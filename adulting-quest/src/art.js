'use strict';
// Every sprite and tile is drawn procedurally into small offscreen canvases
// and cached. No image files: the whole game is one HTML file.

const T = {
  VOID: 0, GROUND: 1, PATH: 2, GRASS: 3, TREE: 4, WATER: 5, FLOWER: 6, ROCK: 7, FENCE: 8,
  BUILD: 9, DOOR: 10, SAND: 11, CROP: 12, SIGN: 13, LAMP: 14, DECO: 15, BRIDGE: 16,
  // interiors
  FLOOR: 20, WALL: 21, WWALL: 22, COUNTER: 23, SHELF: 24, BED: 25, BEDB: 26, TABLE: 27,
  PLANT: 28, RUG: 29, EXIT: 30, PEW: 31, ALTAR: 32, MACHINE: 33, BOOKS: 34, TV: 35,
  HBED: 36, STATUE: 37, MAT: 38, CHAIR: 39, BANNER: 40,
};
const SOLID = new Set([
  T.VOID, T.TREE, T.WATER, T.ROCK, T.FENCE, T.BUILD, T.CROP, T.SIGN, T.LAMP, T.DECO,
  T.WALL, T.WWALL, T.COUNTER, T.SHELF, T.BED, T.BEDB, T.TABLE, T.PLANT, T.PEW, T.ALTAR,
  T.MACHINE, T.BOOKS, T.TV, T.HBED, T.STATUE, T.CHAIR, T.BANNER,
]);

const BIO = {
  suburb: { ground: ['#7cc858', '#6cb848', '#8cd868'], path: ['#dcc494', '#ccb282'], grass: ['#3c9c3c', '#2a7a2a', '#64c060'],
    tree: 'round', canopy: ['#2a7a32', '#3e9a44', '#1c5a24'], trunk: '#7a5034', water: ['#4aa8e8', '#8ccaf4'],
    walls: ['#f4ecd8', '#e8dcc0'], roofs: ['#c8504a', '#4a7ac0', '#8a5aa8', '#e0a03a'], sky: ['#9cd4f8', '#e4f4ff'], field: '#7cc858' },
  desert: { ground: ['#ecd08c', '#e0c27a', '#f4dca0'], path: ['#cca46a', '#bc9458'], grass: ['#b8a040', '#8c7a28', '#d8c060'],
    tree: 'cactus', canopy: ['#3e9a4a', '#5ab860', '#2a7a34'], trunk: '#7a5034', water: ['#4aa8e8', '#8ccaf4'],
    walls: ['#e0b480', '#d0a070'], roofs: ['#b86a3a', '#a85a3a', '#c88a4a', '#9a5a3a'], flat: true, sky: ['#f8d890', '#fff4d8'], field: '#e8cc88' },
  beach: { ground: ['#f6e6b4', '#ecd8a0', '#fcf0cc'], path: ['#c8a072', '#b88e60'], grass: ['#7cbc4c', '#5a9a38', '#a4d86c'],
    tree: 'palm', canopy: ['#3eaa4a', '#5ac85a', '#2a8a3a'], trunk: '#a87a4a', water: ['#3aa8f0', '#8cd4fa'],
    walls: ['#f8f0e0', '#a8e0e8'], roofs: ['#e86a5a', '#3ab0c0', '#f0a040', '#5a8ae0'], sky: ['#7cd0f8', '#e0f8ff'], field: '#f4e2b0' },
  snow: { ground: ['#eef4fa', '#dce8f2', '#ffffff'], path: ['#b4c6d8', '#a4b6c8'], grass: ['#8cb8a8', '#6a9888', '#c4e4d8'],
    tree: 'pine', canopy: ['#2a5e4e', '#3a7a64', '#1a4a3a'], trunk: '#6a4a34', water: ['#7ab8e0', '#c4e4f8'],
    walls: ['#c8a07a', '#b8906a'], roofs: ['#8a3a3a', '#3a5a8a', '#5a3a6a', '#3a6a5a'], snowcap: true, sky: ['#c8dcf0', '#f4f8ff'], field: '#e4eef6' },
  forest: { ground: ['#4c9a3c', '#408a30', '#5aaa48'], path: ['#ac8c5c', '#9c7c4c'], grass: ['#2a6a28', '#1c5420', '#4a8a3a'],
    tree: 'pine', canopy: ['#1e5a2a', '#2e7a38', '#124a1e'], trunk: '#5a3a24', water: ['#3a98c8', '#7ac0e4'],
    walls: ['#a8784a', '#98683a'], roofs: ['#3a6a3a', '#7a3a2a', '#5a4a3a', '#2a4a5a'], logs: true, sky: ['#a4d4c0', '#e4f8ec'], field: '#4c9a3c' },
  swamp: { ground: ['#7a9a58', '#6a8a48', '#8aaa68'], path: ['#8c7c5c', '#7c6c4c'], grass: ['#4a6a38', '#384e28', '#6a8a50'],
    tree: 'dead', canopy: ['#5a5a3a', '#6a6a48', '#4a4a2a'], trunk: '#5a4a34', water: ['#4a7a68', '#7aa494'],
    walls: ['#8a7a5a', '#7a6a4a'], roofs: ['#4a5a3a', '#6a4a3a', '#3a4a4a', '#5a5a3a'], sky: ['#a8b898', '#e0e8d0'], field: '#7a9a58' },
  farm: { ground: ['#a8d474', '#98c464', '#b8e484'], path: ['#cca26a', '#bc925a'], grass: ['#e0c050', '#b89a30', '#f4dc78'],
    tree: 'round', canopy: ['#3a8a3a', '#5aaa48', '#2a6a2a'], trunk: '#7a5034', fruit: '#e8503a', water: ['#4aa8e8', '#8ccaf4'],
    walls: ['#c84a3a', '#f4ecd8'], roofs: ['#6a4a3a', '#8a8a8a', '#c84a3a', '#4a6a8a'], sky: ['#a4d8f8', '#f0f8ff'], field: '#a8d474' },
  city: { ground: ['#b4b4b8', '#a4a4a8', '#c4c4c8'], path: ['#5c6064', '#50545a'], grass: ['#86a050', '#6a8a3c', '#a4bc68'],
    tree: 'tower', canopy: ['#3a8a3a', '#5aaa48', '#2a6a2a'], trunk: '#6a4a34', water: ['#4a88c8', '#8cb8e4'],
    walls: ['#a8604a', '#8a8f9a'], roofs: ['#4a4f5a', '#3a3f4a', '#5a5f6a', '#6a5a5a'], flat: true, sky: ['#b8c8e0', '#e8eef8'], field: '#b4b4b8' },
};

const OUTLINE = '#1e1626';

const Art = {
  cache: new Map(),
  get(key, make) {
    let c = this.cache.get(key);
    if (!c) { c = make(); this.cache.set(key, c); }
    return c;
  },
};

// ---------------------------------------------------------------- primitives
function px(x, c, X, Y, w = 1, h = 1) { x.fillStyle = c; x.fillRect(Math.round(X), Math.round(Y), Math.round(w), Math.round(h)); }
function disc(x, cx, cy, rx, ry, c) {
  x.fillStyle = c;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let X = Math.floor(cx - rx); X <= Math.ceil(cx + rx); X++) {
      const dx = (X + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) x.fillRect(X, y, 1, 1);
    }
  }
}
// Darken every transparent pixel that touches an opaque one.
function outline(c, x, col = OUTLINE) {
  const w = c.width, h = c.height;
  const img = x.getImageData(0, 0, w, h), d = img.data;
  const a = (X, Y) => (X < 0 || Y < 0 || X >= w || Y >= h ? 0 : d[(Y * w + X) * 4 + 3]);
  const mark = [];
  for (let Y = 0; Y < h; Y++) for (let X = 0; X < w; X++) {
    if (a(X, Y) > 0) continue;
    if (a(X - 1, Y) > 128 || a(X + 1, Y) > 128 || a(X, Y - 1) > 128 || a(X, Y + 1) > 128) mark.push(X, Y);
  }
  x.fillStyle = col;
  for (let i = 0; i < mark.length; i += 2) x.fillRect(mark[i], mark[i + 1], 1, 1);
}

// ---------------------------------------------------------------- tiles
Art.tile = function (id, theme, v = 0, frame = 0) {
  const key = id + '|' + theme + '|' + v + '|' + (id === T.WATER ? frame : 0);
  return this.get(key, () => {
    const [c, x] = U.canvas(16, 16);
    if (id >= 20) drawInterior(x, id, theme, v);
    else drawOutdoor(x, id, BIO[theme] || BIO.suburb, theme, v, frame);
    return c;
  });
};

