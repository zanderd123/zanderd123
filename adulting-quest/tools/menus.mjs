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
const pick = async (label) => {   // open the menu entry with this label
  const idx = await page.evaluate((l) => [...document.querySelectorAll('.choice .opt')].findIndex((e) => e.textContent.startsWith(l)), label);
  for (let i = 0; i < idx; i++) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(80); }
  await tap('[data-btn="A"]'); await page.waitForTimeout(200);
};
const backToTop = async () => { for (let i = 0; i < 10; i++) { const at = await page.evaluate(() => [...document.querySelectorAll('.choice .opt.sel')].map((e) => e.textContent)[0]); if (at === 'SKILLS') break; await page.keyboard.press('ArrowUp'); await page.waitForTimeout(80); } };
for (const [label, shot] of [['SKILLS', 'm3-skills'], ['BAG', 'm4-bag'], ['PROFILE', 'm5-profile'], ['MAP', 'm6-map'], ['WHAT BEATS', 'm7-chart']]) {
  await backToTop(); await pick(label);
  await page.screenshot({ path: join(shots, shot + '.png') });
  await tap('[data-btn="B"]'); await tap('[data-btn="A"]'); await page.waitForTimeout(100);
  if (await page.$('.panel')) await tap('[data-btn="B"]');
}
await backToTop(); await pick('SAVE GAME');
await tap('[data-btn="A"]');                 // slot 1
for (let i = 0; i < 6; i++) await tap('[data-btn="A"]');
const saved = await page.evaluate(() => !!Saves.read('1'));
console.log('saved:', saved);
await page.reload(); await page.waitForTimeout(800);
await page.screenshot({ path: join(shots, 'm8-continue.png') });
await page.keyboard.press('z'); await page.waitForTimeout(400); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(100); await page.keyboard.press('z'); await page.waitForTimeout(1200);
console.log('continued:', await page.evaluate(() => { const g = window.__game.Game; return { mode: g.mode, map: g.map && g.map.id, x: g.pos.x, name: g.p && g.p.name, money: g.p && g.p.money }; }));
await browser.close();
console.log(errors.length ? 'ERRORS ' + errors.join('\n') : 'no errors');
