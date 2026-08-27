// Builds the RJC Fitness Center AV modernization quote as a print-ready HTML
// document (rendered to PDF with Edge headless). Prices captured Aug 27, 2026.
const fs = require('fs');
const path = require('path');

const logo = fs.readFileSync(path.join(__dirname, '..', 'app', 'assets', 'logo.png')).toString('base64');
const LOGO = `data:image/png;base64,${logo}`;

const money = (n) => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// ---- line items ----
const displays = [
  { name: 'VIZIO 50" V-Series 4K UHD Smart TV', desc: 'SmartCast, three HDMI inputs, LAN and Wi-Fi, VESA 200x200. Same family as the V505 sets already here.', qty: 18, unit: 258.00 },
];
const tablet = [
  { name: 'Microsoft Surface Pro 7+ (i3, 8 GB, 128 GB, Win 11 Pro)', desc: '12.3 inch touchscreen 2-in-1 that runs the RJC TV Control app. Amazon Renewed.', qty: 1, unit: 333.33 },
  { name: 'Microsoft Surface Dock PD9-00003', desc: 'Gives the tablet wired Gigabit Ethernet plus power, so it stays on the control network and charged. Amazon Renewed.', qty: 1, unit: 79.99 },
  { name: 'Mount-It! secure steel tablet wall enclosure', desc: 'Locking anti-theft housing for 9.7 to 13.1 inch tablets. VESA 75x75, portrait or landscape.', qty: 1, unit: 49.99 },
  { name: 'Cat6 Ethernet run (25 ft) to the wall location', desc: 'Wired link from the enclosure back to the nearest control-network switch port.', qty: 1, unit: 12.99 },
  { name: 'Surge protector (6-outlet)', desc: 'Protects the dock and tablet at the mount.', qty: 1, unit: 19.99 },
  { name: 'RJC TV Control application (in-house build)', desc: 'One tap changes the channel, touch sliders set the volume. Already built, no license cost.', qty: 1, unit: 0.00 },
];

const ext = (rows) => rows.reduce((s, r) => s + r.qty * r.unit, 0);
const A_core = ext(displays);
const B_total = ext(tablet);
const baseTotal = A_core + B_total;
const twoStations = B_total;
const KY_TAX = 0.06;

const rowsHtml = (rows) => rows.map((r) => `
  <tr>
    <td class="it"><div class="it-name">${r.name}</div><div class="it-desc">${r.desc}</div></td>
    <td class="num">${r.qty}</td>
    <td class="num">${money(r.unit)}</td>
    <td class="num strong">${money(r.qty * r.unit)}</td>
  </tr>`).join('');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>RJC Fitness Center AV Modernization Quote</title>