function ground(x, b, theme, v) {
  const g = b.ground;
  px(x, g[0], 0, 0, 16, 16);
  if (theme === 'city') {
    px(x, g[1], 0, 15, 16, 1); px(x, g[1], 15, 0, 1, 16);
    px(x, g[2], 0, 0, 16, 1); px(x, g[2], 0, 0, 1, 16);
    if (v % 4 === 0) px(x, g[1], 6, 7, 2, 1);
    return;
  }
  const r = U.rng(v * 977 + 13);
  for (let i = 0; i < 5; i++) {
    const X = Math.floor(r() * 15), Y = Math.floor(r() * 14);
    if (theme === 'suburb' || theme === 'forest' || theme === 'farm' || theme === 'swamp') {
      px(x, g[1], X, Y + 1, 1, 1); px(x, g[1], X + 1, Y, 1, 1); px(x, g[1], X + 2, Y + 1, 1, 1);
    } else {
      px(x, i % 2 ? g[1] : g[2], X, Y, 1, 1);
    }
  }
}

function drawOutdoor(x, id, b, theme, v, frame) {
  if (id === T.WATER) return water(x, b, frame, v);
  if (id === T.PATH || id === T.BRIDGE) {
    if (id === T.BRIDGE) {
      px(x, '#a8784a', 0, 0, 16, 16);
      for (let i = 0; i < 16; i += 4) px(x, '#7a5434', 0, i + 3, 16, 1);
      px(x, '#5a3a24', 0, 0, 1, 16); px(x, '#5a3a24', 15, 0, 1, 16);
      return;
    }
    px(x, b.path[0], 0, 0, 16, 16);
    const r = U.rng(v * 31 + 7);
    for (let i = 0; i < 4; i++) px(x, b.path[1], Math.floor(r() * 15), Math.floor(r() * 15), 2, 1);
    if (theme === 'beach') for (let i = 0; i < 16; i += 4) px(x, b.path[1], 0, i, 16, 1);
    return;
  }
  if (id === T.SAND) {
    px(x, '#f6e6b4', 0, 0, 16, 16);
    const r = U.rng(v * 17 + 3);
    for (let i = 0; i < 4; i++) px(x, '#e4d098', Math.floor(r() * 15), Math.floor(r() * 15), 1, 1);
    return;
  }
  if (id === T.CROP) {
    px(x, '#8a6a44', 0, 0, 16, 16);
    for (let i = 0; i < 16; i += 4) px(x, '#7a5a38', 0, i + 2, 16, 1);
    for (let s = 1; s < 16; s += 5) {
      px(x, '#3a8a2a', s, 1, 2, 14); px(x, '#5ab040', s - 1, 4, 1, 3); px(x, '#5ab040', s + 2, 7, 1, 3);
      px(x, '#f0d050', s + 2, 4, 2, 3);
    }
    return;
  }
  ground(x, b, theme, v);
  switch (id) {
    case T.GRASS: return tallGrass(x, b, theme);
    case T.TREE: return tree(x, b, theme, v);
    case T.FLOWER: return deco(x, theme, v);
    case T.ROCK: {
      const col = theme === 'desert' ? '#b8846a' : theme === 'snow' ? '#9aa8b8' : '#8a8a8e';
      const [rc, rx] = U.canvas(16, 16);
      disc(rx, 8, 9, 6.5, 5.5, col); disc(rx, 6, 7, 3, 2.5, U.shade(col, 0.3));
      if (theme === 'snow') px(rx, '#ffffff', 4, 4, 7, 2);
      outline(rc, rx); x.drawImage(rc, 0, 0);
      return;
    }
    case T.FENCE: {
      const w = theme === 'farm' ? '#f0e8d8' : '#b88a5a', d = U.shade(w, -0.35);
      px(x, w, 0, 5, 16, 2); px(x, w, 0, 10, 16, 2); px(x, d, 0, 7, 16, 1); px(x, d, 0, 12, 16, 1);
      px(x, w, 2, 2, 3, 13); px(x, w, 11, 2, 3, 13); px(x, d, 4, 2, 1, 13); px(x, d, 13, 2, 1, 13);
      if (theme === 'snow') { px(x, '#fff', 2, 1, 3, 2); px(x, '#fff', 11, 1, 3, 2); px(x, '#fff', 0, 4, 16, 1); }
      return;
    }
    case T.SIGN: {
      px(x, '#6a4a2a', 7, 9, 2, 7);
      px(x, OUTLINE, 1, 2, 14, 8); px(x, '#c89a5a', 2, 3, 12, 6); px(x, '#a87a3a', 2, 8, 12, 1);
      px(x, '#6a4a2a', 4, 5, 8, 1); px(x, '#6a4a2a', 4, 7, 5, 1);
      return;
    }
    case T.LAMP: {
      px(x, '#3a3f4a', 7, 4, 2, 11); px(x, '#3a3f4a', 5, 14, 6, 2);
      px(x, '#3a3f4a', 5, 1, 6, 4); px(x, '#f8e080', 6, 2, 4, 2);
      return;
    }
    case T.DECO: return solidDeco(x, theme, v);
  }
}

function water(x, b, frame, v) {
  const [a, l] = b.water;
  px(x, a, 0, 0, 16, 16);
  const o = (frame + v) % 4;
  for (let i = 0; i < 3; i++) {
    const Y = 3 + i * 5, X = (i * 6 + o * 2) % 16;
    px(x, l, X, Y, 4, 1); px(x, l, (X + 9) % 16, Y + 2, 3, 1);
  }
}

function tallGrass(x, b, theme) {
  const [m, d, l] = b.grass;
  px(x, m, 0, 0, 16, 16);
  const tufts = [[0, 1], [8, 1], [4, 9], [12, 9]];
  for (const [ox, oy] of tufts) {
    const hs = [4, 6, 5, 3];
    for (let k = 0; k < 4; k++) {
      const bx = ox + k * 2 - 1;
      if (bx < 0 || bx > 15) continue;
      px(x, d, bx, oy + 6 - hs[k], 1, hs[k]);
      px(x, theme === 'farm' ? '#fff0a0' : theme === 'snow' ? '#ffffff' : l, bx, oy + 6 - hs[k], 1, 1);
    }
    px(x, d, ox - 1, oy + 6, 8, 1);
  }
}

function tree(x, b, theme, v) {
  const kind = b.tree, [c0, c1, c2] = b.canopy;
  const [cv, cx] = [x.canvas, x];
  if (kind === 'tower') {
    const shades = ['#6a7484', '#7a6a6a', '#5a6a7a', '#8a8070'];
    const w = shades[v % 4];
    px(x, w, 0, 0, 16, 16);
    px(x, U.shade(w, 0.15), 0, 0, 16, 1);
    const r = U.rng(v * 7 + 1);
    for (let Y = 2; Y < 16; Y += 4) for (let X = 1; X < 16; X += 4) px(x, r() < 0.35 ? '#f8e08a' : '#3a4a5a', X, Y, 2, 2);
    return;
  }
  const [tc, tx] = U.canvas(16, 16);
  if (kind === 'round') {
    px(tx, b.trunk, 6, 11, 4, 5);
    disc(tx, 8, 7, 7, 6.5, c0); disc(tx, 7, 6, 5, 4.5, c1); disc(tx, 6, 4.5, 2, 1.5, U.shade(c1, 0.25));
    px(tx, c2, 3, 10, 10, 1);
    if (b.fruit) { px(tx, b.fruit, 4, 7, 2, 2); px(tx, b.fruit, 10, 5, 2, 2); px(tx, b.fruit, 8, 9, 2, 2); }
  } else if (kind === 'pine') {
    px(tx, b.trunk, 7, 13, 2, 3);
    const tiers = [[1, 5, 3], [4, 6, 5], [8, 6, 7]];
    for (const [y0, h, w] of tiers) {
      for (let i = 0; i < h; i++) {
        const hw = Math.round(1 + (w - 1) * (i / (h - 1)));
        px(tx, c0, 8 - hw, y0 + i, hw * 2, 1);
        px(tx, c1, 8 - hw, y0 + i, Math.max(1, hw - 1), 1);
      }
      if (b.snowcap) px(tx, '#ffffff', 6, y0, 4, 2);
    }
  } else if (kind === 'cactus') {
    px(tx, c0, 6, 2, 4, 14); px(tx, c1, 7, 2, 1, 13);
    px(tx, c0, 2, 6, 4, 3); px(tx, c0, 2, 3, 3, 4); px(tx, c1, 3, 3, 1, 4);
    px(tx, c0, 10, 8, 4, 3); px(tx, c0, 11, 5, 3, 4); px(tx, c1, 12, 5, 1, 4);
    px(tx, '#f8f0c0', 8, 5, 1, 1); px(tx, '#f8f0c0', 6, 10, 1, 1);
  } else if (kind === 'palm') {
    for (let i = 0; i < 11; i++) px(tx, i % 2 ? b.trunk : U.shade(b.trunk, -0.2), 7 + Math.round(Math.sin(i / 4)), 5 + i, 3, 1);
    const fr = [[-6, 2], [-4, 4], [5, 2], [4, 4], [-1, -2]];
    for (const [dx, dy] of fr) {
      const steps = 6;
      for (let s = 0; s <= steps; s++) px(tx, s > 3 ? c0 : c1, Math.round(8 + dx * s / steps), Math.round(5 + dy * s / steps), 2, 1);
    }
    disc(tx, 8, 5, 2.5, 2, c0);
    px(tx, '#7a4a2a', 6, 6, 2, 2); px(tx, '#7a4a2a', 9, 6, 2, 2);
  } else if (kind === 'dead') {
    px(tx, b.trunk, 7, 4, 3, 12); px(tx, b.trunk, 3, 5, 4, 1); px(tx, b.trunk, 3, 2, 1, 3);
    px(tx, b.trunk, 10, 7, 4, 1); px(tx, b.trunk, 13, 3, 1, 4); px(tx, b.trunk, 8, 1, 1, 3);
    disc(tx, 4, 3, 2.5, 1.5, '#7a8a4a'); disc(tx, 12, 4, 2.5, 1.5, '#6a7a3a');
    px(tx, '#8a9a5a', 2, 6, 1, 3); px(tx, '#8a9a5a', 12, 8, 1, 4);
  }
  outline(tc, tx);
  x.drawImage(tc, 0, 0);
}

