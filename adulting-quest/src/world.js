'use strict';
// World generation. The overworld is built deterministically from data.js:
// eight towns on a 4x2 grid joined by routes in a loop, plus small interior
// maps for every enterable building.

const TW = 30, TH = 24, RH = 26, RV = 18, MARGIN = 4;
const WORLD_W = MARGIN * 2 + 4 * TW + 3 * RH;
const WORLD_H = MARGIN * 2 + 2 * TH + RV;

class GMap {
  constructor(id, w, h, theme = null) {
    this.id = id; this.w = w; this.h = h; this.theme = theme;
    this.t = new Uint8Array(w * h);
    this.bio = new Uint8Array(w * h);
    this.region = new Int8Array(w * h).fill(-1);
    this.npcs = [];
    this.buildings = [];
    this.doors = new Map();   // idx -> { to, x, y } or { locked: msg }
    this.signs = new Map();   // idx -> text
    this.acts = new Map();    // idx -> async fn (interactable tiles)
    this.props = new Map();   // idx -> prop kind drawn on top of a tile
    this.items = new Map();   // idx -> { amt } dollar bills
    this.exit = null;         // interiors: { map, x, y }
  }
  idx(x, y) { return y * this.w + x; }
  in(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(x, y) { return this.in(x, y) ? this.t[y * this.w + x] : T.VOID; }
  set(x, y, v) { if (this.in(x, y)) this.t[y * this.w + x] = v; }
  themeAt(x, y) { return this.theme || BIOME_IDS[this.bio[this.idx(x, y)]]; }
  regionAt(x, y) { return this.in(x, y) ? this.region[this.idx(x, y)] : -1; }
  solid(x, y) { return SOLID.has(this.get(x, y)); }
  npcAt(x, y) {
    return this.npcs.find((n) => !n.hidden && ((n.x === x && n.y === y) || (n.moving && n.tx === x && n.ty === y)));
  }
}

const World = {
  maps: {},
  regions: [],   // [{ name, kind:'town'|'route', town?, route?, biome }]
  townRect: [],
  routeInfo: [],
  gates: [],

  townOrigin(t) {
    const town = TOWNS[t];
    return [MARGIN + town.col * (TW + RH), MARGIN + town.row * (TH + RV)];
  },

  build() {
    const m = new GMap('world', WORLD_W, WORLD_H);
    this.maps.world = m;
    m.t.fill(T.TREE);

    // regions: towns 0-7, routes 8-15
    TOWNS.forEach((t, i) => this.regions.push({ name: t.name, kind: 'town', town: i, biome: t.biome }));
    ROUTES.forEach((r, i) => this.regions.push({ name: 'Route ' + (i + 1), kind: 'route', route: i }));

    // biome by nearest town, with a little jitter so borders are ragged
    const centres = TOWNS.map((t, i) => { const [x, y] = this.townOrigin(i); return [x + TW / 2, y + TH / 2]; });
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      let best = 0, bd = 1e9;
      centres.forEach(([cx, cy], i) => {
        const d = Math.hypot(x - cx, (y - cy) * 1.4) + (U.hash(x >> 1, y >> 1, i) % 4);
        if (d < bd) { bd = d; best = i; }
      });
      m.bio[m.idx(x, y)] = BIOME_IDS.indexOf(TOWNS[best].biome);
      m.region[m.idx(x, y)] = best;
    }

    // which sides of each town open onto a route
    this.exits = TOWNS.map(() => ({}));
    ROUTES.forEach((r, i) => {
      const A = TOWNS[r.a], B = TOWNS[r.b];
      if (A.row === B.row) {
        const [l, rr] = A.col < B.col ? [r.a, r.b] : [r.b, r.a];
        this.exits[l].E = i; this.exits[rr].W = i;
      } else {
        const [top, bot] = A.row < B.row ? [r.a, r.b] : [r.b, r.a];
        this.exits[top].S = i; this.exits[bot].N = i;
      }
    });

    ROUTES.forEach((r, i) => this.carveRoute(m, i));
    TOWNS.forEach((t, i) => this.carveTown(m, i));
    this.placeGates(m);
    this.seedBills(m);
  },

