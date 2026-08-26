// Global Caché iTach IP2IR — network-to-IR blaster (TCP port 4998).
// Third transport fallback: works on any TV with a stick-on emitter,
// regardless of what ports the set has. Commands are standard "sendir"
// strings pasted from Global Caché's IR database (or learned); we retarget
// the module:port and ID to the TV's configured emitter.
const net = require('net');

let counter = 0;

function adjustCommand(cmd, port) {
  const parts = String(cmd).trim().split(',');
  if (parts[0] !== 'sendir' || parts.length < 6) throw new Error('not a sendir command');
  parts[1] = `1:${port}`;
  parts[2] = String((++counter % 65000) + 1);
  return parts.join(',');
}

function send(ip, port, cmd, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    let line;
    try { line = adjustCommand(cmd, port); } catch (e) { return reject(e); }
    const sock = net.createConnection({ host: ip, port: 4998, timeout: timeoutMs });
    let buf = '';
    const fail = (e) => { sock.destroy(); reject(e); };
    sock.on('timeout', () => fail(new Error('timeout')));
    sock.on('error', fail);
    sock.on('connect', () => sock.write(line + '\r'));
    sock.on('data', (d) => {
      buf += d;
      if (buf.includes('completeir')) { sock.end(); resolve(true); }
      else if (buf.includes('ERR')) fail(new Error(buf.trim()));
    });
  });
}

module.exports = { send };