function deco(x, theme, v) {
  const r = U.rng(v * 101 + 9);
  if (theme === 'desert') {
    px(x, '#b8946a', 3, 9, 3, 2); px(x, '#a88458', 10, 5, 2, 2); px(x, '#c8a47a', 8, 12, 2, 1);
    return;
  }
  if (theme === 'beach') {
    px(x, '#f08a6a', 4, 6, 1, 3); px(x, '#f08a6a', 3, 7, 3, 1);
    disc(x, 11, 11, 2, 1.5, '#f4d4c4'); px(x, '#d8a898', 10, 11, 3, 1);
    return;
  }
  if (theme === 'snow') {
    disc(x, 5, 10, 3, 2, '#ffffff'); disc(x, 11, 6, 2.5, 1.5, '#ffffff'); px(x, '#c8d8e8', 3, 11, 5, 1);
    return;
  }
  if (theme === 'swamp' || theme === 'forest') {
    for (let i = 0; i < 2; i++) {
      const X = 3 + i * 7, Y = 6 + (i * 4);
      px(x, '#f0e8d8', X + 1, Y + 2, 2, 3); disc(x, X + 2, Y + 1.5, 3, 2, i ? '#c8402a' : '#d8a040'); px(x, '#ffffff', X + 1, Y, 1, 1);
    }
    return;
  }
  if (theme === 'city') {
    disc(x, 8, 8, 5, 5, '#6a6e74'); disc(x, 8, 8, 4, 4, '#7a7e84'); px(x, '#5a5e64', 5, 7, 7, 1); px(x, '#5a5e64', 5, 9, 7, 1);
    return;
  }
  const cols = theme === 'farm' ? ['#f8f8f8', '#f0d040'] : ['#e84a4a', '#f8d040', '#f8f8f8', '#c868d8'];
  for (let i = 0; i < 3; i++) {
    const X = 2 + Math.floor(r() * 10), Y = 2 + Math.floor(r() * 10), c = cols[Math.floor(r() * cols.length)];
    px(x, c, X, Y - 1, 1, 1); px(x, c, X - 1, Y, 1, 1); px(x, c, X + 1, Y, 1, 1); px(x, c, X, Y + 1, 1, 1);
    px(x, '#f8e070', X, Y, 1, 1);
  }
}

function solidDeco(x, theme, v) {
  const [tc, tx] = U.canvas(16, 16);
  switch (theme) {
    case 'suburb': case 'forest':
      if (theme === 'forest') { px(tx, '#8a6a44', 3, 8, 10, 7); disc(tx, 8, 8, 5, 2, '#c8a074'); disc(tx, 8, 8, 3, 1, '#a8805a'); break; }
      disc(tx, 8, 9, 7, 6, '#2e8a3a'); disc(tx, 6, 7, 3, 2.5, '#4aaa4a'); px(tx, '#e84a6a', 10, 6, 2, 2); px(tx, '#e84a6a', 5, 11, 2, 2); break;
    case 'desert':
      disc(tx, 8, 10, 6, 5, '#4a9a4a'); for (let i = 3; i < 14; i += 3) px(tx, '#2a7a34', i, 6, 1, 9); px(tx, '#f05a8a', 7, 4, 3, 2); break;
    case 'beach':
      px(tx, '#e8e0d0', 7, 5, 2, 11);
      for (let i = 0; i < 7; i++) px(tx, i % 2 ? '#f4f4f4' : '#e84a3a', 1 + i * 2, 2 + Math.abs(3 - i) / 2, 2, 4 - Math.abs(3 - i) / 2);
      break;
    case 'snow':
      disc(tx, 8, 12, 5, 4, '#ffffff'); disc(tx, 8, 6, 3.5, 3.5, '#ffffff');
      px(tx, '#2a2a2a', 7, 5, 1, 1); px(tx, '#2a2a2a', 9, 5, 1, 1); px(tx, '#f08a2a', 8, 6, 2, 1);
      px(tx, '#c83a3a', 5, 9, 7, 1); break;
    case 'swamp':
      px(tx, '#6a5034', 1, 8, 14, 6); px(tx, '#8a6a44', 1, 8, 14, 1); disc(tx, 2, 11, 1.5, 3, '#a8885a'); px(tx, '#5a8a3a', 6, 7, 3, 1); break;
    case 'farm':
      px(tx, '#e0b850', 1, 5, 14, 10); px(tx, '#c89a30', 1, 8, 14, 1); px(tx, '#c89a30', 1, 12, 14, 1); px(tx, '#f0d070', 1, 5, 14, 1); break;
    case 'city':
      px(tx, '#d8302a', 5, 5, 6, 10); px(tx, '#d8302a', 3, 8, 10, 2); disc(tx, 8, 5, 3, 2, '#e84a3a'); px(tx, '#f8f8f8', 6, 10, 4, 1); break;
    default:
      disc(tx, 8, 9, 6, 5, '#888');
  }
  outline(tc, tx);
  x.drawImage(tc, 0, 0);
}

// ---------------------------------------------------------------- interiors
// Interior themes follow House Keeper's rooms: a dark wall top, a papered
// face with a trim line and baseboard, then the floor.
const THEMES = {
  house:    { floor: 'wood',    top: '#3a2a26', lip: '#5a443c', c1: '#dccaa0', c2: '#cfbb8e', trim: '#b08c58', base: '#6a4428' },
  store:    { floor: 'checker', top: '#1e2a40', lip: '#34466a', c1: '#a8cce8', c2: '#98bcdc', trim: '#e8f0f8', base: '#3a5a8a', tile: ['#ece6d6', '#7ab0d8'] },
  hospital: { floor: 'checker', top: '#3a2430', lip: '#5a3a48', c1: '#f8e0e4', c2: '#ecccd4', trim: '#f8f4f4', base: '#a84a5a', tile: ['#f4f4f4', '#d8e4ec'] },
  chapel:   { floor: 'stone',   top: '#26222e', lip: '#403a4c', c1: '#8a8296', c2: '#706a7c', trim: '#a49cb0', base: '#3e3848', brick: true },
  lab:      { floor: 'checker', top: '#1e3430', lip: '#34524a', c1: '#d8e8e0', c2: '#c4d8d0', trim: '#f4fbf8', base: '#3a6a5e', tile: ['#eef4f2', '#b8d8cc'] },
};
function themeOf(theme) {
  if (theme.startsWith('hall:')) {
    const c = theme.slice(5);
    return { floor: 'marble', top: U.shade(c, -0.72), lip: U.shade(c, -0.55), c1: U.shade(c, -0.1), c2: U.shade(c, -0.22), trim: '#d6a84a', base: U.shade(c, -0.6), hall: c };
  }
  return THEMES[theme] || THEMES.house;
}

