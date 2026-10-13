// The airfield's geometry. Every airport shares this plan: what differs is
// which land parcels you own and what you have built on them.
//
//   north   runway 2 (y 60)  + taxiway C (y 112)
//   strip   runway 1 (y 210) + taxiway A (y 260, eastbound only)
//                            + taxiway B (y 322, westbound only)
//   apron   midfield concourses, stands facing taxiway B
//           apron lane (y 530, eastbound only)
//           main terminal row, stands facing the apron lane
//   land    service road, curb, car parks; highway along the bottom
//
// Ground traffic is one-way, as at a real busy airport, so two aircraft never
// meet nose to nose. Taxilanes between B and the apron lane alternate:
// southbound ones (in) lie west of the gates they serve, northbound ones
// (out) lie east of them, so every flow runs the same way round.
//
// Spacing is set so the largest aircraft (60 px long, 60 px span) clears
// everything: the runway edge, the other taxiway, and parked tails.

export const RW = [
  { id: 0, y: 210, x0: 270, x1: 1730, exitY: 260 },
  { id: 1, y: 60, x0: 270, x1: 1730, exitY: 112 },
];
export const TWY_A = 260;
export const TWY_B = 322;
export const LANE2 = 530;
export const RUNWAY_HALF = 17;
export const EXITS = [580, 760, 960];
export const LONG_RUNWAY_X1 = 1880;
export const HOLD_POINT = { x: 240, y: 268 };
export const B_TURN_X = 240; // where departures leave taxiway B for the hold point
export const IAF = { x: 60 };

// The crosswind runway some sites can build: north to south across the far
// east field, departures only, taking off southbound. Main-row departures
// reach it along the apron lane, which turns north to its hold point.
export const XW = { x: 1775, y0: 400, y1: 1050 };
export const XW_HOLD = { x: 1705, y: 445 };
export function pathGateToCrosswind(stand) {
  return [{ x: stand.x, y: LANE2 }, { x: XW_HOLD.x, y: LANE2 }, { x: XW_HOLD.x, y: XW_HOLD.y }];
}
export function crosswindTakeoff() {
  return [{ x: XW_HOLD.x, y: XW_HOLD.y }, { x: XW_HOLD.x + 8, y: XW.y0 + 14 }, { x: XW.x - 26, y: XW.y0 + 4 }, { x: XW.x, y: XW.y0 + 30 }, { x: XW.x, y: XW.y1 + 700 }];
}

// Taxilanes between taxiway B and the apron lane, and which way they run.
export const TAXILANES = [
  { x: 90, dir: 'S', plot: 'farwest' },
  { x: 445, dir: 'S', plot: 'west' },
  { x: 825, dir: 'S', plot: 'core' },
  { x: 1175, dir: 'N', plot: 'core' },
  { x: 1555, dir: 'N', plot: 'east' },
  { x: 1905, dir: 'N', plot: 'fareast' },
];

export const MAIN_BLDG = { y0: 630, y1: 720 };
export const MID_BLDG = { y0: 420, y1: 495 };
export const MAIN_STAND_Y = 596;
export const MID_STAND_Y = 386;
export const SERVICE_Y = 731;
export const CURB_Y = 752;
export const HIGHWAY_Y = 1090;
export const RAMP_IN_X = 862;
export const RAMP_OUT_X = 1138;
export const SECURITY = { x: 1000, y: 688 };
export const MAIN_CENTER = { x: 1000, y: 675 };
export const GATE_SPACING = 64;

