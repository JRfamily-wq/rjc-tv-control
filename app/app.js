/* RJC TV Control — renderer (vanilla, no framework)
   Model: `tvs` are the 30 screens on the floor (what the dashboard shows);
   `boxes` are the 13 DirecTV receivers ("feeds") behind them. Tuning a TV
   tunes its feed, so sibling TVs on the same feed change together. */
const api = window.rjc;

let cfg = null;
let statuses = {};
const ui = {
  filter: 'all',
  selecting: false,
  selected: new Set(),   // tv ids
  picker: null,          // {tvIds, label}
  pad: '',
  settings: false,
  settingsTab: 'boxes',
  confirm: null,         // {title, body, yes, fn}
  savePreset: false,
  scan: { running: false, progress: null, found: null },
  devices: [],
  sleeping: false,
  pairingTv: null,
  diag: { log: [], filter: 'all', info: null, pings: {}, tests: {}, com: null },
  openCards: new Set(),
  tvscan: null,
};

// collapsed-by-default card for advanced/rarely-touched settings
function cardClps(id, icon, title, body, status) {
  const open = ui.openCards.has(id);
  return `<div class="card slim clps ${open ? 'open' : ''}">
    <h3 data-act="card-toggle" data-id="${id}">${icon}<span class="lbl">${title}</span>${status ? `<span class="clps-status">${esc(status)}</span>` : ''}${I.chevd}</h3>
    ${open ? `<div class="clps-body">${body}</div>` : ''}
  </div>`;
}

async function refreshDiag() {
  try {
    const [info, logEntries] = await Promise.all([api.diagInfo(), api.logGet()]);
    ui.diag.info = info;
    ui.diag.log = logEntries || [];
  } catch { /* keep whatever we have */ }
  if (ui.settings && ui.settingsTab === 'diag') renderModal();
}

async function refreshDevices() {
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    ui.devices = list.filter((d) => d.kind === 'videoinput');
  } catch { ui.devices = []; }
  if (ui.settings && ui.settingsTab === 'general') renderModal();
}

/* ---------- custom icon set ----------
   24px grid, 1.8 stroke, square caps, miter joins — industrial control-room set. */
const ic = (paths, extra) => `<svg class="ic${extra ? ' ' + extra : ''}" viewBox="0 0 24 24">${paths}</svg>`;
const I = {
  power: ic('<path d="M12 3.2v7.3"/><path d="M16.9 6.2a7.2 7.2 0 1 1-9.8 0"/>'),
  videowall: ic('<rect x="3" y="4.5" width="18" height="14" rx="1.5"/><path d="M12 4.5v14M3 11.5h18"/>'),
  tvone: ic('<rect x="3" y="5" width="18" height="12.5" rx="1.5"/><path d="M12 17.5v3M8 20.5h8"/>'),
  sliders: ic('<path d="M6 4v16M12 4v16M18 4v16"/><rect x="4.4" y="7.6" width="3.2" height="3.2" rx="0.6" fill="currentColor" stroke="none"/><rect x="10.4" y="13.2" width="3.2" height="3.2" rx="0.6" fill="currentColor" stroke="none"/><rect x="16.4" y="5.2" width="3.2" height="3.2" rx="0.6" fill="currentColor" stroke="none"/>'),
  brackets: ic('<path d="M8.5 4H5.5A1.5 1.5 0 0 0 4 5.5v3"/><path d="M15.5 4h3A1.5 1.5 0 0 1 20 5.5v3"/><path d="M8.5 20H5.5A1.5 1.5 0 0 1 4 18.5v-3"/><path d="M15.5 20h3a1.5 1.5 0 0 0 1.5-1.5v-3"/>'),
  contrast: ic('<circle cx="12" cy="12" r="7.6"/><path d="M12 4.4a7.6 7.6 0 0 1 0 15.2z" fill="currentColor" stroke="none"/>'),
  boltf: ic('<path d="M13.6 2.6L5 13.4h5.4L9.9 21.4l8.7-10.9h-5.4z" fill="currentColor" stroke="none"/>'),
  radar: ic('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.4"/><path d="M12 12l5.7-5.7"/><path d="M12 2v2.2M12 19.8V22M2 12h2.2M19.8 12H22"/>'),
  target: ic('<circle cx="12" cy="12" r="7.4"/><path d="M12 2.2v3.4M12 18.4v3.4M2.2 12h3.4M18.4 12h3.4"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/>'),
  zonebox: ic('<rect x="4.2" y="4.2" width="15.6" height="15.6" rx="2" stroke-dasharray="3.4 3"/><circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none"/>'),
  star: ic('<path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6L3.2 9.6l6.1-.8z"/>'),
  knob: ic('<circle cx="12" cy="12" r="7.8"/><path d="M12 12l3.2-4.4"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>'),
  clipboard: ic('<rect x="5" y="4" width="14" height="17" rx="1.5"/><rect x="9" y="2.6" width="6" height="3.2" rx="1" fill="currentColor" stroke="none"/><path d="M8.5 10.5h7M8.5 14h7M8.5 17.5h4.5"/>'),
  plus: ic('<path d="M12 5.5v13M5.5 12h13"/>'),
  x: ic('<path d="M6 6l12 12M18 6L6 18"/>'),
  check: '<svg viewBox="0 0 24 24" style="stroke-linecap:square;stroke-linejoin:miter"><polyline points="4.5 12.5 9.5 17.5 19.5 7" fill="none" stroke="currentColor" stroke-width="3"/></svg>',
  trash: ic('<path d="M3.5 6.5h17"/><path d="M9.5 6.5V4h5v2.5"/><path d="M5.5 6.5l1.1 14h10.8l1.1-14"/><path d="M10 10.5v6M14 10.5v6"/>'),
  arrl: ic('<path d="M10.5 5.5L4 12l6.5 6.5"/><path d="M4 12h16"/>'),
  pip: ic('<rect x="3" y="5" width="18" height="13.5" rx="1.5"/><rect x="12.6" y="12" width="5.6" height="4" rx="0.8" fill="currentColor" stroke="none"/>'),
  pulse: ic('<path d="M2.5 12h4.2l2.6-6.5 4.4 13 2.6-6.5h5.2"/>'),
  shield: ic('<path d="M12 3l7 2.8v5.4c0 4.3-2.9 7.6-7 9.3-4.1-1.7-7-5-7-9.3V5.8z"/>'),
  chevd: ic('<path d="M6.5 9.5l5.5 5.5 5.5-5.5"/>', 'chev'),
  copy: ic('<rect x="8.5" y="8.5" width="12" height="12" rx="1.5"/><path d="M15.5 8.5V5A1.5 1.5 0 0 0 14 3.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h3.5"/>'),
  feed: ic('<path d="M4.5 19.5a15 15 0 0 1 15-15"/><path d="M4.5 13.5a9 9 0 0 1 9-9"/><circle cx="5.6" cy="18.4" r="1.7" fill="currentColor" stroke="none"/>'),
  speaker: ic('<path d="M4 9.5v5h3.5L12 19V5L7.5 9.5z"/><path d="M15 9.2a4.2 4.2 0 0 1 0 5.6"/><path d="M17.6 6.6a8 8 0 0 1 0 10.8"/>'),
  spkmute: ic('<path d="M4 9.5v5h3.5L12 19V5L7.5 9.5z"/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5"/>'),
};

/* ---------- per-channel accent colors (the gym's lineup) ---------- */
const CHAN_ACC = {
  '2.1': '#e60000',   // RJC house channel — Corman red
  '11.1': '#3fae6a',  // WLEX (NBC)
  '12.1': '#4a7fd4',  // WKYT (CBS)
  '13.1': '#b04ae0',  // WTVQ (ABC)
  '14.1': '#2f6fd0',  // WDKY (FOX 56)
  '15.1': '#cf5b45',  // CNN
  '16.1': '#cf5b45',  // HLN
  '17.1': '#4463d0',  // FOX
  '18.1': '#46b7d6',  // TWC
  '19.1': '#d24bb0',  // E!
  '20.1': '#e8642c',  // ESPN
  '21.1': '#d8973c',  // CMT
  '22.1': '#b08a4a',  // HIST
};
const acc = (chan) => CHAN_ACC[chan] || `hsl(${((Number(String(chan).replace('.', '')) || 7) * 47) % 360} 45% 55%)`;

/* ---------- helpers ---------- */
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const zoneOf = (id) => cfg.zones.find((z) => z.id === id) || null;
const feedOf = (id) => cfg.boxes.find((b) => b.id === id) || null;
const favName = (chan) => {
  const f = cfg.favorites.find((x) => String(x.chan) === String(chan));
  return f ? f.name : null;
};
const uid = (p) => p + '-' + Math.random().toString(36).slice(2, 8);
const CHAN_RE = /^\d{1,3}(\.\d{1,2})?$/;

function feedShareCounts() {
  const m = {};
  for (const t of cfg.tvs) if (t.boxId) m[t.boxId] = (m[t.boxId] || 0) + 1;
  return m;
}

function applyTheme(t) {
  const theme = t === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  if (api.setOverlay) {
    api.setOverlay(theme === 'light'
      ? { color: '#f3f3f1', symbolColor: '#17191c' }
      : { color: '#0c0d10', symbolColor: '#f2f3f5' });
  }
}

function shownTvs() {
  if (ui.filter === 'all') return cfg.tvs;
  if (ui.filter === 'none') return cfg.tvs.filter((t) => !zoneOf(t.zone));
  return cfg.tvs.filter((t) => t.zone === ui.filter);
}

/* ---------- feed-group model: tiles are feeds, TVs are their audience ---------- */
const feedTvs = (feedId) => cfg.tvs.filter((t) => t.boxId === feedId);

function feedZone(feed) {
  const counts = {};
  for (const t of feedTvs(feed.id)) if (t.zone && zoneOf(t.zone)) counts[t.zone] = (counts[t.zone] || 0) + 1;
  let best = null, n = 0;
  for (const [z, c] of Object.entries(counts)) if (c > n) { best = z; n = c; }
  return best;
}

function shownFeeds() {
  if (ui.filter === 'all') return cfg.boxes;
  if (ui.filter === 'none') return cfg.boxes.filter((b) => !feedZone(b));
  return cfg.boxes.filter((b) => feedZone(b) === ui.filter);
}

// What a tile displays: live readback when the box reports it,
// otherwise the channel last set from this panel (the remembered placeholder).
function effChanOf(feed) {
  const st = statuses[feed.id];
  if (st && st.online && st.mode === 0 && st.chan) return { chan: String(st.chan), live: true, st };
  if (feed.lastChan) return { chan: String(feed.lastChan), live: false, st };
  return { chan: null, live: false, st };
}

function toast(msg, kind = 'ok', ms = 2800) {
  const host = $('#toastHost');
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'ok' ? '' : ' ' + kind);
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => { el.classList.add('fade'); setTimeout(() => el.remove(), 450); }, ms);
}

/* ---------- actions ---------- */
async function doTuneFeeds(feedIds, chan, label) {
  const affected = feedIds.reduce((s, id) => s + feedTvs(id).length, 0);
  const name = favName(chan) || `channel ${chan}`;
  const r = await api.tune({ boxIds: feedIds, chan });
  const what = affected ? `${affected} TV${affected === 1 ? '' : 's'}` : `${feedIds.length} group${feedIds.length === 1 ? '' : 's'}`;
  if (r.fail.length === 0) {
    toast(`${label || what} → ${name} (${chan})`);
  } else if (r.ok.length === 0) {
    toast(`Couldn't reach ${r.fail.length} feed${r.fail.length === 1 ? '' : 's'}`, 'err');
  } else {
    toast(`${r.ok.length} tuned to ${name}; ${r.fail.length} didn't respond`, 'warn');
  }
}

async function doPowerFeeds(feedIds, on) {
  // Feeds get SHEF standby/wake; those groups' paired Vizio panels get real power too.
  const tvIds = feedIds.flatMap((id) => feedTvs(id)).map((t) => t.id);
  const affected = tvIds.length || feedIds.length;
  let anyFail = false;
  const r = await api.power({ boxIds: feedIds, on });
  let feedMsg;
  if (r.fail.length === 0) feedMsg = `${on ? 'Waking' : 'Standby sent to'} ${affected} TV${affected === 1 ? '' : 's'}`;
  else { anyFail = true; feedMsg = `${on ? 'Waking' : 'Standby:'} ${r.ok.length} feed${r.ok.length === 1 ? '' : 's'}, ${r.fail.length} didn't respond`; }
  const vz = tvIds.length ? await api.vizioPower({ tvIds, on }) : { ok: [], fail: [] };
  if (vz.fail.length) anyFail = true;
  const bits = [feedMsg,
    vz.ok.length ? `${vz.ok.length} panel${vz.ok.length === 1 ? '' : 's'} ${on ? 'on' : 'off'}` : '',
    vz.fail.length ? `${vz.fail.length} panel${vz.fail.length === 1 ? '' : 's'} unreachable` : ''].filter(Boolean);
  toast(bits.join(' · '), anyFail ? 'warn' : 'ok');
}

async function doVolume(tvIds, action) {
  const r = await api.vizioVol({ tvIds, action });
  const label = action === 'mute' ? 'Mute toggled' : action === 'up' ? 'Volume up' : 'Volume down';
  if (!r.ok.length && !r.fail.length) { toast('None of those TVs are paired yet — see Settings → TVs & Feeds', 'warn'); return; }
  const bits = [`${label} · ${r.ok.length} TV${r.ok.length === 1 ? '' : 's'}`];
  if (r.skipped) bits.push(`${r.skipped} not paired`);
  if (r.fail.length) bits.push(`${r.fail.length} unreachable`);
  toast(bits.join(' · '), r.fail.length || r.skipped ? 'warn' : 'ok');
}

function openPicker(tvIds, label) {
  ui.picker = { tvIds, label };
  ui.pad = '';
  renderModal();
}