  // ------------------------------------------------------------ routes
  carveRoute(m, ri) {
    const r = ROUTES[ri], A = TOWNS[r.a], B = TOWNS[r.b];
    const horiz = A.row === B.row;
    let x0, y0, len, span, entry, startTown;
    if (horiz) {
      const left = A.col < B.col ? r.a : r.b;
      const [tx, ty] = this.townOrigin(left);
      x0 = tx + TW; y0 = ty; len = RH; span = TH; entry = 10;
      startTown = r.a === left ? 'lo' : 'hi';
    } else {
      const top = A.row < B.row ? r.a : r.b;
      const [tx, ty] = this.townOrigin(top);
      x0 = tx; y0 = ty + TH; len = RV; span = TW; entry = 14;
      startTown = r.a === top ? 'lo' : 'hi';
    }
    const at = (u, v) => (horiz ? [x0 + u, y0 + v] : [x0 + v, y0 + u]);
    const rnd = U.rng(ri * 7919 + 17);
    const reg = 8 + ri;

    // ragged open band
    const lo = [], hi = [];
    for (let u = 0; u < len; u++) {
      lo[u] = 2 + Math.floor(rnd() * 3);
      hi[u] = span - 3 - Math.floor(rnd() * 3);
      for (let v = 0; v < span; v++) {
        const [x, y] = at(u, v);
        m.region[m.idx(x, y)] = reg;
        if (v >= lo[u] && v <= hi[u]) m.set(x, y, T.GROUND);
      }
    }
    // meandering two-wide path
    const pathV = [];
    let v = entry, target = entry, nextTurn = 4 + Math.floor(rnd() * 4);
    const mark = (u, vv) => { for (const dv of [0, 1]) { const [x, y] = at(u, vv + dv); m.set(x, y, T.PATH); } };
    for (let u = 0; u < len; u++) {
      if (u === nextTurn && u < len - 7) {
        target = U.clamp(entry + U.ri(rnd, -6, 6), 5, span - 7);
        nextTurn = u + 4 + Math.floor(rnd() * 5);
      }
      if (u >= len - 6) target = entry;
      while (v !== target) { mark(u, v); v += v < target ? 1 : -1; }
      mark(u, v);
      pathV[u] = v;
    }
    // tall grass blobs (some cross the path so you can't always avoid them)
    for (let k = 0; k < 8; k++) {
      const cu = U.ri(rnd, 4, len - 5), cv = U.ri(rnd, 4, span - 5);
      const ru = U.ri(rnd, 2, 5), rv = U.ri(rnd, 2, 4);
      for (let u = cu - ru; u <= cu + ru; u++) for (let vv = cv - rv; vv <= cv + rv; vv++) {
        if (u < 3 || u > len - 4) continue;
        const du = (u - cu) / ru, dv = (vv - cv) / rv;
        if (du * du + dv * dv > 1.05) continue;
        const [x, y] = at(u, vv);
        const t = m.get(x, y);
        if (t === T.GROUND || (t === T.PATH && k % 3 === 0)) m.set(x, y, T.GRASS);
      }
    }
    // obstacles and decoration away from the path
    const nearPath = (u, vv) => {
      for (let du = -1; du <= 1; du++) for (let dv = -1; dv <= 1; dv++) {
        const [x, y] = at(u + du, vv + dv);
        const t = m.get(x, y);
        if (t === T.PATH) return true;
      }
      return false;
    };
    for (let u = 1; u < len - 1; u++) for (let vv = 1; vv < span - 1; vv++) {
      const [x, y] = at(u, vv);
      if (m.get(x, y) !== T.GROUND || nearPath(u, vv)) continue;
      const p = rnd();
      if (p < 0.07) m.set(x, y, T.TREE);
      else if (p < 0.09) m.set(x, y, T.ROCK);
      else if (p < 0.16) m.set(x, y, T.FLOWER);
    }
    // route sign by the start
    const su = startTown === 'lo' ? 2 : len - 3;
    const [sx, sy] = at(su, pathV[su] - 1);
    if (m.get(sx, sy) === T.GROUND || m.get(sx, sy) === T.GRASS || m.get(sx, sy) === T.FLOWER) {
      m.set(sx, sy, T.SIGN);
      m.signs.set(m.idx(sx, sy), `ROUTE ${ri + 1}\n${TOWNS[r.a].name}  <->  ${TOWNS[r.b].name}`);
    }
    this.routeInfo[ri] = { at, len, span, pathV, startTown, horiz };
  },