// Land you can own. Core comes with the airport.
export const PLOTS = {
  core:    { name: 'Airfield core',  rects: [{ x: 180, y: 150, w: 1640, h: 160 }, { x: 800, y: 310, w: 400, h: 630 }], price: 0 },
  west:    { name: 'West apron',     rects: [{ x: 430, y: 310, w: 370, h: 630 }], price: 16000 },
  east:    { name: 'East apron',     rects: [{ x: 1200, y: 310, w: 370, h: 630 }], price: 16000 },
  farwest: { name: 'Far west field', rects: [{ x: 60, y: 310, w: 370, h: 630 }], price: 70000, needs: 'west' },
  fareast: { name: 'Far east field', rects: [{ x: 1570, y: 310, w: 370, h: 630 }], price: 70000, needs: 'east' },
  south:   { name: 'South landside', rects: [{ x: 430, y: 940, w: 1140, h: 190 }], price: 38000 },
  north:   { name: 'North field',    rects: [{ x: 180, y: 25, w: 1640, h: 125 }], price: 140000 },
};
// A landside site on each parcel: a car park, hotel, rental car centre or
// solar farm (see LANDSIDE in config.js).
export const PARKING_SITES = {
  front:     { name: 'Front site',      code: 'L1', plot: 'core',    x: 878,  y: 778, w: 244, h: 150 },
  west:      { name: 'West site',       code: 'L2', plot: 'west',    x: 480,  y: 778, w: 310, h: 146 },
  east:      { name: 'East site',       code: 'L3', plot: 'east',    x: 1210, y: 778, w: 310, h: 146 },
  southwest: { name: 'South-west site', code: 'L4', plot: 'south',   x: 470,  y: 958, w: 360, h: 108 },
  southeast: { name: 'South-east site', code: 'L5', plot: 'south',   x: 1170, y: 958, w: 360, h: 108 },
  farwest:   { name: 'Far west site',   code: 'L6', plot: 'farwest', x: 100,  y: 778, w: 300, h: 146 },
  fareast:   { name: 'Far east site',   code: 'L7', plot: 'fareast', x: 1600, y: 778, w: 300, h: 146 },
};
export const PARKING_ORDER = ['front', 'west', 'east', 'southwest', 'southeast', 'farwest', 'fareast'];
// On sites drawn mirrored (runways the other way) west and east swap in
// every name the player reads.
export function placeName(mirror, name) {
  if (!mirror) return name;
  return name.replace(/\b(West|west|East|east)\b/g, (w) => ({ West: 'East', west: 'east', East: 'West', east: 'west' }[w]));
}
export const PLOT_ORDER = ['west', 'east', 'south', 'farwest', 'fareast', 'north'];

// Terminal sites. 'main' is the original terminal: security and the curb are
// there, so every other terminal needs a connector back to it.
export const SLOTS = {
  main:      { name: 'Main Terminal',      row: 'main', x0: 860, x1: 1140, plot: 'core', maxGates: 4, adjacent: false },
  midcenter: { name: 'Midfield Concourse', row: 'mid',  x0: 872, x1: 1128, plot: 'core', maxGates: 4, adjacent: false },
  westwing:  { name: 'West Pier',          row: 'main', x0: 490, x1: 795, plot: 'west', maxGates: 4, adjacent: true },
  midwest:   { name: 'West Midfield',      row: 'mid',  x0: 482, x1: 790, plot: 'west', maxGates: 4, adjacent: false },
  eastwing:  { name: 'East Pier',          row: 'main', x0: 1205, x1: 1510, plot: 'east', maxGates: 4, adjacent: true },
  mideast:   { name: 'East Midfield',      row: 'mid',  x0: 1210, x1: 1518, plot: 'east', maxGates: 4, adjacent: false },
  farwest:   { name: 'West Remote',        row: 'main', x0: 130, x1: 410, plot: 'farwest', maxGates: 4, adjacent: false },
  fareast:   { name: 'East Remote',        row: 'main', x0: 1590, x1: 1870, plot: 'fareast', maxGates: 4, adjacent: false },
};
export const SLOT_ORDER = ['main', 'midcenter', 'westwing', 'eastwing', 'midwest', 'mideast', 'farwest', 'fareast'];
// Concourse letters, as on real airport signage: gates are A1, B3 and so on.
export const TERMINAL_CODES = { main: 'A', midcenter: 'B', westwing: 'C', eastwing: 'D', midwest: 'E', mideast: 'F', farwest: 'G', fareast: 'H' };

