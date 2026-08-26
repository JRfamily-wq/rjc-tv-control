// RS-232 out to the TVs' existing serial adapters (the old AMX wiring),
// via USB-to-RS232 dongles on this PC. No native modules: configure the
// port with mode.com, then write raw bytes to \\.\COMx.
const { execFile } = require('child_process');
const fs = require('fs');

function configure(port, baud) {
  return new Promise((resolve, reject) => {
    execFile('mode.com', [`${port}:`, `BAUD=${baud}`, 'PARITY=n', 'DATA=8', 'STOP=1'], { windowsHide: true },
      (err) => err ? reject(new Error(`can't open ${port}`)) : resolve());
  });
}

// "A1 00 0B", "0xA1,0x00" → hex bytes; anything else → ASCII (\r \n escapes honored)
function parseCommand(str) {
  const s = String(str || '').trim();
  if (!s) return null;
  const hexish = s.replace(/0x/gi, '').replace(/[,;]/g, ' ').trim();
  if (/^[0-9a-f]{2}(\s+[0-9a-f]{2})*$/i.test(hexish)) {
    return Buffer.from(hexish.split(/\s+/).map((b) => parseInt(b, 16)));
  }
  return Buffer.from(s.replace(/\\r/g, '\r').replace(/\\n/g, '\n'), 'latin1');
}

async function send(port, baud, cmdString) {
  const buf = parseCommand(cmdString);
  if (!buf) throw new Error('no command configured');
  if (!/^COM\d{1,3}$/i.test(String(port))) throw new Error('bad COM port');
  await configure(port, baud);
  await fs.promises.writeFile(`\\\\.\\${String(port).toUpperCase()}`, buf);
  return true;
}

module.exports = { send, parseCommand };
