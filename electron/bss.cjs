// BSS Soundweb London "Direct Inject" control (BLU-100 et al) — raw TCP :1023.
// Frames: 0x02 [escaped body] [escaped checksum] 0x03; body = msgType + HiQnet
// address (node:2, vd:1, object:3) + paramID:2 + data:4 (big-endian).
// SET_VALUE_PERCENT drives faders as 0-100% (16.16 fixed); SET_VALUE drives mutes.
const net = require('net');

const MSG = { SET_VALUE: 0x88, SUBSCRIBE: 0x89, SET_VALUE_PERCENT: 0x8d, BUMP_PERCENT: 0x90 };
const SPECIAL = new Set([0x02, 0x03, 0x06, 0x15, 0x1b]);

function parseAddr(s) {
  // "0x100,0x3,0x152" or decimal — node, virtual device, object
  const parts = String(s || '').split(',').map((x) => parseInt(x.trim()));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    throw new Error('bad address — want "node,vd,object" (hex 0x… ok)');
  }
  const [node, vd, obj] = parts;
  return [(node >> 8) & 0xff, node & 0xff, vd & 0xff, (obj >> 16) & 0xff, (obj >> 8) & 0xff, obj & 0xff];
}

function frame(type, addrStr, paramId, value32) {
  const body = [
    type, ...parseAddr(addrStr),
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

// one persistent socket to the processor; reconnect on demand
let sock = null, sockIp = null;

function connect(ip) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection({ host: ip, port: 1023, timeout: 4000 });
    s.on('connect', () => { s.setTimeout(0); sock = s; sockIp = ip; resolve(s); });
    s.on('timeout', () => { s.destroy(); reject(new Error('timeout')); });
    s.on('error', (e) => { if (sock === s) { sock = null; } reject(e); });
    s.on('close', () => { if (sock === s) { sock = null; } });
    s.on('data', () => { /* subscription echoes ignored in v1 */ });
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

const setPercent = (ip, addr, paramId, pct) =>
  send(ip, frame(MSG.SET_VALUE_PERCENT, addr, paramId, Math.round(Math.max(0, Math.min(100, pct)) * 65536)));

const setValue = (ip, addr, paramId, v) =>
  send(ip, frame(MSG.SET_VALUE, addr, paramId, v | 0));

module.exports = { setPercent, setValue };
