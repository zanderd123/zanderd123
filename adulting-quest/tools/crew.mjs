// Recruit Chad by talking to him, then check swapping, forced tag-ins and
// a team leader fight.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv[2] || join(root, 'dist');
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 820 } });
page.on('pageerror', (e) => errors.push(e.message + '\n' + e.stack));
await page.goto('file://' + join(root, 'dist/adulting-quest.html'));
await page.waitForTimeout(500);
const st = () => page.evaluate(() => { const g = window.__game.Game; return { mode: g.mode, busy: g.busy, ui: window.__game.UI.stack.length, crew: g.p.crew.map((r) => r.id + ':' + r.sanity), me: g.p.sanity, badges: g.p.badges.length }; });
const mash = async (n, until, extra) => {
  for (let i = 0; i < n; i++) {
    const s = await st();
    if (until(s, i)) return s;
    if (extra) await extra(i);
    await page.keyboard.press('z'); await page.waitForTimeout(110);
  }
  return st();
};
// stand below Chad, facing up, and talk
const pos = await page.evaluate(() => {
  const { Game, World, UI } = window.__game;
  UI.stack.length = 0; document.querySelectorAll('.titlecard,.menu').forEach((e) => e.remove());
  Game.p = Game.newPlayer('CREWTEST');
  Object.assign(Game.p, { path: 'college', known: ['wing_it', 'googling', 'small_talk'], equipped: ['wing_it', 'googling', 'small_talk'], money: 100 });
  Game.give('comfort_food', 3); Game.give('pep_talk', 1);
  Game.fullHeal(); Game.mode = 'world'; World.refreshGates();
  const n = World.maps.world.npcs.find((n) => n.ally === 'chad');
  n.wander = 0;
  Game.enter('world', n.x, n.y + 1, 'up');
  return [n.x, n.y];
});
await page.waitForTimeout(300);
await page.keyboard.press('z');
let s = await mash(40, (s, i) => i > 3 && s.ui === 0 && !s.busy);
console.log('after recruit', s);
await page.screenshot({ path: join(shots, 'c0-world.png') });
// battle: lead (me) at low sanity so a tag-in is forced
await page.evaluate(() => { const { Game, Battle } = window.__game; Game.p.sanity = 3; Game.run(() => Battle.start({ foes: [['back_pain', 4]], wild: true, biome: 'suburb' })); });
let shot = false;
s = await mash(200, (s, i) => i > 5 && s.mode === 'world' && s.ui === 0 && !s.busy, async () => {
  const t = await page.evaluate(() => document.querySelector('.dlg-text').textContent);
  if (!shot && /tag in|up!/.test(t)) { shot = true; await page.waitForTimeout(500); await page.screenshot({ path: join(shots, 'c1-tagin.png') }); }
  if (await page.$('.skillmenu')) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(50); }
});
console.log('after wild', s, 'tag-in seen', shot);
// leader with the team
await page.evaluate(() => { const { Game } = window.__game; Game.p.level = 11; Game.p.xp = 1100; Game.fullHeal(); Game.enter('hall-1-0', 9, 4, 'up'); });
await page.waitForTimeout(300);
await page.keyboard.press('z');
let crewShot = false;
s = await mash(900, (s, i) => i > 8 && s.mode === 'world' && s.ui === 0 && !s.busy, async (i) => {
  if (await page.$('.skillmenu')) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(50); }
  if (!crewShot && i > 30 && await page.$('.actmenu')) { crewShot = true; await page.screenshot({ path: join(shots, 'c2-leader.png') }); }
});
console.log('after leader', s);
await page.evaluate(() => { const { Game } = window.__game; window.__game.UI.stack.length = 0; Game.run(() => Menu.crew()); }).catch(() => {});
await page.waitForTimeout(400);
await page.screenshot({ path: join(shots, 'c3-crewmenu.png') });
await browser.close();
console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'no errors');
