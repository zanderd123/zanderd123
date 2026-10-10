// Builds a busy mid-game airport in the browser and photographs it: every
// connector type, a full contract book, congestion. For eyeballing visuals.
//
//   node tools/showcase.mjs [outDir]

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || join(root, '.shots');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
await page.goto('file://' + join(root, 'dist/holding-pattern.html'));
await page.waitForTimeout(300);
await page.click('[data-close="dialog"]:not([data-start-tut])');

await page.evaluate(() => {
  const { game, sim: S } = window.__hp;
  const g = game();
  const ap = g.airports[0];
  g.cash = 5e6;
  ap.level = 5; ap.paxServed = 40000;
  for (const p of ['west', 'east', 'south', 'farwest', 'fareast', 'north']) S.buyPlot(g, ap, p);
  S.buildTerminal(g, ap, 'midcenter', 'shuttle', 4);
  S.buildTerminal(g, ap, 'westwing', 'walkway');
  S.buildTerminal(g, ap, 'eastwing', 'monorail');
  S.buildTerminal(g, ap, 'mideast', 'tunnel');
  for (const k of ['radar', 'rapidExits', 'garage1', 'hvac']) S.buyUpgrade(g, ap, k);
  for (const T of ap.terminals) { T.buildLeft = 0; if (T.connector) T.connector.buildLeft = 0; T.heavy = true; T.retail = 2; }
  for (let i = 0; i < 4; i++) S.addLane(g, ap);
  // sign a big book of routes spread across terminals
  const slots = ['main', 'midcenter', 'westwing', 'eastwing', 'mideast'];
  for (let i = 0; i < 14; i++) {
    ap.nextOfferAt = 0; ap.offers = [];
    S.step(g, ap, 0.01);
    const o = ap.offers[0];
    if (o) S.acceptOffer(g, ap, o.id, slots[i % slots.length]);
  }
  ap.t = 360 * 0.2; // daylight
});
await page.click('.speed button[data-speed="4"]');
await page.waitForTimeout(25000);
await page.click('.speed button[data-speed="1"]');

const shots = [
  ['s1-overview', 1000, 520, 0.62],
  ['s2-main', 1000, 600, 2.2],
  ['s3-runway', 520, 230, 1.6],
  ['s4-midfield', 1100, 430, 1.6],
];
for (const [name, x, y, z] of shots) {
  await page.evaluate(([x, y, z]) => { const c = window.__hp.cam; c.x = x + 200 / z; c.y = y; c.zoom = z; }, [x, y, z]);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, name + '.png') });
}
// night
await page.evaluate(() => { const ap = window.__hp.game().airports[0]; ap.t = Math.ceil(ap.t / 360) * 360 + 360 * 0.45; const c = window.__hp.cam; c.x = 1100; c.y = 450; c.zoom = 0.9; });
await page.waitForTimeout(500);
await page.screenshot({ path: join(out, 's5-night.png') });
await page.evaluate(() => { const ap = window.__hp.game().airports[0]; ap.t = Math.ceil(ap.t / 360) * 360 + 72; });
await page.click('#tabs [data-tab="contracts"]');
await page.waitForTimeout(600);
await page.screenshot({ path: join(out, 's6-contracts.png') });
await page.evaluate(() => { document.querySelector('[data-act="detail"]') || null; });
await page.evaluate(() => { const ui = document.querySelector('#tabs [data-tab="build"]'); ui.click(); });
await page.waitForTimeout(300);
await page.evaluate(() => { const b = document.querySelector('[data-act="detail"][data-id="eastwing"]'); if (b) b.click(); });
await page.waitForTimeout(600);
await page.screenshot({ path: join(out, 's7-terminal.png') });
const stats = await page.evaluate(() => {
  const ap = window.__hp.game().airports[0];
  const st = {}; for (const p of ap.planes) st[p.state] = (st[p.state] || 0) + 1;
  return { st, net: ap.perMin.net, otp: ap.rolling.otp, sec: ap.secQueue };
});
console.log(JSON.stringify(stats));
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
