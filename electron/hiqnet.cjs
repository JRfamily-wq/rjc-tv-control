// HARMAN HiQnet native protocol (TCP :3804) — the language Audio Architect and
// the AMX speak to Soundweb London boxes. Used when the legacy DI port (:1023)
// is disabled in firmware. Big-endian throughout. Header (25 bytes + optional
// 2-byte session number): version, hdrLen, msgLen(4), srcDev(2), srcVd/Obj(4),
// dstDev(2), dstVd/Obj(4), msgId(2), flags(2), hopCount, seq(2).
// Every request gets an explicit reply — INFO (with typed values) or ERROR —
// so probes are decisive, unlike DI's silence.
const net = require('net');
const os = require('os');
const dgram = require('dgram');

const MSG = {
  DISCO: 0x0000, HELLO: 0x0008,
  MULTI_SET: 0x0100, SET_PCT: 0x0102, MULTI_GET: 0x0103,
  SUBSCRIBE: 0x010f, UNSUBSCRIBE: 0x0112,
};
const FLAG = { REQACK: 0x0001, ACK: 0x0002, INFO: 0x0004, ERROR: 0x0008, GUAR: 0x0020, MULTIPART: 0x0040, SESSION: 0x0100 };
const OUR_DEV = 0xfbfb; // our own HiQnet device number — anything unused on the net

// datatype sizes; STRING and BLOCK are length-prefixed
const DT = { BYTE: 0, UBYTE: 1, WORD: 2, UWORD: 3, LONG: 4, ULONG: 5, FLOAT32: 6, FLOAT64: 7, BLOCK: 8, STRING: 9, LONG64: 10, ULONG64: 11 };

function parseAddr(s) {
  const parts = String(s || '').split(',').map((x) => parseInt(x.trim()));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) throw new Error('bad address — want "node,vd,object"');
  return { node: parts[0] & 0xffff, vd: parts[1] & 0xff, obj: parts[2] & 0xffffff };
}

function header(dstDev, dstVd, dstObj, msgId, flags, payloadLen, seq, session) {
  const hdrLen = 25 + (session != null ? 2 : 0);
  const b = Buffer.alloc(hdrLen);
  b[0] = 0x02; b[1] = hdrLen;
  b.writeUInt32BE(hdrLen + payloadLen, 2);
  b.writeUInt16BE(OUR_DEV, 6); // src vd/obj stay 0
  b.writeUInt16BE(dstDev, 12);
  b[14] = dstVd; b[15] = (dstObj >> 16) & 0xff; b[16] = (dstObj >> 8) & 0xff; b[17] = dstObj & 0xff;
  b.writeUInt16BE(msgId, 18);
  b.writeUInt16BE(flags | (session != null ? FLAG.SESSION : 0), 20);
  b[22] = 5;
  b.writeUInt16BE(seq & 0xffff, 23);
  if (session != null) b.writeUInt16BE(session, 25);
  return b;
}

function decodeMsg(m) {
  const hdrLen = m[1];
  return {
    msgId: m.readUInt16BE(18), flags: m.readUInt16BE(20),
    srcDev: m.readUInt16BE(6), srcVd: m[8], srcObj: (m[9] << 16) | (m[10] << 8) | m[11],
    seq: m.readUInt16BE(23), payload: m.slice(Math.min(hdrLen, m.length)), raw: m,
  };
}

// walk a typed value list: [id(2) dtype(1) value...] × count
function parseTypedParams(p) {
  const out = [];
  if (p.length < 2) return out;
  const count = p.readUInt16BE(0);
  let off = 2;
  for (let i = 0; i < count && off + 3 <= p.length; i++) {
    const id = p.readUInt16BE(off); const dt = p[off + 2]; off += 3;
    let value = null;
    try {
      if (dt === DT.BYTE) { value = p.readInt8(off); off += 1; }
      else if (dt === DT.UBYTE) { value = p.readUInt8(off); off += 1; }
      else if (dt === DT.WORD) { value = p.readInt16BE(off); off += 2; }
      else if (dt === DT.UWORD) { value = p.readUInt16BE(off); off += 2; }
      else if (dt === DT.LONG) { value = p.readInt32BE(off); off += 4; }
      else if (dt === DT.ULONG) { value = p.readUInt32BE(off); off += 4; }
      else if (dt === DT.FLOAT32) { value = p.readFloatBE(off); off += 4; }
      else if (dt === DT.FLOAT64) { value = p.readDoubleBE(off); off += 8; }
      else if (dt === DT.BLOCK || dt === DT.STRING) { const n = p.readUInt16BE(off); off += 2 + n; value = null; }
      else if (dt === DT.LONG64 || dt === DT.ULONG64) { off += 8; value = null; }
      else break;
    } catch { break; }
    out.push({ id, dt, value });
  }
  return out;
}

