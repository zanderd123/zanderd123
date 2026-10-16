// Small shared helpers. Nothing here touches the DOM, so the simulation can
// run headless under node for balance checks.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

export function pick(rand, list) {
  return list[Math.floor(rand() * list.length)];
}

export function money(v, digits = 1) {
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(digits)}T`;
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(digits)}M`;
  if (a >= 1e4) return `${sign}$${(a / 1e3).toFixed(digits)}k`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(digits)}k`;
  return `${sign}$${Math.round(a)}`;
}

// A rate given per minute, shown per second: the game's money runs by the second.
export function rate(perMin, signed = false) {
  const v = perMin / 60;
  const a = Math.abs(v);
  const zero = a < 0.05; // shows as 0.0: no sign
  const sign = zero ? '' : v < 0 ? '-' : signed ? '+' : '';
  const body = a >= 1000 ? money(a).slice(1) : a >= 100 ? Math.round(a).toString() : a.toFixed(1);
  return `${sign}$${body}/s`;
}

export function every(perMin) {
  if (perMin <= 0) return '—';
  return `every ${Math.round(60 / perMin)}s`;
}

export function num(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e4) return (v / 1e3).toFixed(1) + 'k';
  return Math.round(v).toLocaleString('en-US');
}

export function duration(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// Polyline helpers for anything that follows a path. A path's running
// lengths are worked out once and kept with it (paths are built, then
// only read), so finding a point along one is a quick search: aircraft
// look along their paths dozens of times a step.
const CUM = new WeakMap();
function cumOf(pts) {
  let c = CUM.get(pts);
  if (c && c.length === pts.length) return c;
  c = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) c[i] = c[i - 1] + dist(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
  CUM.set(pts, c);
  return c;
}
export function pathLength(pts) {
  return pts.length < 2 ? 0 : cumOf(pts)[pts.length - 1];
}

export function pointAlong(pts, d) {
  const n = pts.length;
  if (n < 2) { const p = pts[n - 1]; return { x: p.x, y: p.y, ang: 0 }; }
  const c = cumOf(pts);
  // the first segment that reaches d (or the last one)
  let lo = 1, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (d <= c[mid]) hi = mid; else lo = mid + 1; }
  const a = pts[lo - 1], b = pts[lo];
  const seg = c[lo] - c[lo - 1];
  const t = seg > 0 ? clamp((d - c[lo - 1]) / seg, 0, 1) : 1;
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), ang: Math.atan2(b.y - a.y, b.x - a.x) };
}

// Exponential moving average helper for "per minute" rates.
export function ema(prev, sample, dt, tau) {
  const k = 1 - Math.exp(-dt / tau);
  return prev + (sample - prev) * k;
}