function drawInterior(x, id, theme, v) {
  const th = themeOf(theme);
  const r = U.rng(v * 31 + 5);
  const floor = () => {
    if (th.floor === 'wood') {
      px(x, '#b5773f', 0, 0, 16, 16);
      for (let k = 0; k < 4; k++) { px(x, '#c4884e', 0, k * 4, 16, 1); px(x, '#8f5a2c', 0, k * 4 + 3, 16, 1); px(x, '#8f5a2c', Math.floor(r() * 15), k * 4, 1, 4); }
    } else if (th.floor === 'marble') {
      px(x, v % 2 ? '#e4dccb' : '#d2c6ae', 0, 0, 16, 16); px(x, '#bfb196', 0, 0, 16, 1); px(x, '#bfb196', 0, 0, 1, 16);
      px(x, v % 2 ? '#d4cab6' : '#c4b89e', Math.floor(r() * 14), Math.floor(r() * 14), 2, 1);
    } else if (th.floor === 'stone') {
      px(x, '#6e6e7c', 0, 0, 16, 16);
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
        const sx = i * 8, sy = j * 8;
        px(x, '#8e8e9c', sx, sy, 7, 7); px(x, '#a2a2b0', sx, sy, 7, 1); px(x, '#a2a2b0', sx, sy, 1, 7); px(x, '#7a7a88', sx + 1, sy + 6, 6, 1);
      }
    } else {
      const [a, b] = th.tile;
      px(x, a, 0, 0, 8, 8); px(x, a, 8, 8, 8, 8); px(x, b, 8, 0, 8, 8); px(x, b, 0, 8, 8, 8); px(x, U.shade(a, -0.1), 0, 0, 16, 1);
    }
  };
  if (id === T.WALL || id === T.WWALL || id === T.BANNER) {
    if (v === 0) {           // seen from above: the top of the wall
      px(x, th.top, 0, 0, 16, 16); px(x, th.lip, 0, 6, 4, 1); px(x, th.lip, 8, 6, 4, 1); px(x, th.lip, 0, 14, 16, 2);
      return;
    }
    if (th.brick) {
      px(x, th.c2, 0, 0, 16, 16);
      for (let rw = 0; rw < 4; rw++) { const o = (rw % 2) * 4; for (let i = -4; i < 16; i += 8) { const bx = Math.max(0, i + o), bw = Math.min(16, i + o + 7) - bx; if (bw > 0) px(x, th.c1, bx, rw * 4, bw, 3); } }
      px(x, th.base, 0, 14, 16, 2);
    } else {
      px(x, th.c1, 0, 0, 16, 16); for (let i = 0; i < 16; i += 4) px(x, th.c2, i, 0, 2, 16);
      px(x, th.trim, 0, 0, 16, 2); px(x, th.base, 0, 12, 16, 4); px(x, th.trim, 0, 12, 16, 1);
    }
    if (id === T.WWALL) {
      px(x, '#5a3a22', 2, 2, 12, 11); px(x, '#8ac8f0', 3, 3, 10, 9); px(x, '#a8daf8', 3, 3, 10, 3);
      px(x, '#5a3a22', 7, 3, 2, 9); px(x, '#5a3a22', 3, 7, 10, 1); px(x, '#e8f8ff', 4, 4, 1, 2);
    }
    if (id === T.BANNER) {
      const c = th.hall || '#a82838';
      px(x, c, 4, 1, 8, 11); px(x, '#d8b048', 4, 1, 8, 1); px(x, c, 5, 12, 2, 2); px(x, c, 9, 12, 2, 2); px(x, '#d8b048', 7, 4, 2, 4);
    }
    return;
  }
  floor();
  const [tc, tx] = U.canvas(16, 16);
  let ol = true;
  switch (id) {
    case T.RUG: ol = false; px(tx, '#b84a4a', 0, 0, 16, 16); px(tx, '#d8a040', 1, 1, 14, 1); px(tx, '#d8a040', 1, 14, 14, 1); px(tx, '#c85a5a', 3, 3, 10, 10); break;
    case T.MAT: ol = false; if (th.hall) { px(tx, th.hall, 2, 0, 12, 16); px(tx, U.shade(th.hall, 0.3), 4, 0, 1, 16); px(tx, U.shade(th.hall, 0.3), 11, 0, 1, 16); } break;
    case T.EXIT: ol = false; px(tx, '#8a3a2a', 2, 1, 12, 7); px(tx, '#a8503a', 3, 2, 10, 5); px(tx, 'rgba(0,0,0,.55)', 0, 10, 16, 6); break;
    case T.COUNTER: px(tx, '#a8784a', 0, 2, 16, 14); px(tx, '#d8a874', 0, 2, 16, 4); px(tx, '#8a5a34', 0, 10, 16, 1); break;
    case T.SHELF:
      px(tx, '#8a6a4a', 1, 0, 14, 16);
      for (let s = 0; s < 3; s++) {
        px(tx, '#6a4a2a', 1, 4 + s * 5, 14, 1);
        for (let k = 0; k < 4; k++) px(tx, ['#e84a4a', '#4a8ae8', '#f0c040', '#4ab84a', '#e88ad8'][(v + s * 2 + k) % 5], 2 + k * 3, 1 + s * 5, 2, 3);
      }
      break;
    case T.BOOKS:
      px(tx, '#6a4a2a', 1, 0, 14, 16);
      for (let s = 0; s < 3; s++) for (let k = 0; k < 6; k++) px(tx, ['#a83a3a', '#3a6aa8', '#3a8a4a', '#c8a03a'][(k + s) % 4], 2 + k * 2, 1 + s * 5, 2, 4);
      break;
    case T.BED: px(tx, '#8a5a3a', 1, 0, 14, 16); px(tx, '#f4f4f4', 2, 2, 12, 6); px(tx, '#4a7ac8', 2, 9, 12, 7); break;
    case T.BEDB: px(tx, '#8a5a3a', 1, 0, 14, 14); px(tx, '#4a7ac8', 2, 0, 12, 12); px(tx, '#3a6ab8', 2, 4, 12, 1); break;
    case T.HBED: px(tx, '#c8ccd4', 1, 1, 14, 15); px(tx, '#f8f8f8', 2, 2, 12, 5); px(tx, '#7ab8e8', 2, 8, 12, 7); break;
    case T.TABLE: px(tx, '#9a6a3a', 0, 3, 16, 10); px(tx, '#ba8a54', 0, 3, 16, 3); px(tx, '#7a4a2a', 1, 13, 2, 3); px(tx, '#7a4a2a', 13, 13, 2, 3); break;
    case T.PLANT: px(tx, '#c86a3a', 4, 10, 8, 6); disc(tx, 8, 6, 6, 5, '#3a9a3a'); disc(tx, 6, 4, 2, 2, '#5ac05a'); break;
    case T.TV: px(tx, '#5a3a24', 1, 9, 14, 7); px(tx, '#2a2a2e', 2, 1, 12, 9); px(tx, '#6ac8e8', 3, 2, 10, 7); px(tx, '#a8e8f8', 3, 2, 4, 2); break;
    case T.PEW: px(tx, '#8a5a34', 0, 2, 16, 4); px(tx, '#a8744a', 0, 7, 16, 5); px(tx, '#6a4024', 1, 12, 2, 4); px(tx, '#6a4024', 13, 12, 2, 4); break;
    case T.ALTAR: px(tx, '#8a5a34', 0, 4, 16, 12); px(tx, '#f8f4e8', 0, 4, 16, 6); px(tx, '#d8b850', 7, 4, 2, 10); px(tx, '#f8e080', 3, 0, 1, 4); px(tx, '#f8e080', 12, 0, 1, 4); break;
    case T.MACHINE: px(tx, '#a8b0bc', 1, 1, 14, 15); px(tx, '#3a4a5a', 3, 3, 10, 6); px(tx, '#6ae8a8', 4, 4, 3, 1); px(tx, '#6ae8a8', 4, 6, 6, 1); px(tx, '#e84a4a', 4, 11, 2, 2); px(tx, '#4ae84a', 8, 11, 2, 2); break;
    case T.STATUE: px(tx, '#8a8a94', 3, 9, 10, 7); px(tx, '#a8a8b4', 3, 9, 10, 2); disc(tx, 8, 5, 3.5, 3.5, '#e8c040'); px(tx, '#e8c040', 7, 7, 2, 3); px(tx, '#f8e8a0', 6, 3, 2, 2); break;
    case T.CHAIR: px(tx, '#5a8ac8', 2, 2, 12, 6); px(tx, '#4a7ab8', 2, 8, 12, 5); px(tx, '#3a3a3a', 3, 13, 2, 3); px(tx, '#3a3a3a', 11, 13, 2, 3); break;
    default: ol = false;
  }
  if (ol) outline(tc, tx);
  x.drawImage(tc, 0, 0);
}

