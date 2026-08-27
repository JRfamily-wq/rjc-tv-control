// Builds the RJC Fitness Center AV modernization quote as a print-ready HTML
// document (rendered to PDF with Edge headless). Prices captured 2026-08-27.
const fs = require('fs');
const path = require('path');

const logo = fs.readFileSync(path.join(__dirname, '..', 'app', 'assets', 'logo.png')).toString('base64');
const LOGO = `data:image/png;base64,${logo}`;

const money = (n) => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// ---- line items ----
const displays = [
  { name: 'VIZIO 50" V-Series 4K UHD Smart TV', desc: 'SmartCast, HDMI×3, LAN + Wi-Fi, VESA 200×200. Matches existing V505-series.', qty: 18, unit: 258.00, note: 'street' },
  { name: 'Low-profile tilting wall mount (VESA 200×200)', desc: 'Reuse existing brackets where compatible — budget as optional.', qty: 18, unit: 24.99, note: 'optional' },
];
const tablet = [
  { name: 'Microsoft Surface Pro 7+ (i3 / 8 GB / 128 GB, Win 11 Pro)', desc: '12.3" PixelSense touchscreen 2-in-1. Runs the RJC TV Control app. Amazon Renewed.', qty: 1, unit: 333.33, note: 'linked' },
  { name: 'Microsoft Surface Dock PD9-00003', desc: 'Gigabit Ethernet + power + USB. Keeps the tablet wired to the control network and charged 24/7. Amazon Renewed.', qty: 1, unit: 79.99, note: 'linked' },
  { name: 'Mount-It! Secure Steel Tablet Wall Enclosure', desc: 'Anti-theft locking enclosure, 9.7–13.1", VESA 75×75, portrait/landscape.', qty: 1, unit: 49.99, note: 'linked' },
  { name: 'Cat6 Ethernet run (25 ft) to wall location', desc: 'Wired link from the enclosure to the nearest control-network switch port.', qty: 1, unit: 12.99, note: 'street' },
  { name: 'Surge protector (6-outlet, wall-adjacent)', desc: 'Protects the dock + tablet at the mount.', qty: 1, unit: 19.99, note: 'street' },
  { name: 'RJC TV Control application (in-house build)', desc: 'One-touch channel + zone-volume control. Already developed — no license cost.', qty: 1, unit: 0.00, note: 'included' },
];

const ext = (rows) => rows.reduce((s, r) => s + r.qty * r.unit, 0);
const displaysCore = displays.filter((r) => r.note !== 'optional');
const displaysOpt = displays.filter((r) => r.note === 'optional');

const A_core = ext(displaysCore);   // TVs only
const A_opt = ext(displaysOpt);     // optional mounts
const B_total = ext(tablet);        // one tablet station

const baseTotal = A_core + B_total;                 // 18 TVs + 1 station, no optional
const withMounts = baseTotal + A_opt;
const twoStations = B_total;                        // add a second station
const KY_TAX = 0.06;

const badge = (n) => {
  const map = {
    linked: ['LINKED', '#1f6feb'],
    street: ['STREET', '#8a6d1f'],
    optional: ['OPTIONAL', '#6e6e6e'],
    included: ['IN-HOUSE', '#1a7f4b'],
  };
  const [t, c] = map[n] || ['', '#888'];
  return `<span class="tag" style="--tc:${c}">${t}</span>`;
};

const rowsHtml = (rows) => rows.map((r) => `
  <tr>
    <td class="it"><div class="it-name">${r.name} ${badge(r.note)}</div><div class="it-desc">${r.desc}</div></td>
    <td class="num">${r.qty}</td>
    <td class="num">${money(r.unit)}</td>
    <td class="num strong">${money(r.qty * r.unit)}</td>
  </tr>`).join('');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>RJC Fitness Center — AV Modernization Quote</title>
