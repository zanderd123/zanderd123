// Mid-Continent International, the hub: a star of three runways crossing in
// the middle, framed by four straight runways that its ends touch, each of
// which runs on past one corner like a pinwheel.
//
// It is five airfields on one map, and none of them ever taxis onto
// another's ground:
//   - the south field is an ordinary airfield (the main terminal, security,
//     car parks), and its runway is the bottom of the frame;
//   - the north, east and west fields are the same plan turned to face out
//     from the other three sides of the frame;
//   - the star field is the box inside the frame: each star runway lands
//     and takes off toward the centre from one end, and a terminal in each
//     of the box's four corners is served from the runway beside it.
// Every coordinate here is in the south (main) field's own frame: the
// ordinary airfield, with the rest of the hub drawn around it.

import {
  SLOTS, PLOTS, TERMINAL_CODES, FIELD_XF, SITE_XF, xfApply, xfMul, xfAngle, ID, placeName,
} from './layout.js';
import { SITES } from './config.js';

// The box and the star. The south field's runway (y 210) is the box's
// bottom side.
const R = 455, H = R * Math.sqrt(3) / 2;
export const STAR = { C: { x: 1315, y: 210 - H }, r: R };
export const BOX = { l: STAR.C.x - R, r: STAR.C.x + R, t: STAR.C.y - H, b: 210 };
// The whole hub, in these coordinates, for the camera and the static layer.
export const HUB_RECT = { x0: 180, y0: -1520, w: 2270, h: 2662 };

// The three pocket fields: the usual plan, turned so its runway lies along
// one side of the frame and its terminals face away from the box. Runway
// threshold (x 270) at the far end of the pinwheel arm, end (x 1730) just
// short of the next corner.
FIELD_XF.N = { a: -1, b: 0, c: 0, d: -1, e: 2630, f: -368 };
FIELD_XF.E = { a: 0, b: -1, c: 1, d: 0, e: 1560, f: 1192 };
FIELD_XF.W = { a: 0, b: 1, c: -1, d: 0, e: 1070, f: -1560 };
export const POCKETS = ['N', 'E', 'W'];
export const FIELD_NAMES = { '': 'South field', N: 'North field', E: 'East field', W: 'West field', X: 'Star' };

// Terminal sites in the pockets: the main row and the midfield row of the
// usual plan (the far sites would run into the frame).
const POCKET_SLOTS = ['main', 'midcenter', 'westwing', 'eastwing', 'midwest', 'mideast'];
const POCKET_NAMES = {
  N: { main: 'North Pier', midcenter: 'North Midfield', westwing: 'North-East Pier', eastwing: 'North-West Pier', midwest: 'North-East Midfield', mideast: 'North-West Midfield' },
  E: { main: 'East Pier', midcenter: 'East Midfield', westwing: 'East Pier South', eastwing: 'East Pier North', midwest: 'East Midfield South', mideast: 'East Midfield North' },
  W: { main: 'West Pier', midcenter: 'West Midfield', westwing: 'West Pier North', eastwing: 'West Pier South', midwest: 'West Midfield North', mideast: 'West Midfield South' },
};
const PLOT_NAMES = {
  N: { core: 'North field', west: 'North field, east end', east: 'North field, west end' },
  E: { core: 'East field', west: 'East field, south end', east: 'East field, north end' },
  W: { core: 'West field', west: 'West field, north end', east: 'West field, south end' },
};
const LETTER = { main: 'A', midcenter: 'B', westwing: 'C', eastwing: 'D', midwest: 'E', mideast: 'F' };
const bbox = (pts) => { const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y); const x = Math.min(...xs), y = Math.min(...ys); return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }; };
const rectIn = (m, r) => bbox([{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x, y: r.y + r.h }, { x: r.x + r.w, y: r.y + r.h }].map((p) => xfApply(m, p)));
export const HUB_SLOT_ORDER = [];
export const HUB_PLOT_ORDER = [];
for (const f of POCKETS) {
  const k = f.toLowerCase();
  for (const id of ['core', 'west', 'east']) {
    PLOTS[`${k}.${id}`] = {
      name: PLOT_NAMES[f][id], rects: PLOTS[id].rects.map((r) => rectIn(FIELD_XF[f], r)), hub: true, field: f,
      price: id === 'core' ? 2.5e6 : 16000, needs: id === 'core' ? undefined : `${k}.core`,
      opens: id === 'core' ? `The ${FIELD_NAMES[f].toLowerCase()}'s runway, with its own taxiways and tower` : undefined,
    };
    HUB_PLOT_ORDER.push(`${k}.${id}`);
  }
  for (const id of POCKET_SLOTS) {
    SLOTS[`${k}.${id}`] = { ...SLOTS[id], name: POCKET_NAMES[f][id], plot: `${k}.${SLOTS[id].plot}`, field: f, adjacent: false };
    TERMINAL_CODES[`${k}.${id}`] = f + LETTER[id];
    HUB_SLOT_ORDER.push(`${k}.${id}`);
  }
}
// Two more remote sites, in the empty corners at the top left and bottom
// right: the far end of the west field's arm and of the east field's.
const REMOTE = { W: ['West field, far north end', 'North-West Remote'], E: ['East field, far south end', 'South-East Remote'] };
for (const f of Object.keys(REMOTE)) {
  const k = f.toLowerCase();
  PLOTS[`${k}.farwest`] = { name: REMOTE[f][0], rects: PLOTS.farwest.rects.map((r) => rectIn(FIELD_XF[f], r)), hub: true, hubOnly: true, field: f, price: 70000, needs: `${k}.west` };
  HUB_PLOT_ORDER.push(`${k}.farwest`);
  SLOTS[`${k}.farwest`] = { ...SLOTS.farwest, name: REMOTE[f][1], plot: `${k}.farwest`, field: f, hubOnly: true };
  TERMINAL_CODES[`${k}.farwest`] = `${f}G`;
  HUB_SLOT_ORDER.push(`${k}.farwest`);
}