  // ------------------------------------------------------------ towns
  carveTown(m, ti) {
    const town = TOWNS[ti];
    const [ox, oy] = this.townOrigin(ti);
    const biome = town.biome;
    const ex = this.exits[ti];
    const L = (x, y) => [ox + x, oy + y];
    const set = (x, y, t) => m.set(ox + x, oy + y, t);
    const get = (x, y) => m.get(ox + x, oy + y);
    const rnd = U.rng(ti * 104729 + 3);
    this.townRect[ti] = { x: ox, y: oy, w: TW, h: TH };

    for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
      const [X, Y] = L(x, y);
      m.region[m.idx(X, Y)] = ti;
      m.bio[m.idx(X, Y)] = BIOME_IDS.indexOf(biome);
      const border = x === 0 || y === 0 || x === TW - 1 || y === TH - 1;
      m.set(X, Y, border ? T.TREE : T.GROUND);
    }
    // roads
    for (let x = 1; x < TW - 1; x++) { set(x, 10, T.PATH); set(x, 11, T.PATH); }
    const vEnd = biome === 'beach' ? 21 : TH - 2;
    for (let y = 6; y <= vEnd; y++) { set(14, y, T.PATH); set(15, y, T.PATH); }
    for (let x = 2; x <= 27; x++) { set(x, 20, T.PATH); set(x, 21, T.PATH); }
    if (ex.W !== undefined) { set(0, 10, T.PATH); set(0, 11, T.PATH); }
    if (ex.E !== undefined) { set(TW - 1, 10, T.PATH); set(TW - 1, 11, T.PATH); }
    if (ex.N !== undefined) { for (let y = 0; y < 6; y++) { set(14, y, T.PATH); set(15, y, T.PATH); } }
    if (ex.S !== undefined) { set(14, TH - 1, T.PATH); set(15, TH - 1, T.PATH); }
    // a north exit runs straight through where the hall would be: shift the hall
    const hallX = ex.N !== undefined ? 17 : 11;
    if (ex.N !== undefined) { for (let y = 1; y < 6; y++) { set(14, y, T.PATH); set(15, y, T.PATH); } }

    const leaderKey = town.leader, leader = LEADERS[leaderKey];
    const B = [
      { kind: 'hall', x: hallX, y: 1, w: 7, h: 5, doorX: 3, color: leader.color, locked: !!leader.locked, leader: leaderKey },
      { kind: 'hospital', x: 2, y: 3, w: 5, h: 4, doorX: 2 },
      { kind: 'store', x: 21, y: 3, w: 4, h: 4, doorX: 1 },
      { kind: 'chapel', x: 2, y: 15, w: 5, h: 5, doorX: 2 },
      { kind: 'house', x: 9, y: 16, w: 4, h: 4, doorX: 2, slot: 0, roof: BIO[biome].roofs[0] },
      { kind: 'house', x: 17, y: 16, w: 4, h: 4, doorX: 1, slot: 1, roof: BIO[biome].roofs[1] },
    ];
    if (ti === 0) B.push({ kind: 'lab', x: 21, y: 14, w: 6, h: 4, doorX: 2 });
    else B.push({ kind: 'house', x: 23, y: 15, w: 4, h: 4, doorX: 1, slot: 2, roof: BIO[biome].roofs[2] });
    // with a north exit the hall sits right of the road, so the store moves over
    if (ex.N !== undefined) B[2].x = 24;

