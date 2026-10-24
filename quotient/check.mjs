/**
 * Generates thousands of questions per category and difficulty and checks
 * each one is well formed: enough distinct options, the answer among them,
 * and no undefined/NaN text leaking into what the player reads.
 *
 *   node quotient/check.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'quotient.html'), 'utf8');
const src = html.match(/<script id="engine">([\s\S]*?)<\/script>/)[1];
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src, ctx);
const E = ctx.QEngine;

const MIN = { matrices: 6 };
const bad = /undefined|NaN|Infinity|\[object/;
let failures = 0, total = 0;
const fail = (q, msg) => { if (failures++ < 15) console.log('FAIL', q.cat, q.diff, q.seed, msg, '\n ', q.prompt); };

for (const { id: cat } of E.CATEGORIES) {
  for (const diff of E.DIFFS) {
    for (let seed = 1; seed <= 3000; seed++) {
      const q = E.generate({ seed, cat, diff });
      total++;
      const min = MIN[cat] || (cat === 'logic' ? 3 : 4);
      const keys = q.options.map(o => JSON.stringify(o));
      if (q.options.length < min) fail(q, `only ${q.options.length} options`);
      if (new Set(keys).size !== keys.length) fail(q, 'duplicate options');
      if (!(q.answer >= 0 && q.answer < q.options.length)) fail(q, 'answer missing');
      const text = [q.prompt, q.hint, q.why, JSON.stringify(q.stem), ...keys].join(' ');
      if (bad.test(text)) fail(q, 'bad text: ' + text.match(bad)[0]);
    }
  }
}

// Same seed must give the same question (the daily item depends on it).
const a = JSON.stringify(E.generate({ seed: 42, cat: 'logic', diff: 'hard' }));
const b = JSON.stringify(E.generate({ seed: 42, cat: 'logic', diff: 'hard' }));
if (a !== b) { failures++; console.log('FAIL generation is not deterministic'); }

console.log(`${total} questions checked, ${failures} failures`);
process.exit(failures ? 1 : 0);
