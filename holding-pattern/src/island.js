// Sunset Cay: a Hawaiian island with a road all the way round it, a long
// beach on the west, a marina on the east, and visitors who fly in, rent a
// car, drive once round the island, sit on the beach for a while, then
// drive back and fly out. Drawing only: the simulation sees an ordinary
// small airport.

import { RAMP_IN_X, RAMP_OUT_X, CURB_Y, MAIN_BLDG } from './layout.js';
import { pathLength, pointAlong, mulberry32 } from './util.js';

// ---------------------------------------------------------------- the island
// A rounded island; the beach widens into a long one on the west side, and
// the ring road runs just inside the sand all the way round.
const N = 360;
const SHAPE = { cx: 1000, cy: 560, rx: 930, ry: 520 };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function build() {
  const coast = [], inner = [], road = [];
  for (let k = 0; k < N; k++) {
    const a = k / N * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const wob = 1 + 0.012 * Math.sin(3 * a + 1) + 0.008 * Math.sin(7 * a + 2);
    const p = { x: SHAPE.cx + SHAPE.rx * wob * Math.sign(c) * Math.sqrt(Math.abs(c)), y: SHAPE.cy + SHAPE.ry * wob * Math.sign(s) * Math.sqrt(Math.abs(s)) };
    const west = Math.pow(Math.max(0, -c), 1.5) * smooth(370, 600, p.y) * (1 - smooth(820, 1010, p.y));
    const sand = 14 + 270 * west;
    const dx = p.x - SHAPE.cx, dy = p.y - SHAPE.cy, r = Math.hypot(dx, dy);
    const at = (d) => ({ x: SHAPE.cx + dx * (1 - d / r), y: SHAPE.cy + dy * (1 - d / r) });
    coast.push(p); inner.push(at(sand)); road.push({ ...at(sand + 20), k });
  }
  return { coast, inner, road };
}
export const ISL = build();
const nearest = (x, y) => { let b = 0, bd = Infinity; ISL.road.forEach((q, i) => { const d = Math.hypot(q.x - x, q.y - y); if (d < bd) { bd = d; b = i; } }); return b; };
// where the terminal's two ramps meet the ring road, and the beach car park
const J_OUT = nearest(RAMP_OUT_X, 1100), J_IN = nearest(RAMP_IN_X, 1100);
export const RAMP_END = { out: ISL.road[J_OUT].y, in: ISL.road[J_IN].y };
const BEACH_LOT = { x: 380, y: 590, w: 72, h: 120 };
const J_BEACH = nearest(BEACH_LOT.x, BEACH_LOT.y + BEACH_LOT.h / 2);
const SIGN = { x: 1520, y: 470 };
// where the camera opens on arrival: the sign, with the terminal beside it
export const ISLAND_FOCUS = { x: SIGN.x - 60, y: SIGN.y + 80 };
const DOCKS = [500, 580, 660, 740, 820].map((y) => { const i = nearest(1990, y); return { x: ISL.coast[i].x - 12, y }; });

// places to sit on the west beach
const SPOTS = (() => {
  const R = mulberry32(77), out = [];
  for (let k = 0; k < N; k++) {
    const p = ISL.coast[k], q = ISL.inner[k];
    if (p.x > 600 || p.y < 470 || p.y > 920 || Math.hypot(q.x - p.x, q.y - p.y) < 120) continue;
    if (k % 3) continue;
    for (const f of [0.3, 0.55, 0.78]) out.push({ x: p.x + (q.x - p.x) * f + (R() - 0.5) * 16, y: p.y + (q.y - p.y) * f + (R() - 0.5) * 10, used: false });
  }
  return out;
})();

