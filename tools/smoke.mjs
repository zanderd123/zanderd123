/**
 * End-to-end smoke test of the built game, in a real browser.
 *
 * Loads dist/siege-of-kepler-9.html, plays a short battle through the actual
 * UI — pick a side, auto-fill a fleet, launch, begin, run — and reports every
 * page error, console error and recorder anomaly it saw.
 *
 * This is the check that the reconstruction actually runs, not just that it
 * bundles. A module that throws on construction bundles perfectly.
 *
 *   node tools/smoke.mjs [seconds]
 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const PAGE = pathToFileURL(join(root, 'dist', 'siege-of-kepler-9.html')).href;
const SECONDS = Number(process.argv[2] || 12);

// The bundled chromium in this image dropped the old headless mode; the
// headless shell is the binary that still works.
const EXECUTABLE = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';

const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

const fail = (msg) => { console.error(`FAIL  ${msg}`); process.exitCode = 1; };
const ok = (msg) => console.log(`ok    ${msg}`);

await page.goto(PAGE, { waitUntil: 'load' });

// Boot: the loading screen comes down once the hulls are decoded.
await page.waitForFunction(
  () => document.getElementById('loading').classList.contains('hidden'),
  { timeout: 30000 });
ok('booted, loading screen cleared');

await page.click('.side-card[data-side="attack"]');
await page.click('#auto-fill');
const spent = await page.textContent('#spent');
ok(`fleet auto-filled — ${spent} points`);

await page.click('#launch');
await page.waitForFunction(() => window.__app.game.state === 'prep', { timeout: 10000 });
ok('battle prepared');

await page.click('#prep-go');
await page.waitForFunction(() => window.__app.game.state === 'playing', { timeout: 10000 });
ok('battle started');

// Run it at speed so a short wall-clock window covers real simulated time.
await page.evaluate(() => window.__app.setSpeedIndex(4));
await page.waitForTimeout(SECONDS * 1000);

const state = await page.evaluate(() => {
  const app = window.__app;
  const g = app.game;
  return {
    now: g.now,
    state: g.state,
    units: g.units.length,
    alive: g.units.filter((u) => u.alive).length,
    kills: g.kills,
    planet: g.planet ? g.planet.fraction : null,
    anomalies: app.recorder.anomalies.map((a) => `x${a.count} ${a.what}`),
    recorderErrors: app.recorder.errors.map((e) => e.message),
    // The imported Falcon hull is the one asset that comes from outside the
    // code; if the base64 did not survive bundling it falls back to the
    // procedural model and the count collapses.
    falconTris: (() => {
      const u = g.units.find((x) => x.type.id === 'falcon');
      if (!u) return null;
      let n = 0;
      // Counted off the live instanced meshes, so this is what is actually
      // being drawn rather than what the model registry says it holds.
      for (const [key, batch] of app.fleet.batches) {
        if (!key.startsWith('falcon:')) continue;
        for (const mesh of batch.meshes) {
          const geo = mesh.geometry;
          n += geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
        }
        break;
      }
      return n;
    })(),
  };
});

if (state.falconTris === null) console.log('  (no Falcon in this fleet — hull check skipped)');
else if (state.falconTris === 11708) ok(`imported Falcon hull intact — ${state.falconTris} triangles`);
else fail(`Falcon is ${state.falconTris} triangles, expected 11708 (import did not apply)`);

console.log(`\n  simulated ${state.now.toFixed(1)}s · ${state.alive}/${state.units} squadrons alive`
  + ` · kills ${JSON.stringify(state.kills)}`
  + (state.planet !== null ? ` · planet ${(state.planet * 100).toFixed(0)}%` : ''));

if (state.now < 5) fail(`only ${state.now.toFixed(1)}s simulated — the clock is not running`);
else ok(`clock advanced to ${state.now.toFixed(1)}s`);

if (state.anomalies.length) {
  console.log('\n  ANOMALIES:');
  for (const a of state.anomalies) console.log(`    ${a}`);
  fail(`${state.anomalies.length} anomaly type(s)`);
} else ok('no simulation anomalies');

if (errors.length) {
  console.log('\n  ERRORS:');
  for (const e of errors.slice(0, 20)) console.log(`    ${e}`);
  fail(`${errors.length} page/console error(s)`);
} else ok('no page or console errors');

await browser.close();
