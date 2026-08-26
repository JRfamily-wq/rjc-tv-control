const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron');
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

const argOf = (k) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split('=').slice(1).join('=') : null;
};
const shotPath = argOf('shot');
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
    pollAll();
    log('info', 'config', `Config imported from ${r.filePaths[0]}`);
    return { ok: true };
  } catch (e) { return { ok: false, err: String(e.message || e) }; }
});

ipcMain.handle('config:openFolder', () => { shell.openPath(app.getPath('userData')); });

ipcMain.handle('config:reset', () => {
  const cfg = store.reset();
  broadcast('config', cfg);
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
    width: 1280,
    height: 800,
    useContentSize: true,
    minWidth: 1000,
    minHeight: 660,
    show: false,
    title: 'RJC TV Control',
    backgroundColor: cfg.theme === 'light' ? '#f3f3f1' : '#0c0d10',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: cfg.theme === 'light' ? '#f3f3f1' : '#0c0d10',
      symbolColor: cfg.theme === 'light' ? '#17191c' : '#f2f3f5',
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
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  // Harness knobs: --view=picker|settings --tab=boxes --sel=1
  const query = {};
  for (const k of ['view', 'tab', 'sel', 'click', 'theme', 'preview', 'sleep', 'scroll']) {
    const v = argOf(k);
    if (v !== null) query[k] = v;
  }
  win.loadFile(path.join(__dirname, '..', 'app', 'index.html'), { query });
  if (devTools) win.webContents.openDevTools({ mode: 'detach' });

  // Self-screenshot harness: RJC-TV-Control.exe --shot=C:\out.png [--view=...] [--delay=3000]
  if (shotPath) {
    const delay = Number(argOf('delay') || 3000);
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
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
  createWindow();
  await pollAll();
  schedule();
});
app.on('window-all-closed', () => app.quit());
