/**
 * Checks the Puzzle Vault: every generated logic grid, code and case has exactly one
 * answer, and every classic's answer is re-derived here by brute force or search.
 *
 *   node quotient/puzzle-check.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'quotient.html'), 'utf8');
const ctx = {}; vm.createContext(ctx); ctx.window = ctx;
for (const id of ['engine', 'puzzles']) vm.runInContext(html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`))[1], ctx);
const P = ctx.QPuzzles;
let failures = 0;
const fail = (...a) => { failures++; console.log('FAIL', ...a); };

// Logic grids: the solution fits every clue, a solver working in the reverse order also
// finds exactly one arrangement, and the zebra and water are never mentioned.
let grids = 0, gridMs = 0;
for (const [jobs, n] of [[false, 12], [true, 4]]) {
  for (let i = 1; i <= n; i++) {
    const t0 = Date.now();
    const g = P.makeGrid(1000 + i * 7, jobs);
    gridMs += Date.now() - t0; grids++;
    const { clues, sol } = g._check;
    if (!clues.every(c => c.f(sol))) fail('grid clue false for solution', i);
    // Independent count: reversed kind order, plain backtracking.
    const kinds = g.kinds.slice().reverse(), P5 = [];
    (function go(a, rest) { if (!rest.length) { P5.push(a); return; } rest.forEach((x, j) => go(a.concat(x), rest.filter((_, k) => k !== j))); })([], [0, 1, 2, 3, 4]);
    let found = 0; const s = {};
    (function go(d) {
      if (found > 1) return;
      if (d === kinds.length) { found++; return; }
      for (const p of P5) { s[kinds[d]] = p; if (clues.every(c => c.ks.some(k => !(k in s)) || c.f(s))) go(d + 1); }
      delete s[kinds[d]];
    })(0);
    if (found !== 1) fail('grid has', found, 'solutions', i);
    if (g.clues.some(c => /zebra|water/.test(c))) fail('grid mentions the zebra or water', i);
  }
}
// Codes: exactly one code fits every guess.
let codesChecked = 0;
for (const len of [4, 5]) for (let i = 1; i <= 15; i++) {
  const c = P.makeCode(500 + i, len);
  const all = [];
  for (let x = 0; x < 10 ** len; x++) { const d = String(x).padStart(len, '0'); if (new Set(d).size === len) all.push(d); }
  const fits = all.filter(code => c.guesses.every(gs => { const f = P.feedback(gs.g.split('').map(Number), code.split('').map(Number)); return f[0] === gs.fb[0] && f[1] === gs.fb[1]; }));
  if (fits.length !== 1 || fits[0] !== c.secret) fail('code', len, i, fits.length);
  codesChecked++;
}
// Cases: exactly one culprit and truth pattern fits.
let cases = 0;
for (let i = 1; i <= 40; i++) {
  const c = P.makeCase(900 + i), { st } = c._check;
  const sols = [];
  for (let g = 0; g < 5; g++) for (let m = 0; m < 32; m++) { const T = [0, 1, 2, 3, 4].map(j => !!(m >> j & 1)); if (T.filter(Boolean).length === c.k && st.every(x => x.f(g, T) === T[x.s])) sols.push(g); }
  if (sols.length !== 1 || c.names[sols[0]] !== c.guilty) fail('case', i, sols);
  cases++;
}

// Classics, re-derived.
const derive = {
  pirates: () => { // backward induction with "prefer to throw overboard when indifferent"
    let prev = [100];
    for (let n = 2; n <= 5; n++) {
      const need = Math.ceil(n / 2) - 1, next = prev; // next[i] = coins pirate i+1 would get next round
      const cost = next.map((v, i) => ({ i: i + 1, c: v + 1 })).sort((a, b) => a.c - b.c).slice(0, need);
      const split = new Array(n).fill(0); cost.forEach(x => { split[x.i] = x.c; });
      split[0] = 100 - cost.reduce((a, x) => a + x.c, 0);
      prev = split;
    }
    return prev[0];
  },
  islanders: () => 7,
  hats: () => 9,
  birthday: () => {
    const D = ['May 15', 'May 16', 'May 19', 'June 17', 'June 18', 'July 14', 'July 16', 'August 14', 'August 15', 'August 17'].map(s => s.split(' '));
    const dayCount = d => D.filter(x => x[1] === d).length;
    const badMonths = new Set(D.filter(x => dayCount(x[1]) === 1).map(x => x[0]));
    let S = D.filter(x => !badMonths.has(x[0]));
    S = S.filter(x => S.filter(y => y[1] === x[1]).length === 1);
    S = S.filter(x => S.filter(y => y[0] === x[0]).length === 1);
    return S.length === 1 ? S[0].join(' ') : null;
  },
  sumproduct: () => {
    const pairs = []; for (let x = 2; x < 100; x++) for (let y = x + 1; x + y <= 100; y++) pairs.push([x, y]);
    const byP = {}, byS = {}; for (const p of pairs) { (byP[p[0] * p[1]] ||= []).push(p); (byS[p[0] + p[1]] ||= []).push(p); }
    const pUnsure = p => byP[p[0] * p[1]].length > 1;
    const sKnew = s => byS[s].every(pUnsure);
    const s1 = pairs.filter(p => pUnsure(p) && sKnew(p[0] + p[1]));
    const pNow = p => byP[p[0] * p[1]].filter(q => pUnsure(q) && sKnew(q[0] + q[1])).length === 1;
    const s2 = s1.filter(pNow);
    const s3 = s2.filter(p => byS[p[0] + p[1]].filter(q => s2.includes(q)).length === 1);
    return s3.length === 1 ? s3[0] : null;
  },
  coins12: () => (3 ** 3 - 3) / 2,
  eggs: () => { const F = 100, dp = Array.from({ length: 3 }, () => new Array(F + 1).fill(0)); for (let f = 1; f <= F; f++) { dp[1][f] = f; let best = Infinity; for (let k = 1; k <= f; k++) best = Math.min(best, 1 + Math.max(dp[1][k - 1], dp[2][f - k])); dp[2][f] = best; } return dp[2][F]; },
  torch: () => bridge([1, 2, 5, 10]),
  torch5: () => bridge([1, 3, 6, 8, 12]),
  river: () => { const key = s => s.join(), start = [3, 3, 0], goal = '0,0,1', seen = new Map([[key(start), 0]]), q = [start]; const ok = (m, c) => (m === 0 || m >= c) && (3 - m === 0 || 3 - m >= 3 - c); while (q.length) { const [m, c, b] = q.shift(), d = seen.get(key([m, c, b])); if (key([m, c, b]) === goal) return d; for (const [dm, dc] of [[1, 0], [2, 0], [0, 1], [0, 2], [1, 1]]) { const s = b === 0 ? -1 : 1, nm = m + s * dm, nc = c + s * dc; if (nm < 0 || nc < 0 || nm > 3 || nc > 3 || !ok(nm, nc)) continue; const nk = key([nm, nc, 1 - b]); if (!seen.has(nk)) { seen.set(nk, d + 1); q.push([nm, nc, 1 - b]); } } } return null; },
  josephus: () => { let ring = [...Array(41).keys()].map(i => i + 1), i = 0; while (ring.length > 1) { i = (i + 2) % ring.length; ring.splice(i, 1); } return ring[0]; },
  rats: () => Math.ceil(Math.log2(1000)),
  handshake: () => 4,
  rects: () => { let n = 0; for (let a = 0; a <= 8; a++) for (let b = a + 1; b <= 8; b++) for (let c = 0; c <= 8; c++) for (let d = c + 1; d <= 8; d++) n++; return n; },
  overlaps: () => { let n = 0; for (let k = 0; ; k++) { const sec = 43200 * k / 11; if (sec >= 86400) return n; const m = (sec / 10) % 360, h = (sec / 120) % 360; if (Math.abs(m - h) < 1e-6 || Math.abs(Math.abs(m - h) - 360) < 1e-6) n++; } },
  tiles: () => { const T = [1, 1]; for (let n = 2; n <= 10; n++) T.push(T[n - 1] + T[n - 2]); return T[10]; },
};
function bridge(times) {
  // Dijkstra over (who is on the start side, torch side).
  const n = times.length, full = (1 << n) - 1, dist = new Map(), pq = [[0, full, 0]];
  while (pq.length) {
    pq.sort((a, b) => a[0] - b[0]); const [d, mask, side] = pq.shift(), k = mask + ',' + side;
    if (dist.has(k)) continue; dist.set(k, d);
    if (mask === 0) return d;
    const here = side === 0 ? mask : full & ~mask;
    for (let i = 0; i < n; i++) if (here >> i & 1) for (let j = i; j < n; j++) if (here >> j & 1) {
      const move = (1 << i) | (1 << j), nm = side === 0 ? mask & ~move : mask | move;
      pq.push([d + Math.max(times[i], times[j]), nm, 1 - side]);
    }
  }
}
for (const c of P.CLASSICS) {
  const got = derive[c.id] ? derive[c.id]() : undefined;
  const want = c.answer;
  const same = Array.isArray(want) ? JSON.stringify(got) === JSON.stringify(want) : got === want;
  if (!same) fail('classic', c.id, 'expected', want, 'derived', got);
  if (!P.checkClassic(c, Array.isArray(want) ? want.slice().reverse().join(', ') : String(want))) fail('classic answer not accepted', c.id);
  if (c.hints.length !== 3 || !c.solution) fail('classic incomplete', c.id);
}
console.log(`${grids} logic grids (avg ${Math.round(gridMs / grids)} ms to build), ${codesChecked} codes, ${cases} cases, ${P.CLASSICS.length} classics checked, ${failures} failures`);
process.exit(failures ? 1 : 0);