<style>
  :root { --red:#E11414; --ink:#15181d; --muted:#6b7280; --line:#e3e6ea; --soft:#f6f7f9; }
  * { box-sizing:border-box; margin:0; padding:0; }
  html { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body { font-family:"Segoe UI",Arial,sans-serif; color:var(--ink); font-size:11px; line-height:1.5; }
  @page { size:letter; margin:14mm 14mm 16mm; }

  header.band { background:linear-gradient(100deg,#111418 0%,#1c2027 60%,#2a0d0d 100%); color:#fff; padding:22px 26px; border-radius:10px; display:flex; align-items:center; justify-content:space-between; }
  header.band .logo { height:42px; }
  header.band .h-right { text-align:right; }
  header.band .h-kicker { font-size:9.5px; letter-spacing:.22em; text-transform:uppercase; color:#e6a3a3; }
  header.band .h-title { font-size:16px; font-weight:800; margin-top:2px; }
  .accent { height:4px; background:var(--red); border-radius:3px; margin:0 2px 18px; }

  .meta { display:grid; grid-template-columns:repeat(3,1fr); gap:11px 20px; margin:0 2px 20px; }
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
      <div class="h-kicker">Fitness Center AV Modernization</div>
      <div class="h-title">Equipment Cost Proposal</div>
    </div>
  </header>
  <div class="accent"></div>

  <div class="meta">
    <div class="m"><div class="k">Date</div><div class="v">August 27, 2026</div></div>
    <div class="m"><div class="k">Prepared by</div><div class="v">Jacob Smolinsky</div></div>
    <div class="m"><div class="k">Facility</div><div class="v">R.J. Corman Fitness Center</div></div>
    <div class="m"><div class="k">Project</div><div class="v">TV and Volume Control Upgrade</div></div>
    <div class="m"><div class="k">Location</div><div class="v">Nicholasville, KY</div></div>
    <div class="m"><div class="k">Status</div><div class="v">Internal planning</div></div>
  </div>

  <h2>Summary</h2>
  <p class="lede">This covers replacing <b>18 aging TVs</b> with new <b>50 inch VIZIO 4K</b> sets, and adding a <b>wall-mounted control tablet</b> that runs our in-house <b>RJC TV Control</b> app. With it, staff change every TV's channel and set the speaker volume from one touchscreen in the room. The tablet talks to the DirecTV receivers and the BSS audio processor over a wired network connection from the Surface Dock, and the steel enclosure keeps it locked to the wall.</p>

  <div class="totals">
    <div class="tr"><span class="l">Displays: 18 VIZIO 50 inch 4K televisions</span><span class="r">${money(A_core)}</span></div>
    <div class="tr"><span class="l">Wall control tablet station (one)</span><span class="r">${money(B_total)}</span></div>
    <div class="tr grand"><span class="l">Equipment total</span><span class="r">${money(baseTotal)}</span></div>
    <div class="tr opt"><span class="l">Optional second tablet station</span><span class="r">add ${money(twoStations)}</span></div>
    <div class="tr opt"><span class="l">Estimated KY sales tax (6%, if not tax-exempt)</span><span class="r">add ${money(baseTotal * KY_TAX)}</span></div>
  </div>

  <h2>Section A: Display Replacement</h2>
  <table>
    <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Extended</th></tr></thead>
    <tbody>
      ${rowsHtml(displays)}
      <tr class="subtotal"><td class="lbl">Section A total</td><td class="num"></td><td class="num"></td><td class="num">${money(A_core)}</td></tr>
    </tbody>
  </table>

  <h2>Section B: Wall Control Tablet Station</h2>
  <table>
    <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Extended</th></tr></thead>
    <tbody>
      ${rowsHtml(tablet)}
      <tr class="subtotal"><td class="lbl">Section B, one complete station</td><td class="num"></td><td class="num"></td><td class="num">${money(B_total)}</td></tr>
    </tbody>
  </table>

  <div class="pagebreak"></div>
  <h2>What each item is</h2>
  <div class="cols">
    <div class="card"><h3>VIZIO 50" V-Series 4K Smart TV</h3><p>The screens on the wall. 4K, three HDMI inputs, and built-in networking over LAN or Wi-Fi. VIZIO's <b>SmartCast</b> is what the RJC TV Control app uses for on-screen volume, mute, and power. It is the same family as the V505 sets already running here.</p></div>
    <div class="card"><h3>Microsoft Surface Pro 7+ tablet</h3><p>A full Windows tablet, the touchscreen staff tap to run the room. It runs the <b>RJC TV Control</b> app directly. Buying it renewed keeps the cost down, and an i3 with 8 GB of RAM is plenty for a single-purpose panel like this.</p></div>
    <div class="card"><h3>Microsoft Surface Dock</h3><p>This is what makes the wall tablet dependable. It gives the tablet a <b>wired Gigabit Ethernet</b> connection so the app can always reach the DirecTV receivers on 10.13.0.x and the BSS audio processor. It also powers the tablet so it stays charged, and it connects with one magnetic cable.</p></div>
    <div class="card"><h3>Mount-It! steel enclosure</h3><p>Locks the Surface Pro to the wall inside a tamper-resistant steel housing. VESA 75x75, portrait or landscape, with a cutout for the dock cable. It turns the tablet into a permanent control panel.</p></div>
    <div class="card"><h3>Cat6 cable and surge protector</h3><p>The supporting parts for the install: a network cable from the enclosure to the nearest switch port, and surge protection for the dock and tablet at the mount.</p></div>
    <div class="card"><h3>RJC TV Control app <span style="color:#1a7f4b">(in-house, $0)</span></h3><p>Already built and in use. One tap sends every TV to a channel, and big touch sliders set the speaker volume per zone. There is no per-seat license, and it installs on as many stations as we want.</p></div>
  </div>

  <h2>Notes and Assumptions</h2>
  <ul class="notes">
    <li><b>Pricing.</b> The three tablet items are the exact Amazon listings you sent, captured Aug 27, 2026: Surface Pro 7+ at ${money(333.33)}, Surface Dock at ${money(79.99)}, and the enclosure at ${money(49.99)}. The TV price is typical retail (Walmart or Amazon) for the 50 inch V-Series and should be confirmed at purchase. Buying 18 at once may bring it down.</li>
    <li><b>Renewed hardware.</b> The Surface Pro and Dock are Amazon Renewed to keep the cost down, and both carry a 90-day return. New units run roughly ${money(150)} to ${money(250)} more for the tablet if you would rather have a full warranty.</li>
    <li><b>Signal check.</b> The wall channel lineup (2.1 through 22.1) comes from the in-house modulator rack. Confirm the new VIZIO tuners accept that feed (clear-QAM), or plan to feed each TV from its DirecTV box over HDMI. SmartCast volume and power need each TV on the network, so reserve a DHCP address per set.</li>
    <li><b>Network.</b> The control tablet has to sit on the same network as the receivers and the audio processor. The Surface Dock's wired port is the way to do that. Wi-Fi is not recommended for a fixed panel.</li>
    <li><b>Not included.</b> Install labor (mounting, cable runs, hauling off the old sets), tax if it applies, and freight. If R.J. Corman is tax-exempt, drop the sales-tax line.</li>
    <li><b>Adding stations.</b> A second identical tablet station, say front desk plus the floor, adds ${money(twoStations)}. The app itself has no limit.</li>
  </ul>

  <footer>
    <span>R.J. Corman Fitness Center, AV Modernization</span>
    <span>Internal planning reference. Prices are for budgeting, verify at purchase. Prepared by Jacob Smolinsky.</span>
  </footer>

</div></body></html>`;

fs.writeFileSync(path.join(__dirname, 'RJC-Fitness-AV-Quote.html'), html);
console.log('wrote RJC-Fitness-AV-Quote.html');
console.log('Base equipment total:', money(baseTotal));
