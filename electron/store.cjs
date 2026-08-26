const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const file = () => path.join(app.getPath('userData'), 'config.json');
const SCHEMA = 3;

const DEFAULT_ZONES = [
  { id: 'track', name: 'Track',      color: '#e60000' },
  { id: 'tread', name: 'Treadmills', color: '#3b82f6' },
];

// The gym's wall RF lineup (what TVs display, made by the ZeeVee modulators)
// paired with the DirecTV satellite channel each receiver must actually tune —
// receivers have no off-air tuner, so tuning "11.1" fails with SHEF 501.
// RJC is the house channel (Zvp810 HDMI feed): no receiver can tune it.
const DEFAULT_FAVORITES = [
  { name: 'RJC',      chan: '2.1',  house: true },
  { name: 'WLEX18',   chan: '11.1', sat: '18' },
  { name: 'WKYT 27',  chan: '12.1', sat: '27' },
  { name: 'WTVQ',     chan: '13.1', sat: '36' },
  { name: 'WDKY 36',  chan: '14.1', sat: '56' },
  { name: 'CNN',      chan: '15.1', sat: '202' },
  { name: 'HLN',      chan: '16.1', sat: '204' },
  { name: 'FOX',      chan: '17.1', sat: '360' },
  { name: 'TWC',      chan: '18.1', sat: '362' },
  { name: 'E!',       chan: '19.1', sat: '236' },
  { name: 'ESPN',     chan: '20.1', sat: '206' },
  { name: 'CMT',      chan: '21.1', sat: '235' },
  { name: 'HIST',     chan: '22.1', sat: '269' },
];

const DEFAULT_PRESETS = [
  { id: 'ps-gameday', name: 'Game Day',     assignments: { track: '20.1', tread: '17.1' } },
  { id: 'ps-news',    name: 'Morning News', assignments: { track: '15.1', tread: '12.1' } },
  { id: 'ps-house',   name: 'All RJC',      assignments: { track: '2.1',  tread: '2.1' } },
];

function demoFeeds() {
  const seed = ['20.1', '20.1', '15.1', '17.1', '12.1', '18.1', '20.1', '11.1', '13.1', '22.1', '19.1', '21.1', '2.1'];
  return seed.map((chan, i) => {
    const n = i + 1;
    return {
      id: `feed-${n}`, name: `Feed ${n}`, ip: `10.56.0.${100 + n}`, demo: true,
      receiverId: `0288 7796 03${String(n).padStart(2, '0')}`,
      seedChan: chan, seedPower: n !== 12, // Feed 12 starts in standby
    };
  });
}

function demoTvs() {
  const tvs = [];
  for (let n = 1; n <= 20; n++) {
    // Track 19–20 seeded unpaired so the Pair flow is visible in demo mode.
    const paired = n <= 18;
    tvs.push({
      id: `tv-track-${n}`, name: `Track ${n}`, zone: 'track', boxId: `feed-${Math.ceil(n / 2)}`,
      demo: true, tvIp: paired ? `10.56.1.${n}` : '', tvToken: paired ? 'demo' : null,
    });
  }
  const treadFeeds = [11, 11, 11, 11, 12, 12, 12, 13, 13, 13];
  for (let n = 1; n <= 10; n++) {
    tvs.push({
      id: `tv-tread-${n}`, name: `Treadmill ${n}`, zone: 'tread', boxId: `feed-${treadFeeds[n - 1]}`,
      demo: true, tvIp: `10.56.1.${20 + n}`, tvToken: 'demo',
    });
  }
  return tvs;
}

function defaults() {
  return {
    schema: SCHEMA,
    demoMode: true,
    theme: 'dark',
    preview: { enabled: false, deviceId: null, boxId: null, collapsed: false },
    pollSeconds: 10,
    identifyChannel: '18.1',
    settingsCode: '1972',
    lockTuning: false,
    sleepEnabled: true,
    sleepMinutes: 3,
    serial: {
      baud: 9600,
      commands: { volUp: '', volDown: '', muteToggle: '', powerOn: '', powerOff: '' },
    },
    itach: {
      commands: { volUp: '', volDown: '', muteToggle: '', powerOn: '', powerOff: '' },
    },
    audio: {
      enabled: false,
      ip: '',
      protocol: 'di', // 'di' (:1023) or 'hiqnet' (:3804)
      probeNodes: '0xC642, 0x75B0',
      zones: [
        { id: 'az1', name: 'Track speakers', addr: '', gainParam: 0, muteParam: 1, pct: 50, muted: false },
        { id: 'az2', name: 'Treadmill speakers', addr: '', gainParam: 0, muteParam: 1, pct: 50, muted: false },
      ],
    },
    launchFullscreen: false,
    boxes: demoFeeds(),   // the receivers ("feeds")
    tvs: demoTvs(),       // the screens on the wall — what the dashboard shows
    zones: DEFAULT_ZONES,
    favorites: DEFAULT_FAVORITES,
    presets: DEFAULT_PRESETS,
  };
}

let cfg = null;

function load() {
  if (cfg) return cfg;
  try {
    // strip a UTF-8 BOM — hand-edited or imported configs often carry one
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8').replace(/^﻿/, ''));
    // Schema 1 (pre TVs/feeds split, numeric channels) — rebuild from defaults.
    cfg = raw.schema === SCHEMA ? Object.assign(defaults(), raw) : defaults();
    // soft-migrate stored favorites: graft sat numbers / house flags without a reset
    if (Array.isArray(cfg.favorites)) {
      cfg.favorites = cfg.favorites.map((f) => {
        if (f.sat !== undefined || f.house) return f;
        const d = DEFAULT_FAVORITES.find((x) => String(x.chan) === String(f.chan));
        return d ? { ...f, ...(d.sat ? { sat: d.sat } : {}), ...(d.house ? { house: true } : {}) } : f;
      });
    }
    if (cfg.identifyChannel === '18.1') cfg.identifyChannel = '362'; // wall number → real sat channel
    if (raw.schema !== SCHEMA) save();
  } catch {
    cfg = defaults();
    save();
  }
  return cfg;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.error('config save failed', e);
  }
}

function update(partial) {
  load();
  const wasDemo = cfg.demoMode;
  Object.assign(cfg, partial);
  cfg.pollSeconds = Math.max(5, Number(cfg.pollSeconds) || 10);
  if (!cfg.identifyChannel) cfg.identifyChannel = '18.1';
  // Turning demo off removes the simulated feeds+TVs; turning it on re-seeds if empty.
  if (wasDemo && !cfg.demoMode) {
    cfg.boxes = cfg.boxes.filter((b) => !b.demo);
    const feedIds = new Set(cfg.boxes.map((b) => b.id));
    cfg.tvs = cfg.tvs.filter((t) => !t.demo)
      .map((t) => feedIds.has(t.boxId) ? t : { ...t, boxId: null });
  } else if (!wasDemo && cfg.demoMode && !cfg.boxes.some((b) => b.demo)) {
    cfg.boxes = cfg.boxes.concat(demoFeeds());
    cfg.tvs = cfg.tvs.concat(demoTvs());
  }
  save();
  return cfg;
}

function reset() {
  cfg = defaults();
  save();
  return cfg;
}

module.exports = { load, update, defaults, reset };