// ---------------------------------------------------------------- the star
// Star runways ("lines"): each lands and takes off toward the centre from
// one end, at `ea` (the unit vector from the centre to that end). Ground
// traffic on a line never reaches the centre: arrivals turn off before it
// and departures are airborne by it.
const dir = (deg) => ({ x: Math.cos(deg * Math.PI / 180), y: Math.sin(deg * Math.PI / 180) });
export const STAR_LINES = [
  { ea: dir(0), name: '27', other: '09' },     // lands westbound from the east end
  { ea: dir(240), name: '15', other: '33' },   // from the north-west end
  { ea: dir(120), name: '03', other: '21' },   // from the south-west end
];
export const STAR_THRESHOLD = 430;  // threshold, distance from the centre
export const STAR_EXIT = 250;       // where the turn-off starts
export const STAR_LANE = 80;        // the wedge taxilane, out from the runway
// A point s along a line's arm, o out to one side (side n).
export const starPoint = (line, n, s, o) => ({ x: STAR.C.x + STAR_LINES[line].ea.x * s + n.x * o, y: STAR.C.y + STAR_LINES[line].ea.y * s + n.y * o });

// The four corners of the box, each with a terminal beside one star line:
// ea is that line's arm, n points into the corner, sigma keeps the
// terminal's frame a rotation (not a mirror image).
export const WEDGES = {
  'x.tr': { line: 0, n: { x: 0, y: -1 }, sigma: -1, sc: 303, w: 214, gates: 3, name: 'North-East Star Pier', code: 'J' },
  'x.br': { line: 0, n: { x: 0, y: 1 }, sigma: 1, sc: 303, w: 214, gates: 3, name: 'South-East Star Pier', code: 'K' },
  'x.bl': { line: 2, n: { x: -0.8660254, y: -0.5 }, sigma: 1, sc: 283, w: 169, gates: 2, name: 'South-West Star Pier', code: 'L' },
  'x.tl': { line: 1, n: { x: -0.8660254, y: 0.5 }, sigma: -1, sc: 283, w: 169, gates: 2, name: 'North-West Star Pier', code: 'M' },
};
export const STAR_SLOTS = Object.keys(WEDGES);
for (const id of STAR_SLOTS) {
  const W = WEDGES[id], ea = STAR_LINES[W.line].ea, n = W.n, sg = W.sigma;
  // the usual main-row geometry (centred on x 1000, lane at y 530) laid
  // along the wedge's taxilane: x runs along the arm, y out into the corner
  const o0 = STAR.C, base = { x: o0.x + ea.x * (W.sc - 1000 * sg) + n.x * (STAR_LANE - 530), y: o0.y + ea.y * (W.sc - 1000 * sg) + n.y * (STAR_LANE - 530) };
  const xf = { a: ea.x * sg, b: ea.y * sg, c: n.x, d: n.y, e: base.x, f: base.y };
  SLOTS[id] = { name: W.name, row: 'main', x0: 1000 - W.w / 2, x1: 1000 + W.w / 2, plot: 'core', maxGates: W.gates, adjacent: false, field: 'X', xf, hubOnly: true };
  TERMINAL_CODES[id] = W.code;
  HUB_SLOT_ORDER.push(id);
}

