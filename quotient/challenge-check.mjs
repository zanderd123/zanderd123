/**
 * Checks every Challenge of the Day template against an independent method:
 * brute-force search, simulation, numerical integration or exact counting.
 * The formulas in quotient.html are never reused here.
 *
 *   node quotient/challenge-check.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'quotient.html'), 'utf8');
const ctx = {}; vm.createContext(ctx); ctx.window = ctx;
for (const id of ['engine', 'challenges']) vm.runInContext(html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`))[1], ctx);
const E = ctx.QEngine, C = ctx.QChallenges;
const g = 9.81;

// A small seeded generator for the Monte Carlo checks, so runs are repeatable.
const rand = E.rng(20261027).f;
function scanMax(f, lo, hi, n) { let bx = lo, by = -Infinity; for (let i = 0; i <= n; i++) { const x = lo + (hi - lo) * i / n, y = f(x); if (y > by) { by = y; bx = x; } } return bx; }
function bisect(f, lo, hi) { for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if ((f(m) > 0) === (f(lo) > 0)) lo = m; else hi = m; } return (lo + hi) / 2; }
function solveLinear(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let piv = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
    [A[i], A[piv]] = [A[piv], A[i]]; [b[i], b[piv]] = [b[piv], b[i]];
    for (let r = 0; r < n; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c < n; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
  }
  return b.map((v, i) => v / A[i][i]);
}

const V = {
  cliff: ({ h, v }) => scanMax(t => { const s = Math.sin(t); return v * Math.cos(t) * (v * s + Math.sqrt(v * v * s * s + 2 * g * h)) / g; }, 0, Math.PI / 2, 200000) * 180 / Math.PI,
  ladder: ({ L, x, u }) => { const dt = 1e-6, mid = X => [X / 2, Math.sqrt(L * L - X * X) / 2]; const [a, b] = mid(x), [c, d] = mid(x + u * dt); return Math.hypot(c - a, d - b) / dt; },
  river: ({ w, c, b }) => { let best = Infinity; for (let i = -89990; i <= 89990; i++) { const f = i / 1000 * Math.PI / 180, vx = c - b * Math.sin(f), vy = b * Math.cos(f); if (vy > 0) best = Math.min(best, w * vx / vy); } return best; },
  dome: ({ R, v0 }) => { const th = bisect(t => g * Math.cos(t) - (v0 * v0 + 2 * g * R * (1 - Math.cos(t))) / R, 0, Math.PI / 2); return R * Math.cos(th); },
  balls: ({ M, m, h }) => { const v = Math.sqrt(2 * g * h), vcm = (M * v + m * -v) / (M + m), out = 2 * vcm - (-v); return out * out / (2 * g); },
  'ladder-net': ({ R1, R2 }) => { let R = R1 + R2; for (let i = 0; i < 5000; i++) R = R1 + 1 / (1 / R2 + 1 / R); return R; },
  loop: ({ k, rad }) => bisect(h => 2 * g * (h - 2 * rad) / (1 + k) - g * rad, 2 * rad, 10 * rad),
  orbit: ({ M, R, Tsec }) => bisect(r => 6.674e-11 * M / (r * r) - (2 * Math.PI / Tsec) ** 2 * r, 1e5, 1e10) / 1000 - R,
  ice: ({ mw, Tw, mi, Ti }) => bisect(T => mi * 2.09 * (0 - Ti) + mi * 334 + mi * 4.18 * T - mw * 4.18 * (Tw - T), 0, Tw),
  lifeguard: ({ a, b, d, v1, v2 }) => scanMax(x => -(Math.hypot(a, x) / v1 + Math.hypot(b, d - x) / v2), 0, d, 400000),
  chain: ({ L, x0 }) => { let x = x0, v = 0; const dt = 1e-5, acc = X => g * X / L; while (x < L) { const k1 = [v, acc(x)], k2 = [v + k1[1] * dt / 2, acc(x + k1[0] * dt / 2)], k3 = [v + k2[1] * dt / 2, acc(x + k2[0] * dt / 2)], k4 = [v + k3[1] * dt, acc(x + k3[0] * dt)]; x += dt * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) / 6; v += dt * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) / 6; } return v; },
  spring: ({ m, h, k }) => { let y = -h, v = 0, maxY = 0; const dt = 2e-6; while (v >= 0 || y < 0) { const a = g - (y > 0 ? k * y / m : 0); v += a * dt; y += v * dt; if (y > maxY) maxY = y; if (v < 0 && y > 0) break; } return maxY * 100; },
  tank: ({ H, ratio }) => { let y = H, t = 0; const dt = 0.002; while (y > 1e-9) { y -= dt * Math.sqrt(2 * g * Math.max(y, 0)) / ratio; t += dt; } return t; },
  doors: ({ n, k }) => { let win = 0; const N = 200000; for (let i = 0; i < N; i++) { const car = Math.floor(rand() * n), pick = Math.floor(rand() * n); const others = [...Array(n).keys()].filter(d => d !== pick); const goats = others.filter(d => d !== car); for (let j = 0; j < k; j++) { const gi = Math.floor(rand() * goats.length); const opened = goats.splice(gi, 1)[0]; others.splice(others.indexOf(opened), 1); } if (others[Math.floor(rand() * others.length)] === car) win++; } return win / N * 100; },
  coupon: ({ n, m }) => { let tot = 0; const N = 40000; for (let i = 0; i < N; i++) { const seen = new Set(); let c = 0; while (seen.size < m) { seen.add(Math.floor(rand() * n)); c++; } tot += c; } return tot / N; },
  streak: ({ k, p }) => { const A = [], b = []; for (let i = 0; i < k; i++) { const row = new Array(k).fill(0); row[i] += 1; if (i + 1 < k) row[i + 1] -= p; row[0] -= 1 - p; A.push(row); b.push(1); } return solveLinear(A, b)[0]; },
  ruin: ({ a, N, p }) => { const A = [], b = []; for (let i = 0; i <= N; i++) { const row = new Array(N + 1).fill(0); if (i === 0) { row[0] = 1; b.push(0); } else if (i === N) { row[N] = 1; b.push(1); } else { row[i] = 1; row[i + 1] = -p; row[i - 1] = -(1 - p); b.push(0); } A.push(row); } return solveLinear(A, b)[a] * 100; },
  ballot: ({ a, b }) => { const W = Array.from({ length: a + 1 }, () => new Array(b + 1).fill(0)), T = Array.from({ length: a + 1 }, () => new Array(b + 1).fill(0)); W[0][0] = 1; T[0][0] = 1; for (let i = 0; i <= a; i++) for (let j = 0; j <= b; j++) { if (!i && !j) continue; const ok = i > j; T[i][j] = (i ? T[i - 1][j] : 0) + (j ? T[i][j - 1] : 0); W[i][j] = ok ? (i ? W[i - 1][j] : 0) + (j ? W[i][j - 1] : 0) : 0; } return W[a][b] / T[a][b] * 100; },
  goat: ({ R, f }) => { const area = r => { let s = 0; const n = 200000, x0 = Math.max(-R, R - r), x1 = R; for (let i = 0; i < n; i++) { const x = x0 + (x1 - x0) * (i + 0.5) / n, hf = Math.sqrt(Math.max(0, R * R - x * x)), hg = Math.sqrt(Math.max(0, r * r - (x - R) ** 2)); s += 2 * Math.min(hf, hg); } return s * (x1 - x0) / n; }; return bisect(r => area(r) - f * Math.PI * R * R, 0.01, 2 * R); },
  alley: ({ a, b, h }, ans) => { const x = Math.sqrt(a * a - ans * ans), y = Math.sqrt(b * b - ans * ans); return Math.abs(x * y / (x + y) - h) < 0.006 ? ans : NaN; },
  clock: ({ h, th }) => { const ang = m => { let d = Math.abs(30 * h - 5.5 * m) % 360; return d > 180 ? 360 - d : d; }; let prev = ang(0.00001) - th; for (let m = 0.00001; m < 60; m += 0.00005) { const cur = ang(m) - th; if (Math.abs(cur) < 3e-4 || (cur > 0) !== (prev > 0)) return m; prev = cur; } return NaN; },
  paths: ({ W, H, x1, y1, x2, y2 }) => { const D = Array.from({ length: W + 1 }, () => new Array(H + 1).fill(0)); for (let x = 0; x <= W; x++) for (let y = 0; y <= H; y++) { if ((x === x1 && y === y1) || (x === x2 && y === y2)) { D[x][y] = 0; continue; } D[x][y] = x === 0 && y === 0 ? 1 : (x ? D[x - 1][y] : 0) + (y ? D[x][y - 1] : 0); } return D[W][H]; },
  digits: ({ a, b }) => { const seq = [], seen = new Map(); let v = 1 % 100; for (let n = 0; ; n++) { if (n >= 2 && seen.has(v)) { const start = seen.get(v), len = n - start; return b < start ? seq[b] : seq[start + (b - start) % len]; } if (n >= 2) seen.set(v, n); seq.push(v); v = v * a % 100; } },
  escalator: ({ a, b, s2 }) => { const e = (b - a) / (a - b / s2); return a + e * a; },
};

let failures = 0, checked = 0;
const ids = C.T.map(t => t.id);
for (const id of ids) if (!V[id]) { failures++; console.log('FAIL no verifier for', id); }
for (const t of C.T) {
  const runs = ['doors', 'coupon', 'goat', 'tank', 'spring', 'river', 'cliff', 'lifeguard', 'chain'].includes(t.id) ? 6 : 30;
  for (let i = 0; i < runs; i++) {
    const c = t.gen(E.rng(E.hashStr(`verify:${t.id}:${i}`)));
    const v = V[t.id](c.p, c.answer);
    // Monte Carlo checks get a sampling allowance; everything else must land inside the answer tolerance.
    const mc = t.id === 'doors' ? 0.6 : t.id === 'coupon' ? 0.02 * c.answer : 0;
    const tol = c.tol.rel !== undefined ? c.tol.rel * Math.abs(c.answer) / 2 : c.tol.abs / 2 + 1e-6;
    const okTol = Math.abs(v - c.answer) <= Math.max(tol, mc);
    const bad = /undefined|NaN|Infinity|\[object/.test(c.text + c.steps.join(' ') + c.hint);
    if (!okTol || bad || !C.isRight(c, Number(c.answer.toFixed(c.dp)))) { failures++; if (failures < 20) console.log('FAIL', t.id, i, { answer: c.answer, check: v, bad }); }
    checked++;
  }
}
// The challenge never repeats over three years.
const keyAt = i => { const d = new Date(2026, 9, 24 + i); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const seen = new Set();
for (let i = 0; i < 1095; i++) {
  const c = C.forDay(i, keyAt, E);
  if (seen.has(c.text)) { failures++; console.log('FAIL challenge repeats on', keyAt(i), c.id); }
  seen.add(c.text);
}
// Typed answers are read the way people write them.
for (const [inp, want] of [['42', 42], ['3/4', 0.75], ['1,250 m', 1250], ['−3.5', -3.5], ['about 12.7 m/s', 12.7], ['48.2°', 48.2], ['1e3', 1000]]) {
  if (C.parse(inp) !== want) { failures++; console.log('FAIL parse', inp, C.parse(inp)); }
}
console.log(`${ids.length} challenge templates, ${checked} instances checked against independent methods, ${seen.size} distinct challenges over 3 years, ${failures} failures`);
process.exit(failures ? 1 : 0);
