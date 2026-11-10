// Starts a save at the lab with a chosen path, walks onto Route 1 and fights
// wild issues by mashing the first damaging skill; then fights Car Trouble.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv[2] || join(root, 'dist');
const path = process.argv[3] || 'college';
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 820 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
await page.goto('file://' + join(root, 'dist/adulting-quest.html'));
await page.waitForTimeout(600);
await page.evaluate((path) => {
  const { Game, World, UI, Main } = window.__game;
  // skip title
  UI.stack.length = 0; document.querySelectorAll('.titlecard,.menu').forEach((e) => e.remove());
  Game.p = Game.newPlayer('TESTER');
  const P = { college: 0, trade: 1, job: 2 }[path];
  Object.assign(Game.p, { path, known: [...window.__game.PATHS[path].start], equipped: [...window.__game.PATHS[path].start], money: 100 });
  Game.give('coffee', 3); Game.give('comfort_food', 3);
  Game.fullHeal();
  Game.mode = 'world';
  World.refreshGates();
  Game.enter('world', 4 + 30 + 10, 4 + 10, 'right');
}, path).catch(async (e) => { console.log('setup failed', e.message); });
await page.waitForTimeout(500);
const st = () => page.evaluate(() => { const g = window.__game.Game; return { mode: g.mode, busy: g.busy, ui: window.__game.UI.stack.length, lvl: g.p.level, san: g.p.sanity, en: g.p.energy, money: g.p.money, xp: g.p.xp }; });
console.log(await st());
await page.screenshot({ path: join(shots, 'b0-route.png') });
// fight: start wild battles directly
for (let fight = 0; fight < 4; fight++) {
  await page.evaluate(() => { const { Game, Battle } = window.__game; Game.run(() => Battle.start({ foes: [['parking_ticket', 4]], wild: true, biome: 'suburb' })); });
  let shotTaken = false;
  for (let i = 0; i < 300; i++) {
    const s = await st();
    if (s.mode === 'world' && !s.busy && s.ui === 0) break;
    const menu = await page.$('.actmenu');
    const sk = await page.$('.skillmenu');
    if (menu && !shotTaken && fight === 0) { await page.screenshot({ path: join(shots, 'b1-battle.png') }); shotTaken = true; }
    if (sk && fight === 0 && i < 40) { await page.screenshot({ path: join(shots, 'b2-skills.png') }); }
    if (sk) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(60); }
    await page.keyboard.press('z');
    await page.waitForTimeout(110);
  }
  console.log('after fight', fight, await st());
}
await page.screenshot({ path: join(shots, 'b3-after.png') });
// leader
await page.evaluate(() => { const { Game } = window.__game; Game.p.level = 11; Game.p.xp = 1100; Game.fullHeal(); Game.enter('hall-1-0', 9, 4, 'up'); });
await page.waitForTimeout(300);
await page.keyboard.press('z');
let leaderShot = false;
for (let i = 0; i < 700; i++) {
  const s = await st();
  if (s.mode === 'world' && !s.busy && s.ui === 0 && i > 5) break;
  if (s.mode === 'battle' && !leaderShot && (await page.evaluate(() => document.querySelector('.dlg-text').textContent)).includes('wants to battle')) { await page.screenshot({ path: join(shots, 'b4-leader.png') }); leaderShot = true; }
  if (await page.$('.skillmenu')) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(60); }
  await page.keyboard.press('z');
  await page.waitForTimeout(110);
}
console.log('after leader', await st(), await page.evaluate(() => window.__game.Game.p.badges));
await page.screenshot({ path: join(shots, 'b5-leader-after.png') });
await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