// ---------------------------------------------------------------- characters
// 20x24 sprites built from outlined rectangles in layers (the House Keeper
// method): each layer gets a 1px outline, then detail pixels go on top.
const EYE = '#22182e';

function charStyle(pal, look) {
  const cf = {
    skin: pal.s, skinS: U.shade(pal.s, -0.18), hair: pal.h, hairS: U.shade(pal.h, -0.28), hairL: U.shade(pal.h, 0.35),
    shirt: pal.c, shirtS: U.shade(pal.c, -0.3), pants: pal.p, pantsS: U.shade(pal.p, -0.3), shoe: pal.b,
    style: pal.style || 'short',
  };
  if (pal.pack) { cf.pack = pal.pack; cf.packS = U.shade(pal.pack, -0.3); }
  if (look === 'cap') { cf.cap = '#c8402a'; cf.capS = '#8a2418'; }
  if (look === 'headband') { cf.band = '#e8302a'; cf.bandS = '#a01c18'; }
  if (look === 'glasses') cf.glasses = true;
  if (look === 'collar') cf.collar = true;
  if (pal.coat) cf.coat = pal.coat;
  if (pal.tie) cf.tie = pal.tie;
  return cf;
}

function buildChar(cf, dir, fr) {
  const [cv, C] = U.canvas(20, 24);
  const layers = [[]]; let cur = layers[0];
  const layer = () => { cur = []; layers.push(cur); };
  const R = (x, y, w, h, c) => cur.push([x + 2, y + 4, w, h, c]);
  const det = [];
  const D = (x, y, w, h, c) => det.push([x + 2, y + 4, w, h, c]);
  const lift = fr === 1 ? 1 : fr === 2 ? 2 : 0;

  if (dir === 'down' || dir === 'up') {
    const front = dir === 'down';
    if (cf.style === 'long' && front) { R(2, 4, 2, 10, cf.hair); R(12, 4, 2, 10, cf.hair); }
    layer();
    R(5, 16, 2, lift === 1 ? 2 : 3, cf.pants); R(9, 16, 2, lift === 2 ? 2 : 3, cf.pants);
    D(5, lift === 1 ? 17 : 18, 2, 1, cf.shoe); D(9, lift === 2 ? 17 : 18, 2, 1, cf.shoe);
    layer();
    const body = cf.coat || cf.shirt;
    R(4, 11, 8, 5, body);
    R(2, 11, 2, lift === 2 ? 3 : 4, body); R(12, 11, 2, lift === 1 ? 3 : 4, body);
    D(2, lift === 2 ? 13 : 14, 2, 1, cf.skin); D(12, lift === 1 ? 13 : 14, 2, 1, cf.skin);
    D(4, 15, 8, 1, cf.coat ? U.shade(cf.coat, -0.2) : cf.shirtS);
    if (front && cf.coat) { D(6, 11, 4, 4, cf.shirt); D(7, 11, 2, 4, cf.shirtS); }
    if (front && cf.tie) D(7, 11, 2, 4, cf.tie);
    if (front && cf.pack) { D(4, 11, 1, 4, cf.packS); D(11, 11, 1, 4, cf.packS); }
    if (front && cf.collar) D(7, 11, 2, 1, '#ffffff');
    layer();
    if (front) {
      R(3, 2, 10, 9, cf.skin);
      if (cf.style === 'short' || cf.style === 'bun') {
        R(3, 1, 10, 3, cf.hair); R(3, 4, 1, 3, cf.hair); R(12, 4, 1, 3, cf.hair); D(5, 1, 3, 1, cf.hairL);
        if (cf.style === 'bun') R(6, -1, 4, 3, cf.hair);
      } else if (cf.style === 'long') {
        R(3, 1, 10, 4, cf.hair); R(3, 4, 1, 5, cf.hair); R(12, 4, 1, 5, cf.hair);
        D(4, 5, 2, 1, cf.hair); D(7, 5, 1, 1, cf.hair); D(10, 5, 2, 1, cf.hair); D(5, 1, 4, 1, cf.hairL);
        D(4, 9, 1, 1, '#f0a0a0'); D(11, 9, 1, 1, '#f0a0a0');
      } else {
        R(2, 5, 2, 3, cf.hair); R(12, 5, 2, 3, cf.hair);
      }
      if (cf.cap) { R(3, 1, 10, 3, cf.cap); R(2, 3, 12, 2, cf.cap); D(2, 4, 12, 1, cf.capS); D(5, 1, 3, 1, U.shade(cf.cap, 0.3)); }
      if (cf.band) { R(3, 3, 10, 2, cf.band); R(13, 4, 2, 2, cf.band); D(3, 4, 10, 1, cf.bandS); }
      D(5, 7, 1, 2, EYE); D(10, 7, 1, 2, EYE);
      if (cf.glasses) { D(4, 6, 3, 3, '#30304a'); D(9, 6, 3, 3, '#30304a'); D(5, 7, 1, 1, '#cfe8ff'); D(10, 7, 1, 1, '#cfe8ff'); D(7, 7, 2, 1, '#30304a'); }
      D(7, 9, 2, 1, '#c0605a');
    } else {
      if (cf.style === 'long') {
        R(3, 1, 10, 4, cf.hair); R(2, 4, 12, 10, cf.hair); D(4, 2, 4, 1, cf.hairL); D(7, 4, 2, 9, cf.hairS);
      } else if (cf.style === 'bald') {
        R(3, 2, 10, 9, cf.skin); R(2, 5, 12, 3, cf.hair); D(6, 3, 3, 1, '#ffffff');
      } else {
        R(3, 2, 10, 9, cf.skin); R(3, 1, 10, 8, cf.hair); R(2, 6, 1, 2, cf.skin); R(13, 6, 1, 2, cf.skin);
        D(5, 2, 4, 1, cf.hairL);
        if (cf.style === 'bun') R(6, -1, 4, 3, cf.hair);
      }
      if (cf.cap) { R(3, 1, 10, 4, cf.cap); D(3, 4, 10, 1, cf.capS); }
      if (cf.band) { R(3, 3, 10, 2, cf.band); D(3, 4, 10, 1, cf.bandS); D(7, 5, 2, 2, cf.band); }
    }
    layer();
    if (!front && cf.pack) { R(4, 10, 8, 6, cf.pack); D(4, 10, 8, 2, cf.packS); D(7, 12, 2, 1, '#e0c060'); D(5, 14, 6, 1, cf.packS); }
  } else { // facing right
    if (cf.style === 'long') R(3, 4, 4, 10, cf.hair);
    if (cf.pack) { R(2, 11, 4, 5, cf.pack); D(2, 11, 4, 1, cf.packS); D(3, 13, 2, 1, '#e0c060'); }
    layer();
    if (lift) {
      R(4, 16, 2, 3, lift === 1 ? cf.pantsS : cf.pants); R(9, 16, 2, 3, lift === 1 ? cf.pants : cf.pantsS);
      D(4, 18, 2, 1, cf.shoe); D(9, 18, 3, 1, cf.shoe);
    } else { R(6, 16, 3, 3, cf.pants); D(6, 18, 4, 1, cf.shoe); }
    layer();
    const body = cf.coat || cf.shirt;
    R(5, 11, 6, 5, body); D(5, 15, 6, 1, cf.coat ? U.shade(cf.coat, -0.2) : cf.shirtS);
    if (cf.tie) D(10, 11, 1, 3, cf.tie);
    const ax = lift === 1 ? 9 : lift === 2 ? 5 : 7;
    layer();
    R(ax, 12, 2, 3, body); D(ax, 14, 2, 1, cf.skin);
    layer();
    R(4, 2, 9, 9, cf.skin);
    if (cf.style === 'short' || cf.style === 'bun') {
      R(4, 1, 8, 3, cf.hair); R(4, 4, 3, 5, cf.hair); D(7, 6, 1, 2, cf.skinS); D(5, 1, 3, 1, cf.hairL);
      if (cf.style === 'bun') R(3, 0, 3, 3, cf.hair);
    } else if (cf.style === 'long') {
      R(4, 1, 8, 4, cf.hair); R(3, 4, 4, 6, cf.hair); D(10, 4, 2, 1, cf.hair); D(5, 1, 4, 1, cf.hairL); D(11, 9, 1, 1, '#f0a0a0');
    } else {
      R(4, 5, 2, 4, cf.hair); D(6, 3, 3, 1, '#ffffff');
    }
    if (cf.cap) { R(4, 1, 8, 3, cf.cap); R(11, 3, 4, 1, cf.cap); D(4, 3, 8, 1, cf.capS); }
    if (cf.band) { R(4, 3, 9, 2, cf.band); R(1, 4, 3, 2, cf.band); D(4, 4, 9, 1, cf.bandS); }
    D(10, 7, 1, 2, EYE);
    if (cf.glasses) { D(9, 6, 3, 3, '#30304a'); D(10, 7, 1, 1, '#cfe8ff'); }
    D(11, 9, 1, 1, '#c0605a');
  }
  for (const L of layers) {
    C.fillStyle = OUTLINE; for (const [x, y, w, h] of L) C.fillRect(x - 1, y - 1, w + 2, h + 2);
    for (const [x, y, w, h, c] of L) { C.fillStyle = c; C.fillRect(x, y, w, h); }
  }
  for (const [x, y, w, h, c] of det) { C.fillStyle = c; C.fillRect(x, y, w, h); }
  return cv;
}