function path(g, pts) { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); }
function grow(pts, d) { return pts.map((p) => { const dx = p.x - SHAPE.cx, dy = p.y - SHAPE.cy, r = Math.hypot(dx, dy); return { x: SHAPE.cx + dx * (1 + d / r), y: SHAPE.cy + dy * (1 + d / r) }; }); }
// Land the island leaves free of the airfield, its roads and its signs.
function clear(x, y) {
  if (x > 170 && x < 1860 && y > 165 && y < 355) return false;          // runway and taxiways
  if (x > 785 && x < 1215 && y > 300 && y < 960) return false;          // apron, terminal, front lot
  if (x > 840 && x < 1160 && y > 940) return false;                      // ramps
  if (x > BEACH_LOT.x - 30 && x < BEACH_LOT.x + BEACH_LOT.w + 10 && y > BEACH_LOT.y - 10 && y < BEACH_LOT.y + BEACH_LOT.h + 10) return false;
  if (Math.abs(x - SIGN.x) < 250 && Math.abs(y - SIGN.y) < 50) return false;
  if (x > 1840 && y > 470 && y < 850) return false;                      // docks
  return true;
}

// ---------------------------------------------------------------- the still parts
export function drawShore(g, TH, W, H, R) {
  g.fillStyle = TH.water; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,0.16)'; g.lineWidth = 1.2;
  for (let i = 0; i < 160; i++) { const x = R() * W, y = R() * H; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 8, y - 3, x + 16, y); g.stroke(); }
  g.fillStyle = TH.shallow; path(g, grow(ISL.coast, 44)); g.fill();
  g.fillStyle = TH.sand; path(g, ISL.coast); g.fill();
  g.fillStyle = TH.ground; path(g, ISL.inner); g.fill();
  g.save(); path(g, ISL.inner); g.clip();
  g.fillStyle = TH.stripe;
  for (let x = -H; x < W; x += 56) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 28, 0); g.lineTo(x + 28 + H * 0.5, H); g.lineTo(x + H * 0.5, H); g.fill(); }
  g.restore();
  g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1.6; path(g, grow(ISL.coast, 24)); g.stroke();
}

