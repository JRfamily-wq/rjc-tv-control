const { app, BrowserWindow, ipcMain, Menu, dialog, shell, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const { execFile } = require('child_process');
const store = require('./store.cjs');
const shef = require('./shef.cjs');
const discovery = require('./discovery.cjs');
const vizio = require('./vizio.cjs');
const serial = require('./serial.cjs');
const itach = require('./itach.cjs');
const bss = require('./bss.cjs');
const hq = require('./hiqnet.cjs');
const bser = require('./bss-serial.cjs');
// audio driver: DI over TCP :1023, native HiQnet :3804, or DI over RS-232.
// In serial mode the "ip" argument carries the COM port name instead.
const audioDrv = (cfg) => {
  const p = (cfg.audio || {}).protocol;
  return p === 'hiqnet' ? hq : p === 'serial' ? bser : bss;
};
const audioTarget = (cfg) => ((cfg.audio || {}).protocol === 'serial' ? (cfg.audio.comPort || '') : (cfg.audio || {}).ip);

const argOf = (k) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split('=').slice(1).join('=') : null;
};
const shotPath = argOf('shot');
// Harness truth: on the GPU path, restyled-but-unchanged layers can keep stale
// tiles in capturePage() on background windows. Software rendering paints honest.
if (shotPath) { try { app.disableHardwareAcceleration(); } catch { /* noop */ } }
const devTools = process.argv.includes('--dev');
// Harness isolation: keep screenshot/test runs out of the real config —
// a live instance (someone actually using the app) shares userData otherwise.
const userDataOverride = argOf('userdata');
if (userDataOverride) app.setPath('userData', userDataOverride);
let win = null;

// The screenshot harness launches instances back-to-back — skip the lock there.
if (!shotPath) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
    });
  }
}

app.setAppUserModelId('com.drew.rjcgymtv');
Menu.setApplicationMenu(null);

// ---------- status polling ----------
const statuses = {};
let pollTimer = null;
let polling = false;

const boxById = (id) => store.load().boxes.find((b) => b.id === id);

function broadcast(ch, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(ch, payload);
}

// ---------- event log (ring buffer, feeds the Diagnostics tab) ----------
const LOG = [];
const STARTED_AT = Date.now();
function log(level, source, message) {
  const entry = { ts: Date.now(), level, source, message };
  LOG.push(entry);
  if (LOG.length > 600) LOG.shift();
  broadcast('log', entry);
}

// ---------- keep-awake ----------
// The gym touchscreens must stay on and unlocked through a whole shift.
// 'prevent-display-sleep' pins ES_DISPLAY_REQUIRED|ES_SYSTEM_REQUIRED on
// Windows: no system sleep, no screen-off, no screensaver — and since the
// idle lock rides on those, no lock either. A domain "machine inactivity
// limit" policy is the one thing that can still lock; only IT can lift that.
// The app's own sleep-screen clock is unaffected — that's the burn-in guard.
let keepAwakeId = null;
function syncKeepAwake() {
  const want = store.load().keepAwake;
  const have = keepAwakeId !== null && powerSaveBlocker.isStarted(keepAwakeId);
  if (want && !have) {
    keepAwakeId = powerSaveBlocker.start('prevent-display-sleep');
    log('info', 'app', 'Keep-awake on — PC sleep, screen-off and idle lock held off while the app is open');
  } else if (!want && have) {
    powerSaveBlocker.stop(keepAwakeId);
    keepAwakeId = null;
    log('info', 'app', 'Keep-awake off — Windows power settings back in charge');
  }
}
app.on('will-quit', () => {
  if (keepAwakeId !== null && powerSaveBlocker.isStarted(keepAwakeId)) powerSaveBlocker.stop(keepAwakeId);
});

async function pollBoxes(boxes) {
  const CONC = 8;
  let idx = 0;
  async function worker() {
    while (idx < boxes.length) {
      const box = boxes[idx++];
      const prev = statuses[box.id];
      const res = await shef.status(box);
      statuses[box.id] = {
        ...res, ts: Date.now(),
        lastOk: res.online ? Date.now() : (prev && prev.lastOk) || null,
      };
      // Log state transitions only — never the steady state.
      if (prev) {
        if (prev.online && !res.online) log('warn', 'feed', `${box.name} (${box.ip}) went offline`);
        else if (!prev.online && res.online) log('info', 'feed', `${box.name} back online`);
        else if (res.online && prev.mode !== res.mode) log('info', 'feed', `${box.name} ${res.mode === 1 ? 'entered standby' : 'woke up'}`);
      } else if (!res.online && !box.demo) {
        log('warn', 'feed', `${box.name} (${box.ip}) not responding`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, boxes.length) }, worker));
}

async function pollAll() {
  if (polling) return;
  polling = true;
  try {
    const cfg = store.load();
    const ids = new Set(cfg.boxes.map((b) => b.id));
    for (const id of Object.keys(statuses)) if (!ids.has(id)) delete statuses[id];
    await pollBoxes(cfg.boxes);
    broadcast('status', statuses);
  } finally {
    polling = false;
  }
}