    for (const b of B) {
      const doorLX = b.x + b.doorX, doorLY = b.y + b.h - 1;
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) set(x, y, T.BUILD);
      set(doorLX, doorLY, T.DOOR);
      // walkway from the door to the nearest road
      for (let y = doorLY + 1; y < TH - 1; y++) {
        const t = get(doorLX, y);
        if (t === T.PATH) break;
        set(doorLX, y, T.PATH);
      }
      const [wx, wy] = L(b.x, b.y);
      const [dx, dy] = L(doorLX, doorLY);
      const bd = { ...b, x: wx, y: wy, town: ti, theme: biome };
      m.buildings.push(bd);
      if (b.kind === 'hall' && b.locked) {
        m.doors.set(m.idx(dx, dy), { locked: leader.closed });
      } else {
        const iid = Interiors.create(b, ti, dx, dy);
        m.doors.set(m.idx(dx, dy), { to: iid });
      }
    }
    // the hall door path goes up into a north exit road: make sure it reaches the main road
    if (ex.N !== undefined) {
      const dX = hallX + 3;
      for (let y = 6; y < 10; y++) set(dX, y, T.PATH);
    }

    // biome specials
    if (biome === 'beach') {
      for (let x = 0; x < TW; x++) { set(x, 22, T.WATER); set(x, 23, T.WATER); }
      for (let x = 1; x < TW - 1; x++) if (get(x, 21) !== T.PATH) set(x, 21, T.SAND);
    }
    if (biome === 'farm') {
      for (const [x0, y0, x1, y1] of [[7, 2, 10, 7], [26, 3, 28, 8]]) {
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (get(x, y) === T.GROUND) set(x, y, T.CROP);
      }
    }
    if (biome === 'swamp') {
      for (const [cx, cy] of [[8, 4], [25, 13], [9, 13]]) {
        for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 2; x <= cx + 2; x++) {
          if (get(x, y) === T.GROUND && !(Math.abs(x - cx) === 2 && Math.abs(y - cy) === 1)) set(x, y, T.WATER);
        }
      }
    }
    if (biome === 'city') {
      for (const [x, y] of [[8, 9], [20, 9], [8, 12], [21, 12], [5, 12], [26, 9]]) if (get(x, y) === T.GROUND) set(x, y, T.LAMP);
    }
    // scattered decoration, never next to a road or path
    const dens = {
      suburb: [0.03, 0.03, 0.14], desert: [0.05, 0.03, 0.08], beach: [0.05, 0.03, 0.1], snow: [0.06, 0.03, 0.1],
      forest: [0.12, 0.03, 0.08], swamp: [0.06, 0.03, 0.07], farm: [0.03, 0.04, 0.1], city: [0, 0.03, 0.05],
    }[biome];
    for (let y = 1; y < TH - 1; y++) for (let x = 1; x < TW - 1; x++) {
      if (get(x, y) !== T.GROUND) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
        const t = get(x + dx, y + dy);
        if (t === T.PATH || t === T.DOOR || t === T.SIGN) { near = true; break; }
      }
      if (near) continue;
      const p = rnd();
      if (p < dens[0]) set(x, y, T.TREE);
      else if (p < dens[0] + dens[1]) set(x, y, T.DECO);
      else if (p < dens[0] + dens[1] + dens[2]) set(x, y, T.FLOWER);
    }
    // town sign near the main road
    set(2, 9, T.SIGN);
    m.signs.set(m.idx(ox + 2, oy + 9), town.sign);

    // a recruitable ally waits in town
    for (const [id, A] of Object.entries(ALLIES)) {
      if (A.town !== ti || A.home) continue;
      let sx = 19, sy = 13;
      if (A.meet) { sx = 25; sy = 19; }   // by the lab door
      for (let tries = 0; tries < 30 && get(sx, sy) !== T.GROUND; tries++) { sx = 18 + (tries % 6); sy = 12 + Math.floor(tries / 6); }
      const n = makeNPC({ x: ox + sx, y: oy + sy });
      n.palObj = A.pal; n.look = A.look || null; n.ally = id;
      n.talk = () => Scripts.recruit(id, n);
      m.npcs.push(n);
    }
    // outdoor wanderers
    const folk = TOWNFOLK[ti].out;
    const spots = [[8, 12], [20, 8], [24, 12]];
    folk.forEach((f, i) => {
      let [sx, sy] = spots[i];
      for (let tries = 0; tries < 20 && SOLID.has(get(sx, sy)); tries++) { sx++; }
      const npc = makeNPC({ x: ox + sx, y: oy + sy, pal: f.pal, wander: f.busk ? 0 : 2, say: f.say });
      if (f.busk) npc.talk = () => Scripts.busker(npc, f);
      m.npcs.push(npc);
    });
  },

  // ------------------------------------------------------------ gates
  placeGates(m) {
    ROUTES.forEach((r, ri) => {
      if (!r.need && !r.gateFlag) return;
      const info = this.routeInfo[ri];
      let u = info.startTown === 'lo' ? 0 : info.len - 1;
      if (r.need >= 7) u = Math.floor(info.len / 2);
      const v = info.pathV[u];
      const [gx, gy] = info.at(u, v);
      const [cx, cy] = info.at(u, v + 1);
      const [ax, ay] = info.at(u, v - 1);
      const guard = makeNPC({ x: gx, y: gy, pal: r.gateFlag ? 'aide' : 'guard', dir: info.horiz ? (info.startTown === 'lo' ? 'left' : 'right') : 'up' });
      const cone = makeNPC({ x: cx, y: cy, kind: 'cone' });
      const gate = { ri, guard, cone, aside: [ax, ay], home: [gx, gy] };
      guard.talk = () => Scripts.gate(gate);
      cone.talk = guard.talk;
      m.npcs.push(guard, cone);
      this.gates.push(gate);
    });
  },

  refreshGates() {
    for (const n of this.maps.world.npcs) if (n.ally) n.hidden = Crew.has(n.ally) || (ALLIES[n.ally].meet && !Game.p.path);
    for (const g of this.gates) {
      const open = Game.gateOpen(g.ri);
      g.cone.hidden = open;
      if (open) { g.guard.x = g.aside[0]; g.guard.y = g.aside[1]; }
      else { g.guard.x = g.home[0]; g.guard.y = g.home[1]; }
      g.guard.moving = false;
    }
  },

  // ------------------------------------------------------------ money in the grass
  seedBills(m) {
    for (let ri = 0; ri < ROUTES.length; ri++) for (let k = 0; k < 5; k++) this.spawnBill(m, ri, null);
  },
  spawnBill(m, ri, avoid) {
    const info = this.routeInfo[ri];
    for (let tries = 0; tries < 60; tries++) {
      const u = U.rand(2, info.len - 3), v = U.rand(2, info.span - 3);
      const [x, y] = info.at(u, v);
      if (m.get(x, y) !== T.GRASS) continue;
      const i = m.idx(x, y);
      if (m.items.has(i)) continue;
      if (avoid && Math.abs(avoid.x - x) < 9 && Math.abs(avoid.y - y) < 7) continue;
      m.items.set(i, { amt: Math.random() < 0.22 ? 5 : 1 });
      return true;
    }
    return false;
  },
  billsInRoute(m, ri) {
    let n = 0;
    for (const i of m.items.keys()) if (m.region[i] === 8 + ri) n++;
    return n;
  },
};

