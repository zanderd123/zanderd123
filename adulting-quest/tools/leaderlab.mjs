// Win rate for a leader at a given level:  node tools/leaderlab.mjs car 9 10 college
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [key, lvl, n, path, power, shift] = [process.argv[2], +process.argv[3], +process.argv[4] || 8, process.argv[5] || 'college', +process.argv[6] || 0, +process.argv[7] || 0];
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + join(root, 'dist/adulting-quest.html'));
await page.waitForTimeout(600);
await page.addScriptTag({ content: readFileSync(join(root, 'tools/bot.js'), 'utf8') });
const wins = await page.evaluate(([k, l, c, p, w, sh]) => Bot.lab(k, l, c, p, w, sh), [key, lvl, n, path, power, shift]);
console.log(`${key} L${lvl} ${path} power=${power || 'default'} shift=${shift}: ${wins}/${n} wins${errors.length ? '  ERRORS ' + errors[0] : ''}`);
await browser.close();