function schedule() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    await pollAll();
    schedule();
  }, store.load().pollSeconds * 1000);
}

function pollSoon(ids, delayMs = 1200) {
  setTimeout(async () => {
    const boxes = ids.map(boxById).filter(Boolean);
    await pollBoxes(boxes);
    broadcast('status', statuses);
  }, delayMs);
}

// ---------- ipc ----------
ipcMain.handle('state:get', () => ({ config: store.load(), statuses }));

ipcMain.handle('config:update', (_e, partial) => {
  const cfg = store.update(partial || {});
  broadcast('config', cfg);
  syncKeepAwake();
  pollAll();
  return cfg;
});

ipcMain.handle('tv:tune', async (_e, { boxIds, chan }) => {
  chan = String(chan);
  const ok = [], fail = [];
  await Promise.all(boxIds.map(async (id) => {
    const box = boxById(id);
    if (!box) return fail.push({ id, err: 'unknown box' });
    try {
      // Wake a box that we last saw in standby, then tune.
      if (statuses[id] && statuses[id].online && statuses[id].mode === 1) {
        await shef.power(box, true);
        await new Promise((r) => setTimeout(r, 700));
      }
      await shef.tune(box, chan);
      statuses[id] = { online: true, mode: 0, chan, callsign: shef.callsignFor(chan), title: '', ts: Date.now() };
      ok.push(id);
    } catch (e) {
      fail.push({ id, err: String(e.message || e) });
    }
  }));
  broadcast('status', statuses);
  pollSoon(ok, 1500);
  // Remember what was set from the panel — tiles display this even when a box
  // refuses channel readback (the persisted placeholder).
  if (ok.length) {
    const cfg = store.load();
    store.update({ boxes: cfg.boxes.map((b) => ok.includes(b.id) ? { ...b, lastChan: chan } : b) });
    broadcast('config', store.load());
  }
  const names = (ids) => ids.map((i) => (boxById(i) || {}).name || i).join(', ');
  log(fail.length ? 'warn' : 'info', 'tune',
    `Tune ${chan} (${shef.callsignFor(chan)}) → ${names(ok) || 'none'}${fail.length ? `; FAILED: ${fail.map((f) => `${(boxById(f.id) || {}).name || f.id} (${f.err})`).join(', ')}` : ''}`);
  return { ok, fail };
});

ipcMain.handle('tv:power', async (_e, { boxIds, on }) => {
  const ok = [], fail = [];
  await Promise.all(boxIds.map(async (id) => {
    const box = boxById(id);
    if (!box) return fail.push({ id, err: 'unknown box' });
    try {
      await shef.power(box, on);
      if (statuses[id]) statuses[id] = { ...statuses[id], online: true, mode: on ? 0 : 1, ts: Date.now() };
      ok.push(id);
    } catch (e) {
      fail.push({ id, err: String(e.message || e) });
    }
  }));
  broadcast('status', statuses);
  pollSoon(ok, 1500);
  log(fail.length ? 'warn' : 'info', 'power', `${on ? 'Wake' : 'Standby'} → ${ok.length} feed${ok.length === 1 ? '' : 's'}${fail.length ? `, ${fail.length} failed` : ''}`);
  return { ok, fail };
});

const identifyRestores = new Map();
ipcMain.handle('tv:identify', async (_e, { boxId }) => {
  const box = boxById(boxId);
  if (!box) return { ok: false };
  const cfg = store.load();
  const prev = statuses[boxId] && statuses[boxId].mode === 0 ? statuses[boxId].chan : null;
  try {
    await shef.tune(box, cfg.identifyChannel);
    statuses[boxId] = { online: true, mode: 0, chan: String(cfg.identifyChannel), callsign: shef.callsignFor(cfg.identifyChannel), title: '', ts: Date.now() };
    broadcast('status', statuses);
    clearTimeout(identifyRestores.get(boxId));
    if (prev && prev !== String(cfg.identifyChannel)) {
      identifyRestores.set(boxId, setTimeout(async () => {
        try { await shef.tune(box, prev); } catch { /* box went away */ }
        pollSoon([boxId], 300);
      }, 25000));
    }
    return { ok: true, channel: cfg.identifyChannel, restoreIn: prev ? 25 : 0 };
  } catch (e) {
    return { ok: false, err: String(e.message || e) };
  }
});

// ---------- Vizio SmartCast (TV panels: pair / volume / power) ----------
const tvById = (id) => store.load().tvs.find((t) => t.id === id);

function saveTv(tvId, mut) {
  const cfg = store.load();
  const tvs = cfg.tvs.map((t) => t.id === tvId ? mut({ ...t }) : t);
  store.update({ tvs });
  broadcast('config', store.load());
}

ipcMain.handle('vizio:pairStart', async (_e, { tvId, ip }) => {
  const tv = tvById(tvId);
  if (!tv) return { ok: false, err: 'unknown tv' };
  if (tv.demo) { saveTv(tvId, (t) => ({ ...t, tvIp: ip })); return { ok: true, demo: true }; }
  try {
    await vizio.pairStart(ip);
    saveTv(tvId, (t) => ({ ...t, tvIp: ip }));
    return { ok: true };
  } catch (e) { return { ok: false, err: String(e.message || e) }; }
});