// Roads, beach, marina, palms, hibiscus and the sign. Drawn before the
// airfield, so the runway and terminal sit on top.
export function drawLand(g, R, deps) {
  const { palm, road: roadCol } = deps;
  // the ring road and the two ramps down to it from the terminal curb
  g.lineJoin = 'round';
  g.strokeStyle = roadCol; g.lineWidth = 20; path(g, ISL.road); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1.4; g.setLineDash([14, 12]); path(g, ISL.road); g.stroke(); g.setLineDash([]); g.lineJoin = 'miter';
  g.fillStyle = roadCol;
  g.fillRect(RAMP_IN_X - 8, CURB_Y, 16, RAMP_END.in - CURB_Y);
  g.fillRect(RAMP_OUT_X - 8, CURB_Y, 16, RAMP_END.out - CURB_Y);
  // the beach car park and its spur
  const jb = ISL.road[J_BEACH];
  g.fillRect(jb.x, BEACH_LOT.y + BEACH_LOT.h / 2 - 7, BEACH_LOT.x - jb.x + 4, 14);
  g.fillStyle = '#585c63'; g.fillRect(BEACH_LOT.x, BEACH_LOT.y, BEACH_LOT.w, BEACH_LOT.h);
  g.strokeStyle = 'rgba(232,230,223,0.7)'; g.lineWidth = 0.8;
  for (let y = BEACH_LOT.y + 6; y < BEACH_LOT.y + BEACH_LOT.h - 6; y += 12) { g.beginPath(); g.moveTo(BEACH_LOT.x + 4, y); g.lineTo(BEACH_LOT.x + 26, y); g.moveTo(BEACH_LOT.x + BEACH_LOT.w - 26, y); g.lineTo(BEACH_LOT.x + BEACH_LOT.w - 4, y); g.stroke(); }
  // umbrellas and towels on the beach
  const towels = ['#ff4f8b', '#ffd23f', '#1f9bd1', '#ff8a3d', '#f7f3ea', '#3fbf8f'];
  for (const s of SPOTS) {
    if (R() < 0.45) continue;
    g.fillStyle = towels[Math.floor(R() * towels.length)]; g.fillRect(s.x - 4, s.y + 3, 8, 12);
    if (R() < 0.7) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.beginPath(); g.arc(s.x + 10, s.y + 4, 9, 0, 7); g.fill(); g.fillStyle = ['#e8313a', '#f7f3ea', '#1f5aa6', '#ffd23f', '#ff4f8b'][Math.floor(R() * 5)]; g.beginPath(); g.arc(s.x + 7, s.y, 9, 0, 7); g.fill(); g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 0.8; for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; g.beginPath(); g.moveTo(s.x + 7, s.y); g.lineTo(s.x + 7 + Math.cos(a) * 9, s.y + Math.sin(a) * 9); g.stroke(); } }
  }
  // the marina: piers, and a boathouse
  for (const d of DOCKS) {
    g.fillStyle = '#8a6a45'; g.fillRect(d.x, d.y - 4, 84, 8);
    g.fillStyle = '#5e4630'; for (let x = d.x + 8; x < d.x + 84; x += 16) g.fillRect(x, d.y - 6, 3, 12);
  }
  hut(g, DOCKS[2].x - 40, DOCKS[2].y, 26);
  // grass huts by the beach
  for (const [x, y] of [[520, 560], [540, 760], [500, 870]]) hut(g, x, y, 24);
  // palms: along the shore, thick on the beach, and across the lawns
  for (let i = 0; i < 260; i++) {
    const k = Math.floor(R() * N), p = ISL.coast[k], q = ISL.road[k], f = 0.25 + R() * 0.6;
    const x = p.x + (q.x - p.x) * f, y = p.y + (q.y - p.y) * f;
    if (clear(x, y)) palm(g, x, y, 7 + R() * 4, R);
  }
  for (let i = 0; i < 70; i++) {
    const x = 120 + R() * 1760, y = 380 + R() * 620;
    if (clear(x, y) && insideRoad(x, y, 30)) palm(g, x, y, 7 + R() * 4, R);
  }
  // hibiscus along the inside of the road and in beds by the terminal
  for (let i = 0; i < 150; i++) {
    const k = Math.floor(R() * N), q = ISL.road[k], f = 1.035 + R() * 0.04;
    const x = SHAPE.cx + (q.x - SHAPE.cx) / f, y = SHAPE.cy + (q.y - SHAPE.cy) / f;
    if (clear(x, y)) hibiscus(g, x, y, R, 5);
  }
  for (const [x, y] of [[815, 790], [815, 880], [1185, 790], [1185, 880], [760, 1000], [1240, 1000], [SIGN.x - 230, SIGN.y + 55], [SIGN.x + 230, SIGN.y + 55], [SIGN.x, SIGN.y + 80]]) hibiscus(g, x, y, R, 9);
  // the sign, laid out in flowers' white on the lawn
  g.save();
  g.font = '700 58px "Barlow Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillText('THANKS FOR PLAYING!', SIGN.x + 4, SIGN.y + 4);
  g.fillStyle = '#fbf7ec'; g.fillText('THANKS FOR PLAYING!', SIGN.x, SIGN.y);
  g.font = '700 16px "Barlow Condensed", "Arial Narrow", sans-serif';
  g.fillStyle = 'rgba(251,247,236,0.9)'; g.fillText('SUNSET CAY · HOLDING PATTERN', SIGN.x, SIGN.y + 40);
  g.restore();
}
function insideRoad(x, y, margin) {
  const k = Math.round(((Math.atan2(y - SHAPE.cy, x - SHAPE.cx) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * N) % N;
  const q = ISL.road[k];
  return Math.hypot(x - SHAPE.cx, y - SHAPE.cy) < Math.hypot(q.x - SHAPE.cx, q.y - SHAPE.cy) - margin;
}
function hut(g, x, y, r) {
  g.fillStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.arc(x + 4, y + 4, r, 0, 7); g.fill();
  g.fillStyle = '#c9a25e'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  g.strokeStyle = '#a57f42'; g.lineWidth = 1.2; for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); g.stroke(); }
  g.fillStyle = '#8a6532'; g.beginPath(); g.arc(x, y, r * 0.18, 0, 7); g.fill();
}
const HIBISCUS = ['#ff4f8b', '#e8313a', '#ffd23f', '#ff8a3d', '#f7f3ea', '#c04fd8'];
function hibiscus(g, x, y, R, n) {
  g.fillStyle = '#3e7d34'; g.beginPath(); g.ellipse(x, y, 11, 7, 0, 0, 7); g.fill();
  for (let i = 0; i < n; i++) {
    const fx = x + (R() - 0.5) * 18, fy = y + (R() - 0.5) * 11, c = HIBISCUS[Math.floor(R() * HIBISCUS.length)];
    g.fillStyle = c; for (let p = 0; p < 5; p++) { const a = p * 1.2566; g.beginPath(); g.arc(fx + Math.cos(a) * 2, fy + Math.sin(a) * 2, 1.7, 0, 7); g.fill(); }
    g.fillStyle = '#ffe680'; g.beginPath(); g.arc(fx, fy, 0.9, 0, 7); g.fill();
  }
}

