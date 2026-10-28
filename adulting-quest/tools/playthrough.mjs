// Plays the game from the title screen with tools/bot.js and reports how
// long each milestone took.   node tools/playthrough.mjs <college|trade|job> [minutes]
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const path = process.argv[2] || 'college', limit = (+process.argv[3] || 90) * 60;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto('file://' + join(root, 'dist/adulting-quest.html'));
await page.waitForTimeout(800);
await page.addScriptTag({ content: readFileSync(join(root, 'tools/bot.js'), 'utf8') });
await page.evaluate((p) => { window.Bot.run(p); }, path);
let seen = 0;
const t0 = Date.now();
while (true) {
  await page.waitForTimeout(5000);
  const b = await page.evaluate(() => ({ log: Bot.log, done: Bot.done, error: Bot.error, counts: Bot.counts, lvl: Game.p && Game.p.level, money: Game.p && Game.p.money }));
  for (const [t, m] of b.log.slice(seen)) console.log(`[${path}] ${String(Math.floor(t / 60)).padStart(2)}m${String(t % 60).padStart(2, '0')}s  ${m}`);
  seen = b.log.length;
  if (b.done || (Date.now() - t0) / 1000 > limit) {
    if (b.error) console.log(`[${path}] BOT ERROR ${b.error}`);
    console.log(`[${path}] SUMMARY ${JSON.stringify({ done: b.done, minutes: +((Date.now() - t0) / 60000).toFixed(1), level: b.lvl, money: b.money, ...b.counts })}`);
    break;
  }
  if (seen === 0 && (Date.now() - t0) > 120000) await page.screenshot({ path: `/tmp/claude-0/-home-user-zanderd123/6040611e-7f79-5bfe-a6ce-e74f21876b3a/scratchpad/shots/stuck-${path}.png` });
}
console.log(`[${path}] ${errors.length ? 'PAGE ERRORS\n' + errors.slice(0, 10).join('\n') : 'no page errors'}`);
await browser.close();