ipcMain.handle('vizio:pairPin', async (_e, { tvId, pin }) => {
  const tv = tvById(tvId);
  if (!tv) return { ok: false, err: 'unknown tv' };
  if (tv.demo) { saveTv(tvId, (t) => ({ ...t, tvToken: 'demo' })); return { ok: true }; }
  try {
    const token = await vizio.pairFinish(tv.tvIp, pin);
    saveTv(tvId, (t) => ({ ...t, tvToken: token }));
    return { ok: true };
  } catch (e) { return { ok: false, err: String(e.message || e) }; }
});

ipcMain.handle('vizio:unpair', (_e, { tvId }) => {
  saveTv(tvId, (t) => ({ ...t, tvToken: null }));
  return { ok: true };
});

// One dispatcher, two transports: SmartCast over IP, or raw RS-232 through
// the old AMX adapter wiring (per-TV COM port + shared command set).
async function tvCommand(tv, action) {
  if (tv.ctl === 'serial') {
    const cfg = store.load();
    const cmd = (cfg.serial && cfg.serial.commands && cfg.serial.commands[action]) || '';
    if (!tv.serialPort || !cmd) return 'skip';
    await serial.send(tv.serialPort, (cfg.serial && cfg.serial.baud) || 9600, cmd);
    return 'ok';
  }
  if (tv.ctl === 'ir') {
    const cfg = store.load();
    const cmd = (cfg.itach && cfg.itach.commands && cfg.itach.commands[action]) || '';
    if (!tv.itachIp || !cmd) return 'skip';
    await itach.send(tv.itachIp, tv.itachPort || 1, cmd);
    return 'ok';
  }
  if (!tv.tvToken) return 'skip';
  if (tv.tvToken === 'demo') return 'ok';
  await vizio.key(tv.tvIp, tv.tvToken, action);
  return 'ok';
}

async function vizioEach(tvIds, keyName) {
  const ok = [], fail = [];
  let skipped = 0;
  await Promise.all(tvIds.map(async (id) => {
    const tv = tvById(id);
    if (!tv) { skipped++; return; }
    try {
      const r = await tvCommand(tv, keyName);
      if (r === 'ok') ok.push(id); else skipped++;
    } catch (e) { fail.push({ id, err: String(e.message || e) }); }
  }));
  if (fail.length) {
    log('warn', 'tvctl', `${keyName} failed on ${fail.map((f) => `${(tvById(f.id) || {}).name || f.id} (${f.err})`).join(', ')}`);
  } else if (ok.length) {
    log('info', 'tvctl', `${keyName} → ${ok.length} TV${ok.length === 1 ? '' : 's'}`);
  }
  return { ok, fail, skipped };
}

ipcMain.handle('vizio:vol', (_e, { tvIds, action }) =>
  vizioEach(tvIds, action === 'mute' ? 'muteToggle' : action === 'up' ? 'volUp' : 'volDown'));

ipcMain.handle('vizio:power', (_e, { tvIds, on }) =>
  vizioEach(tvIds, on ? 'powerOn' : 'powerOff'));

// ---------- BSS speaker audio ----------
const audioZone = (id) => ((store.load().audio || {}).zones || []).find((z) => z.id === id);

ipcMain.handle('audio:set', async (_e, { zoneId, pct }) => {
  const cfg = store.load();
  const z = audioZone(zoneId);
  if (!cfg.audio || !audioTarget(cfg) || !z || !z.addr) return { ok: false, err: 'not configured' };
  try {
    await audioDrv(cfg).setPercent(audioTarget(cfg), z.addr, z.gainParam ?? 0, pct);
    return { ok: true };
  } catch (e) {
    log('warn', 'audio', `Volume set failed for ${z.name}: ${e.message}`);
    return { ok: false, err: String(e.message || e) };
  }
});

ipcMain.handle('audio:mute', async (_e, { zoneId, muted }) => {
  const cfg = store.load();
  const z = audioZone(zoneId);
  if (!cfg.audio || !audioTarget(cfg) || !z || !z.addr) return { ok: false, err: 'not configured' };
  try {
    await audioDrv(cfg).setValue(audioTarget(cfg), z.addr, z.muteParam ?? 1, muted ? 1 : 0);
    log('info', 'audio', `${z.name} ${muted ? 'muted' : 'unmuted'}`);
    return { ok: true };
  } catch (e) {
    log('warn', 'audio', `Mute failed for ${z.name}: ${e.message}`);
    return { ok: false, err: String(e.message || e) };
  }
});