function applyPreset(preset) {
  const jobs = new Map(); // chan -> feedIds
  for (const f of cfg.boxes) {
    const chan = preset.assignments[feedZone(f)];
    if (!chan) continue;
    if (!jobs.has(chan)) jobs.set(chan, []);
    jobs.get(chan).push(f.id);
  }
  let tvCount = 0;
  for (const [chan, feedIds] of jobs) {
    tvCount += feedIds.reduce((s, id) => s + feedTvs(id).length, 0);
    api.tune({ boxIds: feedIds, chan });
  }
  api.logAdd({ level: 'info', source: 'scene', message: `Scene "${preset.name}" applied — ${tvCount} TVs` });
  toast(`${preset.name} applied — ${tvCount} TVs`);
}

function saveCfg(partial) { return api.updateConfig(partial); }

/* ---------- render: sidebar ---------- */
function renderSideNav() {
  // Zones as stations on a rail line — the metro-map metaphor, on brand.
  const counts = {}, warn = {};
  for (const t of cfg.tvs) {
    counts[t.zone] = (counts[t.zone] || 0) + 1;
    const st = t.boxId ? statuses[t.boxId] : null;
    if ((st && !st.online) || !t.boxId) warn[t.zone] = true;
  }
  const unzoned = cfg.tvs.filter((t) => !zoneOf(t.zone)).length;
  const anyWarn = Object.keys(warn).length > 0;
  let html = `<div class="side-label"><span>Zones</span></div><div class="railnav">`;
  html += `<button class="st ${ui.filter === 'all' ? 'active' : ''}" data-act="chip" data-id="all" style="--zc:#e60000">
    <span class="st-node st-all"></span><span class="st-lbl">All TVs</span><span class="st-cnt${anyWarn ? ' warn' : ''}">${cfg.tvs.length}</span></button>`;
  for (const z of cfg.zones) {
    html += `<button class="st ${ui.filter === z.id ? 'active' : ''}" data-act="chip" data-id="${esc(z.id)}" style="--zc:${esc(z.color)}">
      <span class="st-node"></span><span class="st-lbl">${esc(z.name)}</span><span class="st-cnt${warn[z.id] ? ' warn' : ''}">${counts[z.id] || 0}</span></button>`;
  }
  if (unzoned) {
    html += `<button class="st ${ui.filter === 'none' ? 'active' : ''}" data-act="chip" data-id="none" style="--zc:#7e8490">
      <span class="st-node st-dash"></span><span class="st-lbl">Unzoned</span><span class="st-cnt">${unzoned}</span></button>`;
  }
  html += `</div>`;
  $('#zoneNav').innerHTML = html;
}

function renderAudio() {
  const host = $('#audioList');
  const a = cfg.audio || {};
  if (!a.enabled || !(a.zones || []).length) { host.innerHTML = ''; return; }
  let html = `<div class="side-label"><span>Audio</span></div>`;
  html += a.zones.map((z) => `<div class="aud-row ${z.addr ? '' : 'aud-off'}" title="${z.addr ? '' : 'No address set — see Settings → Audio'}">
    <div class="aud-top">
      <span class="aud-name">${esc(z.name)}</span>
      <span class="aud-pct">${z.muted ? 'MUTE' : `${Math.round(z.pct ?? 50)}%`}</span>
      <button class="aud-mute ${z.muted ? 'on' : ''}" data-act="audio-mute" data-id="${esc(z.id)}" title="${z.muted ? 'Unmute' : 'Mute'}">${z.muted ? I.spkmute : I.speaker}</button>
    </div>
    <input type="range" class="aud-slider" min="0" max="100" value="${Math.round(z.pct ?? 50)}" data-bind="audio-slider" data-id="${esc(z.id)}" ${z.addr ? '' : 'disabled'}/>
  </div>`).join('');
  host.innerHTML = html;
}

function renderScenes() {
  // Scenes as timetable entries — condensed caps with dotted leaders.
  let html = `<div class="side-label"><span>Scenes</span></div>`;
  html += cfg.presets.map((p) => {
    const zones = Object.keys(p.assignments).length;
    return `<button class="tt" data-act="preset" data-id="${esc(p.id)}">
      <span class="tt-name">${esc(p.name)}</span><span class="tt-dots"></span><span class="tt-meta">${zones} zone${zones === 1 ? '' : 's'}</span>
    </button>`;
  }).join('');
  html += `<button class="tt tt-save" data-act="save-preset" title="Save what's on now as a scene">
    <span class="tt-plus">${I.plus}</span><span class="tt-name">Save current</span><span class="tt-dots"></span>
  </button>`;
  $('#sceneList').innerHTML = html;
}

/* ---------- render: header ---------- */
function renderMix() {
  const bar = $('#mixbar');
  const counts = new Map(); // chan -> tv-weighted count
  for (const f of shownFeeds()) {
    const eff = effChanOf(f);
    if (!eff.chan) continue;
    if (eff.st && (!eff.st.online || eff.st.mode === 1)) continue;
    counts.set(eff.chan, (counts.get(eff.chan) || 0) + Math.max(1, feedTvs(f.id).length));
  }
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (!total) { bar.hidden = true; return; }
  bar.hidden = false;
  const segs = entries.map(([chan, n]) =>
    `<i style="width:${(n / total * 100).toFixed(2)}%;background:${acc(chan)}" title="${esc(favName(chan) || 'CH ' + chan)} — ${n} TV${n === 1 ? '' : 's'}"></i>`).join('');
  const top = entries.slice(0, 4).map(([chan, n]) =>
    `<span class="mix-chip"><i style="background:${acc(chan)}"></i>${esc(favName(chan) || 'CH ' + chan)}&nbsp;<b>${n}</b></span>`).join('');
  const more = entries.length > 4 ? `<span class="mix-more">+${entries.length - 4} more</span>` : '';
  bar.innerHTML = `<span class="mix-label">Now showing</span><div class="mix-bar">${segs}</div><div class="mix-legend">${top}${more}</div>`;
}

function renderHeader() {
  $('#demoChip').hidden = !cfg.demoMode;
  const title = ui.filter === 'all' ? 'All TVs'
    : ui.filter === 'none' ? 'Unzoned'
    : (zoneOf(ui.filter) || {}).name || 'Zone';
  $('#pageTitle').textContent = title;

  // One quiet meta sentence — a single colored dot, plain text, no badge chrome.
  let live = 0, stby = 0, offl = 0;
  for (const f of shownFeeds()) {
    const w = Math.max(1, feedTvs(f.id).length);
    const st = statuses[f.id];
    if (st && !st.online) offl += w;
    else if (st && st.online && st.mode === 1) stby += w;
    else live += w;
  }
  const feedsDown = cfg.boxes.filter((b) => statuses[b.id] && !statuses[b.id].online).length;
  const parts = [];
  parts.push(feedsDown > 0
    ? `<span class="mdot warn"></span><span class="mwarn">${feedsDown} feed${feedsDown === 1 ? '' : 's'} unreachable</span>`
    : `<span class="mdot ok"></span>All ${cfg.boxes.length} feeds healthy`);
  parts.push(`<b>${live}</b> live`);
  if (stby) parts.push(`<b>${stby}</b> standby`);
  if (offl) parts.push(`<b class="mwarn">${offl}</b> offline`);
  $('#metaLine').innerHTML = parts.join('<span class="msep">·</span>');
  renderMix();

  const shown = shownFeeds();
  const tvN = shown.reduce((s, f) => s + feedTvs(f.id).length, 0);
  const btn = $('#tuneShown');
  btn.textContent = ui.filter === 'all' ? `Tune all ${tvN || shown.length}` : `Tune ${title}`;
  btn.style.display = shown.length ? '' : 'none';

  $('#selectToggle').classList.toggle('on', ui.selecting);
  $('#selectToggle').textContent = ui.selecting ? 'Done' : 'Select';
  $('#fsBtn').innerHTML = I.brackets;
  $('#themeBtn').innerHTML = I.contrast;
  $('#settingsRow').innerHTML = `${I.sliders}<span class="lbl">Settings</span>`;
}

/* ---------- render: grid ---------- */
function feedTileHtml(feed) {
  const zid = feedZone(feed);
  const z = zid ? zoneOf(zid) : null;
  const eff = effChanOf(feed);
  const st = eff.st;
  const sel = ui.selected.has(feed.id);
  const offline = !!(st && !st.online);
  const n = feedTvs(feed.id).length;
  let screen;
  if (offline) {
    screen = `<div class="screen is-static"><span class="scr-state offl">No signal</span></div>`;
  } else if (st && st.online && st.mode === 1) {
    screen = `<div class="screen is-dim"><span class="scr-standby">${I.power}<span>Standby</span></span></div>`;
  } else if (eff.chan) {
    const cs = (eff.live && st && st.callsign) || favName(eff.chan) || `CH ${eff.chan}`;
    const a = acc(eff.chan);
    let title = '', prog = '', remain = '';
    if (eff.live && st.startTime && st.duration) {
      const elapsed = Date.now() / 1000 - st.startTime;
      const pct = Math.max(0, Math.min(1, elapsed / st.duration));
      const left = Math.round((st.duration - elapsed) / 60);
      if (pct > 0 && pct < 1) {
        prog = `<div class="scr-prog"><i style="width:${(pct * 100).toFixed(1)}%"></i></div>`;
        if (left > 0) remain = `<span class="scr-left">${left}m left</span>`;
      }
    }
    if (eff.live) title = esc((st && st.title) || '');
    screen = `<div class="screen is-live" style="--acc:${a}">
      <div class="scr-top"><span class="live-dot"></span><span class="scr-ch">CH ${esc(eff.chan)}</span></div>
      <div class="scr-cs">${esc(cs)}</div>
      <div class="scr-title">${title}${remain}</div>
      ${prog}
    </div>`;
  } else {
    screen = `<div class="screen is-dim"><span class="scr-state offl" style="letter-spacing:0.24em">Tap to tune</span></div>`;
  }
  return `<div class="tv ${sel ? 'selected' : ''} ${offline ? 'is-offline' : ''}" data-act="tile" data-id="${esc(feed.id)}" style="--zc:${esc(z ? z.color : '#7e8490')}">
    ${screen}
    <div class="placard">
      <span class="ptick"></span>
      <span class="pname">${esc(feed.name)}</span>
      ${n ? `<span class="ftag">${esc(String(n))} TV${n === 1 ? '' : 's'}</span>` : ''}
      ${ui.selecting
        ? `<span class="tv-check">${I.check}</span>`
        : `<button class="tv-power" data-act="tile-power" data-id="${esc(feed.id)}" title="${st && st.online && st.mode === 0 ? 'Standby' : 'Wake'}">${I.power}</button>`}
    </div>
  </div>`;
}

function renderGrid() {
  const grid = $('#grid');
  if (!cfg.boxes.length) {
    grid.innerHTML = `<div class="grid-empty">No feeds yet.<br>
      <button class="btn primary" data-act="open-settings" data-tab="boxes">Scan the network</button></div>`;
    return;
  }
  let groups;
  if (ui.filter === 'all') {
    groups = cfg.zones.map((z) => ({ zone: z, feeds: cfg.boxes.filter((b) => feedZone(b) === z.id) }))
      .filter((g) => g.feeds.length);
    const rest = cfg.boxes.filter((b) => !feedZone(b));
    if (rest.length) groups.push({ zone: { id: 'none', name: groups.length ? 'Unzoned' : 'Feeds', color: '#7e8490' }, feeds: rest });
  } else {
    const shown = shownFeeds();
    const zone = ui.filter === 'none' ? { id: 'none', name: 'Unzoned', color: '#7e8490' } : zoneOf(ui.filter);
    groups = shown.length ? [{ zone, feeds: shown, single: true }] : [];
  }
  grid.innerHTML = groups.map((g) => {
    const counts = new Map();
    let stby = 0, offl = 0;
    for (const f of g.feeds) {
      const w = Math.max(1, feedTvs(f.id).length);
      const eff = effChanOf(f);
      if (eff.st && !eff.st.online) offl += w;
      else if (eff.st && eff.st.online && eff.st.mode === 1) stby += w;
      else if (eff.chan) counts.set(eff.chan, (counts.get(eff.chan) || 0) + w);
    }
    const topEntry = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const bits = [];
    if (topEntry && topEntry[1] >= 2) bits.push(`mostly ${favName(topEntry[0]) || 'CH ' + topEntry[0]}`);
    if (stby) bits.push(`${stby} standby`);
    if (offl) bits.push(`${offl} offline`);
    const sub = bits.length ? `<span class="sec-sub">· ${esc(bits.join(' · '))}</span>` : '';
    const tvTotal = g.feeds.reduce((s, f) => s + feedTvs(f.id).length, 0);
    return `
    <section class="sec" style="--zc:${esc(g.zone.color)}">
      <div class="sec-head">
        <span class="sec-tick"></span>
        <span class="sec-name">${esc(g.zone.name)}</span>
        <span class="sec-n">${g.feeds.length} group${g.feeds.length === 1 ? '' : 's'}${tvTotal ? ` · ${tvTotal} TVs` : ''}</span>
        ${sub}
        ${g.single || g.zone.id === 'none' ? '' : `<button class="btn quiet sm" data-act="tune-zone" data-id="${esc(g.zone.id)}">Tune zone</button>`}
      </div>
      <div class="cards">${g.feeds.map(feedTileHtml).join('')}</div>
    </section>`;
  }).join('') || `<div class="grid-empty">Nothing in this zone yet.</div>`;
}

function renderSelbar() {
  const bar = $('#selbar');
  if (!ui.selecting || ui.selected.size === 0) { bar.hidden = true; return; }
  bar.hidden = false;
  const anyPaired = [...ui.selected].some((id) => { const t = cfg.tvs.find((x) => x.id === id); return t && t.tvToken; });
  bar.innerHTML = `
    <span class="count"><b>${ui.selected.size}</b> selected</span>
    <button class="btn primary" data-act="sel-tune">Tune</button>
    ${anyPaired ? `
    <button class="btn outline" data-act="sel-vol-down" title="Volume down">&minus;&nbsp;Vol</button>
    <button class="btn outline" data-act="sel-vol-up" title="Volume up">+&nbsp;Vol</button>
    <button class="btn outline" data-act="sel-mute">Mute</button>` : ''}
    <button class="btn outline" data-act="sel-on">Wake</button>
    <button class="btn outline" data-act="sel-off">Standby</button>
    <button class="iconbtn" data-act="sel-clear" title="Clear selection">${I.x}</button>`;
}