function encodeTyped(dt, v) {
  let b;
  if (dt === DT.BYTE || dt === DT.UBYTE) { b = Buffer.alloc(1); dt === DT.BYTE ? b.writeInt8(v) : b.writeUInt8(v & 0xff); }
  else if (dt === DT.WORD || dt === DT.UWORD) { b = Buffer.alloc(2); dt === DT.WORD ? b.writeInt16BE(v) : b.writeUInt16BE(v & 0xffff); }
  else if (dt === DT.FLOAT32) { b = Buffer.alloc(4); b.writeFloatBE(v); }
  else { b = Buffer.alloc(4); dt === DT.ULONG ? b.writeUInt32BE(v >>> 0) : b.writeInt32BE(v | 0); } // LONG default
  return b;
}

// ---- connection management: one socket per IP, reconnect on demand ----
const conns = new Map(); // ip -> {sock, buf, listeners:Set, seq, session, stats}

function getConn(ip) {
  const c = conns.get(ip);
  if (c && c.sock && !c.sock.destroyed) return Promise.resolve(c);
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: ip, port: 3804, timeout: 4000 });
    const c2 = { sock, buf: Buffer.alloc(0), listeners: new Set(), seq: 1, session: null, stats: { info: 0, errors: 0, acks: 0, bytes: 0, raw: [] } };
    sock.on('connect', () => { sock.setTimeout(0); conns.set(ip, c2); resolve(c2); });
    sock.on('timeout', () => { sock.destroy(); reject(new Error('timeout connecting :3804')); });
    sock.on('error', (e) => { if (conns.get(ip) === c2) conns.delete(ip); reject(e); });
    sock.on('close', () => { if (conns.get(ip) === c2) conns.delete(ip); });
    sock.on('data', (chunk) => ingest(c2, chunk));
  });
}

// shared byte-stream/datagram parser — TCP chunks and UDP datagrams both land here
function ingest(c, chunk) {
  c.stats.bytes += chunk.length;
  if (c.stats.raw.length < 64) for (const b of chunk.slice(0, 64 - c.stats.raw.length)) c.stats.raw.push(b);
  c.buf = Buffer.concat([c.buf, chunk]);
  while (c.buf.length >= 25) {
    if (c.buf[0] !== 0x02) { c.buf = c.buf.slice(1); continue; }
    const len = c.buf.readUInt32BE(2);
    if (len < 25 || len > 0x40000) { c.buf = c.buf.slice(1); continue; }
    if (c.buf.length < len) break;
    const msg = decodeMsg(c.buf.slice(0, len));
    c.buf = c.buf.slice(len);
    if (msg.flags & FLAG.ERROR) c.stats.errors++;
    else if (msg.flags & FLAG.INFO) c.stats.info++;
    else if (msg.flags & FLAG.ACK) c.stats.acks++;
    for (const fn of c.listeners) { try { fn(msg); } catch { /* noop */ } }
  }
}

async function sendMsg(ip, dstDev, dstVd, dstObj, msgId, flags, payload) {
  const c = await getConn(ip);
  const seq = c.seq = (c.seq + 1) & 0xffff;
  const h = header(dstDev, dstVd, dstObj, msgId, flags, payload.length, seq, c.session);
  const buf = Buffer.concat([h, payload]);
  if (c.udp) {
    await new Promise((res, rej) => c.udp.send(buf, 3804, ip, (e) => (e ? rej(e) : res())));
  } else {
    await new Promise((res, rej) => c.sock.write(buf, (e) => (e ? rej(e) : res())));
  }
  return c;
}

// Some London firmware only registers third parties that introduce themselves the
// way Audio Architect does: DiscoInfo over UDP :3804 (broadcast + unicast). If the
// device answers there, the whole conversation moves to UDP datagrams.
function tryUdp(ip, c) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    let u;
    try { u = dgram.createSocket('udp4'); } catch { return finish(null); }
    u.on('error', () => { try { u.close(); } catch { /* noop */ } finish(null); });
    u.on('message', (msg, rinfo) => {
      if (rinfo.address !== ip) return;
      ingest(c, msg);
      finish(u);
    });
    u.bind(0, () => {
      try { u.setBroadcast(true); } catch { /* noop */ }
      const seq = c.seq = (c.seq + 1) & 0xffff;
      const pay = discoPayload();
      const buf = Buffer.concat([header(0xffff, 0, 0, MSG.DISCO, 0, pay.length, seq, null), pay]);
      u.send(buf, 3804, ip, () => { /* noop */ });
      u.send(buf, 3804, '255.255.255.255', () => { /* noop */ });
    });
    setTimeout(() => { if (!settled) { try { u.close(); } catch { /* noop */ } finish(null); } }, 2000);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// wait for the first message matching pred