// Returns {down:[stand,stepA,stepB], up, left, right}; 20x24 canvases drawn
// at (tileX - 2, tileY - 8).
Art.character = function (pal, look) {
  const key = 'chr|' + JSON.stringify(pal) + '|' + look;
  return this.get(key, () => {
    const cf = charStyle(pal, look), out = {};
    for (const dir of ['down', 'up', 'right']) out[dir] = [0, 1, 2].map((f) => buildChar(cf, dir, f));
    out.left = out.right.map((src) => {
      const [c, x] = U.canvas(20, 24);
      x.translate(20, 0); x.scale(-1, 1); x.drawImage(src, 0, 0);
      return c;
    });
    return out;
  });
};
const WALKCYCLE = [1, 0, 2, 0];
function shadow(x, sx, sy) { x.fillStyle = 'rgba(20,10,30,.28)'; x.fillRect(sx + 4, sy + 13, 8, 3); x.fillRect(sx + 3, sy + 14, 10, 1); }

Art.cone = function () {
  return this.get('cone', () => {
    const [c, x] = U.canvas(16, 16);
    px(x, '#f07a2a', 6, 3, 4, 2); px(x, '#f07a2a', 5, 5, 6, 3); px(x, '#f8f8f8', 5, 8, 6, 2); px(x, '#f07a2a', 4, 10, 8, 3);
    px(x, '#2a2a2a', 2, 13, 12, 2);
    outline(c, x);
    return c;
  });
};

Art.bill = function (amt, frame) {
  return this.get('bill|' + amt + '|' + (frame % 2), () => {
    const [c, x] = U.canvas(16, 16);
    const g = amt >= 5 ? '#4aa85a' : '#7ac86a';
    px(x, g, 3, 6, 10, 6); px(x, U.shade(g, -0.3), 3, 11, 10, 1);
    disc(x, 8, 9, 2, 2, U.shade(g, 0.35));
    px(x, '#1a5a2a', amt >= 5 ? 7 : 8, 8, amt >= 5 ? 2 : 1, 3);
    outline(c, x);
    if (frame % 2) { px(x, '#ffffff', 12, 3, 1, 3); px(x, '#ffffff', 11, 4, 3, 1); }
    return c;
  });
};

// Table props in Dr. Street's lab.
Art.prop = function (kind) {
  return this.get('prop|' + kind, () => {
    const [c, x] = U.canvas(16, 16);
    drawIcon(x, kind);
    outline(c, x);
    return c;
  });
};

function drawIcon(x, kind) {
  switch (kind) {
    case 'diploma':
      px(x, '#f4ecd0', 2, 5, 12, 7); px(x, '#d8c8a0', 2, 11, 12, 1); px(x, '#c83a3a', 7, 4, 2, 9); px(x, '#e8c040', 6, 12, 4, 2); break;
    case 'wrench':
      for (let i = 0; i < 8; i++) px(x, i < 2 ? '#7a8490' : '#9aa4b0', 2 + i, 12 - i, 3, 3);
      disc(x, 11.5, 4.5, 4, 4, '#9aa4b0'); disc(x, 10.5, 5, 1.5, 1.5, '#c4ccd4');
      x.clearRect(12, 0, 4, 4); x.clearRect(11, 2, 2, 2);
      break;
    case 'badge':
      px(x, '#4a7ac8', 6, 2, 4, 3); px(x, '#f4f4f4', 3, 5, 10, 9); px(x, '#3a6ab8', 3, 5, 10, 3); px(x, '#5a5a5a', 5, 10, 6, 1); px(x, '#5a5a5a', 5, 12, 4, 1); break;
    case 'bolt':
      px(x, '#f0c030', 8, 1, 4, 2); px(x, '#f0c030', 6, 3, 4, 3); px(x, '#f0c030', 4, 6, 8, 2); px(x, '#f0c030', 7, 8, 3, 3); px(x, '#f0c030', 5, 11, 3, 3); break;
    case 'heart': case 'heart2':
      disc(x, 5.5, 6, 3.5, 3, kind === 'heart' ? '#e84a3a' : '#f06aa8'); disc(x, 10.5, 6, 3.5, 3, kind === 'heart' ? '#e84a3a' : '#f06aa8');
      for (let i = 0; i < 6; i++) px(x, kind === 'heart' ? '#e84a3a' : '#f06aa8', 2 + i, 7 + i, 12 - i * 2, 1);
      break;
    case 'doc':
      px(x, '#f8f8f8', 3, 1, 10, 14); px(x, '#5a8ac8', 3, 1, 10, 3); for (let i = 6; i < 14; i += 2) px(x, '#a8b0bc', 5, i, 6, 1); px(x, '#4ab84a', 9, 10, 3, 3); break;
    case 'coin':
      disc(x, 8, 8, 6, 6, '#e8c040'); disc(x, 8, 8, 4, 4, '#f8d860'); px(x, '#b8902a', 7, 5, 2, 6); break;
    case 'cap':
      px(x, '#2a2a3a', 1, 5, 14, 3); px(x, '#2a2a3a', 4, 8, 8, 4); px(x, '#e8c040', 12, 7, 1, 5); px(x, '#e8c040', 11, 11, 3, 2); break;
    case 'case':
      px(x, '#7a4a2a', 2, 5, 12, 9); px(x, '#5a3a1a', 6, 3, 4, 2); px(x, '#e8c040', 7, 8, 2, 2); px(x, '#5a3a1a', 2, 8, 12, 1); break;
    case 'house':
      for (let i = 0; i < 6; i++) px(x, '#c84a3a', 7 - i, 1 + i, 2 + i * 2, 1);
      px(x, '#f4ecd8', 3, 7, 10, 7); px(x, '#7a4a2a', 7, 10, 3, 4); break;
  }
}

Art.icon = function (kind, scale = 3) {
  return this.get('icon|' + kind + '|' + scale, () => {
    const [c, x] = U.canvas(16, 16);
    drawIcon(x, kind);
    outline(c, x);
    const [o, ox] = U.canvas(16 * scale, 16 * scale);
    ox.drawImage(c, 0, 0, 16 * scale, 16 * scale);
    return o;
  });
};
Art.iconURL = function (kind, scale = 3) { return this.icon(kind, scale).toDataURL(); };