// The parts of the usual plan the hub's south field cannot have: the far
// fields run into the frame, and the box is where a second runway would go.
export const HUB_NO_PLOTS = new Set(['farwest', 'fareast', 'north']);
export const HUB_NO_SLOTS = new Set(['farwest', 'fareast']);

export const fieldOfSlot = (slot) => (SLOTS[slot] && SLOTS[slot].field) || '';

// ------------------------------------------------------------ expansions
// Every other airport (but the island) starts as the usual single field.
// Once three of its terminals are built out to every gate, it can grow to
// the hub's size: new airfields for sale around it, each the usual plan
// turned to face out, on the sides away from any coast. Each airport has
// its own arrangement.
export const EXPANSIONS = {
  PWR: ['N', 'E'],
  BSI: ['N', 'E'], // the bay is to the west
  HMA: ['N', 'W'],
  HBC: ['N', 'W'], // the harbour is to the east
  NGT: ['E', 'W'],
  CRL: ['N', 'E'], // the sea is to the west
  MRD: ['N', 'E', 'W'],
};
// Where they go, in the main field's coordinates: the north field turned
// round above it, the east and west fields on their sides, runways nearest
// the main field and terminals facing out.
const OUT_XF = {
  N: { a: -1, b: 0, c: 0, d: -1, e: 2000, f: 110 },
  E: { a: 0, b: -1, c: 1, d: 0, e: 1910, f: 1150 },
  W: { a: 0, b: 1, c: -1, d: 0, e: 90, f: -850 },
};
export const EXPAND_TERMINALS = 3;
const siteId = (site) => SITES[site] && SITES[site].id;
// The airfields an airport can add ([] for one that can't grow; the hub's
// come with it).
export function siteFields(site) {
  if (SITES[site] && SITES[site].hub) return POCKETS;
  return EXPANSIONS[siteId(site)] || [];
}
SITES.forEach((s, i) => {
  if (!EXPANSIONS[s.id]) return;
  SITE_XF[i] = {};
  for (const k of EXPANSIONS[s.id]) SITE_XF[i][k] = OUT_XF[k];
});
// The whole map of a grown airport, in main coordinates.
const RECTS = {};
export function siteRect(site) {
  if (SITES[site] && SITES[site].hub) return HUB_RECT;
  if (RECTS[site]) return RECTS[site];
  let x0 = 0, y0 = 0, x1 = 2000, y1 = 1150;
  for (const k of siteFields(site)) {
    const b = rectIn(OUT_XF[k], { x: 0, y: 120, w: 2000, h: 840 });
    // a margin only where the map grows past the main field
    if (b.x < x0) x0 = b.x - 20;
    if (b.y < y0) y0 = b.y - 20;
    if (b.x + b.w > x1) x1 = b.x + b.w + 20;
  }
  return (RECTS[site] = { x0, y0, w: x1 - x0, h: y1 - y0 });
}
// A parcel's outline at this airport (another airfield's lies wherever
// that airport put the field).
const PLOT_RECTS = {};
export function plotRects(site, id) {
  const P = PLOTS[id];
  if (!P.field || (SITES[site] && SITES[site].hub) || !SITE_XF[site]) return P.rects;
  const key = site + ':' + id;
  if (!PLOT_RECTS[key]) PLOT_RECTS[key] = PLOTS[id.split('.')[1]].rects.map((r) => rectIn(SITE_XF[site][P.field], r));
  return PLOT_RECTS[key];
}
// An airfield's name at this airport (east and west swap where it is
// drawn mirrored).
export function fieldName(site, key) {
  if (!key) return SITES[site] && SITES[site].hub ? 'South field' : 'Main field';
  return placeName(!!(SITES[site] && SITES[site].mirror), FIELD_NAMES[key]);
}
export const fieldXf = (f) => FIELD_XF[f] || ID;
export { xfApply, xfMul, xfAngle };