function waitFor(c, pred, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const fn = (m) => { if (!done && pred(m)) { done = true; c.listeners.delete(fn); resolve(m); } };
    c.listeners.add(fn);
    setTimeout(() => { if (!done) { done = true; c.listeners.delete(fn); resolve(null); } }, timeoutMs);
  });
}

// Our TCP/IP network info for DiscoInfo — the routing layer needs real values
function nicInfo() {
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const a of ifs[name] || []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) {
        return {
          mac: (a.mac || '').split(':').map((x) => parseInt(x, 16) || 0).concat([0, 0, 0, 0, 0, 0]).slice(0, 6),
          ip: a.address.split('.').map(Number),
          mask: (a.netmask || '255.255.255.0').split('.').map(Number),
        };
      }
    }
  }
  return { mac: [0, 0, 0, 0, 0, 0], ip: [0, 0, 0, 0], mask: [255, 255, 255, 0] };
}

// DiscoInfo payload: device, cost, serial (BLOCK 16), maxMsgSize, keepAlive ms,
// networkID(1=TCP/IP), then MAC + DHCP + IP + subnet + gateway
function discoPayload() {
  const n = nicInfo();
  const b = Buffer.alloc(2 + 1 + 2 + 16 + 4 + 2 + 1 + 6 + 1 + 4 + 4 + 4);
  let o = 0;
  b.writeUInt16BE(OUR_DEV, o); o += 2;
  b[o++] = 1; // cost
  b.writeUInt16BE(16, o); o += 2;
  Buffer.from('RJC-TV-CONTROL\0\0', 'latin1').copy(b, o); o += 16;
  b.writeUInt32BE(0xffff, o); o += 4; // max message size
  b.writeUInt16BE(10000, o); o += 2;  // keep-alive period ms
  b[o++] = 1; // network id: TCP/IP
  for (const x of n.mac) b[o++] = x & 0xff;
  b[o++] = 1; // DHCP
  for (const x of n.ip) b[o++] = x & 0xff;
  for (const x of n.mask) b[o++] = x & 0xff;
  o += 4; // gateway 0.0.0.0
  return b;
}

// Login liturgy per HARMAN's third-party guide: (1) DiscoInfo query broadcast —
// introduces us so the routing layer has a way back (without this the device
// silently drops everything), (2) Hello session handshake — adopt the device's
// session number for our header extensions, (3) DiscoInfo(Info) keep-alives.
async function ensureSession(ip, node) {
  const c = await getConn(ip);
  if (c.helloTried) return c;
  c.helloTried = true;
  try {
    await sendMsg(ip, 0xffff, 0, 0, MSG.DISCO, 0, discoPayload());
    let disco = await waitFor(c, (m) => m.msgId === MSG.DISCO, 1500);
    if (!disco) {
      // TCP stranger ignored — introduce ourselves over UDP like AA does
      const waiter = waitFor(c, (m) => m.msgId === MSG.DISCO, 2200);
      const u = await tryUdp(ip, c);
      if (u) { c.udp = u; c.transport = 'udp'; }
      disco = await waiter;
    } else {
      c.transport = 'tcp';
    }
    if (disco) c.deviceDev = disco.srcDev;
    const sess = 1 + Math.floor(0xfff0 * ((Date.now() % 10000) / 10000));
    const pay = Buffer.alloc(4);
    pay.writeUInt16BE(sess, 0); pay.writeUInt16BE(FLAG.SESSION, 2);
    await sendMsg(ip, node, 0, 0, MSG.HELLO, 0, pay);
    const rep = await waitFor(c, (m) => m.msgId === MSG.HELLO, 1200);
    if (rep && (rep.flags & FLAG.INFO) && rep.payload.length >= 2) c.session = rep.payload.readUInt16BE(0);
    c.ka = setInterval(() => { sendMsg(ip, 0xffff, 0, 0, MSG.DISCO, FLAG.INFO, discoPayload()).catch(() => { /* noop */ }); }, 5000);
    c.sock.on('close', () => clearInterval(c.ka));
  } catch { /* proceed best-effort */ }
  return c;
}