// ---------------------------------------------------------------- visitors
// Each party: off the plane to the rental cars in the front lot, once round
// the island, the beach for 3 to 25 seconds, back to the lot, into the
// terminal for a flight home.
const parties = [];
let waiting = 0, waitT = 0, nextId = 1;
const sparks = [];
let show = 0, nextBurst = 0, lastReal = 0;
const COLORS = ['#c9473a', '#e8e8e8', '#2b5f9e', '#262626', '#d9b44a', '#3d7a4f', '#e07b39', '#f2f2f2'];

function ring(from, to, dir, laps) {
  const out = [];
  let i = from;
  const steps = ((dir > 0 ? to - from : from - to) + N) % N + laps * N;
  for (let s = 0; s <= steps; s++) { out.push(ISL.road[i]); i = (i + dir + N) % N; }
  return out;
}
// a bay in the car park, or the kerb when something else stands on its site
let lotOpen = true;
const lotSpot = () => (lotOpen ? { x: 892 + Math.random() * 216, y: 790 + Math.floor(Math.random() * 4) * 36 + 7 } : { x: 892 + Math.random() * 216, y: 768 });
const beachBay = (i) => ({ x: BEACH_LOT.x + (i % 2 ? BEACH_LOT.w - 15 : 15), y: BEACH_LOT.y + 12 + (Math.floor(i / 2) % 9) * 12 });
const leg = (pts, speed) => ({ pts, len: pathLength(pts), d: 0, speed });

function start(P, stage) {
  P.stage = stage;
  const jb = ISL.road[J_BEACH], spur = { x: jb.x, y: BEACH_LOT.y + BEACH_LOT.h / 2 };
  if (stage === 'drive') {
    P.lot = P.lot || lotSpot();
    P.bay = Math.floor(Math.random() * 18);
    const bay = beachBay(P.bay);
    P.leg = leg([P.lot, { x: RAMP_OUT_X, y: P.lot.y }, { x: RAMP_OUT_X, y: RAMP_END.out }, ...ring(J_OUT, J_BEACH, 1, 1), spur, { x: bay.x, y: spur.y }, bay], 110);
  } else if (stage === 'toSand') {
    const free = SPOTS.filter((s) => !s.used);
    P.spot = free.length ? free[Math.floor(Math.random() * free.length)] : SPOTS[Math.floor(Math.random() * SPOTS.length)];
    P.spot.used = true;
    const bay = beachBay(P.bay);
    P.leg = leg([bay, { x: BEACH_LOT.x - 4, y: bay.y }, { x: P.spot.x, y: P.spot.y }], 24);
  } else if (stage === 'sit') {
    P.left = 3 + Math.random() * 22;
  } else if (stage === 'toCar') {
    const bay = beachBay(P.bay);
    P.leg = leg([{ x: P.spot.x, y: P.spot.y }, { x: BEACH_LOT.x - 4, y: bay.y }, bay], 24);
  } else if (stage === 'driveBack') {
    P.spot.used = false;
    const bay = beachBay(P.bay);
    P.lot = lotSpot();
    P.leg = leg([bay, { x: bay.x, y: spur.y }, spur, ...ring(J_BEACH, J_IN, -1, 0), { x: RAMP_IN_X, y: RAMP_END.in }, { x: RAMP_IN_X, y: P.lot.y }, P.lot], 110);
  } else if (stage === 'home') {
    const door = { x: 900 + Math.random() * 200, y: MAIN_BLDG.y1 - 4 };
    P.leg = leg([P.lot, { x: P.lot.x, y: CURB_Y - 2 }, door, { x: door.x, y: MAIN_BLDG.y1 - 30 }], 26);
  }
}
const NEXT = { drive: 'toSand', toSand: 'sit', sit: 'toCar', toCar: 'driveBack', driveBack: 'home', home: null };

