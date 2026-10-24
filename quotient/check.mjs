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
const ctx = {};
vm.createContext(ctx);
ctx.window = ctx;
for (const id of ['engine', 'words']) vm.runInContext(html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`))[1], ctx);
const E = ctx.QEngine, WORDS = ctx.QWords;

const MIN = { matrices: 6 };
const bad = /undefined|NaN|Infinity|\[object/;
let failures = 0, total = 0;
const fail = (q, msg) => { if (failures++ < 15) console.log('FAIL', q.cat, q.diff, q.seed, msg, '\n ', q.prompt); };

for (const { id: cat } of E.CATEGORIES.filter(c => !c.game)) {
  for (const diff of E.DIFFS) {
    for (let seed = 1; seed <= 3000; seed++) {
      const q = E.generate({ seed, cat, diff });
      total++;
      const min = MIN[cat] || (cat === 'logic' ? 3 : 4);
      const keys = q.options.map(o => JSON.stringify(o));
      if (q.options.length < min) fail(q, `only ${q.options.length} options`);
      if (new Set(keys).size !== keys.length) fail(q, 'duplicate options');
      if (!(q.answer >= 0 && q.answer < q.options.length)) fail(q, 'answer missing');
      if (cat === 'spatial') {
        // Exactly one option may be reachable by turning the shape.
        const norm = cs => { const a = Math.min(...cs.map(x => x[0])), b = Math.min(...cs.map(x => x[1])); return JSON.stringify(cs.map(([r, c]) => [r - a, c - b]).sort((x, y) => x[0] - y[0] || x[1] - y[1])); };
        const turnsOf = new Set(); let cs = q.stem.cells;
        for (let k = 0; k < 4; k++) { turnsOf.add(norm(cs)); cs = cs.map(([r, c]) => [c, -r]); }
        const hits = q.options.filter(o => turnsOf.has(norm(o))).length;
        if (hits !== 1) fail(q, `${hits} options are turns of the shape`);
      }
      const text = [q.prompt, q.hint, q.why, JSON.stringify(q.stem), ...keys].join(' ');
      if (bad.test(text)) fail(q, 'bad text: ' + text.match(bad)[0]);
    }
  }
}

// Same seed must give the same question (the daily item depends on it).
const a = JSON.stringify(E.generate({ seed: 42, cat: 'logic', diff: 'hard' }));
const b = JSON.stringify(E.generate({ seed: 42, cat: 'logic', diff: 'hard' }));
if (a !== b) { failures++; console.log('FAIL generation is not deterministic'); }

// The Question of the Day must never repeat over ten years.
const keyAt = i => { const d = new Date(2026, 9, 24 + i); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const seenDaily = new Set();
let rerolled = 0;
E.daily(3649, keyAt, (i, f, k) => {
  if (seenDaily.has(f)) { failures++; console.log('FAIL daily question repeats on', keyAt(i)); }
  seenDaily.add(f);
  rerolled += k ? 1 : 0;
});

// Daily Grid: every puzzle has exactly one solution that matches its givens.
let gridCount = 0;
for (const diff of E.DIFFS) {
  for (let seed = 1; seed <= 40; seed++) {
    const g = E.makeGrid(seed * 7919, diff);
    const cells = g.puzzle.split('').map(Number);
    const sols = E.countSolutions(cells, g.n, g.peers, 2);
    const fits = cells.every((v, i) => !v || v === Number(g.solution[i]));
    const sol = g.solution.split('').map(Number);
    const valid = sol.every((v, i) => v >= 1 && v <= g.n && g.peers[i].every(j => sol[j] !== v));
    if (sols !== 1 || !fits || !valid) { failures++; console.log('FAIL grid', diff, seed, { sols, fits, valid }); }
    gridCount++;
  }
}

// Word list: no duplicate words or meanings, every field present.
const words = new Set(), meanings = new Set();
for (const w of WORDS) {
  if (!w.word || !w.pos || !w.meaning || !w.example) { failures++; console.log('FAIL incomplete word', w.word); }
  if (words.has(w.word) || meanings.has(w.meaning)) { failures++; console.log('FAIL duplicate word', w.word); }
  words.add(w.word); meanings.add(w.meaning);
}

console.log(`${seenDaily.size} distinct daily questions over 10 years (${rerolled} re-rolled), ${WORDS.length} words`);
console.log(`${gridCount} Daily Grid puzzles checked for a single solution`);
console.log(`${total} questions checked, ${failures} failures`);
process.exit(failures ? 1 : 0);