// ------------------------------------------------------- the hub's south field
// Mid-Continent International, the hub, can buy a second airfield south of
// the highway: the same plan as the north one, mirrored north to south, so
// its terminals face the car parks across the highway and runway 3 runs
// along the bottom of the map. Its aircraft are simulated in the same local
// coordinates as the north field (sim.js keeps them apart); the mirror is
// applied only where things are drawn, picked or walked to.
export const SOUTH_M = 2180; // world y = SOUTH_M - local y
export const HUB_WORLD = { w: 2000, h: 2110 };
export const SPINE_X = 1158; // the service road under the highway, north field to south
const SOUTH = {
  main:      ['South Central Pier',   'J'],
  midcenter: ['South Midfield',       'K'],
  westwing:  ['South-West Pier',      'L'],
  eastwing:  ['South-East Pier',      'M'],
  midwest:   ['South-West Midfield',  'N'],
  mideast:   ['South-East Midfield',  'P'],
  farwest:   ['South-West Remote',    'Q'],
  fareast:   ['South-East Remote',    'R'],
};
const SOUTH_PLOT = { core: 'score', west: 'swest', east: 'seast', farwest: 'sfarwest', fareast: 'sfareast' };
export const SOUTH_SLOT_ORDER = SLOT_ORDER.map((k) => 's' + k);
for (const k of SLOT_ORDER) {
  SLOTS['s' + k] = { ...SLOTS[k], name: SOUTH[k][0], plot: SOUTH_PLOT[SLOTS[k].plot], adjacent: false, field: 1 };
  TERMINAL_CODES['s' + k] = SOUTH[k][1];
}
// The south field's land, in world coordinates. Buying the core buys runway 3
// and its taxiways.
const flipRect = (r) => ({ x: r.x, y: SOUTH_M - r.y - r.h, w: r.w, h: r.h });
Object.assign(PLOTS, {
  score:    { name: 'South airfield',     rects: PLOTS.core.rects.map(flipRect), price: 3.5e6, hub: true, field: 1, opens: 'Runway 3 and its own taxiways' },
  swest:    { name: 'South-west apron',   rects: PLOTS.west.rects.map(flipRect), price: 16000, needs: 'score', hub: true, field: 1 },
  seast:    { name: 'South-east apron',   rects: PLOTS.east.rects.map(flipRect), price: 16000, needs: 'score', hub: true, field: 1 },
  sland:    { name: 'Highway frontage',   rects: [{ x: 430, y: 1104, w: 1140, h: 136 }], price: 38000, needs: 'score', hub: true, field: 1 },
  sfarwest: { name: 'Far south-west field', rects: PLOTS.farwest.rects.map(flipRect), price: 70000, needs: 'swest', hub: true, field: 1 },
  sfareast: { name: 'Far south-east field', rects: PLOTS.fareast.rects.map(flipRect), price: 70000, needs: 'seast', hub: true, field: 1 },
});
export const SOUTH_PLOT_ORDER = ['score', 'swest', 'seast', 'sland', 'sfarwest', 'sfareast'];
// The local plot names the south field's taxi routes are built from.
export function southPlots(plots) {
  const out = {};
  for (const k in SOUTH_PLOT) out[k] = !!plots[SOUTH_PLOT[k]];
  return out;
}
const southSite = (id, name, code, plot) => ({ ...flipRect(PARKING_SITES[id]), name, code, plot, field: 1 });
Object.assign(PARKING_SITES, {
  sfront:     southSite('front', 'South front site', 'L8', 'score'),
  swest:      southSite('west', 'South-west site', 'L9', 'swest'),
  seast:      southSite('east', 'South-east site', 'L10', 'seast'),
  shighwayw:  { name: 'Highway site west', code: 'L11', plot: 'sland', x: 470, y: 1114, w: 360, h: 108, field: 1 },
  shighwaye:  { name: 'Highway site east', code: 'L12', plot: 'sland', x: 1170, y: 1114, w: 360, h: 108, field: 1 },
  sfarwest:   southSite('farwest', 'Far south-west site', 'L13', 'sfarwest'),
  sfareast:   southSite('fareast', 'Far south-east site', 'L14', 'sfareast'),
});
export const SOUTH_PARKING_ORDER = ['sfront', 'swest', 'seast', 'shighwayw', 'shighwaye', 'sfarwest', 'sfareast'];
export const slotField = (slot) => (SLOTS[slot] && SLOTS[slot].field) || 0;
// World coordinates of a point in a slot's field.
export function toWorld(field, x, y) { return field ? { x, y: SOUTH_M - y } : { x, y }; }