/* ---------- live preview (USB HDMI capture) ---------- */
let prevStream = null, prevStreamDevice; // undefined = never acquired

async function syncPreviewStream() {
  const p = cfg.preview || {};
  const video = document.querySelector('#previewHost video');
  if (!p.enabled || p.collapsed || !video) {
    if (prevStream) { prevStream.getTracks().forEach((t) => t.stop()); prevStream = null; prevStreamDevice = undefined; }
    return;
  }
  const wantDevice = p.deviceId || null;
  if (!prevStream || prevStreamDevice !== wantDevice) {
    if (prevStream) { prevStream.getTracks().forEach((t) => t.stop()); prevStream = null; }
    try {
      prevStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: wantDevice ? { deviceId: { exact: wantDevice } } : true,
      });
      prevStreamDevice = wantDevice;
    } catch {
      prevStream = null; prevStreamDevice = wantDevice;
    }
  }
  const empty = document.querySelector('#previewHost .prev-empty');
  if (prevStream) {
    if (video.srcObject !== prevStream) video.srcObject = prevStream;
    if (empty) empty.hidden = true;
  } else if (empty) {
    empty.hidden = false;
  }
}

function previewChip() {
  const p = cfg.preview || {};
  const st = p.boxId ? statuses[p.boxId] : null;
  if (st && st.online && st.mode === 0) {
    return `CH ${st.chan} · ${st.callsign || favName(st.chan) || ''}`;
  }
  return st && st.online && st.mode === 1 ? 'Standby' : '';
}

function renderPreview() {
  const host = $('#previewHost');
  const p = cfg.preview || {};
  if (!p.enabled) { host.innerHTML = ''; syncPreviewStream(); return; }
  const feed = p.boxId ? feedOf(p.boxId) : null;
  host.innerHTML = `<div class="preview ${p.collapsed ? 'collapsed' : ''}">
    <div class="prev-head" data-act="prev-collapse" title="${p.collapsed ? 'Expand' : 'Collapse'}">
      <span class="live-dot"></span>
      <span class="prev-label">${esc(feed ? feed.name : 'Live preview')}</span>
      <span class="prev-ch">${esc(previewChip())}</span>
    </div>
    <div class="prev-body" data-act="prev-watch" ${feed ? `title="Tune ${esc(feed.name)}"` : ''}>
      <video autoplay muted playsinline></video>
      <div class="prev-empty" hidden>No HDMI capture device found.<br>Plug a USB HDMI capture stick into this PC &mdash; see the Setup Guide.</div>
    </div>
  </div>`;
  syncPreviewStream();
}

function updatePreviewChip() {
  const el = document.querySelector('#previewHost .prev-ch');
  if (el) el.textContent = previewChip();
}

function renderAll() {
  renderSideNav(); renderScenes(); renderAudio(); renderHeader(); renderGrid(); renderSelbar(); renderPreview(); renderModal();
}

/* ---------- render: modals ---------- */
function confirmHtml() {
  return `<div class="overlay" data-act="overlay">
      <div class="sheet" style="width:min(430px,100%)">
        <div class="sheet-head"><span class="sheet-title">${esc(ui.confirm.title)}</span>
          <button class="iconbtn sheet-x" data-act="close-modal">${I.x}</button></div>
        <div class="sheet-body">
          <p style="color:var(--muted);font-size:13.5px;line-height:1.55;margin-bottom:18px">${esc(ui.confirm.body)}</p>
          <div style="display:flex;gap:10px;justify-content:flex-end">
            <button class="btn outline" data-act="close-modal">Cancel</button>
            <button class="btn danger" data-act="confirm-yes">${esc(ui.confirm.yes)}</button>
          </div>
        </div></div></div>`;
}

function savePresetHtml() {
  return `<div class="overlay" data-act="overlay">
      <div class="sheet" style="width:min(430px,100%)">
        <div class="sheet-head"><span class="sheet-title">Save current lineup</span>
          <button class="iconbtn sheet-x" data-act="close-modal">${I.x}</button></div>
        <div class="sheet-body">
          <p style="color:var(--muted);font-size:13px;margin-bottom:14px">Saves what each zone is watching right now as a one-tap scene.</p>
          <input type="text" id="presetName" placeholder="Scene name" style="width:100%" maxlength="24" />
          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
            <button class="btn outline" data-act="close-modal">Cancel</button>
            <button class="btn primary" data-act="save-preset-go">Save scene</button>
          </div>
        </div></div></div>`;
}

const focusPresetName = () => setTimeout(() => { const el = $('#presetName'); if (el) el.focus(); }, 30);

// Status ticks while the picker is open only need the "current" highlight moved —
// re-rendering the whole overlay restarted its entrance animation (visible flash).
function updatePickerCurrent() {
  if (!ui.picker) return;
  const singleFeed = ui.picker.tvIds.length === 1 ? feedOf(ui.picker.tvIds[0]) : null;
  const current = singleFeed ? effChanOf(singleFeed).chan : null;
  document.querySelectorAll('#modalHost .fav-btn').forEach((b) => b.classList.toggle('current', b.dataset.chan === current));
}

function pickerHtml() {
    const singleFeed = ui.picker.tvIds.length === 1 ? feedOf(ui.picker.tvIds[0]) : null;
    const current = singleFeed ? effChanOf(singleFeed).chan : null;
    const singleN = singleFeed ? feedTvs(singleFeed.id).length : 0;
    const shareNote = singleFeed && singleN
      ? ` &mdash; ${singleN} TV${singleN === 1 ? '' : 's'} follow this group`
      : '';
    return `<div class="overlay" data-act="overlay">
      <div class="sheet">
        <div class="sheet-head">
          <div><div class="sheet-title">Tune ${esc(ui.picker.label)}</div>
          <div class="sheet-sub">Tap a channel, or punch in a number${shareNote}</div></div>
          <button class="iconbtn sheet-x" data-act="close-modal">${I.x}</button>
        </div>
        <div class="sheet-body">
          <div class="picker">
            <div class="fav-grid">
              ${cfg.favorites.map((f) => `
                <button class="fav-btn ${current === String(f.chan) ? 'current' : ''}" data-act="fav" data-chan="${esc(f.chan)}" style="--acc:${acc(f.chan)}">
                  <span class="cs">${esc(f.name)}</span><span class="num">${esc(f.chan)}</span>
                </button>`).join('')}
            </div>
            <div class="pad">
              <div class="pad-display" id="padDisplay">${esc(ui.pad)}</div>
              <div class="pad-keys">
                ${[1,2,3,4,5,6,7,8,9].map((n) => `<button class="pad-key" data-act="pad" data-k="${n}">${n}</button>`).join('')}
                <button class="pad-key dim" data-act="pad" data-k=".">·</button>
                <button class="pad-key" data-act="pad" data-k="0">0</button>
                <button class="pad-key dim" data-act="pad-back">DEL</button>
              </div>
              <button class="btn primary pad-go" data-act="pad-go">Go</button>
              ${ui.picker.tvIds.some((id) => feedTvs(id).some((t) => t.tvToken))
                ? `<div class="pow-row">
                    <button class="btn outline" data-act="picker-vol-down" title="Volume down">&minus;&nbsp;Vol</button>
                    <button class="btn outline" data-act="picker-mute">Mute</button>
                    <button class="btn outline" data-act="picker-vol-up" title="Volume up">+&nbsp;Vol</button>
                  </div>` : ''}
              <div class="pow-row">
                <button class="btn outline" data-act="picker-on">${I.power} Wake</button>
                <button class="btn outline" data-act="picker-off">${I.power} Standby</button>
              </div>
            </div>
          </div>
        </div>
      </div></div>`;
}

function codeGateHtml() {
  const g = ui.codeGate;
  const dots = Array.from({ length: Math.max(4, String(cfg.settingsCode || '').length) }, (_, i) =>
    `<i class="${i < g.entered.length ? 'on' : ''}"></i>`).join('');
  const sub = g.for === 'fullscreen' ? 'to exit fullscreen'
    : g.for === 'tune' ? 'to change channels'
    : 'to open Settings';
  return `<div class="overlay" data-act="overlay">
      <div class="sheet code-sheet ${g.shake ? 'shake' : ''}" style="width:262px">
        <div class="sheet-body" style="padding:22px 20px 20px;text-align:center">
          <div class="code-title">Staff code</div>
          <div class="code-sub">${sub}</div>
          <div class="code-dots">${dots}</div>
          <div class="pad-keys code-keys">
            ${[1,2,3,4,5,6,7,8,9].map((n) => `<button class="pad-key" data-act="code-key" data-k="${n}">${n}</button>`).join('')}
            <button class="pad-key dim" data-act="close-modal" title="Cancel">${I.x}</button>
            <button class="pad-key" data-act="code-key" data-k="0">0</button>
            <button class="pad-key dim" data-act="code-back">DEL</button>
          </div>
        </div></div></div>`;
}

function openSettings(tab) {
  ui.settings = true;
  if (tab) ui.settingsTab = tab;
  renderModal();
  refreshDevices();
  if (ui.settingsTab === 'diag') refreshDiag();
}

let unlockUntil = 0; // 2-minute grace after a correct code, so staff aren't re-typing

// Channel lock: when enabled, tuning and scenes ask for the staff code first.
function gatedTune(fn) {
  if (cfg.lockTuning && cfg.settingsCode && Date.now() > unlockUntil) {
    ui.codeGate = { for: 'tune', run: fn, entered: '', shake: false };
    renderModal();
  } else {
    fn();
  }
}

function enterCodeDigit(k) {
  const g = ui.codeGate;
  if (!g) return;
  g.entered += k;
  const code = String(cfg.settingsCode || '');
  if (g.entered.length >= code.length) {
    if (g.entered === code) {
      const target = g.for, tab = g.tab, run = g.run;
      ui.codeGate = null;
      unlockUntil = Date.now() + 120000;
      if (target === 'settings') openSettings(tab);
      else if (target === 'fullscreen') { renderModal(); api.toggleFullscreen(); }
      else { renderModal(); if (run) run(); }
    } else {
      g.shake = true; g.entered = '';
      renderModal();
      setTimeout(() => { if (ui.codeGate) { ui.codeGate.shake = false; renderModal(); } }, 450);
    }
    return;
  }
  updateCodeDots();
}

function updateCodeDots() {
  const g = ui.codeGate;
  document.querySelectorAll('#modalHost .code-dots i').forEach((el, i) =>
    el.classList.toggle('on', g && i < g.entered.length));
}

function renderModal() {
  const host = $('#modalHost');
  const dialog = ui.codeGate ? codeGateHtml()
    : ui.confirm ? confirmHtml()
    : ui.savePreset ? savePresetHtml()
    : (!ui.settings && ui.picker ? pickerHtml() : '');

  if (!ui.settings) {
    host.innerHTML = dialog;
    if (ui.savePreset) focusPresetName();
    return;
  }

  // Settings stays mounted across tab switches and data edits — a full rebuild
  // restarted its fade-in and let the dashboard flash through behind it.
  let root = host.querySelector('.settings');
  if (!root) {
    host.innerHTML = settingsHtml();
    root = host.querySelector('.settings');
    root.querySelector('.set-body').dataset.tab = ui.settingsTab;
  } else {
    root.querySelectorAll('.set-nav[data-id]').forEach((b) =>
      b.classList.toggle('active', b.dataset.id === ui.settingsTab));
    const body = root.querySelector('.set-body');
    const keep = body.dataset.tab === ui.settingsTab ? body.scrollTop : 0;
    body.innerHTML = settingsBody();
    body.dataset.tab = ui.settingsTab;
    body.scrollTop = keep;
  }

  // Dialogs (confirm, save-scene, code pad) live on their own layer ABOVE settings —
  // previously the settings branch returned early and they never displayed.
  let dh = host.querySelector('#dialogHost');
  if (!dh) { dh = document.createElement('div'); dh.id = 'dialogHost'; host.appendChild(dh); }
  dh.innerHTML = dialog;
  if (ui.savePreset) focusPresetName();
}

/* ---------- render: settings ---------- */
const TABS = [
  ['boxes', 'TVs & Feeds', I.tvone],
  ['zones', 'Zones', I.zonebox],
  ['channels', 'Channels', I.star],
  ['presets', 'Scenes', I.boltf],
  ['audio', 'Audio', I.speaker],
  ['general', 'General', I.knob],
  ['diag', 'Diagnostics', I.pulse],
  ['guide', 'Setup Guide', I.clipboard],
];

function settingsHtml() {
  const navCnt = {
    boxes: `${cfg.tvs.length}·${cfg.boxes.length}`,
    zones: cfg.zones.length,
    channels: cfg.favorites.length,
    presets: cfg.presets.length,
  };
  return `<div class="settings">
    <div class="set-rail">
      <div class="side-stripe" aria-hidden="true"></div>
      <div class="side-brand" style="padding-bottom:14px">
        <img class="brand-logo" src="assets/logo.png" alt="R.J. Corman" style="max-width:172px" draggable="false"/>
        <span class="brand-sub">Settings</span></div>
      ${TABS.map(([id, label, icon]) =>
        `<button class="set-nav ${ui.settingsTab === id ? 'active' : ''}" data-act="settings-tab" data-id="${id}">${icon}<span class="lbl">${label}</span>${navCnt[id] != null ? `<span class="cnt">${navCnt[id]}</span>` : ''}</button>`).join('')}
      <div class="spacer"></div>
      <button class="set-nav" data-act="close-settings">${I.arrl}<span class="lbl">Back to dashboard</span></button>
    </div>
    <div class="set-body">${settingsBody()}</div>
  </div>`;
}

const setHead = (title, desc, action) => `<div class="set-head">
  <div class="set-headt"><div class="set-title">${title}</div>${desc ? `<div class="set-desc">${desc}</div>` : ''}</div>
  ${action || ''}
</div>`;

