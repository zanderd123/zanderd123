'use strict';
// Small helpers shared by every other file. Everything in this game is plain
// browser globals loaded in order (see build.mjs), so this file comes first.

const U = {
  clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
  lerp: (a, b, t) => a + (b - a) * t,

  // xorshift32: deterministic, so the world is identical on every load.
  rng(seed) {
    let s = (seed >>> 0) || 0x9e3779b9;
    return () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  },
  ri: (r, a, b) => a + Math.floor(r() * (b - a + 1)),
  pick: (r, arr) => arr[Math.floor(r() * arr.length)],
  chance: (p) => Math.random() < p,
  rand: (a, b) => a + Math.floor(Math.random() * (b - a + 1)),

  hash(x, y, s = 0) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  },

  wait: (ms) => new Promise((r) => setTimeout(r, ms)),

  canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = false;
    return [c, x];
  },

  rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  },
  // amt > 0 mixes toward white, amt < 0 toward black.
  shade(hex, amt) {
    const [r, g, b] = U.rgb(hex);
    const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
    const f = (c) => Math.round(c + (t - c) * p).toString(16).padStart(2, '0');
    return '#' + f(r) + f(g) + f(b);
  },

  esc: (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  money: (n) => '$' + Math.floor(n).toLocaleString('en-US'),
};