// ------------------------------------------------------------ NPCs
let npcSeq = 0;
function makeNPC(o) {
  return {
    id: ++npcSeq, x: o.x, y: o.y, dir: o.dir || 'down', pal: o.pal || 'dude', look: o.look || null,
    kind: o.kind || 'person', name: o.name || null, wander: o.wander || 0,
    home: { x: o.x, y: o.y }, moving: false, mt: 0, tx: o.x, ty: o.y, fx: o.x, fy: o.y,
    timer: 1 + Math.random() * 3, step: 0, hidden: false,
    talk: o.talk || (o.say ? (npc) => Scripts.chat(npc, o.say) : null),
  };
}

// ------------------------------------------------------------ interiors
// Rooms are House Keeper sized: a 17x11 floor inside walls, filling the
// 19x14 screen. `face` is the papered wall row (w window, N banner); the exit
// mat sits in the middle of the bottom wall.
const TEMPLATES = {
  house: { face: 'WwWWWwWWWWWwWWWwW', inner: [
    'BKK..........PP.V', 'b................', '.................', '.....TT....c.....', '.....TT..........', '.................',
    '.P.............P.', '.................', '......RRRRR......', '......RRRRR......', '.................'] },
  store: { face: 'WwWWWWwWWWWwWWWWw', inner: [
    'P...............P', '.................', 'CCC..SSS.SSS.SSS.', '.................', '.....SSS.SSS.SSS.', '.................',
    '.....SSS.SSS.SSS.', '.................', '.P.............P.', '.................', '.................'] },
  hospital: { face: 'WwWWWwWWWWWwWWWwW', inner: [
    'H.H.H.......M.M.P', '.................', '.....CCCCCCC.....', '.................', '.................', 'cc.cc.......cc.cc',
    '.................', '.................', '.P.............P.', '.................', '.................'] },
  chapel: { face: 'WwWWwWWWNWWWwWWwW', inner: [
    'P......AAA......P', '.................', '.................', '.UUUUUU...UUUUUU.', '.................', '.UUUUUU...UUUUUU.',
    '.................', '.UUUUUU...UUUUUU.', '.................', '.................', 'P...............P'] },
  hall: { face: 'WwWWNWWWNWWWNWWwW', inner: [
    'X......GGG......X', '.......GGG.......', 'X......GGG......X', '.......GGG.......', 'X......GGG......X', '.......GGG.......',
    'X......GGG......X', '.......GGG.......', '.......GGG.......', '.......GGG.......', '.......GGG.......'] },
  lab: { face: 'WwWWWwWWWWWwWWWwW', inner: [
    'MM.KKK.....KKK.MM', '.................', '.................', '......TTT........', '.................', '.................',
    'P...............P', '..MM.........MM..', '.................', '.................', '.................'] },
};
const IN = (x, y) => ({ x: x + 1, y: y + 2 });   // inner coords -> room coords
function roomRows(tpl) {
  const rows = ['W'.repeat(19), 'W' + tpl.face + 'W'];
  for (const r of tpl.inner) rows.push('W' + r + 'W');
  rows.push('W'.repeat(9) + 'E' + 'W'.repeat(9));
  return rows;
}
const TCHAR = {
  W: T.WALL, w: T.WWALL, '.': T.FLOOR, K: T.BOOKS, B: T.BED, b: T.BEDB, T: T.TABLE, P: T.PLANT, V: T.TV,
  R: T.RUG, E: T.EXIT, C: T.COUNTER, S: T.SHELF, H: T.HBED, U: T.PEW, A: T.ALTAR, M: T.MACHINE, X: T.STATUE,
  G: T.MAT, c: T.CHAIR, N: T.BANNER,
};

