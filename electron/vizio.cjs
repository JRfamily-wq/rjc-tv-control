// Vizio SmartCast local API (HTTPS on port 7345, self-signed cert) — the modern
// replacement for the old AMX RS-232 path. Consumer sets like the V505M-K09
// have no serial port; every SmartCast Vizio speaks this instead.
// Flow: pair once per TV (a PIN appears on its screen), keep the AUTH token,
// then send key commands (power / volume / mute).
const https = require('https');

const DEVICE_ID = 'rjc-tv-control';
const DEVICE_NAME = 'RJC TV Control';

function req(ip, path, body, token, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const r = https.request({
      host: ip, port: 7345, path, method: 'PUT',
      rejectUnauthorized: false, timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...(token ? { AUTH: token } : {}),
      },
    }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch { reject(new Error('bad response')); } });
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', reject);
    r.end(data);
  });
}

const ok = (j) => j && j.STATUS && String(j.STATUS.RESULT).toUpperCase() === 'SUCCESS';

const pending = new Map(); // ip -> PAIRING_REQ_TOKEN

async function pairStart(ip) {
  const j = await req(ip, '/pairing/start', { DEVICE_ID, DEVICE_NAME });
  if (!ok(j) || !j.ITEM) throw new Error((j && j.STATUS && j.STATUS.DETAIL) || 'pairing refused');
  pending.set(ip, j.ITEM.PAIRING_REQ_TOKEN);
  return true;
}

async function pairFinish(ip, pin) {
  const reqToken = pending.get(ip);
  if (reqToken == null) throw new Error('no pairing in progress');
  const j = await req(ip, '/pairing/pair', {
    DEVICE_ID, CHALLENGE_TYPE: 1, RESPONSE_VALUE: String(pin).trim(), PAIRING_REQ_TOKEN: reqToken,
  });
  if (!ok(j) || !j.ITEM || !j.ITEM.AUTH_TOKEN) throw new Error('wrong PIN');
  pending.delete(ip);
  return j.ITEM.AUTH_TOKEN;
}

const KEYS = {
  volUp: [5, 1],
  volDown: [5, 0],
  muteToggle: [5, 4],
  powerOn: [11, 1],
  powerOff: [11, 0],
};

async function key(ip, token, name) {
  const [codeset, code] = KEYS[name];
  const j = await req(ip, '/key_command/', {
    KEYLIST: [{ CODESET: codeset, CODE: code, ACTION: 'KEYPRESS' }],
  }, token);
  if (!ok(j)) throw new Error('key rejected');
  return true;
}

module.exports = { pairStart, pairFinish, key };