// ---------------------------------------------------------------- buildings
// kind: house | hospital | store | chapel | hall | lab | apartment
Art.building = function (bd, theme) {
  const key = 'bld|' + bd.kind + '|' + theme + '|' + bd.w + 'x' + bd.h + '|' + (bd.roof || '') + '|' + (bd.locked ? 1 : 0) + '|' + (bd.color || '') + '|' + bd.doorX;
  return this.get(key, () => {
    const W = bd.w * 16, H = bd.h * 16;
    const [c, x] = U.canvas(W, H);
    const b = BIO[theme];
    let wall = b.walls[0], roof = bd.roof || b.roofs[0];
    if (bd.kind === 'hospital') { wall = '#f8f4f0'; roof = '#d8403a'; }
    if (bd.kind === 'store') { wall = '#f0f4f8'; roof = '#3a78d0'; }
    if (bd.kind === 'chapel') { wall = theme === 'desert' ? '#e8c890' : '#f4f0e4'; roof = '#7a5a8a'; }
    if (bd.kind === 'lab') { wall = '#f4f8f4'; roof = '#5a8a7a'; }
    if (bd.kind === 'hall') { wall = U.shade(bd.color, 0.55); roof = bd.color; }
    if (bd.kind === 'house' && theme === 'farm') wall = b.walls[0];
    const flat = b.flat && bd.kind !== 'chapel';
    const wallD = U.shade(wall, -0.18), roofD = U.shade(roof, -0.3), roofL = U.shade(roof, 0.2);

    const roofH = bd.kind === 'chapel' ? Math.floor(H * 0.5) : Math.floor(H * (flat ? 0.3 : 0.5));
    const wallTop = roofH;
    // walls
    px(x, wall, 1, wallTop, W - 2, H - wallTop);
    if (b.logs && bd.kind === 'house') for (let y = wallTop + 3; y < H; y += 4) px(x, wallD, 1, y, W - 2, 1);
    if (theme === 'city' && bd.kind === 'house') for (let y = wallTop + 2; y < H; y += 3) for (let X = 1 + ((y / 3) % 2) * 3; X < W - 2; X += 6) px(x, wallD, X, y, 4, 1);
    px(x, wallD, 1, H - 3, W - 2, 3);
    // roof
    if (flat) {
      px(x, roof, 0, 2, W, roofH - 2); px(x, roofL, 0, 2, W, 2); px(x, roofD, 0, roofH - 2, W, 2);
    } else {
      px(x, roof, 0, 4, W, roofH - 4);
      for (let y = 6; y < roofH - 2; y += 4) px(x, roofD, 0, y, W, 1);
      for (let y = 4; y < roofH - 2; y += 4) for (let X = (y % 8 ? 0 : 4); X < W; X += 8) px(x, roofD, X, y, 1, 3);
      px(x, roofL, 0, 4, W, 2); px(x, roofD, 0, roofH - 2, W, 2);
      if (b.snowcap) { px(x, '#ffffff', 0, 2, W, 4); for (let X = 2; X < W; X += 5) px(x, '#ffffff', X, 6, 2, 2); }
    }
    // windows
    const doorPx = bd.doorX * 16;
    const winY = wallTop + Math.max(3, Math.floor((H - wallTop) * 0.25));
    for (let X = 6; X < W - 12; X += 16) {
      if (Math.abs(X + 5 - (doorPx + 8)) < 14) continue;
      px(x, OUTLINE, X, winY, 11, 9); px(x, '#a8d8f8', X + 1, winY + 1, 9, 7); px(x, '#e0f4ff', X + 1, winY + 1, 3, 3);
      px(x, OUTLINE, X + 5, winY + 1, 1, 7);
      if (theme === 'snow' || bd.kind === 'house') px(x, U.shade(roof, -0.1), X - 1, winY + 8, 13, 2);
    }
    // door
    const dTop = H - 15;
    px(x, OUTLINE, doorPx + 2, dTop - 1, 12, 16);
    if (bd.kind === 'hospital' || bd.kind === 'store' || bd.kind === 'lab') {
      px(x, '#9ad0f0', doorPx + 3, dTop, 10, 15); px(x, '#c8e8fa', doorPx + 3, dTop, 4, 15); px(x, OUTLINE, doorPx + 8, dTop, 1, 15);
    } else {
      px(x, '#8a5434', doorPx + 3, dTop, 10, 15); px(x, '#6a3a24', doorPx + 3, dTop + 7, 10, 1); px(x, '#e8c040', doorPx + 10, dTop + 8, 2, 2);
    }
    if (bd.locked) {
      px(x, '#c8a06a', doorPx + 1, dTop + 3, 14, 3); px(x, '#c8a06a', doorPx + 1, dTop + 9, 14, 3);
      px(x, '#8a6a3a', doorPx + 1, dTop + 5, 14, 1); px(x, '#8a6a3a', doorPx + 1, dTop + 11, 14, 1);
    }
    // signs & features
    const signY = wallTop - (flat ? 2 : 6);
    if (bd.kind === 'hospital') {
      const sx = doorPx + 1;
      px(x, OUTLINE, sx, signY - 1, 14, 12); px(x, '#ffffff', sx + 1, signY, 12, 10);
      px(x, '#e8302a', sx + 5, signY + 1, 4, 8); px(x, '#e8302a', sx + 3, signY + 3, 8, 4);
    } else if (bd.kind === 'store') {
      const sx = doorPx - 4;
      px(x, OUTLINE, sx, signY - 1, 24, 11); px(x, '#f8d040', sx + 1, signY, 22, 9);
      // "$" glyph
      const g = ['.ooo.', 'o.o..', '.ooo.', '..o.o', '.ooo.'];
      g.forEach((r, yy) => { for (let i = 0; i < 5; i++) if (r[i] === 'o') px(x, '#2a7a3a', sx + 9 + i, signY + 2 + yy, 1, 1); });
      px(x, '#2a7a3a', sx + 11, signY + 1, 1, 7);
    } else if (bd.kind === 'chapel') {
      const sx = Math.floor(W / 2) - 6;
      px(x, wall, sx, 0, 12, roofH); px(x, OUTLINE, sx - 1, 0, 1, roofH); px(x, OUTLINE, sx + 12, 0, 1, roofH);
      px(x, roofD, sx - 2, 0, 16, 3);
      px(x, '#3a2a2a', sx + 3, 6, 6, 8); disc(x, sx + 6, 11, 2.5, 2.5, '#e8c040'); px(x, '#a8802a', sx + 5, 13, 2, 1);
      // round window over door
      disc(x, doorPx + 8, wallTop + 4, 3, 3, '#e8a0c8'); disc(x, doorPx + 8, wallTop + 4, 1.5, 1.5, '#a8d8f8');
    } else if (bd.kind === 'hall') {
      const sx = doorPx - 4;
      px(x, OUTLINE, sx, signY - 4, 24, 14); px(x, '#f8f0d8', sx + 1, signY - 3, 22, 12);
      const star = ['...o...', '..ooo..', 'ooooooo', '.ooooo.', '.oo.oo.', 'o.....o'];
      star.forEach((r, yy) => { for (let i = 0; i < 7; i++) if (r[i] === 'o') px(x, bd.locked ? '#9a9a9a' : '#e8b030', sx + 8 + i, signY - 1 + yy, 1, 1); });
      // pillars
      px(x, '#f4f4f4', doorPx - 10, wallTop + 2, 4, H - wallTop - 4); px(x, '#f4f4f4', doorPx + 22, wallTop + 2, 4, H - wallTop - 4);
      px(x, '#c8c8c8', doorPx - 7, wallTop + 2, 1, H - wallTop - 4); px(x, '#c8c8c8', doorPx + 25, wallTop + 2, 1, H - wallTop - 4);
    } else if (bd.kind === 'lab') {
      const sx = doorPx + 18;
      px(x, OUTLINE, sx, signY - 1, 13, 12); px(x, '#ffffff', sx + 1, signY, 11, 10);
      px(x, '#4aa88a', sx + 5, signY + 1, 3, 3); px(x, '#4aa88a', sx + 3, signY + 4, 7, 5); px(x, '#8ae8c8', sx + 4, signY + 6, 5, 2);
    }
    // outline the silhouette
    outline(c, x);
    return c;
  });
};