function settingsBody() {
  const t = ui.settingsTab;
  if (t === 'boxes') return boxesTab();
  if (t === 'zones') return zonesTab();
  if (t === 'channels') return channelsTab();
  if (t === 'presets') return presetsTab();
  if (t === 'audio') return audioTab();
  if (t === 'general') return generalTab();
  if (t === 'diag') return diagTab();
  if (t === 'guide') return guideTab();
  return '';
}

/* ---------- audio tab (BSS speaker zones) ---------- */
function audioTab() {
  const a = cfg.audio || {};
  return `${setHead('Audio',
    'Zone volume for the ceiling speakers, straight to the BSS processor over the network. Sliders appear in the sidebar once this is on and addressed.')}
    <div class="card slim"><h3>${I.speaker} BSS Soundweb London</h3>
      <div class="field-row"><label>Speaker control<span class="hint">Shows the volume sliders in the sidebar</span></label>
        <span class="switch"><input type="checkbox" ${a.enabled ? 'checked' : ''} data-bind="audio-enabled"/><span class="track"></span></span></div>
      <div class="field-row"><label>BLU-100 IP address</label>
        <span class="pairbox">
          <input type="text" value="${esc(a.ip || '')}" data-bind="audio-ip" placeholder="192.168.1.x" style="width:140px;font-family:var(--mono)"/>
          <button class="mini" data-act="audio-test">Test :1023</button>
        </span></div>
    </div>
    <div class="card slim"><h3>${I.zonebox} Speaker zones</h3>
      <p style="color:var(--muted);font-size:12.5px;margin:-2px 0 10px;line-height:1.5">Each zone needs its gain object's HiQnet address from the design — get it with the free HARMAN <b>Audio Architect</b> app (see steps below). Format: <code style="font-family:var(--mono)">node,vd,object</code> — hex like <code style="font-family:var(--mono)">0x100,0x3,0x152</code> is fine.</p>
      <div class="row-grid row-head" style="grid-template-columns:1.1fr 1.3fr 0.55fr 0.55fr auto"><span>Zone</span><span>Address</span><span>Gain #</span><span>Mute #</span><span></span></div>
      ${(a.zones || []).map((z) => `<div class="row-grid" style="grid-template-columns:1.1fr 1.3fr 0.55fr 0.55fr auto">
        <input type="text" value="${esc(z.name)}" data-bind="az-name" data-id="${esc(z.id)}" maxlength="22"/>
        <input type="text" value="${esc(z.addr || '')}" data-bind="az-addr" data-id="${esc(z.id)}" placeholder="0x100,0x3,0x152" style="font-family:var(--mono)"/>
        <input type="number" value="${esc(z.gainParam ?? 0)}" data-bind="az-gain" data-id="${esc(z.id)}" min="0" max="99" style="width:64px"/>
        <input type="number" value="${esc(z.muteParam ?? 1)}" data-bind="az-mute" data-id="${esc(z.id)}" min="0" max="99" style="width:64px"/>
        <button class="mini warn" data-act="az-remove" data-id="${esc(z.id)}">${I.trash}</button>
      </div>`).join('')}
      <div style="margin-top:12px"><button class="btn outline" data-act="az-add">${I.plus} Add zone</button></div>
    </div>
    <div class="card slim guide"><h3>${I.clipboard} Getting the addresses (one laptop session)</h3>
      <ol>
        <li>Install HARMAN <b>Audio Architect</b> (free) on a laptop on the gym network.</li>
        <li>Let it discover the BLU-100 (that reveals its IP for the field above), then go <b>online</b> and open the design living in the device.</li>
        <li>Find the gain/fader block feeding each speaker zone; its properties show the <b>HiQnet address</b> (node / virtual device / object) — type it here. Gain # and Mute # are that block's parameter numbers (0 and 1 for a standard single-channel gain; per-channel blocks count up).</li>
        <li>Test with the slider at a quiet hour — if the wrong thing moves, it's the wrong block; pick the next gain in the chain.</li>
      </ol></div>`;
}

/* ---------- diagnostics tab ---------- */
const relTime = (ts) => {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
};
const logTime = (ts) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};

function logRowHtml(e) {
  return `<div class="dlog-row lv-${esc(e.level)}"><span class="dl-t">${logTime(e.ts)}</span><span class="dl-dot"></span><span class="dl-src">${esc(e.source)}</span><span class="dl-msg">${esc(e.message)}</span></div>`;
}

function diagTab() {
  const d = ui.diag;
  const filtered = d.filter === 'all' ? d.log : d.log.filter((e) => e.level === d.filter);
  const shown = filtered.slice(-250).reverse();
  const counts = { warn: d.log.filter((e) => e.level === 'warn').length, error: d.log.filter((e) => e.level === 'error').length };

  const testRes = (key) => {
    const r = d.tests[key];
    if (!r) return '';
    if (r.busy) return `<span class="tres">testing…</span>`;
    if (r.ok) return `<span class="tres ok">OK · ${r.ms}ms${r.receiverId ? ` · ${esc(r.receiverId)}` : ''}${r.devices ? ` · ${esc(r.devices.join(' / '))}` : ''}</span>`;
    return `<span class="tres err">${esc(r.err || 'failed')} · ${r.ms || '—'}ms</span>`;
  };

  const info = d.info;
  return `${setHead('Diagnostics', 'Everything the app is doing, live — plus feed health, connection testers, and config tools.')}

    <div class="card"><h3>${I.pulse} Event log <span class="dl-counts">${counts.warn ? `· ${counts.warn} warnings` : ''}${counts.error ? ` · ${counts.error} errors` : ''}</span></h3>
      <div class="dlog-bar">
        ${['all', 'info', 'warn', 'error'].map((f) => `<button class="fchip ${d.filter === f ? 'on' : ''}" data-act="log-filter" data-id="${f}">${f === 'all' ? 'All' : f}</button>`).join('')}
        <span class="spacer2"></span>
        <button class="mini" data-act="log-copy">${I.copy} Copy</button>
        <button class="mini" data-act="log-save">Save&hellip;</button>
        <button class="mini warn" data-act="log-clear">Clear</button>
      </div>
      <div class="dlog" id="dlogList">${shown.map(logRowHtml).join('') || '<div style="color:var(--muted);padding:8px 0">Nothing yet.</div>'}</div>
    </div>

    <div class="card"><h3>${I.feed} Feed health</h3>
      ${cfg.boxes.map((b) => {
        const st = statuses[b.id];
        const state = !st || !st.online ? ['#5a5f6a', 'offline'] : st.mode === 1 ? ['#f8982d', 'standby'] : ['#2fbf71', 'live'];
        const ping = d.pings[b.id];
        const pingRes = !ping ? '' : ping.busy ? `<span class="tres">…</span>`
          : ping.ok ? `<span class="tres ok">${ping.ms}ms</span>` : `<span class="tres err">${esc(ping.err)}</span>`;
        return `<div class="fh-row">
          <span class="fh-dot" style="background:${state[0]}"></span>
          <span style="font-weight:700">${esc(b.name)}</span>
          <span class="tres">${esc(b.ip)}${b.demo ? ' (demo)' : ''}</span>
          <span class="tres">${st && st.online && st.mode === 0 ? `${esc(st.callsign || '')} ${esc(st.chan || '')}` : state[1]}</span>
          <span class="tres">${st ? relTime(st.lastOk) : '—'}</span>
          <span style="display:flex;gap:6px;align-items:center;justify-content:flex-end">${pingRes}<button class="mini" data-act="diag-ping" data-id="${esc(b.id)}" data-ip="${esc(b.ip)}">Ping</button></span>
        </div>`;
      }).join('')}
    </div>

    <div class="card"><h3>${I.radar} Connection testers</h3>
      <div class="trow"><input type="text" placeholder="Receiver IP" id="tFeed" style="width:140px;font-family:var(--mono)"/>
        <button class="mini" data-act="diag-test-feed">Test feed (SHEF :8080)</button>${testRes('feed')}</div>
      <div class="trow"><input type="text" placeholder="TV IP" id="tTv" style="width:140px;font-family:var(--mono)"/>
        <button class="mini" data-act="diag-test-tv">Test SmartCast (:7345)</button>${testRes('tv')}</div>
      <div class="trow"><input type="text" placeholder="iTach IP" id="tItach" style="width:140px;font-family:var(--mono)"/>
        <button class="mini" data-act="diag-test-itach">Test iTach (:4998)</button>${testRes('itach')}</div>
      <div class="trow"><button class="mini" data-act="diag-comports">List COM ports</button>
        ${d.com ? (d.com.ports.length
          ? `<span class="tres ok">${d.com.ports.map((p) => `${esc(p.port)} (${esc(p.device)})`).join(' · ')}</span>`
          : `<span class="tres err">No serial ports found — plug in the USB dongles</span>`) : ''}</div>
    </div>

    <div class="card"><h3>${I.knob} System</h3>
      ${info ? `<div class="diag-kv">
        <span class="k">App</span><span class="v">RJC TV Control v${esc(info.version)} · Electron ${esc(info.electron)} · Chrome ${esc(info.chrome)}</span>
        <span class="k">Platform</span><span class="v">${esc(info.platform)}</span>
        <span class="k">Running since</span><span class="v">${new Date(info.startedAt).toLocaleTimeString()} (${relTime(info.startedAt)})</span>
        <span class="k">This PC</span><span class="v">${info.nets.map((n) => `${esc(n.name)}: ${esc(n.address)}`).join(' · ') || 'no network'}</span>
        <span class="k">Status poll</span><span class="v">every ${esc(cfg.pollSeconds)}s · ${cfg.boxes.length} feeds · ${cfg.tvs.length} TVs</span>
        <span class="k">Config</span><span class="v">${esc(info.userData)}</span>
      </div>` : `<div class="scan-status"><span class="spinner"></span> Loading…</div>`}
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        <button class="mini" data-act="cfg-open">Open config folder</button>
        <button class="mini" data-act="cfg-export">Export config&hellip;</button>
        <button class="mini" data-act="cfg-import">Import config&hellip;</button>
        <button class="mini warn" data-act="cfg-reset">Reset to demo</button>
      </div>
      <p style="color:var(--muted);font-size:12px;margin-top:10px">Export on this PC, import on the other touchscreen — the whole setup (TVs, feeds, scenes, pairings) moves over.</p>
    </div>`;
}