// read one or more SVs from an object; resolves {values:[{id,dt,value}]} | {error} | null (silence)
async function getParams(ip, node, vd, obj, svIds, timeoutMs = 1200) {
  const c = await ensureSession(ip, node);
  const pay = Buffer.alloc(2 + svIds.length * 2);
  pay.writeUInt16BE(svIds.length, 0);
  svIds.forEach((id, i) => pay.writeUInt16BE(id, 2 + i * 2));
  await sendMsg(ip, node, vd, obj, MSG.MULTI_GET, 0, pay);
  const rep = await waitFor(c, (m) =>
    (m.msgId === MSG.MULTI_GET || m.msgId === MSG.MULTI_SET) && m.srcVd === vd && m.srcObj === obj, timeoutMs);
  if (!rep) return null;
  if (rep.flags & FLAG.ERROR) return { error: rep.payload.length ? rep.payload[0] : -1 };
  return { values: parseTypedParams(rep.payload) };
}

const dtCache = new Map(); // `${ip}/${node}/${vd}/${obj}/${sv}` -> datatype

async function readValue(ip, addrStr, sv, timeoutMs = 1200) {
  const a = parseAddr(addrStr);
  const r = await getParams(ip, a.node, a.vd, a.obj, [sv], timeoutMs);
  if (!r || r.error != null || !r.values || !r.values.length) return null;
  const v = r.values.find((x) => x.id === sv) || r.values[0];
  dtCache.set(`${ip}/${a.node}/${a.vd}/${a.obj}/${sv}`, v.dt);
  return v.value;
}

async function setValue(ip, addrStr, sv, value) {
  const a = parseAddr(addrStr);
  let dt = dtCache.get(`${ip}/${a.node}/${a.vd}/${a.obj}/${sv}`);
  if (dt == null) { await readValue(ip, addrStr, sv); dt = dtCache.get(`${ip}/${a.node}/${a.vd}/${a.obj}/${sv}`); }
  if (dt == null) dt = DT.LONG;
  const val = encodeTyped(dt, value);
  const pay = Buffer.concat([Buffer.from([0, 1]), (() => { const b = Buffer.alloc(3); b.writeUInt16BE(sv, 0); b[2] = dt; return b; })(), val]);
  await sendMsg(ip, a.node, a.vd, a.obj, MSG.MULTI_SET, 0, pay);
  return true;
}

// slider: map 0-100% onto -60..0 dB (London gain values are dB × 10000)
const setPercent = (ip, addrStr, sv, pct) =>
  setValue(ip, addrStr, sv, Math.round((Math.max(0, Math.min(100, pct)) * 0.6 - 60) * 10000));

// Decisive sweep: MultiParamGet every object; INFO replies carry live values,
// ERROR replies prove the box heard us. Pipelined for speed.
async function probe(ip, nodes, objFrom, objTo, svIds, onProgress) {
  const found = new Map();
  const c = await ensureSession(ip, nodes[0]);
  c.stats.info = 0; c.stats.errors = 0; c.stats.acks = 0; c.stats.bytes = 0; c.stats.raw = [];
  const collector = (m) => {
    if ((m.msgId === MSG.MULTI_GET || m.msgId === MSG.MULTI_SET) && (m.flags & FLAG.INFO)) {
      for (const v of parseTypedParams(m.payload)) {
        if (v.value == null) continue;
        found.set(`${m.srcDev}/${m.srcVd}/${m.srcObj}/${v.id}`, { node: m.srcDev, vd: m.srcVd, obj: m.srcObj, param: v.id, value: v.value, dt: v.dt });
      }
    }
  };
  c.listeners.add(collector);
  try {
    const pay = Buffer.alloc(2 + svIds.length * 2);
    pay.writeUInt16BE(svIds.length, 0);
    svIds.forEach((id, i) => pay.writeUInt16BE(id, 2 + i * 2));
    const total = nodes.length * (objTo - objFrom + 1);
    let done = 0;
    for (const node of nodes) {
      for (let obj = objFrom; obj <= objTo; obj++) {
        await sendMsg(ip, node, 0x03, obj, MSG.MULTI_GET, 0, pay);
        done++;
        if (done % 16 === 0) {
          await sleep(8);
          if (onProgress) onProgress({ done, total, found: found.size });
        }
      }
    }
    await sleep(1500);
  } finally {
    c.listeners.delete(collector);
  }
  const rawHex = c.stats.raw.map((b) => b.toString(16).padStart(2, '0')).join(' ');
  for (const f of found.values()) dtCache.set(`${ip}/${f.node}/${f.vd}/${f.obj}/${f.param}`, f.dt);
  return { found: [...found.values()], diag: { info: c.stats.info, errors: c.stats.errors, acks: c.stats.acks, bytes: c.stats.bytes, rawHex, session: c.session, deviceDev: c.deviceDev == null ? null : c.deviceDev, transport: c.transport || 'none' } };
}

module.exports = { probe, readValue, setValue, setPercent, getParams, sleep };