export function slotCenter(slotId) {
  const s = SLOTS[slotId];
  const b = s.row === 'main' ? MAIN_BLDG : MID_BLDG;
  return { x: (s.x0 + s.x1) / 2, y: (b.y0 + b.y1) / 2 };
}

export function slotBuilding(slotId) {
  const s = SLOTS[slotId];
  const b = s.row === 'main' ? MAIN_BLDG : MID_BLDG;
  return { x: s.x0, y: b.y0, w: s.x1 - s.x0, h: b.y1 - b.y0 };
}

// The same in world coordinates (the south field is mirrored).
export function slotBuildingW(slotId) {
  const b = slotBuilding(slotId);
  return SLOTS[slotId].field ? flipRect(b) : b;
}
export function slotCenterW(slotId) {
  const c = slotCenter(slotId);
  return toWorld(SLOTS[slotId].field, c.x, c.y);
}

// Stands sit at fixed places along the pier so adding a gate never moves an
// aircraft already parked. Gates fill from the middle outwards.
const STAND_ORDER = [1, 2, 0, 3];
export function gateStand(slotId, i) {
  const s = SLOTS[slotId];
  const cx = (s.x0 + s.x1) / 2;
  const k = STAND_ORDER[i] ?? i;
  return {
    x: cx + (k - 1.5) * GATE_SPACING,
    y: s.row === 'main' ? MAIN_STAND_Y : MID_STAND_Y,
    laneY: s.row === 'main' ? LANE2 : TWY_B,
  };
}

export function lanesFor(plots) {
  return TAXILANES.filter((L) => plots[L.plot]);
}

// The southbound lane nearest to the west of x, and the northbound one
// nearest to the east of x.
function laneIn(x, plots) {
  let best = null;
  for (const L of lanesFor(plots)) if (L.dir === 'S' && L.x < x && (!best || L.x > best.x)) best = L;
  return best ? best.x : 825;
}
function laneOut(x, plots) {
  let best = null;
  for (const L of lanesFor(plots)) if (L.dir === 'N' && L.x > x && (!best || L.x < best.x)) best = L;
  return best ? best.x : 1175;
}

// Taxiway B, west and east ends, depend on the land you own.
export function twyBSpan(plots) {
  return [plots.farwest ? 90 : 200, plots.fareast ? 1905 : 1820];
}

// From the end of a runway exit (on taxiway A at exitX) to a gate stand.
// A runs east, B runs west. Main-row gates: take the southbound taxilane west
// of the gate, east along A if it is ahead, otherwise straight across onto B
// and west. Midfield gates face B: always arrive along B, so nobody ever cuts
// across B in front of a stand; join it at the first link east of the gate
// (a runway exit or a northbound taxilane).
export function pathExitToGate(exitX, stand, plots) {
  const pts = [{ x: exitX, y: TWY_A }];
  if (stand.laneY === TWY_B) {
    const links = EXITS.concat(lanesFor(plots).filter((L) => L.dir === 'N').map((L) => L.x)).sort((a, b) => a - b);
    let join = exitX;
    if (stand.x > exitX) join = links.find((x) => x >= stand.x) || links[links.length - 1];
    pts.push({ x: join, y: TWY_A }, { x: join, y: TWY_B }, { x: stand.x, y: TWY_B }, { x: stand.x, y: stand.y });
    return dedupe(pts);
  }
  const turnX = laneIn(stand.x, plots);
  if (turnX >= exitX) {
    pts.push({ x: turnX, y: TWY_A });
  } else {
    // Straight across A onto B, then west.
    pts.push({ x: exitX, y: TWY_B }, { x: turnX, y: TWY_B });
  }
  pts.push({ x: turnX, y: LANE2 }, { x: stand.x, y: LANE2 }, { x: stand.x, y: stand.y });
  return dedupe(pts);
}

