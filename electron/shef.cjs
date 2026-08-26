// SHEF = DirecTV's Set-top HTTP Exported Functionality (port 8080 on H21+ receivers).
// One client for real boxes plus an in-process simulator for demo feeds.
// Channels are "major.minor" strings (e.g. "20.1") to match the gym's RF lineup;
// plain "206"-style numbers also work (no minor sent).
const http = require('http');

// The gym's lineup — names exactly as posted.
const LINEUP = {
  '2.1': 'RJC', '11.1': 'WLEX18', '12.1': 'WKYT 27', '13.1': 'WTVQ',
  '14.1': 'WDKY 36', '15.1': 'CNN', '16.1': 'HLN', '17.1': 'FOX',
  '18.1': 'TWC', '19.1': 'E!', '20.1': 'ESPN', '21.1': 'CMT', '22.1': 'HIST',
};

const DEMO_TITLES = {
  '2.1':  ['Class Schedule', 'Club Announcements', 'RJC Highlights'],
  '11.1': ['WLEX 18 News', 'Days of our Lives', 'NBC News Daily'],
  '12.1': ['WKYT News at Noon', 'The Young and the Restless', 'Let’s Make a Deal'],
  '13.1': ['ABC 36 News', 'General Hospital', 'GMA3'],
  '14.1': ['FOX 56 News', 'Judge Judy', 'The People’s Court'],
  '15.1': ['CNN News Central', 'The Lead', 'Situation Room'],
  '16.1': ['Forensic Files', 'On the Case', 'HLN News'],
  '17.1': ['America’s Newsroom', 'The Five', 'Special Report'],
  '18.1': ['Local on the 8s', 'Weather Center Live', 'Storm Watch'],
  '19.1': ['E! News', 'Keeping Up', 'Botched'],
  '20.1': ['SportsCenter', 'First Take', 'NFL Live', 'Pardon the Interruption'],
  '21.1': ['CMT Music', 'Mud Madness', 'Dog and Beth'],
  '22.1': ['Pawn Stars', 'American Pickers', 'The Curse of Oak Island'],
};

const callsignFor = (chan) => LINEUP[chan] || `CH ${chan}`;

function demoTitleFor(chan) {
  const list = DEMO_TITLES[chan] || ['Live Programming'];
  const hour = new Date().getHours();
  const seed = Number(String(chan).replace('.', '')) || 0;
  return list[(seed + hour) % list.length];
}

function parseChan(chan) {
  const [major, minor] = String(chan).split('.');
  return { major: Number(major) || 0, minor: minor != null ? Number(minor) : null };
}

// ---- real box HTTP ----
function getJson(ip, pathname, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: ip, port: 8080, path: pathname, timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('bad json')); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

// ---- demo simulator ----
const demoState = new Map();
function demo(box) {
  if (!demoState.has(box.id)) {
    demoState.set(box.id, { power: box.seedPower !== false, chan: box.seedChan || '20.1' });
  }
  return demoState.get(box.id);
}

// ---- public api ----
async function status(box) {
  if (box.demo) {
    const d = demo(box);
    if (!d.power) return { online: true, mode: 1 };
    const now = new Date();
    const hourStart = Math.floor(now.getTime() / 1000) - (now.getMinutes() * 60 + now.getSeconds());
    return {
      online: true, mode: 0, chan: d.chan, callsign: callsignFor(d.chan),
      title: demoTitleFor(d.chan), startTime: hourStart, duration: 3600,
    };
  }
  try {
    const m = await getJson(box.ip, '/info/mode');
    if (m && m.mode === 1) return { online: true, mode: 1 };
    const t = await getJson(box.ip, '/tv/getTuned');
    // A box with External Access allowed can still refuse getTuned (403 body,
    // no major) until restarted — surface that as "blocked", not "CH undefined".
    if (!t || t.major == null) return { online: true, mode: 0, blocked: true };
    // Satellite channels report minor 65535; OTA/RF locals report a real minor.
    const chan = (t.minor != null && t.minor > 0 && t.minor < 100) ? `${t.major}.${t.minor}` : String(t.major);
    return {
      online: true, mode: 0, chan,
      callsign: t.callsign || callsignFor(chan), title: t.title || '',
      startTime: t.startTime || null, duration: t.duration || null,
    };
  } catch {
    return { online: false };
  }
}

async function tune(box, chan) {
  if (box.demo) {
    const d = demo(box);
    d.power = true;
    d.chan = String(chan);
    return true;
  }
  const { major, minor } = parseChan(chan);
  const qs = minor != null ? `major=${major}&minor=${minor}` : `major=${major}`;
  const r = await getJson(box.ip, `/tv/tune?${qs}`);
  if (r && r.status && r.status.code !== 200) throw new Error(`tune code ${r.status.code}`);
  return true;
}

async function power(box, on) {
  if (box.demo) {
    demo(box).power = !!on;
    return true;
  }
  const key = on ? 'poweron' : 'poweroff';
  const r = await getJson(box.ip, `/remote/processKey?key=${key}&hold=keyPress`);
  if (r && r.status && r.status.code !== 200) throw new Error(`key code ${r.status.code}`);
  return true;
}

async function version(ip, timeoutMs = 700) {
  const v = await getJson(ip, '/info/getVersion', timeoutMs);
  return { ip, receiverId: (v.receiverId || '').trim(), version: v.stbSoftwareVersion || '' };
}

module.exports = { status, tune, power, version, callsignFor };