ipcMain.handle('audio:probe', async (_e, { nodes, objFrom, objTo }) => {
  const cfg = store.load();
  if (!cfg.audio || !audioTarget(cfg)) return { ok: false, err: 'set the processor IP / COM port first' };
  try {
    log('info', 'audio', `Probe started: nodes ${nodes.map((n) => '0x' + n.toString(16).toUpperCase()).join(', ')}, objects 0x${objFrom.toString(16)}–0x${objTo.toString(16)} (read-only)`);
    const serialMode = (cfg.audio || {}).protocol === 'serial';
    const { found, diag } = await (serialMode ? bser : bss).probe(audioTarget(cfg), nodes, objFrom, objTo, [0, 1], (p) => broadcast('audioprobe', p));
    const verdict = found.length ? `${found.length} responding control${found.length === 1 ? '' : 's'}`
      : diag.naks > 0 ? `0 controls — device NAK'd ${diag.naks} queries (protocol mismatch)`
      : diag.acks > 0 ? `0 controls — device ACK'd ${diag.acks} queries; these object numbers just don't exist`
      : diag.bytes > 0 ? `0 controls — ${diag.bytes} bytes of non-DI traffic received (first: ${diag.rawHex})`
      : `0 controls — device sent NOTHING back (port open, DI silent)`;
    log('info', 'audio', `Probe done: ${verdict}`);
    return { ok: true, found, diag };
  } catch (e) {
    log('warn', 'audio', `Probe failed: ${e.message}`);
    return { ok: false, err: String(e.message || e) };
  }
});

// Native HiQnet (:3804) probe — the protocol AA/AMX use. Every query is
// answered (INFO with live values, or an explicit error), so results are decisive.
ipcMain.handle('audio:hqprobe', async (_e, { nodes, objFrom, objTo }) => {
  const cfg = store.load();
  if (!cfg.audio || !cfg.audio.ip) return { ok: false, err: 'set the processor IP first' };
  try {
    log('info', 'audio', `HiQnet probe started on :3804 — nodes ${nodes.map((n) => '0x' + n.toString(16).toUpperCase()).join(', ')}, objects 0x${objFrom.toString(16)}–0x${objTo.toString(16)}`);
    const { found, diag } = await hq.probe(cfg.audio.ip, nodes, objFrom, objTo, [0, 1], (p) => broadcast('audioprobe', p));
    const verdict = found.length ? `${found.length} live control${found.length === 1 ? '' : 's'} (via ${diag.transport}, session ${diag.session == null ? 'none' : diag.session})`
      : diag.errors > 0 ? `0 controls — device answered ${diag.errors} explicit errors (heard us; objects not here)`
      : diag.info > 0 ? `0 controls — ${diag.info} info replies but none parseable (first bytes: ${diag.rawHex})`
      : diag.bytes > 0 ? `0 controls — unrecognized traffic (first bytes: ${diag.rawHex})`
      : diag.deviceDev != null ? `0 controls — device 0x${diag.deviceDev.toString(16).toUpperCase()} answered the login (via ${diag.transport}) but ignored the queries`
      : `0 controls — :3804 silent on TCP and UDP${diag.udpStatus === 'bound' ? ' (we owned udp/3804 and heard nothing — likely the Windows Firewall blocking inbound UDP; use Fix firewall)' : diag.udpStatus === 'inuse' ? ' (udp/3804 is exclusively held by another program — close it and probe again)' : ''}`;
    log('info', 'audio', `HiQnet probe done: ${verdict}`);
    return { ok: true, found, diag, via: 'hiqnet' };
  } catch (e) {
    log('warn', 'audio', `Probe failed: ${e.message}`);
    return { ok: false, err: String(e.message || e) };
  }
});

