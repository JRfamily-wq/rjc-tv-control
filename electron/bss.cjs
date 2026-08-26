// BSS Soundweb London "Direct Inject" control (BLU-100/102 et al) — raw TCP :1023.
// Frames: 0x02 [escaped body] [escaped checksum] 0x03; body = msgType + HiQnet
// address (node:2, vd:1, object:3) + paramID:2 + data:4 (big-endian).
// SET_VALUE_PERCENT drives faders as 0-100% (16.16 fixed); SET_VALUE drives mutes;
// SUBSCRIBE is the read-only probe primitive (valid objects answer with SET_VALUE);
// BUMP_PERCENT nudges a fader relatively — the identify-by-ear tool.
const net = require('net');

const MSG = {
  SET_VALUE: 0x88, SUBSCRIBE: 0x89, UNSUBSCRIBE: 0x8a,
  SET_VALUE_PERCENT: 0x8d, SUBSCRIBE_PERCENT: 0x8e, BUMP_PERCENT: 0x90,
};
const SPECIAL = new Set([0x02, 0x03, 0x06, 0x15, 0x1b]);

function parseAddr(s) {
  // "0xC642,0x3,0x11A" or decimal — node, virtual device, object
  const parts = String(s || '').split(',').map((x) => parseInt(x.trim()));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    throw new Error('bad address — want "node,vd,object" (hex 0x… ok)');
  }
  const [node, vd, obj] = parts;
  return [(node >> 8) & 0xff, node & 0xff, vd & 0xff, (obj >> 16) & 0xff, (obj >> 8) & 0xff, obj & 0xff];
}

function frameBytes(type, addrBytes, paramId, value32) {
  const body = [
    type, ...addrBytes,
    (paramId >> 8) & 0xff, paramId & 0xff,
    (value32 >>> 24) & 0xff, (value32 >>> 16) & 0xff, (value32 >>> 8) & 0xff, value32 & 0xff,
  ];
  let ck = 0;
  for (const b of body) ck ^= b;
  const out = [0x02];
  for (const b of [...body, ck]) {
    if (SPECIAL.has(b)) out.push(0x1b, (b + 0x80) & 0xff);
    else out.push(b);
  }
  out.push(0x03);
  return Buffer.from(out);
}

const frame = (type, addrStr, paramId, value32) => frameBytes(type, parseAddr(addrStr), paramId, value32);

// incoming frame parser — devices answer subscriptions with SET_VALUE frames
let onFrame = null;

function attachParser(s) {
  let buf = [], esc = false, inFrame = false;
  s.on('data', (chunk) => {
    for (const byte of chunk) {
      if (byte === 0x02) { inFrame = true; buf = []; esc = false; continue; }
      if (!inFrame) continue;
      if (byte === 0x03) {
        inFrame = false;
        if (buf.length >= 14) {
          const body = buf.slice(0, -1), ck = buf[buf.length - 1];
          let x = 0;
          for (const b of body) x ^= b;
          if (x === ck && onFrame) {
            onFrame({
              type: body[0],
              node: (body[1] << 8) | body[2],
              vd: body[3],
              obj: (body[4] << 16) | (body[5] << 8) | body[6],
              param: (body[7] << 8) | body[8],
              value: (body[9] << 24) | (body[10] << 16) | (body[11] << 8) | body[12],
            });
          }
        }
        continue;
      }
      if (esc) { buf.push((byte - 0x80) & 0xff); esc = false; continue; }
      if (byte === 0x1b) { esc = true; continue; }
      buf.push(byte);
    }
  });
}

// one persistent socket to the processor; reconnect on demand
let sock = null, sockIp = null;

function connect(ip) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection({ host: ip, port: 1023, timeout: 4000 });
    s.on('connect', () => { s.setTimeout(0); attachParser(s); sock = s; sockIp = ip; resolve(s); });
    s.on('timeout', () => { s.destroy(); reject(new Error('timeout')); });
    s.on('error', (e) => { if (sock === s) { sock = null; } reject(e); });
    s.on('close', () => { if (sock === s) { sock = null; } });
  });
}

async function send(ip, buf) {
  if (!sock || sockIp !== ip || sock.destroyed) {
    if (sock) { try { sock.destroy(); } catch { /* noop */ } sock = null; }
    await connect(ip);
  }
  await new Promise((resolve, reject) => sock.write(buf, (e) => (e ? reject(e) : resolve())));
  return true;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const setPercent = (ip, addr, paramId, pct) =>
  send(ip, frame(MSG.SET_VALUE_PERCENT, addr, paramId, Math.round(Math.max(0, Math.min(100, pct)) * 65536)));

const setValue = (ip, addr, paramId, v) =>
  send(ip, frame(MSG.SET_VALUE, addr, paramId, v | 0));

// relative fader move: +/- percent (signed 16.16) — safe identify-by-ear nudges
const bump = (ip, addr, paramId, pctSigned) =>
  send(ip, frame(MSG.BUMP_PERCENT, addr, paramId, Math.round(pctSigned * 65536)));

// Read-only sweep: SUBSCRIBE to candidate objects; collect whatever answers;
// UNSUBSCRIBE everything that responded so no stray subscriptions remain.
async function probe(ip, nodes, objFrom, objTo, paramId, onProgress) {
  const found = new Map();
  onFrame = (f) => {
    if (f.type === MSG.SET_VALUE || f.type === MSG.SET_VALUE_PERCENT) {
      found.set(`${f.node}/${f.vd}/${f.obj}/${f.param}`, f);
    }
  };
  try {
    const total = nodes.length * (objTo - objFrom + 1);
    let done = 0;
    for (const node of nodes) {
      for (let obj = objFrom; obj <= objTo; obj++) {
        const addrBytes = [(node >> 8) & 0xff, node & 0xff, 0x03, (obj >> 16) & 0xff, (obj >> 8) & 0xff, obj & 0xff];
        await send(ip, frameBytes(MSG.SUBSCRIBE, addrBytes, paramId, 0));
        done++;
        if (done % 16 === 0) {
          await sleep(12);
          if (onProgress) onProgress({ done, total, found: found.size });
        }
      }
    }
    await sleep(1200); // let stragglers answer
    // clean up: unsubscribe everything that responded
    for (const f of found.values()) {
      const addrBytes = [(f.node >> 8) & 0xff, f.node & 0xff, f.vd & 0xff, (f.obj >> 16) & 0xff, (f.obj >> 8) & 0xff, f.obj & 0xff];
      await send(ip, frameBytes(MSG.UNSUBSCRIBE, addrBytes, f.param, 0));
      await sleep(3);
    }
  } finally {
    onFrame = null;
  }
  return [...found.values()];
}

module.exports = { setPercent, setValue, bump, probe };