const Interiors = {
  create(b, ti, doorX, doorY) {
    const tplName = b.kind === 'house' ? 'house' : b.kind;
    const tpl = roomRows(TEMPLATES[tplName]);
    const theme = b.kind === 'hall' ? 'hall:' + b.color : tplName;
    const id = `${b.kind}-${ti}-${b.slot ?? 0}`;
    const m = new GMap(id, tpl[0].length, tpl.length, theme);
    m.kind = b.kind; m.town = ti; m.slot = b.slot;
    tpl.forEach((row, y) => { for (let x = 0; x < row.length; x++) m.set(x, y, TCHAR[row[x]] ?? T.FLOOR); });
    // find exit mat
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.get(x, y) === T.EXIT) m.entry = { x, y: y - 1 };
    m.exit = { map: 'world', x: doorX, y: doorY + 1 };
    Interiors.populate(m, b, ti);
    World.maps[id] = m;
    return id;
  },

  populate(m, b, ti) {
    const add = (o) => { const p = IN(o.x, o.y); const n = makeNPC({ ...o, ...p }); m.npcs.push(n); return n; };
    switch (b.kind) {
      case 'store': {
        const n = add({ x: 1, y: 1, pal: 'clerk' });
        n.talk = () => Scripts.shop(ti);
        add({ x: 8, y: 3, pal: ['dude', 'lady', 'old', 'kid'][ti % 4], wander: 1, say: [
          ['They raised the price of coffee again. I\'m buying three.'],
          ['Self-help books are basically cheat codes. Read one, learn a skill!'],
          ['A Scratch-Off Ticket is a "tax on hope." I buy one every day.'],
          ['Headphones keep weak issues away. Introverts\' secret weapon.'],
        ][ti % 4] });
        break;
      }
      case 'hospital': {
        const n = add({ x: 8, y: 1, pal: 'nurse' });
        n.talk = () => Scripts.hospital(ti);
        add({ x: 2, y: 4, pal: 'old', dir: 'right', say: ['I\'ve been in this waiting room since Tuesday. Which Tuesday? Don\'t ask.'] });
        break;
      }
      case 'chapel': {
        const n = add({ x: 8, y: 1, pal: 'pastor', look: 'collar' });
        n.talk = () => Scripts.chapel(ti);
        add({ x: 8, y: 6, pal: 'lady', dir: 'up', say: ['A little kindness goes a long way. So does a little donation.'] });
        break;
      }
      case 'hall': {
        const L = LEADERS[b.leader];
        const n = add({ x: 8, y: 1, pal: 'leader', look: L.look });
        n.palObj = L.pal; n.leader = b.leader;
        n.talk = () => Scripts.leader(b.leader, n);
        const g = add({ x: 5, y: 9, pal: 'guide', dir: 'right' });
        g.talk = () => Scripts.guide(b.leader);
        break;
      }
      case 'lab': {
        const st = add({ x: 12, y: 2, pal: 'street', look: 'glasses' });
        st.talk = () => Scripts.street(st);
        add({ x: 5, y: 9, pal: 'aide', wander: 1, say: ['Dr. Street once beat a parking ticket in court using only a PowerPoint.'] });
        ['diploma', 'wrench', 'badge'].forEach((k, i) => {
          const t = IN(6 + i, 3), idx = m.idx(t.x, t.y);
          m.props.set(idx, k);
          m.acts.set(idx, () => Scripts.pathTable(k));
        });
        break;
      }
      case 'house': {
        if (ti === 0 && b.slot === 0) {
          m.isHome = true;
          const mom = add({ x: 10, y: 4, pal: 'mom', dir: 'left' });
          mom.talk = () => Scripts.mom(mom);
          break;
        }
        const def = TOWNFOLK[ti].houses[b.slot];
        if (def) {
          const n = add({ x: 10, y: 4, pal: def.pal, wander: 1 });
          n.talk = () => Scripts.house(n, def, ti, b.slot);
        }
        break;
      }
    }
  },
};