// ---------------------------------------------------------------- issues
// 48x48 "grumpy object" sprites.
Art.issue = function (id) {
  return this.get('issue|' + id, () => {
    const d = ISSUES[id];
    const [c, x] = U.canvas(48, 48);
    const col = d.col, dk = U.shade(col, -0.25), lt = U.shade(col, 0.35);
    let face = [24, 26], faceCol = null;
    switch (d.shape) {
      case 'paper':
        px(x, '#f8f6ee', 11, 6, 26, 38); px(x, col, 11, 6, 26, 6);
        for (let y = 32; y < 42; y += 3) px(x, '#b8bcc4', 14, y, 20, 1);
        x.clearRect(31, 6, 6, 6); px(x, '#d8d4c8', 31, 6, 1, 6); px(x, '#d8d4c8', 31, 11, 6, 1);
        face = [24, 22]; break;
      case 'envelope':
        px(x, col, 5, 13, 38, 26); px(x, dk, 5, 37, 38, 2);
        for (let i = 0; i < 19; i++) { px(x, dk, 5 + i, 13 + Math.floor(i * 0.6), 1, 1); px(x, dk, 42 - i, 13 + Math.floor(i * 0.6), 1, 1); }
        disc(x, 24, 26, 3, 3, '#c8302a'); face = [24, 31]; break;
      case 'bubble':
        disc(x, 24, 21, 20, 15, col); disc(x, 20, 15, 7, 4, lt);
        for (let i = 0; i < 8; i++) px(x, col, 9 + i, 33 + i, 8 - i, 1);
        face = [24, 22]; break;
      case 'stack':
        for (let i = 0; i < 4; i++) { disc(x, 24, 40 - i * 7, 18 - (i % 2) * 2, 5, i % 2 ? col : U.shade(col, -0.08)); disc(x, 24, 39 - i * 7, 12, 2.5, '#f8fafc'); }
        px(x, '#8a6a4a', 32, 6, 3, 14); px(x, '#c8c8c8', 30, 4, 7, 4);
        face = [24, 30]; break;
      case 'pile':
        disc(x, 24, 34, 21, 12, col); disc(x, 14, 26, 9, 8, '#e86a5a'); disc(x, 33, 24, 10, 9, '#f0d050'); disc(x, 24, 18, 9, 8, '#9a6ad0'); disc(x, 36, 36, 8, 6, '#4ab86a');
        px(x, '#f8f8f8', 6, 34, 4, 6); face = [24, 33]; faceCol = col; break;
      case 'card':
        px(x, col, 4, 12, 40, 26); px(x, '#1a1a1a', 4, 16, 40, 5); px(x, '#e8c040', 9, 24, 7, 5); px(x, lt, 4, 12, 40, 2);
        face = [30, 29]; break;
      case 'blob': case 'ghost':
        disc(x, 24, 26, 18, 18, col); disc(x, 18, 18, 6, 5, lt);
        if (d.shape === 'ghost') { x.clearRect(6, 38, 36, 10); for (let i = 0; i < 6; i++) disc(x, 9 + i * 6, 38, 3, 4, col); }
        else disc(x, 24, 40, 18, 5, col);
        face = [24, 26]; break;
      case 'phone':
        px(x, col, 13, 3, 22, 42); px(x, '#a8d8f8', 15, 7, 18, 32); px(x, '#5a5a5a', 21, 41, 6, 2);
        face = [24, 22]; break;
      case 'box':
        px(x, col, 6, 18, 28, 26); px(x, lt, 6, 12, 28, 6); for (let i = 0; i < 6; i++) px(x, lt, 34 + i, 12 + i, 1, 1);
        px(x, dk, 34, 18, 8, 26); for (let i = 0; i < 6; i++) px(x, dk, 34 + i, 12 + i, 8 - i, 6);
        px(x, '#f8f8f8', 12, 13, 16, 2);
        face = [20, 31]; break;
      case 'shoebox':
        px(x, col, 4, 22, 36, 22); px(x, dk, 4, 22, 36, 3); px(x, U.shade(col, 0.2), 2, 18, 40, 5);
        for (let i = 0; i < 5; i++) px(x, '#f8f8f0', 8 + i * 7, 6 + (i % 2) * 4, 5, 13);
        face = [22, 33]; break;
      case 'cloud':
        disc(x, 16, 26, 12, 10, col); disc(x, 30, 22, 14, 12, col); disc(x, 24, 30, 16, 10, col); disc(x, 24, 16, 9, 7, lt);
        if (id === 'allergies') for (let i = 0; i < 8; i++) px(x, '#f8a020', U.rand(6, 42), U.rand(36, 46), 2, 2);
        face = [24, 26]; break;
      case 'house':
        px(x, col, 9, 22, 30, 22);
        for (let i = 0; i < 14; i++) px(x, '#7a3a2a', 24 - i * 1.4 - 4, 8 + i, 8 + i * 2.8, 1);
        px(x, '#5a3a2a', 21, 36, 7, 8); face = [24, 29]; break;
      case 'tooth':
        disc(x, 24, 18, 17, 14, col); px(x, col, 9, 18, 30, 14); px(x, col, 10, 30, 10, 14); px(x, col, 28, 30, 10, 14);
        x.clearRect(20, 34, 8, 14); disc(x, 17, 12, 5, 3, '#ffffff'); face = [24, 21]; break;
      case 'router':
        px(x, col, 6, 26, 36, 16); px(x, U.shade(col, 0.2), 6, 26, 36, 3);
        px(x, col, 10, 6, 3, 20); px(x, col, 35, 6, 3, 20);
        for (let i = 0; i < 4; i++) px(x, i === 3 ? '#e84a3a' : '#5ae87a', 12 + i * 6, 38, 3, 2);
        face = [24, 32]; faceCol = '#ffffff'; break;
      case 'clipboard':
        px(x, '#9a6a3a', 7, 6, 32, 40); px(x, '#f8f8f0', 10, 11, 26, 32); px(x, '#a8a8b0', 17, 3, 12, 7);
        for (let y = 33; y < 42; y += 3) px(x, '#b8bcc4', 13, y, 20, 1);
        px(x, col, 10, 11, 26, 4); face = [23, 24]; break;
      case 'calendar':
        px(x, '#f8f8f4', 6, 10, 36, 34); px(x, col, 6, 10, 36, 9);
        for (let i = 0; i < 4; i++) px(x, '#3a3a3a', 11 + i * 8, 6, 2, 7);
        for (let r = 0; r < 2; r++) for (let k = 0; k < 5; k++) px(x, '#c8c8d0', 9 + k * 7, 34 + r * 5, 4, 3);
        face = [24, 26]; break;
      case 'light':
        disc(x, 24, 24, 20, 20, '#2a2a2e'); disc(x, 24, 24, 16, 16, col); disc(x, 24, 24, 12, 12, U.shade(col, 0.3));
        face = [24, 26]; break;
      case 'tire':
        disc(x, 24, 26, 21, 20, '#2a2a2e'); for (let a = 0; a < 16; a++) { const r = 19; px(x, '#4a4a50', Math.round(24 + Math.cos(a / 16 * 6.28) * r) - 1, Math.round(26 + Math.sin(a / 16 * 6.28) * r) - 1, 3, 3); }
        disc(x, 24, 26, 12, 12, '#a8b0bc'); disc(x, 24, 26, 10, 10, '#c4ccd4');
        x.clearRect(0, 44, 48, 4); px(x, '#2a2a2e', 8, 42, 32, 4);
        face = [24, 26]; break;
      case 'gear':
        for (let a = 0; a < 10; a++) { const ang = a / 10 * 6.283; px(x, col, Math.round(24 + Math.cos(ang) * 19) - 3, Math.round(25 + Math.sin(ang) * 19) - 3, 7, 7); }
        disc(x, 24, 25, 18, 18, col); disc(x, 24, 25, 14, 14, lt); disc(x, 20, 19, 4, 3, U.shade(col, 0.55));
        face = [24, 26]; break;
      case 'kettlebell':
        disc(x, 24, 31, 17, 15, col); px(x, col, 14, 8, 4, 16); px(x, col, 30, 8, 4, 16); px(x, col, 14, 6, 20, 5);
        x.clearRect(18, 11, 12, 9); disc(x, 18, 26, 4, 3, lt);
        px(x, '#e8e8e8', 19, 37, 10, 4); face = [24, 29]; break;
      case 'cup':
        for (let y = 10; y < 46; y++) { const w = 26 - Math.floor((y - 10) / 6); px(x, col, 24 - w / 2, y, w, 1); }
        px(x, '#f8f8f8', 10, 8, 28, 4); px(x, '#e84a8a', 28, 0, 3, 12); px(x, lt, 14, 14, 3, 20);
        face = [24, 28]; break;
    }
    outline(c, x);
    drawFace(x, face[0], face[1], faceCol || '#1a1a20');
    if (d.shades) { px(x, '#1a1a1a', face[0] - 10, face[1] - 6, 20, 4); px(x, '#3a3a4a', face[0] - 9, face[1] - 5, 3, 1); }
    if (d.magnifier) {
      disc(x, 38, 34, 7, 7, '#5a5a62'); disc(x, 38, 34, 5, 5, '#c8e8f8'); disc(x, 36, 32, 2, 2, '#ffffff');
      for (let i = 0; i < 6; i++) px(x, '#7a5a3a', 42 + i * 0.6, 39 + i, 3, 2);
    }
    return c;
  });
};

function drawFace(x, cx, cy, ink) {
  // furious little brows, eyes, grimace
  px(x, ink, cx - 9, cy - 6, 3, 1); px(x, ink, cx - 7, cy - 5, 3, 1); px(x, ink, cx - 5, cy - 4, 2, 1);
  px(x, ink, cx + 6, cy - 6, 3, 1); px(x, ink, cx + 4, cy - 5, 3, 1); px(x, ink, cx + 3, cy - 4, 2, 1);
  px(x, ink, cx - 7, cy - 3, 3, 4); px(x, ink, cx + 4, cy - 3, 3, 4);
  px(x, '#ffffff', cx - 7, cy - 3, 1, 1); px(x, '#ffffff', cx + 4, cy - 3, 1, 1);
  px(x, ink, cx - 4, cy + 4, 8, 3); px(x, '#ffffff', cx - 3, cy + 5, 6, 1);
  px(x, ink, cx - 1, cy + 4, 1, 3); px(x, ink, cx + 1, cy + 4, 1, 3);
}

// Big portrait used in battles and cutscenes: a character scaled 4x.
Art.portrait = function (pal, look, dir = 'down') {
  return this.get('portrait|' + JSON.stringify(pal) + '|' + look + '|' + dir, () => {
    const src = Art.character(pal, look)[dir][0];
    const [c, x] = U.canvas(60, 72);
    x.drawImage(src, 0, 0, 60, 72);
    return c;
  });
};