function boxesTab() {
  const share = feedShareCounts();
  const scanAction = ui.scan.running
    ? `<div class="scan-status" style="margin-top:8px"><span class="spinner"></span> <span id="scanStatus">Scanning${ui.scan.progress ? ` — ${ui.scan.progress.done}/${ui.scan.progress.total}, ${ui.scan.progress.found} found` : '…'}</span></div>`
    : `<button class="btn primary" data-act="scan">${I.radar} Scan network</button>`;
  let foundHtml = '';
  if (ui.scan.found) {
    const fresh = ui.scan.found.filter((f) => !f.known);
    foundHtml = `<div class="card"><h3>Scan results — ${ui.scan.found.length} receiver${ui.scan.found.length === 1 ? '' : 's'} (${fresh.length} new)</h3>
      ${ui.scan.found.length === 0 ? `<p style="color:var(--muted);font-size:13px">No receivers answered on port 8080. Check the DECA adapter and that External Access is set to Allow (see the Setup Guide tab).</p>` : ''}
      ${ui.scan.found.map((f) => `<div class="row-grid" style="grid-template-columns:1fr 1.4fr auto">
          <span class="ip">${esc(f.ip)}</span><span class="rid">${esc(f.receiverId)} · ${esc(f.version)}</span>
          ${f.known ? `<span class="rid" style="color:var(--green)">Added</span>` : `<button class="mini" data-act="add-found" data-ip="${esc(f.ip)}" data-rid="${esc(f.receiverId)}">Add</button>`}
        </div>`).join('')}
      ${fresh.length > 1 ? `<div style="margin-top:12px"><button class="btn outline" data-act="add-all-found">Add all ${fresh.length} new</button></div>` : ''}
    </div>`;
  }
  return `${setHead('TVs &amp; Feeds',
    'A feed is one receiver; a TV is one screen — TVs sharing a feed change together. Details in the Setup Guide.',
    scanAction)}
    ${foundHtml}
    <div class="card editgrid"><h3>${I.feed} Feeds — ${cfg.boxes.length} receivers</h3>
      <div class="row-grid row-head" style="grid-template-columns:1fr 1.2fr 0.6fr auto"><span>Name</span><span>Address</span><span>TVs on it</span><span></span></div>
      ${cfg.boxes.map((b) => `<div class="row-grid" style="grid-template-columns:1fr 1.2fr 0.6fr auto">
        <input type="text" value="${esc(b.name)}" data-bind="feed-name" data-id="${esc(b.id)}" maxlength="22"/>
        <span><span class="ip">${esc(b.ip)}</span>${b.demo ? ' <span class="rid">(demo)</span>' : ''}<br><span class="rid">${esc(b.receiverId || '')}</span></span>
        <span class="rid">${share[b.id] || 0}</span>
        <span class="row-actions">
          <button class="mini" data-act="identify" data-id="${esc(b.id)}">${I.target} Identify</button>
          <button class="mini warn" data-act="remove-feed" data-id="${esc(b.id)}">${I.trash}</button>
        </span>
      </div>`).join('')}
    </div>
    <div class="card editgrid"><h3>${I.tvone} TVs — ${cfg.tvs.length} screens</h3>
      <p style="color:var(--muted);font-size:12.5px;margin:-4px 0 8px">Vizio volume &amp; power: enter the TV's IP, press Pair, type the PIN it shows.</p>
      ${ui.tvscan && ui.tvscan.running
        ? `<div class="scan-status" style="margin-bottom:10px"><span class="spinner"></span> Sweeping the network for SmartCast TVs&hellip;</div>`
        : `<div style="margin-bottom:10px"><button class="mini" data-act="tvscan">${I.radar} Scan for TVs</button></div>`}
      ${ui.tvscan && ui.tvscan.found && ui.tvscan.found.length ? `
      <div class="row-grid row-head" style="grid-template-columns:1fr 1.3fr auto"><span>SmartCast TV found</span><span>Which TV is it?</span><span></span></div>
      ${ui.tvscan.found.map((ip) => `<div class="row-grid" style="grid-template-columns:1fr 1.3fr auto">
        <span class="ip">${esc(ip)}</span>
        <span class="pairbox"><select style="width:100%">
          <option value="">Pick a TV&hellip;</option>
          ${cfg.tvs.map((t) => `<option value="${esc(t.id)}" ${t.tvIp === ip ? 'selected' : ''}>${esc(t.name)}${t.tvIp === ip ? ' (assigned)' : ''}</option>`).join('')}
        </select>
        <button class="mini" data-act="tvscan-assign" data-ip="${esc(ip)}">Set</button></span>
        <span></span>
      </div>`).join('')}` : ''}
      <div class="row-grid row-head" style="grid-template-columns:1fr 0.68fr 0.78fr 1.55fr auto"><span>Name</span><span>Zone</span><span>Feed</span><span>TV control</span><span></span></div>
      ${[...cfg.zones.map((z) => ({ label: z.name, color: z.color, tvs: cfg.tvs.filter((t) => t.zone === z.id) })),
         { label: 'Unzoned', color: '#7e8490', tvs: cfg.tvs.filter((t) => !zoneOf(t.zone)) }]
        .filter((g) => g.tvs.length)
        .map((g) => `<div class="tgroup"><i style="background:${esc(g.color)}"></i>${esc(g.label)} · ${g.tvs.length}</div>`
          + g.tvs.map((t) => `<div class="row-grid" style="grid-template-columns:1fr 0.68fr 0.78fr 1.55fr auto">
        <input type="text" value="${esc(t.name)}" data-bind="tv-name" data-id="${esc(t.id)}" maxlength="28"/>
        <select data-bind="tv-zone" data-id="${esc(t.id)}">
          <option value="">Unzoned</option>
          ${cfg.zones.map((z) => `<option value="${esc(z.id)}" ${t.zone === z.id ? 'selected' : ''}>${esc(z.name)}</option>`).join('')}
        </select>
        <select data-bind="tv-feed" data-id="${esc(t.id)}">
          <option value="">No feed</option>
          ${cfg.boxes.map((b) => `<option value="${esc(b.id)}" ${t.boxId === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
        </select>
        ${tvCtlCell(t)}
        <span class="row-actions">
          <button class="mini warn" data-act="remove-tv" data-id="${esc(t.id)}">${I.trash}</button>
        </span>
      </div>`).join('')).join('')}
      <div style="margin-top:12px"><button class="btn outline" data-act="add-tv">${I.plus} Add TV</button></div>
    </div>`;
}

function tvCtlCell(t) {
  const sel = `<select data-bind="tv-ctl" data-id="${esc(t.id)}" style="width:66px;flex:none" title="How this TV is controlled: SmartCast over IP, RS-232 through its serial adapter, or an iTach IR blaster">
      <option value="ip" ${!t.ctl || t.ctl === 'ip' ? 'selected' : ''}>IP</option>
      <option value="serial" ${t.ctl === 'serial' ? 'selected' : ''}>COM</option>
      <option value="ir" ${t.ctl === 'ir' ? 'selected' : ''}>IR</option>
    </select>`;
  if (t.ctl === 'serial') {
    return `<span class="pairbox">${sel}
      <input type="text" value="${esc(t.serialPort || '')}" placeholder="COM3" data-bind="tv-com" data-id="${esc(t.id)}" style="width:66px;font-family:var(--mono)"/>
      <button class="mini" data-act="serial-test" data-id="${esc(t.id)}">Test</button>
    </span>`;
  }
  if (t.ctl === 'ir') {
    return `<span class="pairbox">${sel}
      <input type="text" value="${esc(t.itachIp || '')}" placeholder="iTach IP" data-bind="tv-itachip" data-id="${esc(t.id)}" style="width:92px;font-family:var(--mono)"/>
      <select data-bind="tv-itachport" data-id="${esc(t.id)}" style="width:50px;flex:none" title="Emitter port on the iTach">
        ${[1, 2, 3].map((p) => `<option value="${p}" ${(t.itachPort || 1) === p ? 'selected' : ''}>${p}</option>`).join('')}
      </select>
      <button class="mini" data-act="serial-test" data-id="${esc(t.id)}">Test</button>
    </span>`;
  }
  if (ui.pairingTv === t.id) {
    return `<span class="pairbox">${sel}
      <input type="text" id="pinInput" placeholder="PIN" maxlength="8" inputmode="numeric" style="width:60px;font-family:var(--mono)"/>
      <button class="mini" data-act="vizio-pin" data-id="${esc(t.id)}">OK</button>
      <button class="mini" data-act="vizio-cancel">${I.x}</button>
    </span>`;
  }
  if (t.tvToken) {
    return `<span class="pairbox">${sel}<span class="paired">Paired</span>
      <button class="mini warn" data-act="vizio-unpair" data-id="${esc(t.id)}">Unpair</button></span>`;
  }
  return `<span class="pairbox">${sel}
    <input type="text" value="${esc(t.tvIp || '')}" placeholder="TV IP" data-bind="tv-ip" data-id="${esc(t.id)}" style="width:100px;font-family:var(--mono)"/>
    <button class="mini" data-act="vizio-pair" data-id="${esc(t.id)}">Pair</button>
  </span>`;
}

const SWATCH_COLORS = ['#e60000', '#f8982d', '#3b82f6', '#22c55e', '#a855f7', '#14b8a6', '#eab308', '#ec4899'];
function zonesTab() {
  return `${setHead('Zones', 'Group TVs by area of the gym. Zones drive the sidebar, group tuning, and scenes.',
    `<button class="btn outline" data-act="add-zone">${I.plus} Add zone</button>`)}
    <div class="card">
      ${cfg.zones.map((z) => `<div class="row-grid" style="grid-template-columns:1.2fr 2fr auto">
        <input type="text" value="${esc(z.name)}" data-bind="zone-name" data-id="${esc(z.id)}" maxlength="20"/>
        <span class="swatches">${SWATCH_COLORS.map((c) => `<button class="swatch ${z.color === c ? 'sel' : ''}" style="background:${c}" data-act="zone-color" data-id="${esc(z.id)}" data-color="${c}" title="${c}"></button>`).join('')}</span>
        <button class="mini warn" data-act="remove-zone" data-id="${esc(z.id)}">Remove</button>
      </div>`).join('')}
    </div>`;
}

function channelsTab() {
  return `${setHead('Channels', 'The gym\'s lineup, shown in the tune picker. Numbers use the TV format (like 20.1); each channel carries its accent color through the whole app.',
    `<button class="btn outline" data-act="add-fav">${I.plus} Add channel</button>`)}
    <div class="card">
      <div class="row-grid row-head" style="grid-template-columns:12px 2fr 1fr auto"><span></span><span>Name</span><span>Channel</span><span></span></div>
      ${cfg.favorites.map((f, i) => `<div class="row-grid" style="grid-template-columns:12px 2fr 1fr auto">
        <span class="chan-tick" style="background:${acc(f.chan)}"></span>
        <input type="text" value="${esc(f.name)}" data-bind="fav-name" data-idx="${i}" maxlength="16"/>
        <input type="text" value="${esc(f.chan)}" data-bind="fav-chan" data-idx="${i}" maxlength="7" style="font-family:var(--mono);width:92px"/>
        <button class="mini warn" data-act="remove-fav" data-idx="${i}">Remove</button>
      </div>`).join('')}
    </div>`;
}

function presetsTab() {
  return `${setHead('Scenes', 'One-tap lineups: each scene sets a channel per zone. Blank leaves that zone alone. You can also save the current lineup from the sidebar.',
    `<button class="btn outline" data-act="add-preset">${I.plus} Add scene</button>`)}
    ${cfg.presets.map((p, pi) => `<div class="card">
      <div class="row-grid" style="grid-template-columns:1fr auto;border:0;padding-bottom:2px">
        <input type="text" value="${esc(p.name)}" data-bind="preset-name" data-idx="${pi}" maxlength="24" style="font-weight:700"/>
        <button class="mini warn" data-act="remove-preset" data-idx="${pi}">Remove</button>
      </div>
      ${cfg.zones.map((z) => `<div class="row-grid" style="grid-template-columns:1fr 1fr">
        <label style="color:var(--muted);font-size:13px">${esc(z.name)}</label>
        <input type="text" placeholder="—" value="${esc(p.assignments[z.id] || '')}" data-bind="preset-chan" data-idx="${pi}" data-zone="${esc(z.id)}" maxlength="7" style="font-family:var(--mono);width:92px"/>
      </div>`).join('')}
    </div>`).join('')}`;
}

function generalTab() {
  const p = cfg.preview || {};
  const devs = ui.devices || [];
  return `${setHead('General', 'The essentials up top; advanced fallbacks tucked below.')}
    <div class="card slim"><h3>${I.shield} Security</h3>
      <div class="field-row"><label>Staff code<span class="hint">The PIN for Settings, fullscreen exit, and the channel lock. Type a new one to change it.</span></label>
        <input type="text" value="${esc(cfg.settingsCode || '')}" data-bind="settingsCode" maxlength="8" inputmode="numeric" style="font-family:var(--mono);width:92px"/></div>
      <div class="field-row"><label>Lock channel changes<span class="hint">Tuning and scenes ask for the code; unlocks for 2 minutes per entry</span></label>
        <span class="switch"><input type="checkbox" ${cfg.lockTuning ? 'checked' : ''} data-bind="lockTuning"/><span class="track"></span></span></div>
    </div>
    <div class="card slim"><h3>${I.contrast} Display &amp; sleep</h3>
      <div class="field-row"><label>Launch fullscreen<span class="hint">Kiosk-style start (F11 toggles any time)</span></label>
        <span class="switch"><input type="checkbox" ${cfg.launchFullscreen ? 'checked' : ''} data-bind="launchFullscreen"/><span class="track"></span></span></div>
      <div class="field-row"><label>Sleep screen<span class="hint">Dims to a clock when idle; any tap wakes it</span></label>
        <span class="switch"><input type="checkbox" ${cfg.sleepEnabled ? 'checked' : ''} data-bind="sleepEnabled"/><span class="track"></span></span></div>
      <div class="field-row"><label>Sleep after</label>
        <input type="number" value="${esc(cfg.sleepMinutes)}" data-bind="sleepMinutes" min="1" max="60"/></div>
    </div>
    <div class="card slim"><h3>${I.feed} Feeds &amp; data</h3>
      <div class="field-row"><label>Demo mode<span class="hint">30 simulated TVs on 13 feeds</span></label>
        <span class="switch"><input type="checkbox" ${cfg.demoMode ? 'checked' : ''} data-bind="demoMode"/><span class="track"></span></span></div>
      <div class="field-row"><label>Status refresh<span class="hint">Seconds between feed polls</span></label>
        <input type="number" value="${esc(cfg.pollSeconds)}" data-bind="pollSeconds" min="5" max="120"/></div>
      <div class="field-row"><label>Identify channel</label>
        <input type="text" value="${esc(cfg.identifyChannel)}" data-bind="identifyChannel" maxlength="7" style="font-family:var(--mono);width:92px"/></div>
    </div>
    ${cardClps('preview', I.pip, 'Live corner preview', `
      <div class="field-row"><label>Show preview window<span class="hint">Real video from one feed, via a USB HDMI capture stick plugged into this PC</span></label>
        <span class="switch"><input type="checkbox" ${p.enabled ? 'checked' : ''} data-bind="prev-enabled"/><span class="track"></span></span></div>
      <div class="field-row"><label>Capture device</label>
        <select data-bind="prev-device" style="max-width:280px">
          <option value="">Auto-detect</option>
          ${devs.map((d) => `<option value="${esc(d.deviceId)}" ${p.deviceId === d.deviceId ? 'selected' : ''}>${esc(d.label || 'Video device')}</option>`).join('')}
        </select></div>
      <div class="field-row"><label>Which feed drives it<span class="hint">Labels the preview with that feed's channel; tap the video to tune it</span></label>
        <select data-bind="prev-box" style="max-width:280px">
          <option value="">Not set</option>
          ${cfg.boxes.map((b) => `<option value="${esc(b.id)}" ${p.boxId === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
        </select></div>`, p.enabled ? 'On' : 'Off')}
    ${cardClps('serial', I.sliders, 'Serial TV control (RS-232)', `
      <p style="color:var(--muted);font-size:12.5px;line-height:1.5;margin:-2px 0 10px;max-width:640px">
        For TVs still wired to the old AMX serial adapters: run those lines into USB-to-RS232 dongles on this PC,
        switch the TV's control to <b>COM</b> in TVs &amp; Feeds, and enter the adapter's command bytes below —
        hex like <code style="font-family:var(--mono)">A1 00 0B</code>, or plain text (use \\r for a carriage return).
        The adapter's model number determines these; the app sends them as-is.</p>
      <div class="field-row"><label>Baud rate</label>
        <input type="number" value="${esc((cfg.serial || {}).baud || 9600)}" data-bind="serial-baud" min="300" max="115200"/></div>
      ${[['volUp', 'Volume up'], ['volDown', 'Volume down'], ['muteToggle', 'Mute'], ['powerOn', 'Power on'], ['powerOff', 'Power off']]
        .map(([k, label]) => `<div class="field-row"><label>${label} command</label>
        <input type="text" value="${esc(((cfg.serial || {}).commands || {})[k] || '')}" data-bind="serial-cmd-${k}" placeholder="—" style="width:230px;font-family:var(--mono)"/></div>`).join('')}`)}
    ${cardClps('itach', I.radar, 'IR blaster (Global Caché iTach)', `
      <p style="color:var(--muted);font-size:12.5px;line-height:1.5;margin:-2px 0 10px;max-width:640px">
        Third fallback, works on any TV: an iTach IP2IR unit (~$130, drives 3 TVs with stick-on emitters).
        Set a TV's control to <b>IR</b> with the unit's IP and emitter port, and paste Vizio
        <code style="font-family:var(--mono)">sendir</code> codes below &mdash; Global Cach&eacute;'s IR database has them,
        or the unit can learn from the factory remote.</p>
      ${[['volUp', 'Volume up'], ['volDown', 'Volume down'], ['muteToggle', 'Mute'], ['powerOn', 'Power on'], ['powerOff', 'Power off']]
        .map(([k, label]) => `<div class="field-row"><label>${label} code</label>
        <input type="text" value="${esc(((cfg.itach || {}).commands || {})[k] || '')}" data-bind="itach-cmd-${k}" placeholder="sendir,1:1,1,38000,&hellip;" style="width:230px;font-family:var(--mono)"/></div>`).join('')}`)}`;
}

function guideTab() {
  return `${setHead('Setup Guide', 'From zero to controlling every TV on the floor.')}
    <div class="card guide"><h3>1 · Put the receivers on the network</h3>
      <ol>
        <li>Find the SWiM multiswitch where the satellite coax converges. For each <b>SWM OUT</b> bank in use, connect one <b>DirecTV Broadband DECA adapter</b>: coax side to an open splitter port on that bank, Ethernet side to the router or switch. A SWM-16 has two banks, so it takes two adapters.</li>
        <li>Every H24/H25 on that coax joins the network automatically — no wiring at the TVs.</li>
      </ol></div>
    <div class="card guide"><h3>2 · Allow control on each receiver</h3>
      <ol>
        <li>On the receiver, with the DirecTV remote: <code>Menu &rarr; Settings &amp; Help &rarr; Settings &rarr; Whole-Home &rarr; External Device</code></li>
        <li>Set <b>External Access</b> to <b>Allow</b>. About two minutes per box, one time.</li>
      </ol></div>
    <div class="card guide"><h3>3 · Map feeds to TVs here</h3>
      <ol>
        <li>Turn off Demo mode in <b>General</b>.</li>
        <li>In <b>TVs &amp; Feeds</b>, press <b>Scan network</b> — every receiver with External Access allowed shows up. Add them as feeds.</li>
        <li>Press <b>Identify</b> on a feed: it flips to channel ${esc(cfg.identifyChannel)} for 25 seconds. Walk the floor and note every screen that changed — those TVs are on that feed.</li>
        <li>Add your TVs (Track 1&ndash;20, Treadmill 1&ndash;10&hellip;), set each one's zone and feed. Done once, it's saved.</li>
      </ol>
      <p class="note" style="margin-top:10px">Sanity check from any browser on this network: <code>http://BOX-IP:8080/tv/getTuned</code> should return JSON.</p></div>
    <div class="card guide"><h3>TV volume &amp; power (Vizio SmartCast)</h3>
      <ol>
        <li>These consumer Vizios have no RS-232 port — the old AMX serial path doesn't exist on them. Their network API replaces it, and it's what this app uses.</li>
        <li>Get each TV on the gym network (built-in WiFi or Ethernet), then find its IP: TV menu <code>Network &rarr; About</code>, or your router's client list. Give them DHCP reservations.</li>
        <li>In <b>TVs &amp; Feeds</b>, enter the IP next to the TV, press <b>Pair</b>, and type the 4-digit PIN the TV puts on screen. One time per TV.</li>
        <li>Paired TVs get volume, mute, and real panel power — per TV, per zone, per selection, or all at once. New Walmart Vizios pair the same way.</li>
        <li><b>Using the old serial adapters instead:</b> if a TV is wired to one of the AMX's RS-232 adapters, plug that serial line into a USB-to-RS232 dongle on this PC, set the TV's control to <b>COM</b> with its port, and enter the adapter's command bytes in General. Check the adapter's label for its model — that decides the bytes.</li>
        <li><b>Or IR as the universal fallback:</b> a Global Cach&eacute; iTach IP2IR on the network drives up to 3 TVs with stick-on emitters — set the TV's control to <b>IR</b> with the unit's IP and port, paste the codes in General. Works on any TV, any age.</li>
        <li>Each TV picks its own method with the IP / COM / IR selector — mix and match; the same volume and power buttons drive all three.</li>
      </ol></div>
    <div class="card guide"><h3>Live corner preview (optional)</h3>
      <ol>
        <li>Buy a <b>USB HDMI capture stick</b> (~$20) and, if that receiver also feeds TVs, an <b>HDMI splitter</b> (~$15).</li>
        <li>Receiver HDMI out &rarr; splitter &rarr; one leg onward, other leg &rarr; capture stick &rarr; USB port on this PC.</li>
        <li>In <b>General</b>, turn on the preview window and pick which feed drives it. Tap the video to tune it.</li>
        <li>Pro move: park a spare receiver at the desk as a dedicated preview feed &mdash; check a channel there before sending it to the whole floor.</li>
      </ol></div>
    <div class="card guide"><h3>Tips</h3>
      <ol>
        <li>Give the receivers DHCP reservations in the router so their addresses never change.</li>
        <li>Tuning a feed in standby wakes it automatically first.</li>
        <li>Volume lives in the TVs, not the receivers — that's a later phase.</li>
      </ol></div>`;
}

/* ---------- events ---------- */
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;

  switch (act) {
    case 'sleep-wake': wake(); break;
    case 'tile': {
      const id = btn.dataset.id;
      if (ui.selecting) {
        ui.selected.has(id) ? ui.selected.delete(id) : ui.selected.add(id);
        renderGrid(); renderSelbar();
      } else {
        const feed = feedOf(id);
        gatedTune(() => openPicker([id], feed ? feed.name : 'group'));
      }
      break;
    }
    case 'tile-power': {
      e.stopPropagation();
      const st = statuses[btn.dataset.id];
      doPowerFeeds([btn.dataset.id], !(st && st.online && st.mode === 0));
      break;
    }
    case 'chip': ui.filter = btn.dataset.id; renderSideNav(); renderHeader(); renderGrid(); break;
    case 'toggle-select':
      ui.selecting = !ui.selecting;
      if (!ui.selecting) ui.selected.clear();
      renderGrid(); renderSelbar(); renderHeader();
      break;
    case 'tune-shown': {
      const shown = shownFeeds();
      const tvN = shown.reduce((s, f) => s + feedTvs(f.id).length, 0);
      const label = ui.filter === 'all' ? `all ${tvN || shown.length} TVs`
        : `${ui.filter === 'none' ? 'unzoned' : (zoneOf(ui.filter) || {}).name} — ${tvN || shown.length} TVs`;
      gatedTune(() => openPicker(shown.map((f) => f.id), label));
      break;
    }
    case 'tune-zone': {
      const z = zoneOf(btn.dataset.id);
      const feeds = cfg.boxes.filter((b) => feedZone(b) === btn.dataset.id);
      if (z && feeds.length) {
        const tvN = feeds.reduce((s, f) => s + feedTvs(f.id).length, 0);
        gatedTune(() => openPicker(feeds.map((f) => f.id), `${z.name} — ${tvN} TVs`));
      }
      break;
    }
    case 'sel-tune': gatedTune(() => openPicker([...ui.selected], `${ui.selected.size} selected`)); break;
    case 'sel-on': doPowerFeeds([...ui.selected], true); break;
    case 'sel-off': doPowerFeeds([...ui.selected], false); break;
    case 'sel-clear': ui.selected.clear(); ui.selecting = false; renderGrid(); renderSelbar(); renderHeader(); break;
    case 'preset': {
      const p = cfg.presets.find((x) => x.id === btn.dataset.id);
      if (p) {
        gatedTune(() => {
          btn.classList.add('flash');
          setTimeout(() => btn.classList.remove('flash'), 900);
          applyPreset(p);
        });
      }
      break;
    }
    case 'save-preset': ui.savePreset = true; renderModal(); break;
    case 'save-preset-go': {
      const name = ($('#presetName') || {}).value || '';
      if (!name.trim()) { toast('Give the scene a name', 'warn'); break; }
      const assignments = {};
      for (const z of cfg.zones) {
        const counts = {};
        for (const f of cfg.boxes.filter((b) => feedZone(b) === z.id)) {
          const eff = effChanOf(f);
          if (eff.chan) counts[eff.chan] = (counts[eff.chan] || 0) + Math.max(1, feedTvs(f.id).length);
        }
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        if (top) assignments[z.id] = top[0];
      }
      ui.savePreset = false;
      await saveCfg({ presets: [...cfg.presets, { id: uid('ps'), name: name.trim(), assignments }] });
      toast(`Scene "${name.trim()}" saved`);
      break;
    }
    case 'prev-collapse':
      await saveCfg({ preview: { ...cfg.preview, collapsed: !(cfg.preview || {}).collapsed } });
      break;
    case 'prev-watch': {
      const p = cfg.preview || {};
      const feed = p.boxId ? feedOf(p.boxId) : null;
      if (feed) gatedTune(() => openPicker([feed.id], feed.name));
      break;
    }
    case 'power-all-on': doPowerTvs(cfg.tvs.map((t) => t.id), true); break;
    case 'power-all-off': doPowerTvs(cfg.tvs.map((t) => t.id), false); break;
    case 'fullscreen': {
      const fs = await api.isFullscreen();
      if (fs && cfg.settingsCode) { ui.codeGate = { for: 'fullscreen', entered: '', shake: false }; renderModal(); }
      else api.toggleFullscreen();
      break;
    }
    case 'code-key': enterCodeDigit(btn.dataset.k); break;
    case 'code-back': if (ui.codeGate) { ui.codeGate.entered = ui.codeGate.entered.slice(0, -1); updateCodeDots(); } break;
    case 'theme': {
      const theme = cfg.theme === 'light' ? 'dark' : 'light';
      applyTheme(theme);
      await saveCfg({ theme });
      break;
    }
    case 'open-settings':
      if (cfg.settingsCode && !ui.settings) {
        ui.codeGate = { for: 'settings', tab: btn.dataset.tab, entered: '', shake: false };
        renderModal();
      } else {
        openSettings(btn.dataset.tab);
      }
      break;
    case 'close-settings': ui.settings = false; renderModal(); break;
    case 'settings-tab':
      ui.settingsTab = btn.dataset.id;
      renderModal();
      if (btn.dataset.id === 'general') refreshDevices();
      if (btn.dataset.id === 'diag') refreshDiag();
      break;

    case 'fav': {
      const chan = btn.dataset.chan;
      const feedIds = ui.picker.tvIds, label = ui.picker.label;
      ui.picker = null; renderModal();
      doTuneFeeds(feedIds, chan, label);
      break;
    }
    case 'pad': {
      const k = btn.dataset.k;
      if (k === '.' && ui.pad.includes('.')) break;
      if (ui.pad.length < 6) { ui.pad += k; $('#padDisplay').textContent = ui.pad; }
      break;
    }
    case 'pad-back': ui.pad = ui.pad.slice(0, -1); $('#padDisplay').textContent = ui.pad; break;
    case 'pad-go': {
      const chan = ui.pad.replace(/\.$/, '');
      if (!chan || !CHAN_RE.test(chan)) { toast('Enter a channel number', 'warn'); break; }
      const feedIds = ui.picker.tvIds, label = ui.picker.label;
      ui.picker = null; renderModal();
      doTuneFeeds(feedIds, chan, label);
      break;
    }
    case 'picker-on': doPowerFeeds(ui.picker.tvIds, true); ui.picker = null; renderModal(); break;
    case 'picker-off': doPowerFeeds(ui.picker.tvIds, false); ui.picker = null; renderModal(); break;
    // volume keeps the picker open — staff tap it repeatedly
    case 'picker-vol-up': doVolume(ui.picker.tvIds.flatMap((id) => feedTvs(id)).map((t) => t.id), 'up'); break;
    case 'picker-vol-down': doVolume(ui.picker.tvIds.flatMap((id) => feedTvs(id)).map((t) => t.id), 'down'); break;
    case 'picker-mute': doVolume(ui.picker.tvIds.flatMap((id) => feedTvs(id)).map((t) => t.id), 'mute'); break;
    case 'sel-vol-up': doVolume([...ui.selected].flatMap((id) => feedTvs(id)).map((t) => t.id), 'up'); break;
    case 'sel-vol-down': doVolume([...ui.selected].flatMap((id) => feedTvs(id)).map((t) => t.id), 'down'); break;
    case 'sel-mute': doVolume([...ui.selected].flatMap((id) => feedTvs(id)).map((t) => t.id), 'mute'); break;

    case 'vizio-pair': {
      const tv = cfg.tvs.find((t) => t.id === btn.dataset.id);
      const ipEl = btn.parentElement.querySelector('input');
      const ip = ((ipEl && ipEl.value) || (tv && tv.tvIp) || '').trim();
      if (!ip) { toast('Enter the TV\'s IP address first', 'warn'); break; }
      const r = await api.vizioPairStart({ tvId: btn.dataset.id, ip });
      if (r.ok) {
        ui.pairingTv = btn.dataset.id;
        renderModal();
        toast(r.demo ? `Demo TV — enter any PIN` : `Check ${tv ? tv.name : 'the TV'} — a PIN is on its screen`);
        setTimeout(() => { const el = $('#pinInput'); if (el) el.focus(); }, 30);
      } else {
        toast(`Couldn't reach a SmartCast TV at ${ip}`, 'err');
      }
      break;
    }
    case 'vizio-pin': {
      const pin = (($('#pinInput') || {}).value || '').trim();
      if (!pin) { toast('Type the PIN shown on the TV', 'warn'); break; }
      const tv = cfg.tvs.find((t) => t.id === btn.dataset.id);
      const r = await api.vizioPairPin({ tvId: btn.dataset.id, pin });
      if (r.ok) { ui.pairingTv = null; toast(`${tv ? tv.name : 'TV'} paired`); }
      else toast('Wrong PIN — press Pair to try again', 'warn');
      break;
    }
    case 'vizio-cancel': ui.pairingTv = null; renderModal(); break;

    case 'card-toggle': {
      const id = btn.dataset.id;
      ui.openCards.has(id) ? ui.openCards.delete(id) : ui.openCards.add(id);
      renderModal();
      break;
    }
    case 'log-filter': ui.diag.filter = btn.dataset.id; renderModal(); break;
    case 'log-copy': {
      const rows = (ui.diag.filter === 'all' ? ui.diag.log : ui.diag.log.filter((e) => e.level === ui.diag.filter))
        .map((e) => `${new Date(e.ts).toISOString()} [${e.level.toUpperCase()}] ${e.source}: ${e.message}`).join('\n');
      try { await navigator.clipboard.writeText(rows || '(empty log)'); toast('Log copied to clipboard'); }
      catch { toast('Copy failed', 'err'); }
      break;
    }
    case 'log-save': {
      const r = await api.logExport();
      if (r.ok) toast(`Log saved to ${r.path}`);
      break;
    }
    case 'log-clear': await api.logClear(); ui.diag.log = []; refreshDiag(); break;
    case 'diag-ping': {
      const id = btn.dataset.id;
      const feed = feedOf(id);
      ui.diag.pings[id] = { busy: true }; renderModal();
      ui.diag.pings[id] = feed && feed.demo
        ? { ok: true, ms: 2, receiverId: 'demo' }
        : await api.diagPing({ ip: btn.dataset.ip });
      renderModal();
      break;
    }
    case 'diag-test-feed': {
      const ip = (($('#tFeed') || {}).value || '').trim();
      if (!ip) { toast('Enter an IP first', 'warn'); break; }
      ui.diag.tests.feed = { busy: true }; renderModal();
      ui.diag.tests.feed = await api.diagPing({ ip });
      renderModal();
      break;
    }
    case 'diag-test-tv': {
      const ip = (($('#tTv') || {}).value || '').trim();
      if (!ip) { toast('Enter an IP first', 'warn'); break; }
      ui.diag.tests.tv = { busy: true }; renderModal();
      const r = await api.diagTcp({ ip, port: 7345 });
      ui.diag.tests.tv = r.ok ? { ok: true, ms: r.ms } : { ok: false, ms: r.ms, err: `${r.err} — SmartCast port closed?` };
      renderModal();
      break;
    }
    case 'diag-test-itach': {
      const ip = (($('#tItach') || {}).value || '').trim();
      if (!ip) { toast('Enter an IP first', 'warn'); break; }
      ui.diag.tests.itach = { busy: true }; renderModal();
      ui.diag.tests.itach = await api.diagItach({ ip });
      renderModal();
      break;
    }
    case 'diag-comports': ui.diag.com = await api.diagComports(); renderModal(); break;
    case 'cfg-open': api.configOpenFolder(); break;
    case 'cfg-export': {
      const r = await api.configExport();
      if (r.ok) toast(`Config exported to ${r.path}`);
      break;
    }
    case 'cfg-import': {
      const r = await api.configImport();
      if (r.ok) toast('Config imported — everything reloaded');
      else if (!r.canceled) toast(`Import failed: ${r.err}`, 'err');
      break;
    }
    case 'cfg-reset': {
      ui.confirm = {
        title: 'Reset to demo defaults', yes: 'Reset everything',
        body: 'Wipes ALL setup on this PC — TVs, feeds, scenes, pairings, staff code — back to the 30-TV demo. Export the config first if you might want it back.',
        fn: async () => { await api.configReset(); toast('Reset to demo defaults', 'warn'); },
      };
      renderModal();
      break;
    }
    case 'serial-test': {
      const tv = cfg.tvs.find((t) => t.id === btn.dataset.id);
      const via = tv && tv.ctl === 'ir' ? `iTach ${tv.itachIp || ''}:${tv.itachPort || 1}` : (tv && tv.serialPort) || 'serial';
      const r = await api.vizioVol({ tvIds: [btn.dataset.id], action: 'up' });
      if (r.ok.length) toast(`Volume-up sent via ${via} — did ${tv ? tv.name : 'the TV'} respond?`);
      else if (r.skipped) toast(`Fill in the ${tv && tv.ctl === 'ir' ? 'iTach IP here and the IR commands' : 'COM port here and the serial commands'} in General first`, 'warn');
      else toast(`Send failed: ${(r.fail[0] || {}).err || 'unknown'}`, 'err');
      break;
    }

    case 'audio-mute': {
      const z = ((cfg.audio || {}).zones || []).find((x) => x.id === btn.dataset.id);
      if (!z) break;
      const muted = !z.muted;
      const r = await api.audioMute({ zoneId: z.id, muted });
      if (r.ok) {
        await saveCfg({ audio: { ...cfg.audio, zones: cfg.audio.zones.map((x) => x.id === z.id ? { ...x, muted } : x) } });
      } else {
        toast(r.err === 'not configured' ? 'Set the BLU-100 IP and zone address first (Settings → Audio)' : `Speaker mute failed: ${r.err}`, 'warn');
      }
      break;
    }
    case 'audio-test': {
      const ipEl = btn.parentElement.querySelector('input');
      const ip = ((ipEl && ipEl.value) || (cfg.audio || {}).ip || '').trim();
      if (!ip) { toast('Enter the BLU-100 IP first', 'warn'); break; }
      const r = await api.diagTcp({ ip, port: 1023 });
      toast(r.ok ? `BLU-100 answered in ${r.ms}ms — control port open` : `No answer on :1023 (${r.err})`, r.ok ? 'ok' : 'err');
      break;
    }
    case 'az-add':
      await saveCfg({ audio: { ...cfg.audio, zones: [...(cfg.audio.zones || []), { id: uid('az'), name: 'New zone', addr: '', gainParam: 0, muteParam: 1, pct: 50, muted: false }] } });
      break;
    case 'az-remove':
      await saveCfg({ audio: { ...cfg.audio, zones: (cfg.audio.zones || []).filter((z) => z.id !== btn.dataset.id) } });
      break;

    case 'tvscan': {
      ui.tvscan = { running: true, found: null };
      renderModal();
      const r = await api.vizioScan();
      ui.tvscan = { running: false, found: r.found };
      toast(r.found.length ? `${r.found.length} SmartCast TV${r.found.length === 1 ? '' : 's'} on the network` : 'No SmartCast TVs found — are they on WiFi yet?', r.found.length ? 'ok' : 'warn');
      renderModal();
      break;
    }
    case 'tvscan-assign': {
      const sel = btn.parentElement.querySelector('select');
      const tvId = sel && sel.value;
      if (!tvId) { toast('Pick which TV this is first', 'warn'); break; }
      await saveCfg({ tvs: cfg.tvs.map((t) => t.id === tvId ? { ...t, ctl: null, tvIp: btn.dataset.ip, tvToken: null } : t) });
      toast(`IP assigned — now press Pair on that TV's row`);
      break;
    }
    case 'vizio-unpair': {
      const tv = cfg.tvs.find((t) => t.id === btn.dataset.id);
      await api.vizioUnpair({ tvId: btn.dataset.id });
      toast(`${tv ? tv.name : 'TV'} unpaired`);
      break;
    }

    case 'overlay': if (e.target === btn) { ui.picker = null; ui.confirm = null; ui.savePreset = false; ui.codeGate = null; renderModal(); } break;
    case 'close-modal': ui.picker = null; ui.confirm = null; ui.savePreset = false; ui.codeGate = null; renderModal(); break;
    case 'confirm-yes': {
      const fn = ui.confirm && ui.confirm.fn;
      ui.confirm = null; renderModal();
      if (fn) await fn();
      break;
    }

    case 'scan': {
      ui.scan = { running: true, progress: null, found: null };
      renderModal();
      try {
        const res = await api.scan();
        ui.scan = { running: false, progress: null, found: res.found };
        if (res.found.length) toast(`Found ${res.found.length} receiver${res.found.length === 1 ? '' : 's'}`);
      } catch {
        ui.scan = { running: false, progress: null, found: [] };
        toast('Scan failed', 'err');
      }
      renderModal();
      break;
    }
    case 'add-found': {
      const ip = btn.dataset.ip;
      const boxes = [...cfg.boxes, { id: uid('feed'), name: `Feed ${cfg.boxes.length + 1}`, ip, demo: false, receiverId: btn.dataset.rid || '' }];
      ui.scan.found = ui.scan.found.map((f) => f.ip === ip ? { ...f, known: true } : f);
      await saveCfg({ boxes });
      break;
    }
    case 'add-all-found': {
      let boxes = [...cfg.boxes];
      for (const f of ui.scan.found.filter((x) => !x.known)) {
        boxes.push({ id: uid('feed'), name: `Feed ${boxes.length + 1}`, ip: f.ip, demo: false, receiverId: f.receiverId || '' });
      }
      ui.scan.found = ui.scan.found.map((f) => ({ ...f, known: true }));
      await saveCfg({ boxes });
      toast('All new receivers added — use Identify to map them to TVs');
      break;
    }
    case 'identify': {
      const r = await api.identify({ boxId: btn.dataset.id });
      const feed = feedOf(btn.dataset.id);
      if (r.ok) toast(`${feed ? feed.name : 'Feed'} is showing ch ${r.channel}${r.restoreIn ? ` — restores in ${r.restoreIn}s` : ''}`);
      else toast(`Couldn't reach ${feed ? feed.name : 'that feed'}`, 'err');
      break;
    }
    case 'remove-feed': {
      const feed = feedOf(btn.dataset.id);
      const share = feedShareCounts();
      const onIt = share[btn.dataset.id] || 0;
      ui.confirm = {
        title: 'Remove feed', yes: 'Remove',
        body: `Remove "${feed ? feed.name : ''}"?${onIt ? ` ${onIt} TV${onIt === 1 ? '' : 's'} on it will show "No feed" until reassigned.` : ''} The receiver itself is untouched.`,
        fn: () => saveCfg({
          boxes: cfg.boxes.filter((b) => b.id !== btn.dataset.id),
          tvs: cfg.tvs.map((t) => t.boxId === btn.dataset.id ? { ...t, boxId: null } : t),
        }),
      };
      renderModal();
      break;
    }
    case 'add-tv': await saveCfg({ tvs: [...cfg.tvs, { id: uid('tv'), name: `TV ${cfg.tvs.length + 1}`, zone: null, boxId: null }] }); break;
    case 'remove-tv': {
      const tv = cfg.tvs.find((t) => t.id === btn.dataset.id);
      ui.confirm = {
        title: 'Remove TV', yes: 'Remove',
        body: `Remove "${tv ? tv.name : ''}" from the dashboard?`,
        fn: () => saveCfg({ tvs: cfg.tvs.filter((t) => t.id !== btn.dataset.id) }),
      };
      renderModal();
      break;
    }
    case 'zone-color': {
      const zones = cfg.zones.map((z) => z.id === btn.dataset.id ? { ...z, color: btn.dataset.color } : z);
      await saveCfg({ zones });
      break;
    }
    case 'add-zone': await saveCfg({ zones: [...cfg.zones, { id: uid('z'), name: 'New zone', color: SWATCH_COLORS[cfg.zones.length % SWATCH_COLORS.length] }] }); break;
    case 'remove-zone': {
      const zone = zoneOf(btn.dataset.id);
      const inZone = cfg.tvs.filter((t) => t.zone === btn.dataset.id).length;
      ui.confirm = {
        title: 'Remove zone', yes: 'Remove',
        body: `Remove "${zone ? zone.name : ''}"?${inZone ? ` Its ${inZone} TV${inZone === 1 ? '' : 's'} become unzoned.` : ''}`,
        fn: () => saveCfg({
          zones: cfg.zones.filter((z) => z.id !== btn.dataset.id),
          tvs: cfg.tvs.map((t) => t.zone === btn.dataset.id ? { ...t, zone: null } : t),
          presets: cfg.presets.map((p) => { const a = { ...p.assignments }; delete a[btn.dataset.id]; return { ...p, assignments: a }; }),
        }),
      };
      renderModal();
      break;
    }
    case 'add-fav': await saveCfg({ favorites: [...cfg.favorites, { name: 'New', chan: '2.1' }] }); break;
    case 'remove-fav': await saveCfg({ favorites: cfg.favorites.filter((_, i) => i !== Number(btn.dataset.idx)) }); break;
    case 'add-preset': await saveCfg({ presets: [...cfg.presets, { id: uid('ps'), name: 'New scene', assignments: {} }] }); break;
    case 'remove-preset': await saveCfg({ presets: cfg.presets.filter((_, i) => i !== Number(btn.dataset.idx)) }); break;
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target.closest('[data-bind]');
  if (!el) return;
  const bind = el.dataset.bind;

  if (bind === 'tv-name' || bind === 'tv-zone' || bind === 'tv-feed') {
    const tvs = cfg.tvs.map((t) => {
      if (t.id !== el.dataset.id) return t;
      if (bind === 'tv-name') return { ...t, name: el.value.trim() || t.name };
      if (bind === 'tv-zone') return { ...t, zone: el.value || null };
      return { ...t, boxId: el.value || null };
    });
    await saveCfg({ tvs });
  } else if (bind === 'tv-ip') {
    await saveCfg({ tvs: cfg.tvs.map((t) => t.id === el.dataset.id ? { ...t, tvIp: el.value.trim(), tvToken: null } : t) });
  } else if (bind === 'tv-ctl') {
    await saveCfg({ tvs: cfg.tvs.map((t) => t.id === el.dataset.id ? { ...t, ctl: el.value === 'ip' ? null : el.value } : t) });
  } else if (bind === 'tv-itachip') {
    await saveCfg({ tvs: cfg.tvs.map((t) => t.id === el.dataset.id ? { ...t, itachIp: el.value.trim() } : t) });
  } else if (bind === 'tv-itachport') {
    await saveCfg({ tvs: cfg.tvs.map((t) => t.id === el.dataset.id ? { ...t, itachPort: Number(el.value) || 1 } : t) });
  } else if (bind && bind.startsWith('itach-cmd-')) {
    const action = bind.slice('itach-cmd-'.length);
    await saveCfg({ itach: { ...cfg.itach, commands: { ...(cfg.itach || {}).commands, [action]: el.value.trim() } } });
  } else if (bind === 'tv-com') {
    await saveCfg({ tvs: cfg.tvs.map((t) => t.id === el.dataset.id ? { ...t, serialPort: el.value.trim().toUpperCase() } : t) });
  } else if (bind === 'serial-baud') {
    await saveCfg({ serial: { ...cfg.serial, baud: Number(el.value) || 9600 } });
  } else if (bind && bind.startsWith('serial-cmd-')) {
    const action = bind.slice('serial-cmd-'.length);
    await saveCfg({ serial: { ...cfg.serial, commands: { ...(cfg.serial || {}).commands, [action]: el.value.trim() } } });
  } else if (bind === 'feed-name') {
    await saveCfg({ boxes: cfg.boxes.map((b) => b.id === el.dataset.id ? { ...b, name: el.value.trim() || b.name } : b) });
  } else if (bind === 'zone-name') {
    await saveCfg({ zones: cfg.zones.map((z) => z.id === el.dataset.id ? { ...z, name: el.value.trim() || z.name } : z) });
  } else if (bind === 'fav-name' || bind === 'fav-chan') {
    const favorites = cfg.favorites.map((f, i) => {
      if (i !== Number(el.dataset.idx)) return f;
      if (bind === 'fav-name') return { ...f, name: el.value.trim() || f.name };
      const v = el.value.trim();
      return { ...f, chan: CHAN_RE.test(v) ? v : f.chan };
    });
    await saveCfg({ favorites });
  } else if (bind === 'preset-name') {
    await saveCfg({ presets: cfg.presets.map((p, i) => i === Number(el.dataset.idx) ? { ...p, name: el.value.trim() || p.name } : p) });
  } else if (bind === 'preset-chan') {
    const presets = cfg.presets.map((p, i) => {
      if (i !== Number(el.dataset.idx)) return p;
      const a = { ...p.assignments };
      const v = el.value.trim();
      if (v && CHAN_RE.test(v)) a[el.dataset.zone] = v; else delete a[el.dataset.zone];
      return { ...p, assignments: a };
    });
    await saveCfg({ presets });
  } else if (bind === 'demoMode') {
    if (!el.checked) {
      el.checked = true; // revert visually until confirmed
      ui.confirm = {
        title: 'Turn off demo mode', yes: 'Turn off',
        body: 'This removes the simulated feeds and TVs. Your real ones stay; add them in TVs & Feeds if you haven\'t yet.',
        fn: () => saveCfg({ demoMode: false }),
      };
      renderModal();
    } else {
      await saveCfg({ demoMode: true });
    }
  } else if (bind === 'launchFullscreen') {
    await saveCfg({ launchFullscreen: el.checked });
  } else if (bind === 'audio-enabled') {
    await saveCfg({ audio: { ...cfg.audio, enabled: el.checked } });
  } else if (bind === 'audio-ip') {
    await saveCfg({ audio: { ...cfg.audio, ip: el.value.trim() } });
  } else if (bind === 'az-name' || bind === 'az-addr' || bind === 'az-gain' || bind === 'az-mute') {
    const zones = (cfg.audio.zones || []).map((z) => {
      if (z.id !== el.dataset.id) return z;
      if (bind === 'az-name') return { ...z, name: el.value.trim() || z.name };
      if (bind === 'az-addr') return { ...z, addr: el.value.trim() };
      if (bind === 'az-gain') return { ...z, gainParam: Number(el.value) || 0 };
      return { ...z, muteParam: Number(el.value) || 0 };
    });
    await saveCfg({ audio: { ...cfg.audio, zones } });
  } else if (bind === 'prev-enabled') {
    await saveCfg({ preview: { ...cfg.preview, enabled: el.checked } });
  } else if (bind === 'prev-device') {
    await saveCfg({ preview: { ...cfg.preview, deviceId: el.value || null } });
  } else if (bind === 'prev-box') {
    await saveCfg({ preview: { ...cfg.preview, boxId: el.value || null } });
  } else if (bind === 'lockTuning') {
    await saveCfg({ lockTuning: el.checked });
  } else if (bind === 'sleepEnabled') {
    await saveCfg({ sleepEnabled: el.checked });
  } else if (bind === 'sleepMinutes') {
    await saveCfg({ sleepMinutes: Math.max(1, Math.min(60, Number(el.value) || 3)) });
  } else if (bind === 'settingsCode') {
    const v = el.value.trim();
    if (/^\d{0,8}$/.test(v)) await saveCfg({ settingsCode: v });
    else el.value = cfg.settingsCode || '';
  } else if (bind === 'identifyChannel') {
    const v = el.value.trim();
    await saveCfg({ identifyChannel: CHAN_RE.test(v) ? v : cfg.identifyChannel });
  } else if (bind === 'pollSeconds') {
    await saveCfg({ pollSeconds: Number(el.value) || cfg.pollSeconds });
  }
});

// speaker sliders: live sends while dragging (throttled), persist on release
const audThrottle = {};
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-bind="audio-slider"]');
  if (!el) return;
  const id = el.dataset.id, pct = Number(el.value);
  const row = el.closest('.aud-row');
  const pctEl = row && row.querySelector('.aud-pct');
  if (pctEl) pctEl.textContent = `${pct}%`;
  const now = Date.now();
  if (!audThrottle[id] || now - audThrottle[id] > 120) {
    audThrottle[id] = now;
    api.audioSet({ zoneId: id, pct });
  }
});
document.addEventListener('change', async (e) => {
  const el = e.target.closest('[data-bind="audio-slider"]');
  if (!el) return;
  const id = el.dataset.id, pct = Number(el.value);
  const r = await api.audioSet({ zoneId: id, pct });
  if (!r.ok && r.err !== 'not configured') toast(`Speaker volume failed: ${r.err}`, 'warn');
  await saveCfg({ audio: { ...cfg.audio, zones: (cfg.audio.zones || []).map((z) => z.id === id ? { ...z, pct } : z) } });
});