function newParty(n) {
  const P = { id: nextId++, n, color: COLORS[Math.floor(Math.random() * COLORS.length)] };
  start(P, 'drive');
  parties.push(P);
  return P;
}

// A fresh visit: a few parties already about, and fireworks.
export function islandAttach() {
  parties.length = 0; sparks.length = 0; waiting = 0; waitT = 0;
  for (const s of SPOTS) s.used = false;
  for (const stage of ['drive', 'drive', 'sit', 'sit', 'sit', 'driveBack', 'toSand']) {
    const P = newParty(2 + Math.floor(Math.random() * 2));
    while (P.stage !== stage) start(P, NEXT[P.stage]);
    if (P.leg) P.leg.d = Math.random() * P.leg.len;
    if (P.stage === 'sit') P.left = Math.random() * 25;
  }
  show = 7; nextBurst = 0; lastReal = 0;
}
// An arriving passenger has reached the rental cars.
export function islandArrive() {
  waiting++;
  if (waiting >= 3) { if (parties.length < 22) newParty(waiting); waiting = 0; waitT = 0; }
}
// Where arrivals walk once they are through the terminal.
export function rentalPoint() { return { x: 900 + Math.random() * 200, y: 786 }; }

export function islandFrame(g, t, dt, deps) {
  const { car, plane } = deps;
  lotOpen = deps.lot !== false;
  // a lone arrival does not wait for company for ever
  if (waiting) { waitT += dt; if (waitT > 6) { if (parties.length < 22) newParty(waiting); waiting = 0; waitT = 0; } }
  for (let i = parties.length - 1; i >= 0; i--) {
    const P = parties[i];
    if (P.stage === 'sit') { P.left -= dt; if (P.left <= 0) start(P, 'toCar'); }
    else { P.leg.d += P.leg.speed * dt; if (P.leg.d >= P.leg.len) { const nx = NEXT[P.stage]; if (nx) start(P, nx); else parties.splice(i, 1); } }
  }
  // boats bob at the marina
  DOCKS.forEach((d, i) => {
    for (const side of [-1, 1]) {
      const bob = Math.sin(t * 1.3 + i * 2 + side) * 1.4;
      g.save(); g.translate(d.x + 56, d.y + side * 15 + bob);
      g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(-26, -1, 10, 2);
      g.fillStyle = '#f4f1e8'; g.beginPath(); g.moveTo(14, 0); g.lineTo(5, -6); g.lineTo(-13, -6); g.lineTo(-13, 6); g.lineTo(5, 6); g.closePath(); g.fill();
      if ((i + side) % 2) { g.fillStyle = '#fbf7ec'; g.beginPath(); g.moveTo(-3, -5); g.lineTo(-3, -22); g.lineTo(9, -5); g.fill(); } else { g.fillStyle = ['#3d6f9e', '#c8102e', '#2f8a4f'][i % 3]; g.fillRect(-8, -4, 9, 8); }
      g.restore();
    }
  });
  // parked cars, moving cars, people
  for (const P of parties) {
    const atBeach = P.stage === 'toSand' || P.stage === 'sit' || P.stage === 'toCar';
    if (atBeach) { const b = beachBay(P.bay); car(g, b.x, b.y, 0, P.color); }
    if (P.stage === 'drive' || P.stage === 'driveBack') { const q = pointAlong(P.leg.pts, P.leg.d); car(g, q.x, q.y, q.ang, P.color); continue; }
    const q = P.stage === 'sit' ? P.spot : pointAlong(P.leg.pts, P.leg.d);
    for (let k = 0; k < P.n; k++) {
      const x = q.x + (k - (P.n - 1) / 2) * 4, y = q.y + (P.stage === 'sit' ? 6 : 0);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x - 0.6, y - 0.6, 2.8, 2.8);
      g.fillStyle = P.stage === 'sit' ? '#d9673a' : '#e0861c'; g.fillRect(x - 1.3, y - 1.3, 2.8, 2.8);
    }
  }
  // fireworks, in real time, for the first few seconds of every visit
  const now = performance.now() / 1000, rdt = lastReal ? Math.min(0.05, now - lastReal) : 0;
  lastReal = now;
  if (show > 0) {
    show -= rdt; nextBurst -= rdt;
    if (nextBurst <= 0) {
      nextBurst = 0.22 + Math.random() * 0.3;
      const x = SIGN.x - 650 + Math.random() * 900, y = 260 + Math.random() * 480; // over the sign, in view
      const col = ['#ff4f8b', '#ffd23f', '#5fe0ff', '#ff8a3d', '#b98bff', '#ffffff', '#7dff8a'][Math.floor(Math.random() * 7)];
      for (let k = 0; k < 70; k++) { const a = k / 70 * Math.PI * 2, v = 170 + Math.random() * 120; sparks.push({ x, y, px: x, py: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1.2 + Math.random() * 0.7, col }); }
    }
  }
  if (sparks.length) {
    g.lineCap = 'round';
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.life -= rdt; s.px = s.x; s.py = s.y; s.x += s.vx * rdt; s.y += s.vy * rdt; s.vy += 60 * rdt; s.vx *= 0.985; s.vy *= 0.985;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      g.globalAlpha = Math.min(1, s.life);
      g.strokeStyle = s.col; g.lineWidth = 6; g.beginPath(); g.moveTo(s.x - s.vx * 0.06, s.y - s.vy * 0.06); g.lineTo(s.x, s.y); g.stroke();
      g.fillStyle = '#fff'; g.fillRect(s.x - 2, s.y - 2, 4, 4);
    }
    g.globalAlpha = 1; g.lineCap = 'butt';
  }
  bannerTow(g, t, plane);
}