// One-click firewall rule: HiQnet replies arrive as inbound UDP on 3804, and a
// portable exe gets a fresh firewall identity every version. Port-scoped rule
// (any program) so it survives future versions. Elevates via UAC.
ipcMain.handle('audio:fixfw', async () => {
  const { spawn } = require('child_process');
  try {
    spawn('powershell.exe', ['-NoProfile', '-Command',
      `Start-Process netsh -Verb RunAs -ArgumentList 'advfirewall firewall add rule name="RJC TV Control HiQnet" dir=in action=allow protocol=UDP localport=3804'`],
      { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    log('info', 'audio', 'Firewall rule requested (UAC) — allow it, then probe again');
    return { ok: true };
  } catch (e) { return { ok: false, err: String(e.message || e) }; }
});

// Identity check: ping the IP, then read the ARP table for the MAC that
// actually answered. BSS London MACs are 00-0F-D4-xx-xx-xx with the HiQnet
// node as the last two bytes — a mismatched MAC = IP conflict found.
ipcMain.handle('net:arpcheck', async (_e, { ip }) => {
  const { execFile } = require('child_process');
  const run = (cmd, args) => new Promise((res) => execFile(cmd, args, { windowsHide: true, timeout: 8000 }, (err, stdout) => res(String(stdout || ''))));
  try {
    const ping = await run('ping.exe', ['-n', '1', '-w', '1500', ip]);
    const alive = /TTL=/i.test(ping);
    const arp = await run('arp.exe', ['-a']);
    let mac = null;
    for (const line of arp.split(/\r?\n/)) {
      const m = line.match(/^\s*([\d.]+)\s+([0-9a-f-]{17})/i);
      if (m && m[1] === ip) { mac = m[2].toLowerCase(); break; }
    }
    log('info', 'net', `Identity check ${ip}: ${alive ? 'ping OK' : 'no ping reply'}, MAC ${mac || 'not in ARP table'}`);
    return { ok: true, alive, mac };
  } catch (e) { return { ok: false, err: String(e.message || e) }; }
});

// Quick TCP port scan of one host — which services actually answer there
ipcMain.handle('net:portscan', async (_e, { ip }) => {
  const ports = [23, 80, 443, 1023, 1319, 3804, 8080];
  const one = (port) => new Promise((res) => {
    const s = net.createConnection({ host: ip, port, timeout: 1500 });
    s.on('connect', () => { s.destroy(); res({ port, open: true }); });
    s.on('timeout', () => { s.destroy(); res({ port, open: false }); });
    s.on('error', () => res({ port, open: false }));
  });
  const results = await Promise.all(ports.map(one));
  log('info', 'net', `Port scan ${ip}: open ${results.filter((r) => r.open).map((r) => r.port).join(', ') || 'none'}`);
  return { ok: true, results };
});

// Passive HiQnet census: listen on udp/3804 and collect the DiscoInfo
// announcements London devices broadcast. Sends nothing. Each hit reveals the
// device's node, MAC, the IP it BELIEVES it has, and the IP it actually sent
// from — a mismatch between those two is an addressing problem made visible.
ipcMain.handle('audio:listen', async (_e, { seconds }) => {
  const dgram = require('dgram');
  const secs = Math.max(5, Math.min(120, seconds || 25));
  try { hq.reset(); } catch { /* noop */ } // free udp/3804 from any prior HiQnet session
  return new Promise((resolve) => {
    const heard = new Map();
    let u;
    try { u = dgram.createSocket({ type: 'udp4', reuseAddr: true }); } catch (e) { return resolve({ ok: false, err: String(e.message || e) }); }
    u.on('error', (e) => { try { u.close(); } catch { /* noop */ } resolve({ ok: false, err: `udp/3804: ${e.message} — close Audio Architect/NetSetter` }); });
    u.on('message', (m, rinfo) => {
      try {
        if (m[0] !== 0x02 || m.length < 25) return;
        if (m.readUInt16BE(18) !== 0x0000) return; // DiscoInfo only
        const p = m.slice(m[1]);
        const node = p.readUInt16BE(0);
        const serLen = p.readUInt16BE(3);
        let off = 3 + 2 + serLen + 4 + 2 + 1; // cost, serial block, maxmsg, keepalive, netid
        const mac = [...p.slice(off, off + 6)].map((b) => b.toString(16).padStart(2, '0')).join('-');
        off += 6 + 1; // mac, dhcp
        const claimedIp = [...p.slice(off, off + 4)].join('.');
        heard.set(`${node}/${rinfo.address}`, { node: '0x' + node.toString(16).toUpperCase(), mac, claimedIp, fromIp: rinfo.address });
      } catch { /* malformed — ignore */ }
    });
    u.bind(3804, () => log('info', 'audio', `Listening for HiQnet announcements on udp/3804 for ${secs}s (passive)…`));
    setTimeout(() => {
      try { u.close(); } catch { /* noop */ }
      const list = [...heard.values()];
      log('info', 'audio', `Listen done: heard ${list.length} device${list.length === 1 ? '' : 's'}${list.length ? ' — ' + list.map((d) => `${d.node}@${d.fromIp}`).join(', ') : ''}`);
      resolve({ ok: true, heard: list, seconds: secs });
    }, secs * 1000);
  });
});

// Manual tester: read/set/bump one arbitrary address over the active protocol
ipcMain.handle('audio:raw', async (_e, { mode, addr, param, value }) => {
  const cfg = store.load();
  const drv = audioDrv(cfg);
  const tgt = audioTarget(cfg);
  if (!tgt) return { ok: false, err: 'set the processor IP / COM port first' };
  try {
    const p = Number(param) || 0;
    if (mode === 'read') {
      const v = await drv.readValue(tgt, addr, p);
      log('info', 'audio', `Manual read ${addr} p${p}: ${v === null ? 'no answer' : v + (Math.abs(v) <= 300000 ? ` (≈${(v / 10000).toFixed(1)} dB)` : '')}`);
      return { ok: true, value: v };
    }
    if (mode === 'set') { await drv.setValue(tgt, addr, p, Number(value) | 0); log('info', 'audio', `Manual set ${addr} p${p} = ${value}`); return { ok: true }; }
    if (mode === 'setpct') { await drv.setPercent(tgt, addr, p, Number(value) || 0); log('info', 'audio', `Manual set% ${addr} p${p} = ${value}%`); return { ok: true }; }
    if (mode === 'bump' && drv.bump) { await drv.bump(tgt, addr, p, Number(value) || 0); log('info', 'audio', `Manual bump ${addr} p${p} ${value > 0 ? '+' : ''}${value}%`); return { ok: true }; }
    return { ok: false, err: mode === 'bump' ? 'bump is DI-only (not HiQnet)' : 'unknown mode' };
  } catch (e) { return { ok: false, err: String(e.message || e) }; }
});

// ---------- AMX NetLinx console (telnet :23) ----------
let amxSock = null;
ipcMain.handle('amx:open', async (_e, { ip, port }) => {
  try { if (amxSock) { amxSock.destroy(); amxSock = null; } } catch { /* noop */ }
  return new Promise((resolve) => {
    const s = net.createConnection({ host: ip, port: port || 23, timeout: 5000 });
    s.on('connect', () => { s.setTimeout(0); amxSock = s; log('info', 'amx', `Console connected to ${ip}:${port || 23}`); resolve({ ok: true }); });
    s.on('timeout', () => { s.destroy(); resolve({ ok: false, err: 'timeout' }); });
    s.on('error', (e) => { if (amxSock === s) amxSock = null; resolve({ ok: false, err: String(e.message || e) }); });
    s.on('close', () => { if (amxSock === s) { amxSock = null; broadcast('amxdata', '\n[connection closed]\n'); } });
    s.on('data', (chunk) => {
      // strip/answer telnet IAC negotiations, pass printable text through
      const out = [];
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === 0xff) {
          if (i + 2 >= chunk.length) break; // incomplete IAC at chunk end — drop the tail
          const cmd = chunk[i + 1], opt = chunk[i + 2];
          if (cmd === 0xfd) { try { s.write(Buffer.from([0xff, 0xfc, opt])); } catch { /* noop */ } } // DO -> WONT
          else if (cmd === 0xfb) { try { s.write(Buffer.from([0xff, 0xfe, opt])); } catch { /* noop */ } } // WILL -> DONT
          i += 2;
          continue;
        }
        out.push(chunk[i]);
      }
      if (out.length) broadcast('amxdata', Buffer.from(out).toString('latin1'));
    });
  });
});
ipcMain.handle('amx:send', async (_e, { text }) => {
  if (!amxSock) return { ok: false, err: 'not connected' };
  try { amxSock.write(String(text) + '\r\n'); return { ok: true }; } catch (e) { return { ok: false, err: String(e.message || e) }; }
});
ipcMain.handle('amx:close', async () => { try { if (amxSock) amxSock.destroy(); } catch { /* noop */ } amxSock = null; return { ok: true }; });

