// London DI over RS-232 — the BLU-100's serial port speaks the exact same
// framed protocol as TCP :1023 (115200 8-N-1, always listening, no enable
// needed). Network-proof fallback: a USB-serial adapter straight into the
// processor works when Ethernet is unreachable.
//
// WRITE-ONLY by design: a synchronous COM handle serializes reads and writes,
// so a parked ReadFile would wedge every subsequent write (volume commands
// dying silently). Sets/bumps are fire-and-forget; reads return null and the
// UI explains that serial can't read — use pasted London Architect addresses
// and your ears instead of read-back verification.
const fs = require('fs');
const { execFile } = require('child_process');
const { frameBytes, parseAddr, MSG } = require('./bss.cjs');

let fd = null, comName = null;

function configure(com) {
  return new Promise((resolve) => {
    execFile('mode.com', [`${com}:`, 'BAUD=115200', 'PARITY=n', 'DATA=8', 'STOP=1', 'to=on', 'xon=off', 'odsr=off', 'octs=off', 'dtr=on', 'rts=on', 'idsr=off'],
      { windowsHide: true }, () => resolve());
  });
}

function close() {
  if (fd !== null) { try { fs.closeSync(fd); } catch { /* noop */ } }
  fd = null; comName = null;
}

async function open(com) {
  if (fd !== null && comName === com) return;
  close();
  await configure(com);
  fd = fs.openSync('\\\\.\\' + com, 'w');
  comName = com;
}

// driver contract parity: the "ip" slot carries the COM port name in serial mode
async function send(com, frame) {
  if (!com) throw new Error('set the COM port first');
  await open(com);
  try {
    await new Promise((res, rej) => fs.write(fd, frame, 0, frame.length, null, (e) => (e ? rej(e) : res())));
  } catch (e) {
    close(); // stale handle (adapter unplugged etc.) — next call reopens
    throw e;
  }
  return true;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fb = (type, addrStr, paramId, v) => frameBytes(type, parseAddr(addrStr), paramId, v);

const setPercent = (com, addr, paramId, pct) =>
  send(com, fb(MSG.SET_VALUE_PERCENT, addr, paramId, Math.round(Math.max(0, Math.min(100, pct)) * 65536)));
const setValue = (com, addr, paramId, v) => send(com, fb(MSG.SET_VALUE, addr, paramId, v | 0));
const bump = (com, addr, paramId, pctSigned) => send(com, fb(MSG.BUMP_PERCENT, addr, paramId, Math.round(pctSigned * 65536)));

// serial is write-only in this build — callers treat null as "can't read here"
async function readValue() { return null; }

async function probe() {
  throw new Error('probing needs read-back — serial is write-only. Get addresses from London Architect (paste card) and test with Set/Bump.');
}

module.exports = { setPercent, setValue, bump, readValue, probe, sleep, close };
