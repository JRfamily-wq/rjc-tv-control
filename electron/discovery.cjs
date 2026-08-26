// Subnet sweep: try /info/getVersion on :8080 across every local /24.
const os = require('os');
const shef = require('./shef.cjs');

function bases() {
  const out = new Set();
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const addr of ifs[name] || []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      if (addr.address.startsWith('169.254.')) continue;
      out.add(addr.address.split('.').slice(0, 3).join('.'));
    }
  }
  return [...out];
}

async function scan(onProgress) {
  const targets = [];
  for (const base of bases()) {
    for (let i = 1; i <= 254; i++) targets.push(`${base}.${i}`);
  }
  const found = [];
  let done = 0;
  const CONC = 64;
  let idx = 0;
  async function worker() {
    while (idx < targets.length) {
      const ip = targets[idx++];
      try {
        const v = await shef.version(ip, 650);
        if (v && v.receiverId) found.push(v);
      } catch { /* not a box */ }
      done++;
      if (onProgress && done % 32 === 0) onProgress({ done, total: targets.length, found: found.length });
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  found.sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
  return { found, scanned: targets.length };
}

module.exports = { scan };
