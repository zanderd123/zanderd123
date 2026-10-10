// Opens the built page in headless Chromium, plays a little, takes
// screenshots, and fails on any console error.
//
//   node tools/smoke.mjs [outDir]

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || join(root, '.shots');
mkdirSync(out, { recursive: true });
const url = 'file://' + join(root, 'dist/holding-pattern.html');

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const errors = [];
async function session(name, viewport, script) {
  const page = await browser.newPage({ viewport });
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_FAILED/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await page.goto(url);
  await page.waitForTimeout(400);
  await script(page);
  await page.close();
}

await session('desktop', { width: 1440, height: 900 }, async (page) => {
  await page.screenshot({ path: join(out, '1-welcome.png') });
  await page.click('[data-start-tut]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, '1b-tutorial.png') });
  await page.click('[data-tut="skip"]');
  await page.click('.speed button[data-speed="4"]');
  await page.waitForTimeout(9000);
  await page.screenshot({ path: join(out, '2-running.png') });
  // sign whatever is offered
  for (let i = 0; i < 3; i++) {
    // The panel rebuilds twice a second, so click through the DOM directly.
    await page.evaluate(() => { const b = document.querySelector('[data-act="accept"]:not([disabled])'); if (b) b.click(); });
    await page.waitForTimeout(300);
  }
  await page.click('#tabs [data-tab="build"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, '3-build.png') });
  await page.click('#tabs [data-tab="advisor"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, '3b-advisor.png') });
  await page.click('#tabs [data-tab="help"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, '3c-help.png') });
  await page.evaluate(() => {});
  await page.click('#tabs [data-tab="finance"]');
  await page.waitForTimeout(12000);
  await page.screenshot({ path: join(out, '4-finance.png') });
  // zoom into the terminal
  await page.mouse.move(700, 560);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -200); await page.waitForTimeout(50); }
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(out, '5-zoom.png') });
  await page.click('#mapBtn');
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(out, '6-map.png') });
});

await session('phone', { width: 400, height: 820 }, async (page) => {
  await page.click('[data-close="dialog"]');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(out, '7-phone.png') });
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  if (sw > 400) errors.push(`phone: page is ${sw}px wide`);
});

await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('smoke ok →', out);