<style>
  :root { --red:#E11414; --ink:#15181d; --muted:#6b7280; --line:#e3e6ea; --soft:#f6f7f9; }
  * { box-sizing:border-box; margin:0; padding:0; }
  html { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body { font-family:"Segoe UI",Arial,sans-serif; color:var(--ink); font-size:11px; line-height:1.5; }
  @page { size:letter; margin:14mm 14mm 16mm; }
  .sheet { }

  header.band { background:linear-gradient(100deg,#111418 0%,#1c2027 60%,#2a0d0d 100%); color:#fff; padding:22px 26px; border-radius:10px; display:flex; align-items:center; justify-content:space-between; }
  header.band .logo { height:42px; }
  header.band .h-right { text-align:right; }
  header.band .h-kicker { font-size:9.5px; letter-spacing:.22em; text-transform:uppercase; color:#e6a3a3; }
  header.band .h-title { font-size:16px; font-weight:800; margin-top:2px; }
  .accent { height:4px; background:var(--red); border-radius:3px; margin:0 2px 18px; }

  .meta { display:grid; grid-template-columns:repeat(4,1fr); gap:10px 18px; margin:0 2px 20px; }
  .meta .m { border-left:3px solid var(--red); padding-left:9px; }
  .meta .m .k { font-size:8.5px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); }
  .meta .m .v { font-size:12px; font-weight:700; margin-top:1px; }

  h2 { font-size:12.5px; text-transform:uppercase; letter-spacing:.09em; color:var(--red); margin:22px 2px 9px; padding-bottom:6px; border-bottom:2px solid var(--line); }
  p.lede { margin:0 2px 6px; color:#33383f; }

  table { width:100%; border-collapse:collapse; margin:2px 0 6px; }
  thead th { background:var(--ink); color:#fff; font-size:8.5px; letter-spacing:.1em; text-transform:uppercase; text-align:left; padding:7px 10px; }
  thead th.num { text-align:right; }
  tbody td { padding:9px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
  tbody tr:nth-child(even) td { background:var(--soft); }
  td.num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  td.strong { font-weight:800; }
  .it-name { font-weight:700; font-size:11px; }
  .it-desc { color:var(--muted); font-size:9.5px; margin-top:2px; max-width:430px; }
  .tag { font-size:7px; font-weight:800; letter-spacing:.08em; color:#fff; background:var(--tc); padding:1.5px 5px; border-radius:4px; vertical-align:middle; margin-left:5px; }

  .subtotal td { background:#fff !important; border-top:2px solid var(--ink); border-bottom:0; font-weight:800; padding-top:9px; }
  .subtotal td.lbl { text-transform:uppercase; letter-spacing:.06em; font-size:9.5px; }

  .totals { margin:18px 2px 0; border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  .totals .tr { display:flex; justify-content:space-between; padding:9px 16px; border-bottom:1px solid var(--line); }
  .totals .tr:last-child { border-bottom:0; }
  .totals .tr .l { color:#33383f; }
  .totals .tr .r { font-weight:700; font-variant-numeric:tabular-nums; }
  .totals .tr.opt { color:var(--muted); }
  .totals .grand { background:var(--red); color:#fff; }
  .totals .grand .l { color:#fff; font-weight:800; letter-spacing:.04em; text-transform:uppercase; font-size:11px; }
  .totals .grand .r { font-size:16px; font-weight:800; }

  .cols { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin:4px 2px 0; }
  .card { border:1px solid var(--line); border-radius:9px; padding:13px 15px; break-inside:avoid; }
  .card h3 { font-size:10.5px; color:var(--red); text-transform:uppercase; letter-spacing:.07em; margin-bottom:5px; }
  .card p { font-size:9.8px; color:#33383f; }
  .card p + p { margin-top:6px; }
  .card b { color:var(--ink); }

  ul.notes { margin:6px 2px 0 18px; }
  ul.notes li { font-size:9.8px; margin-bottom:5px; color:#33383f; }
  ul.notes li b { color:var(--ink); }

  footer { margin-top:22px; padding-top:10px; border-top:1px solid var(--line); display:flex; justify-content:space-between; font-size:8.5px; color:var(--muted); }
  .pagebreak { page-break-before:always; }
</style></head>
<body><div class="sheet">

  <header class="band">
    <img class="logo" src="${LOGO}" alt="R.J. Corman Railroad Group">
    <div class="h-right">
      <div class="h-kicker">Fitness Center &middot; AV Modernization</div>
      <div class="h-title">Internal Equipment Quote &amp; Cost Reference</div>
    </div>
  </header>
  <div class="accent"></div>

  <div class="meta">
    <div class="m"><div class="k">Quote #</div><div class="v">RJC-FC-2026-001</div></div>
    <div class="m"><div class="k">Date</div><div class="v">August 27, 2026</div></div>
    <div class="m"><div class="k">Prepared&nbsp;by</div><div class="v">Jacob Smolinsky</div></div>
    <div class="m"><div class="k">Status</div><div class="v">Internal planning</div></div>
    <div class="m"><div class="k">Prepared&nbsp;for</div><div class="v">R.J. Corman Fitness Center</div></div>
    <div class="m"><div class="k">Project</div><div class="v">TV + Volume Control Modernization</div></div>
    <div class="m"><div class="k">Location</div><div class="v">Nicholasville, KY</div></div>
    <div class="m"><div class="k">Valid</div><div class="v">30 days (verify pricing)</div></div>
  </div>

  <h2>Summary</h2>
  <p class="lede">This quote covers replacing <b>18 aging displays</b> with new <b>50-inch VIZIO 4K</b> televisions, and adding a <b>wall-mounted control tablet</b> — a Microsoft Surface Pro running the in-house <b>RJC TV Control</b> app — so staff can change every TV's channel and speaker volume from one touchscreen in the room. The control tablet reaches the DirecTV receivers and the BSS audio processor over a wired network connection provided by the Surface Dock; the secure enclosure fixes it to the wall.</p>

  <div class="totals">
    <div class="tr"><span class="l">A &nbsp;&middot;&nbsp; Display replacement — 18 × VIZIO 50" 4K</span><span class="r">${money(A_core)}</span></div>
    <div class="tr"><span class="l">B &nbsp;&middot;&nbsp; Wall control tablet station (×1)</span><span class="r">${money(B_total)}</span></div>
    <div class="tr grand"><span class="l">Equipment total (base)</span><span class="r">${money(baseTotal)}</span></div>
    <div class="tr opt"><span class="l">+ Optional TV wall mounts (18, if not reusing existing)</span><span class="r">+ ${money(A_opt)}</span></div>
    <div class="tr opt"><span class="l">+ Optional second tablet station</span><span class="r">+ ${money(twoStations)}</span></div>
    <div class="tr opt"><span class="l">Est. KY sales tax (6%, if not tax-exempt) on base</span><span class="r">+ ${money(baseTotal * KY_TAX)}</span></div>
  </div>

  <h2>A &middot; Display Replacement</h2>
  <table>
    <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Extended</th></tr></thead>
    <tbody>
      ${rowsHtml(displays)}
      <tr class="subtotal"><td class="lbl">Section A — TVs only (mounts optional)</td><td class="num"></td><td class="num"></td><td class="num">${money(A_core)}</td></tr>
    </tbody>
  </table>

  <h2>B &middot; Wall Control Tablet Station</h2>
  <table>
    <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Extended</th></tr></thead>
    <tbody>
      ${rowsHtml(tablet)}
      <tr class="subtotal"><td class="lbl">Section B — one complete station</td><td class="num"></td><td class="num"></td><td class="num">${money(B_total)}</td></tr>
    </tbody>
  </table>

  <div class="pagebreak"></div>
  <h2>Item Description Guide</h2>
  <div class="cols">
    <div class="card"><h3>VIZIO 50" V-Series 4K Smart TV</h3><p>The screens on the wall. 4K UHD, three HDMI inputs, and built-in networking (LAN or Wi-Fi). VIZIO's <b>SmartCast</b> network interface is what the RJC TV Control app uses for on-screen volume, mute, and power — the same model family already in service here (V505-series).</p></div>
    <div class="card"><h3>Microsoft Surface Pro 7+ (control tablet)</h3><p>A full Windows tablet — the touchscreen staff tap to run the room. It runs the <b>RJC TV Control</b> app natively. Renewed/refurbished keeps cost low; an i3 with 8 GB RAM is ample for this single-purpose kiosk.</p></div>
    <div class="card"><h3>Microsoft Surface Dock</h3><p>The reason the tablet works reliably on the wall: it supplies <b>wired Gigabit Ethernet</b> so the app can always reach the DirecTV receivers (10.13.0.x) and the BSS audio processor, delivers power to keep the tablet charged 24/7, and connects with one magnetic cable.</p></div>
    <div class="card"><h3>Mount-It! Secure Steel Enclosure</h3><p>Locks the Surface Pro to the wall in a tamper-resistant steel housing. VESA 75×75, portrait or landscape, with a cutout for the dock cable — turns the tablet into a permanent in-wall control panel.</p></div>
    <div class="card"><h3>Cat6 run + surge protector</h3><p>Supporting install parts: a network cable from the enclosure to the nearest switch port, and surge protection for the dock and tablet at the mount.</p></div>
    <div class="card"><h3>RJC TV Control app <span style="color:#1a7f4b">(in-house · $0)</span></h3><p>Already built and in use. One tap sends every TV to a channel; big touch sliders set speaker volume per zone. Free — no per-seat license, and it installs on as many stations as needed.</p></div>
  </div>

  <h2>Notes, Assumptions &amp; Compatibility</h2>
  <ul class="notes">
    <li><b>Pricing.</b> The three tablet-kit items are the exact Amazon listings provided (captured Aug 27, 2026): Surface Pro 7+ ${money(333.33)}, Surface Dock ${money(79.99)}, enclosure ${money(49.99)}. TV pricing is typical retail (Walmart / Amazon) for the 50" V-Series and should be confirmed at purchase; bulk or account pricing may reduce it.</li>
    <li><b>Renewed hardware.</b> The Surface Pro and Dock are Amazon Renewed to control cost; both carry a 90-day return. New units are available at roughly ${money(150)}–${money(250)} more for the tablet if a warranty is preferred.</li>
    <li><b>Signal compatibility.</b> The existing wall channel lineup (2.1–22.1) is produced by the in-house modulator rack. Confirm the new VIZIO tuners accept that feed (clear-QAM), or plan to drive each TV from its DirecTV box over HDMI. Volume/power control over SmartCast requires each TV on the network — reserve a DHCP address per TV.</li>
    <li><b>Network.</b> The control tablet must sit on the same control network as the receivers and audio processor. The Surface Dock's wired port is the supported path; Wi-Fi is not recommended for a fixed kiosk.</li>
    <li><b>Not included.</b> Installation labor (mounting, cable runs, disposal of old sets), taxes if applicable, and freight. R.J. Corman's tax-exempt status, if it applies, removes the sales-tax line.</li>
    <li><b>Scalability.</b> A second identical tablet station (e.g. front desk + floor) adds ${money(twoStations)}. The app itself is unlimited.</li>
  </ul>

  <footer>
    <span>R.J. Corman Fitness Center &middot; AV Modernization &middot; Quote RJC-FC-2026-001</span>
    <span>Internal planning reference — prices for budgeting; verify at purchase. Built by Jacob Smolinsky.</span>
  </footer>

</div></body></html>`;

fs.writeFileSync(path.join(__dirname, 'RJC-Fitness-AV-Quote.html'), html);
console.log('wrote RJC-Fitness-AV-Quote.html');
console.log('Base equipment total:', money(baseTotal));
console.log('With optional mounts:', money(withMounts));