document.addEventListener('keydown', async (e) => {
  if (ui.sleeping) { e.preventDefault(); e.stopPropagation(); wake(); return; }
  if (e.key === 'Escape') {
    if (ui.picker || ui.confirm || ui.savePreset || ui.codeGate) { ui.picker = null; ui.confirm = null; ui.savePreset = false; ui.codeGate = null; renderModal(); }
    else if (ui.settings) { ui.settings = false; renderModal(); }
    return;
  }
  if (e.key === 'F11') {
    e.preventDefault();
    const fs = await api.isFullscreen();
    if (fs && cfg.settingsCode) { ui.codeGate = { for: 'fullscreen', entered: '', shake: false }; renderModal(); }
    else api.toggleFullscreen();
    return;
  }
  if (ui.codeGate) {
    if (/^[0-9]$/.test(e.key)) enterCodeDigit(e.key);
    else if (e.key === 'Backspace') { ui.codeGate.entered = ui.codeGate.entered.slice(0, -1); updateCodeDots(); }
    return;
  }
  if (ui.picker && !ui.savePreset) {
    if (/^[0-9.]$/.test(e.key) && ui.pad.length < 6) {
      if (e.key === '.' && ui.pad.includes('.')) return;
      ui.pad += e.key; const d = $('#padDisplay'); if (d) d.textContent = ui.pad;
    } else if (e.key === 'Backspace') {
      ui.pad = ui.pad.slice(0, -1); const d = $('#padDisplay'); if (d) d.textContent = ui.pad;
    } else if (e.key === 'Enter' && ui.pad) {
      const chan = ui.pad.replace(/\.$/, '');
      if (!CHAN_RE.test(chan)) return;
      const tvIds = ui.picker.tvIds, label = ui.picker.label;
      ui.picker = null; renderModal();
      doTune(tvIds, chan, label);
    }
  }
});