// After pushback the aircraft sits on its lane, nose to the terminal.
export function pathGateToHold(stand, plots) {
  const pts = [{ x: stand.x, y: stand.laneY }];
  if (stand.laneY === LANE2) {
    const L = laneOut(stand.x, plots);
    pts.push({ x: L, y: LANE2 }, { x: L, y: TWY_B });
  }
  pts.push({ x: B_TURN_X, y: TWY_B }, { x: HOLD_POINT.x, y: HOLD_POINT.y });
  return dedupe(pts);
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q.x - p.x) > 0.5 || Math.abs(q.y - p.y) > 0.5) out.push(p);
  }
  return out;
}

// ------------------------------------------------------------- connectors
// Route geometry from the main terminal to a satellite, per connector type.
export function connectorRoute(type, slotId) {
  const s = SLOTS[slotId];
  const c = slotCenter(slotId);
  const west = c.x < 1000;
  if (s.field) return southRoute(type, slotId);
  if (type === 'walkway') {
    return [{ x: MAIN_CENTER.x, y: MAIN_CENTER.y }, { x: west ? 860 : 1140, y: MAIN_CENTER.y }, { x: west ? s.x1 : s.x0, y: MAIN_CENTER.y }, { x: c.x, y: MAIN_CENTER.y }];
  }
  if (type === 'shuttle') {
    if (s.row === 'main') {
      return [{ x: MAIN_CENTER.x, y: SERVICE_Y }, { x: c.x, y: SERVICE_Y }];
    }
    const sx = busCrossX(slotId);
    return [{ x: MAIN_CENTER.x, y: SERVICE_Y }, { x: sx, y: SERVICE_Y }, { x: sx, y: MID_BLDG.y1 + 9 }, { x: c.x, y: MID_BLDG.y1 + 9 }];
  }
  if (type === 'monorail') {
    if (s.row === 'main') return [{ x: MAIN_CENTER.x, y: 660 }, { x: c.x, y: 660 }];
    const mx = west ? 905 : 1095;
    return [{ x: mx, y: 640 }, { x: mx, y: 560 }, { x: c.x, y: 520 }, { x: c.x, y: 470 }];
  }
  // tunnel: straight underground
  return [{ x: MAIN_CENTER.x, y: 688 }, { x: c.x, y: s.row === 'main' ? 688 : 458 }];
}

// To the south field: under the highway along the spine road, over it on
// the monorail, or straight under everything in the tunnel.
function southRoute(type, slotId) {
  const s = SLOTS[slotId];
  const c = slotCenter(slotId);
  const w = (y) => SOUTH_M - y;
  if (type === 'shuttle') {
    const pts = [{ x: MAIN_CENTER.x, y: SERVICE_Y }, { x: SPINE_X, y: SERVICE_Y }, { x: SPINE_X, y: w(SERVICE_Y) }];
    if (s.row === 'main') pts.push({ x: c.x, y: w(SERVICE_Y) });
    else { const sx = busCrossX(slotId); pts.push({ x: sx, y: w(SERVICE_Y) }, { x: sx, y: w(MID_BLDG.y1 + 9) }, { x: c.x, y: w(MID_BLDG.y1 + 9) }); }
    return dedupe(pts);
  }
  if (type === 'monorail') {
    const end = s.row === 'main' ? w(660) : w(470);
    return dedupe([{ x: MAIN_CENTER.x, y: 700 }, { x: 1060, y: 700 }, { x: 1060, y: w(700) }, { x: c.x, y: w(700) }, { x: c.x, y: end }]);
  }
  return [{ x: MAIN_CENTER.x, y: 688 }, { x: c.x, y: w(s.row === 'main' ? 688 : 458) }];
}

function busCrossX(slotId) {
  return slotCenter(slotId).x < 1000 ? 848 : 1152;
}

// Where a shuttle crosses the apron lane. Aircraft and buses take turns.
// y is in world coordinates, ly in the slot's field.
export function apronCrossing(slotId) {
  const s = SLOTS[slotId];
  if (s.row !== 'mid') return null;
  const f = s.field || 0;
  return { x: busCrossX(slotId), y: f ? SOUTH_M - LANE2 : LANE2, ly: LANE2, field: f };
}
