// Phone-sized run: checks the touch pad layout and every field menu screen,
// plus save -> reload -> continue.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv[2] || join(root, 'dist');
const errors = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
const url = 'file://' + join(root, 'dist/adulting-quest.html');
await page.goto(url);
await page.waitForTimeout(700);
await page.screenshot({ path: join(shots, 'm0-title.png') });
await page.evaluate(() => {
  const { Game, World, UI } = window.__game;
  UI.stack.length = 0; document.querySelectorAll('.titlecard,.menu').forEach((e) => e.remove());
  Game.p = Game.newPlayer('PHONE');
  Object.assign(Game.p, { path: 'college', known: ['wing_it', 'googling', 'small_talk', 'deep_breaths'], equipped: ['wing_it', 'googling', 'small_talk'], money: 321, debt: 2900, badges: ['car'] });
  Game.give('coffee', 3); Game.give('book_diy', 1); Game.give('outfit', 1);
  Game.fullHeal(); Game.mode = 'world'; World.refreshGates();
  const [ox, oy] = World.townOrigin(1); Game.enter('world', ox + 14, oy + 12, 'down');
});
await page.waitForTimeout(400);
await page.screenshot({ path: join(shots, 'm1-world.png') });
const tap = async (sel, n = 1) => { for (let i = 0; i < n; i++) { await page.tap(sel); await page.waitForTimeout(160); } };
// walk with the d-pad: hold right
const b = await (await page.$('[data-btn="right"]')).boundingBox();
await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
console.log('walked to', await page.evaluate(() => window.__game.Game.pos.x));
await tap('[data-btn="START"]');
await page.screenshot({ path: join(shots, 'm2-menu.png') });
await tap('[data-btn="A"]'); // skills
await page.screenshot({ path: join(shots, 'm3-skills.png') });
await tap('[data-btn="B"]');
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(100); await tap('[data-btn="A"]'); // bag
await page.screenshot({ path: join(shots, 'm4-bag.png') });
await tap('[data-btn="B"]');
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(100); await tap('[data-btn="A"]'); // profile
await page.waitForTimeout(200);
await page.screenshot({ path: join(shots, 'm5-profile.png') });
await tap('[data-btn="A"]');
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(100); await tap('[data-btn="A"]'); // map
await page.screenshot({ path: join(shots, 'm6-map.png') });
await tap('[data-btn="A"]');
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(100); await tap('[data-btn="A"]'); // chart
await page.screenshot({ path: join(shots, 'm7-chart.png') });
await tap('[data-btn="A"]');
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(100); await tap('[data-btn="A"]'); // save
await tap('[data-btn="A"]'); // yes
for (let i = 0; i < 6; i++) await tap('[data-btn="A"]');
const saved = await page.evaluate(() => localStorage.getItem('adulting-quest-save-v1') !== null);
console.log('saved:', saved);
await page.reload(); await page.waitForTimeout(800);
await page.screenshot({ path: join(shots, 'm8-continue.png') });
await page.keyboard.press('z'); await page.waitForTimeout(1200);
console.log('continued:', await page.evaluate(() => { const g = window.__game.Game; return { mode: g.mode, map: g.map && g.map.id, x: g.pos.x, name: g.p && g.p.name, money: g.p && g.p.money }; }));
await browser.close();
console.log(errors.length ? 'ERRORS ' + errors.join('\n') : 'no errors');