/* ---------- clock ---------- */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULLDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FULLMONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function tickClock() {
  const d = new Date();
  let h = d.getHours() % 12; if (h === 0) h = 12;
  $('#clock').textContent = `${h}:${String(d.getMinutes()).padStart(2, '0')}`;
  const greet = d.getHours() < 12 ? 'Good morning' : d.getHours() < 17 ? 'Good afternoon' : 'Good evening';
  $('#eyebrow').textContent = `${greet} · ${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  renderSleepBits();
}

/* ---------- sleep screen ---------- */
let lastActivity = Date.now();
['pointerdown', 'keydown', 'wheel'].forEach((ev) =>
  document.addEventListener(ev, () => { lastActivity = Date.now(); }, { capture: true, passive: true }));

function sleepStatusText() {
  let live = 0;
  const counts = new Map();
  for (const f of cfg.boxes) {
    const w = Math.max(1, feedTvs(f.id).length);
    const eff = effChanOf(f);
    if (eff.st && (!eff.st.online || eff.st.mode === 1)) continue;
    live += w;
    if (eff.chan) counts.set(eff.chan, (counts.get(eff.chan) || 0) + w);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return `${live} TV${live === 1 ? '' : 's'} live${top && top[1] >= 2 ? ` · mostly ${favName(top[0]) || 'CH ' + top[0]}` : ''}`;
}

function renderSleepBits() {
  const c = $('#sleepClock');
  if (!c) return;
  const d = new Date();
  let h = d.getHours() % 12; if (h === 0) h = 12;
  c.innerHTML = `${h}<span class="cln">:</span>${String(d.getMinutes()).padStart(2, '0')}`;
  $('#sleepDate').textContent = `${FULLDAYS[d.getDay()]} · ${FULLMONTHS[d.getMonth()]} ${d.getDate()}`;
  const s = $('#sleepStatus');
  if (s) s.innerHTML = `<span class="sdot"></span>${esc(sleepStatusText())}`;
}

function goSleep() {
  if (ui.sleeping) return;
  ui.sleeping = true;
  api.logAdd({ level: 'info', source: 'ui', message: 'Sleep screen engaged' });
  // Blend the native window buttons into the black sleep screen.
  if (api.setOverlay) api.setOverlay({ color: '#050607', symbolColor: '#16181d' });
  // Lock the room on the way down: anything staff left open closes, so the
  // code is required again after a nap.
  ui.settings = false; ui.picker = null; ui.confirm = null; ui.savePreset = false; ui.codeGate = null;
  renderModal();
  $('#sleepHost').innerHTML = `<div class="sleep" data-act="sleep-wake">
    <div class="sleep-drift">
      <img class="sleep-logo" src="assets/logo.png" alt="" draggable="false"/>
      <div class="sleep-clock" id="sleepClock"></div>
      <div class="sleep-date" id="sleepDate"></div>
      <div class="sleep-status" id="sleepStatus"></div>
    </div>
    <div class="sleep-hint">Tap anywhere</div>
  </div>`;
  renderSleepBits();
}

function wake() {
  if (!ui.sleeping) return;
  ui.sleeping = false;
  $('#sleepHost').innerHTML = '';
  lastActivity = Date.now();
  applyTheme(cfg.theme); // restores the themed window-button overlay
}

setInterval(() => {
  if (!cfg || ui.sleeping || !cfg.sleepEnabled) return;
  const mins = Math.max(1, Number(cfg.sleepMinutes) || 3);
  if (Date.now() - lastActivity >= mins * 60000) goSleep();
}, 10000);

/* ---------- boot ---------- */
(async function boot() {
  const s = await api.getState();
  cfg = s.config;
  statuses = s.statuses;

  // screenshot-harness knobs: ?view=picker|settings&tab=...&sel=1&theme=light&preview=1&click=selector
  const q = new URLSearchParams(location.search);
  applyTheme(q.get('theme') || cfg.theme);
  if (q.get('theme')) cfg.theme = q.get('theme');

  api.onStatus((m) => { statuses = m; if (!ui.settings) { renderHeader(); renderGrid(); updatePreviewChip(); updatePickerCurrent(); } if (ui.sleeping) renderSleepBits(); });
  api.onConfig((c) => { cfg = c; renderAll(); });
  api.onScanProgress((p) => {
    ui.scan.progress = p;
    const el = document.querySelector('#scanStatus');
    if (el) el.textContent = `Scanning the network for receivers — ${p.done}/${p.total} addresses, ${p.found} found`;
  });
  api.onLog((entry) => {
    ui.diag.log.push(entry);
    if (ui.diag.log.length > 600) ui.diag.log.shift();
    if (ui.settings && ui.settingsTab === 'diag' && (ui.diag.filter === 'all' || ui.diag.filter === entry.level)) {
      const el = document.querySelector('#dlogList');
      if (el) el.insertAdjacentHTML('afterbegin', logRowHtml(entry));
    }
  });

  tickClock();
  setInterval(tickClock, 10000);

  if (q.get('audio') === '1') {
    cfg.audio = {
      enabled: true, ip: '10.56.0.50',
      zones: [
        { id: 'az1', name: 'Track speakers', addr: '0x100,0x3,0x152', gainParam: 0, muteParam: 1, pct: 62, muted: false },
        { id: 'az2', name: 'Treadmill speakers', addr: '0x100,0x3,0x153', gainParam: 0, muteParam: 1, pct: 45, muted: true },
      ],
    };
  }
  if (q.get('preview') === '1') {
    cfg.preview = { ...(cfg.preview || {}), enabled: true, boxId: (cfg.boxes[12] || cfg.boxes[0] || {}).id };
  }
  if (q.get('sel') === '1') {
    ui.selecting = true;
    cfg.boxes.slice(0, 3).forEach((b) => ui.selected.add(b.id));
  }
  if (q.get('view') === 'picker') {
    const feeds = cfg.boxes.filter((b) => feedZone(b) === 'tread');
    const tvN = feeds.reduce((s, f) => s + feedTvs(f.id).length, 0);
    ui.picker = { tvIds: feeds.map((f) => f.id), label: `Treadmills — ${tvN} TVs` };
  } else if (q.get('view') === 'settings') {
    ui.settings = true;
    ui.settingsTab = q.get('tab') || 'boxes';
    if (ui.settingsTab === 'diag') refreshDiag();
  }

  renderAll();

  if (q.get('sleep') === '1') goSleep();
  if (q.get('scroll')) {
    setTimeout(() => {
      const b = document.querySelector('.set-body') || $('#grid');
      if (b) b.scrollTop = Number(q.get('scroll')) || b.scrollHeight;
    }, 400);
  }

  // harness: --click accepts comma-separated selectors, clicked sequentially
  const clickSel = q.get('click');
  if (clickSel) {
    clickSel.split(',').forEach((sel, i) => {
      setTimeout(() => { const el = document.querySelector(sel.trim()); if (el) el.click(); }, 700 + i * 450);
    });
  }
})();