// A small plane towing a banner round the island.
function bannerTow(g, t, plane) {
  const u = t * 0.05;
  const at = (v) => ({ x: SHAPE.cx + 840 * Math.cos(v), y: SHAPE.cy + 470 * Math.sin(v) });
  const p = at(u), q = at(u + 0.01);
  const ang = Math.atan2(q.y - p.y, q.x - p.x);
  const alt = 120, L = 200, gap = 34, shadowCol = 'rgba(15,25,10,0.28)';
  const draw = (shadow) => {
    g.save();
    g.translate(p.x + (shadow ? alt * 0.32 : 0), p.y + (shadow ? alt * 0.42 : 0));
    g.rotate(ang);
    if (shadow) g.globalAlpha = 0.35;
    g.strokeStyle = shadow ? shadowCol : 'rgba(40,40,40,0.8)'; g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(-16, 0); g.lineTo(-16 - gap, 0); g.stroke();
    g.fillStyle = shadow ? shadowCol : '#fbf7ec';
    g.fillRect(-16 - gap - L, -9, L, 18);
    if (!shadow) {
      g.strokeStyle = '#c8102e'; g.lineWidth = 1.5; g.strokeRect(-16 - gap - L, -9, L, 18);
      g.save(); g.translate(-16 - gap - L / 2, 0);
      if (Math.cos(ang) < 0) g.rotate(Math.PI); // keep the words the right way up
      g.font = '700 14px "Barlow Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#c8102e'; g.fillText('THANKS FOR PLAYING!', 0, 1);
      g.restore();
    }
    g.scale(1.25, 1.25);
    plane(g, 'regional', '#c8102e', shadow);
    g.restore();
  };
  draw(true); draw(false);
}