// Dip: read → set −6 dB → verify mid-dip → restore exact value.
// Distinguishes "not audible / wrong fader" from "device ignores writes".
ipcMain.handle('audio:dip', async (_e, { addr }) => {
  const cfg = store.load();
  if (!cfg.audio || !audioTarget(cfg)) return { ok: false, err: 'not configured' };
  try {
    const drv = audioDrv(cfg);
    const ip = audioTarget(cfg);
    const v0 = await drv.readValue(ip, addr, 0);
    if (v0 === null) return { ok: false, err: (cfg.audio || {}).protocol === 'serial' ? 'serial is write-only — use the Manual tester (Set −6 dB / Bump) and listen' : 'object did not answer a read' };
    await drv.setValue(ip, addr, 0, v0 - 60000);
    await drv.sleep(600);
    const mid = await drv.readValue(ip, addr, 0);
    await drv.sleep(1900);
    await drv.setValue(ip, addr, 0, v0);
    const wrote = mid !== null && Math.abs(mid - (v0 - 60000)) < 5000;
    log(wrote ? 'info' : 'warn', 'audio', `Dip ${addr}: ${v0} → ${mid === null ? 'no read-back' : mid} → restored (${wrote ? 'write CONFIRMED' : 'write NOT taken'})`);
    return { ok: true, before: v0, wrote };
  } catch (e) { return { ok: false, err: String(e.message || e) }; }
});

// Mute blink: different message path than the fader — flips param 1 for 1.5s.
ipcMain.handle('audio:blink', async (_e, { addr }) => {
  const cfg = store.load();
  if (!cfg.audio || !audioTarget(cfg)) return { ok: false, err: 'not configured' };
  try {
    const drv = audioDrv(cfg);
    const ip = audioTarget(cfg);
    const m0 = await drv.readValue(ip, addr, 1);
    const target = m0 === 1 ? 0 : 1;
    await drv.setValue(ip, addr, 1, target);
    await drv.sleep(1500);
    await drv.setValue(ip, addr, 1, m0 === null ? 0 : m0);
    log('info', 'audio', `Mute blink ${addr} (was ${m0 === null ? 'unreadable' : m0})`);
    return { ok: true, hadRead: m0 !== null };
  } catch (e) { return { ok: false, err: String(e.message || e) }; }
});

// ---------- SmartCast TV discovery (port 7345 sweep) ----------
ipcMain.handle('vizio:scan', async () => {
  const os2 = require('os');
  const bases = new Set();
  const ifs = os2.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const a of ifs[name] || []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) {
        bases.add(a.address.split('.').slice(0, 3).join('.'));
      }
    }
  }
  const targets = [];
  for (const b of bases) for (let i = 1; i <= 254; i++) targets.push(`${b}.${i}`);
  const found = [];
  let idx = 0;
  async function probe(ip) {
    return new Promise((resolve) => {
      const s = net.createConnection({ host: ip, port: 7345, timeout: 450 });
      s.on('connect', () => { s.destroy(); resolve(true); });
      s.on('timeout', () => { s.destroy(); resolve(false); });
      s.on('error', () => resolve(false));
    });
  }
  await Promise.all(Array.from({ length: 64 }, async () => {
    while (idx < targets.length) {
      const ip = targets[idx++];
      if (await probe(ip)) found.push(ip);
    }
  }));
  found.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  log('info', 'scan', `SmartCast TV scan: ${found.length} found`);
  return { found };
});

