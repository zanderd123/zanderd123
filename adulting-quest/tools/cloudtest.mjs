// Cloud save check with a fake claude.use('db'): device A saves, device B
// (fresh browser storage, same "account") sees the save on its title screen.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const store = {};
const fake = () => {
  const call = (op, path, data) => window.__cloudOp(op, path, data && JSON.stringify(data));
  const doc = (path) => ({
    get: async () => { const v = await call('get', path); return { exists: v != null, data: () => (v ? JSON.parse(v) : undefined) }; },
    set: async (d) => { await call('set', path, d); },
  });
  window.claude = { use: async (n) => (n === 'db' ? { collection: (c) => ({ doc: (k) => doc(c + '/' + k) }) } : n === 'user' ? { id: async () => 'u123' } : null) };
};
const errors = [];
const browser = await chromium.launch();
const device = async () => {
  const ctx = await browser.newContext();
  await ctx.exposeFunction('__cloudOp', (op, path, data) => { if (op === 'set') store[path] = data; return op === 'get' ? store[path] ?? null : null; });
  await ctx.addInitScript(fake);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + join(root, 'dist/adulting-quest.html'));
  await page.waitForTimeout(1200);
  return page;
};

const a = await device();
const before = await a.evaluate(() => [...document.querySelectorAll('.titlemenu .opt, .titlemenu div')].map((e) => e.textContent).join('|'));
await a.evaluate(() => {
  const g = window.__game;
  const p = { name: 'Tester', level: 12, badges: ['car'], money: 345, path: 'college', playTime: 1800 };
  g.Saves.write('2', p);
  g.Saves.write('auto', p);
});
await a.waitForTimeout(500);
const afterManual = Object.keys(store);
await a.evaluate(() => window.__game.Cloud.flush());
await a.waitForTimeout(500);

const b = await device();
const local = await b.evaluate(() => { const S = window.__game.Saves; return ['auto', '1', '2', '3'].map((s) => (S.read(s) ? s + ':' + S.read(s).p.name : s + ':-')).join(' '); });
const menu = await b.evaluate(() => document.body.innerText.includes('CONTINUE'));
console.log('title before:', before);
console.log('cloud after slot 2 save (immediate):', afterManual.join(', '));
console.log('cloud after flush:', Object.keys(store).join(', '));
console.log('device B saves:', local, '| CONTINUE shown:', menu);
console.log(errors.length ? 'ERRORS ' + errors.join('; ') : 'no page errors');
await browser.close();
