// Drives a new game in headless Chromium: title -> intro -> house -> lab ->
// pick a path -> walk to Route 1. Fails on any page error.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv[2] || join(root, 'dist');
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 820 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/fonts|ERR_|net::/.test(m.text())) errors.push('console: ' + m.text()); });
await page.goto('file://' + join(root, 'dist/adulting-quest.html'));
await page.waitForTimeout(800);
const shot = (n) => page.screenshot({ path: join(shots, n + '.png') });
const key = async (k, n = 1, gap = 120) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(gap); } };
const state = () => page.evaluate(() => { const g = window.__game.Game; return { mode: g.mode, map: g.map && g.map.id, x: g.pos.x, y: g.pos.y, busy: g.busy, ui: window.__game.UI.stack.length, p: g.p && { path: g.p.path, money: g.p.money, lvl: g.p.level } }; });
await shot('01-title');
await key('Enter');
await page.waitForTimeout(600);
// intro: mash A until the name box appears
for (let i = 0; i < 40; i++) {
  if (await page.$('#nameIn')) break;
  await key('z', 1, 150);
}
await shot('02-intro');
await page.fill('#nameIn', 'Zander');
await page.press('#nameIn', 'Enter');
for (let i = 0; i < 150; i++) { const s = await state(); const t = await page.evaluate(() => document.querySelector('.dlg-text').textContent); if (s.mode === 'world' && s.ui === 0 && !s.busy && t.includes('say hi')) break; await key('z', 1, 150); }
await page.waitForTimeout(400);
await shot('03-house');
console.log('after intro', await state());
errors.length && console.log(errors.join('\n'));
// teleport helper to test the rest quickly
await page.evaluate(() => { const { Game } = window.__game; Game.enter('lab-0-0', 8, 6, 'up'); });
await page.waitForTimeout(300);
await key('z'); // table at (5,4)
await page.waitForTimeout(500);
await shot('04-pathpick');
await key('z'); await page.waitForTimeout(300); await key('z');
for (let i = 0; i < 150; i++) { const s = await state(); if (s.ui === 0 && !s.busy) break; await key('z', 1, 150); }
console.log('after path', await state());
await page.evaluate(() => { const { Game } = window.__game; const [ox, oy] = window.__game.World.townOrigin(0); Game.enter('world', ox + 20, oy + 11, 'right'); });
await page.waitForTimeout(2500);
await shot('05-town');
await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