ipcMain.handle('net:scan', async () => {
  log('info', 'scan', 'Network scan started');
  const res = await discovery.scan((p) => broadcast('scan:progress', p));
  const known = new Set(store.load().boxes.map((b) => b.ip));
  log('info', 'scan', `Scan done: ${res.found.length} receiver${res.found.length === 1 ? '' : 's'} across ${res.scanned} addresses`);
  return { ...res, found: res.found.map((f) => ({ ...f, known: known.has(f.ip) })) };
});

// ---------- diagnostics ----------
ipcMain.handle('diag:info', () => {
  const nets = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const a of ifs[name] || []) {
      if (a.family === 'IPv4' && !a.internal) nets.push({ name, address: a.address, netmask: a.netmask });
    }
  }
  return {
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${os.platform()} ${os.release()} (${os.arch()})`,
    startedAt: STARTED_AT,
    keepAwake: keepAwakeId !== null && powerSaveBlocker.isStarted(keepAwakeId),
    userData: app.getPath('userData'),
    nets,
  };
});

ipcMain.handle('diag:ping', async (_e, { ip }) => {
  const t0 = Date.now();
  try {
    const v = await shef.version(ip, 2500);
    return { ok: true, ms: Date.now() - t0, receiverId: v.receiverId, version: v.version };
  } catch (e) { return { ok: false, ms: Date.now() - t0, err: String(e.message || e) }; }
});

ipcMain.handle('diag:tcp', (_e, { ip, port }) => new Promise((resolve) => {
  const t0 = Date.now();
  const sock = net.createConnection({ host: ip, port, timeout: 2500 });
  const done = (ok, err) => { sock.destroy(); resolve({ ok, ms: Date.now() - t0, err }); };
  sock.on('connect', () => done(true));
  sock.on('timeout', () => done(false, 'timeout'));
  sock.on('error', (e) => done(false, String(e.message || e)));
}));

ipcMain.handle('diag:itach', (_e, { ip }) => new Promise((resolve) => {
  const t0 = Date.now();
  const sock = net.createConnection({ host: ip, port: 4998, timeout: 2500 });
  let buf = '';
  const done = (ok, extra) => { sock.destroy(); resolve({ ok, ms: Date.now() - t0, ...extra }); };
  sock.on('connect', () => sock.write('getdevices\r'));
  sock.on('data', (d) => {
    buf += d;
    if (buf.includes('endlistdevices')) {
      const devices = buf.split(/\r/).filter((l) => l.startsWith('device,')).map((l) => l.trim());
      done(true, { devices });
    }
  });
  sock.on('timeout', () => done(false, { err: 'timeout' }));
  sock.on('error', (e) => done(false, { err: String(e.message || e) }));
}));

ipcMain.handle('diag:comports', () => new Promise((resolve) => {
  execFile('reg', ['query', 'HKLM\\HARDWARE\\DEVICEMAP\\SERIALCOMM'], { windowsHide: true }, (err, stdout) => {
    if (err) return resolve({ ok: true, ports: [] });
    const ports = [];
    for (const line of String(stdout).split(/\r?\n/)) {
      const m = line.trim().match(/^(\S+)\s+REG_SZ\s+(COM\d+)$/i);
      if (m) ports.push({ port: m[2], device: m[1].replace(/^\\Device\\/, '') });
    }
    ports.sort((a, b) => a.port.localeCompare(b.port, undefined, { numeric: true }));
    resolve({ ok: true, ports });
  });
}));

// ---------- log + config tools ----------
ipcMain.handle('log:get', () => LOG);
ipcMain.handle('log:add', (_e, { level, source, message }) => { log(level || 'info', source || 'ui', String(message).slice(0, 300)); });
ipcMain.handle('log:clear', () => { LOG.length = 0; log('info', 'app', 'Log cleared'); });
ipcMain.handle('log:export', async () => {
  const r = await dialog.showSaveDialog(win, { defaultPath: `rjc-tv-log-${new Date().toISOString().slice(0, 10)}.txt` });
  if (r.canceled || !r.filePath) return { ok: false };
  const text = LOG.map((e) => `${new Date(e.ts).toISOString()} [${e.level.toUpperCase()}] ${e.source}: ${e.message}`).join('\r\n');
  fs.writeFileSync(r.filePath, text);
  return { ok: true, path: r.filePath };
});

ipcMain.handle('config:export', async () => {
  const r = await dialog.showSaveDialog(win, { defaultPath: 'rjc-tv-config.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) return { ok: false };
  fs.writeFileSync(r.filePath, JSON.stringify(store.load(), null, 2));
  log('info', 'config', `Config exported to ${r.filePath}`);
  return { ok: true, path: r.filePath };
});

ipcMain.handle('config:import', async () => {
  const r = await dialog.showOpenDialog(win, { filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
  try {
    const raw = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8').replace(/^﻿/, ''));
    if (!raw || !Array.isArray(raw.tvs) || !Array.isArray(raw.boxes)) throw new Error('not an RJC TV Control config');
    const cfg = store.update(raw);
    broadcast('config', cfg);
    syncKeepAwake();
    pollAll();
    log('info', 'config', `Config imported from ${r.filePaths[0]}`);
    return { ok: true };
  } catch (e) { return { ok: false, err: String(e.message || e) }; }
});

ipcMain.handle('config:openFolder', () => { shell.openPath(app.getPath('userData')); });

ipcMain.handle('config:reset', () => {
  const cfg = store.reset();
  broadcast('config', cfg);
  syncKeepAwake();
  pollAll();
  log('warn', 'config', 'Config reset to demo defaults');
  return { ok: true };
});

ipcMain.handle('win:overlay', (_e, { color, symbolColor }) => {
  if (!win) return;
  try { win.setTitleBarOverlay({ color, symbolColor, height: 36 }); } catch { /* not supported */ }
});

ipcMain.handle('win:fullscreen', () => {
  if (!win) return false;
  win.setFullScreen(!win.isFullScreen());
  return win.isFullScreen();
});

ipcMain.handle('win:isFullscreen', () => (win ? win.isFullScreen() : false));

// ---------- window ----------
function createWindow() {
  const cfg = store.load();
  win = new BrowserWindow({
    width: Number(argOf('w')) || 1280,
    height: Number(argOf('h')) || 800,
    useContentSize: true,
    minWidth: shotPath ? 400 : 1000,
    minHeight: shotPath ? 300 : 660,
    show: false,
    title: 'RJC TV Control',
    backgroundColor: cfg.theme === 'light' ? '#f3f3f1' : '#0c0d10',
    titleBarStyle: 'hidden',
    // the caption corner wears the brand red so the top keyline reads continuous
    titleBarOverlay: {
      color: '#e11414',
      symbolColor: '#ffffff',
      height: 36,
    },
    autoHideMenuBar: true,
    fullscreen: !!cfg.launchFullscreen && !shotPath,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => {
    win.show();
    // harness runs must never be occluded — an occluded window stops
    // presenting frames and capturePage() returns stale pixels
    if (shotPath) { try { win.setAlwaysOnTop(true, 'screen-saver'); win.moveTop(); } catch { /* noop */ } }
  });
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  // Harness knobs: --view=picker|settings --tab=boxes --sel=1
  const query = {};
  for (const k of ['view', 'tab', 'sel', 'click', 'theme', 'preview', 'sleep', 'scroll', 'audio']) {
    const v = argOf(k);
    if (v !== null) query[k] = v;
  }
  win.loadFile(path.join(__dirname, '..', 'app', 'index.html'), { query });
  if (devTools) win.webContents.openDevTools({ mode: 'detach' });

  // Self-screenshot harness: RJC-TV-Control.exe --shot=C:\out.png [--view=...] [--delay=3000]
  if (shotPath) {
    const delay = Number(argOf('delay') || 3000);
    const shotJs = argOf('js'); // arbitrary renderer JS before capture — modal states etc.
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          if (shotJs) {
            const code = Buffer.from(shotJs, 'base64').toString('utf8');
            let jsErr = null, jsResult = null;
            jsResult = await win.webContents.executeJavaScript(code, true).catch((e) => { jsErr = String(e && e.message || e); return null; });
            try {
              const wins = BrowserWindow.getAllWindows().map((w) => ({ id: w.id, url: w.webContents.getURL().slice(-60), isWin: w === win }));
              fs.writeFileSync(shotPath + '.jslog', JSON.stringify({ code, jsErr, jsResult, wins }));
            } catch (e) { try { fs.writeFileSync(shotPath + '.jslog', 'logfail:' + e.message); } catch { /* noop */ } }
            await new Promise((r) => setTimeout(r, 500));
          }
          try { win.moveTop(); win.webContents.invalidate(); } catch { /* noop */ }
          await new Promise((r) => setTimeout(r, 400));
          const img = await win.webContents.capturePage();
          fs.writeFileSync(shotPath, img.toPNG());
        } catch { /* leave no file on failure */ }
        // Hard exit: a packaged harness run once lingered after app.quit(),
        // holding the config file and haunting later runs with stale state.
        app.quit();
        setTimeout(() => app.exit(0), 1200);
      }, delay);
    });
    // Absolute backstop even if did-finish-load never fires.
    setTimeout(() => app.exit(0), delay + 30000);
  }
}

app.whenReady().then(async () => {
  const cfg = store.load();
  log('info', 'app', `RJC TV Control v${app.getVersion()} started — ${cfg.tvs.length} TVs on ${cfg.boxes.length} feeds${cfg.demoMode ? ' (demo mode)' : ''}`);
  syncKeepAwake();
  createWindow();
  await pollAll();
  schedule();
});
app.on('window-all-closed', () => app.quit());
