// Screenshots every town, a few routes and each interior type.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv[2] || join(root, 'dist');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 760, height: 560 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + join(root, 'dist/adulting-quest.html'));
await page.waitForTimeout(500);
await page.evaluate(() => {
  const { Game, World, UI } = window.__game;
  UI.stack.length = 0; document.querySelectorAll('.titlecard,.menu').forEach((e) => e.remove());
  Game.p = Game.newPlayer('TOUR'); Game.p.path = 'job'; Game.mode = 'world'; World.refreshGates();
});
const go = (map, x, y) => page.evaluate(([map, x, y]) => { window.__game.Game.enter(map, x, y, 'down'); document.querySelectorAll('.banner').forEach((e) => e.remove()); }, [map, x, y]);
for (let t = 0; t < 8; t++) {
  const [ox, oy] = await page.evaluate((t) => window.__game.World.townOrigin(t), t);
  await go('world', ox + 13, oy + 12);
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(shots, `t${t}.png`), clip: await page.evaluate(() => { const r = document.getElementById('screen').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }) });
}
for (const [n, dx] of [[0, 30 + 13], [2, 2 * 56 + 30 + 13]]) {
  await go('world', 4 + dx, 4 + 12);
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(shots, `r${n}.png`), clip: await page.evaluate(() => { const r = document.getElementById('screen').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }) });
}
for (const id of ['store-1-0', 'hospital-2-0', 'chapel-3-0', 'hall-3-0', 'lab-0-0']) {
  await page.evaluate((id) => { const m = window.__game.World.maps[id]; window.__game.Game.enter(id, m.entry.x, m.entry.y, 'up'); }, id);
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(shots, `i-${id}.png`), clip: await page.evaluate(() => { const r = document.getElementById('screen').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }) });
}
await browser.close();
console.log(errors.length ? errors.join('\n') : 'no errors');
