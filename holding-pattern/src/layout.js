// The airfield's geometry. Every airport shares this plan: what differs is
// which land parcels you own and what you have built on them.
//
//   north   runway 2 (y 80)  + taxiway C
//   strip   runway 1 (y 210) + taxiways A and B
//   apron   midfield concourses (stands off taxiway B)
//           apron lane (y 560), reached by four north–south taxilanes
//           main terminal row (stands off the apron lane)
//   land    service road, curb, car parks; highway along the bottom

export const RW = [
  { id: 0, y: 210, x0: 270, x1: 1730, exitY: 258 },
  { id: 1, y: 80, x0: 270, x1: 1730, exitY: 122 },
];
export const TWY_A = 258;
export const TWY_B = 292;
export const LANE2 = 560;
export const RUNWAY_HALF = 17;
export const EXITS = [580, 760, 960];
export const LONG_RUNWAY_X1 = 1880;
export const HOLD_POINT = { x: 225, y: TWY_B };
export const IAF = { x: 60 };
export const TAXILANES = [445, 825, 1175, 1555];

export const MAIN_STAND_Y = 603;
export const MID_STAND_Y = 340;
export const MAIN_BLDG = { y0: 632, y1: 722 };
export const MID_BLDG = { y0: 368, y1: 452 };
export const SERVICE_Y = 733;
export const CURB_Y = 752;
export const HIGHWAY_Y = 1090;
export const RAMP_IN_X = 862;
export const RAMP_OUT_X = 1138;
export const SECURITY = { x: 1000, y: 690 };
export const MAIN_CENTER = { x: 1000, y: 677 };
export const GATE_SPACING = 62;

// Land you can own. Core comes with the airport.
export const PLOTS = {
  core:    { name: 'Airfield core',  rects: [{ x: 180, y: 150, w: 1640, h: 160 }, { x: 800, y: 310, w: 400, h: 630 }], price: 0 },
  west:    { name: 'West apron',     rects: [{ x: 430, y: 310, w: 370, h: 630 }], price: 16000 },
  east:    { name: 'East apron',     rects: [{ x: 1200, y: 310, w: 370, h: 630 }], price: 16000 },
  farwest: { name: 'Far west field', rects: [{ x: 80, y: 310, w: 350, h: 630 }], price: 70000, needs: 'west' },
  fareast: { name: 'Far east field', rects: [{ x: 1570, y: 310, w: 350, h: 630 }], price: 70000, needs: 'east' },
  south:   { name: 'South landside', rects: [{ x: 430, y: 940, w: 1140, h: 190 }], price: 38000 },
  north:   { name: 'North field',    rects: [{ x: 180, y: 25, w: 1640, h: 125 }], price: 140000 },
};
export const PLOT_ORDER = ['west', 'east', 'south', 'farwest', 'fareast', 'north'];

// Terminal sites. 'main' is the original terminal: security and the curb are
// there, so every other terminal needs a connector back to it.
export const SLOTS = {
  main:      { name: 'Main Terminal',      row: 'main', x0: 860, x1: 1140, plot: 'core', maxGates: 4, adjacent: false },
  midcenter: { name: 'Midfield Concourse', row: 'mid',  x0: 872, x1: 1128, plot: 'core', maxGates: 4, adjacent: false },
  westwing:  { name: 'West Pier',          row: 'main', x0: 490, x1: 795, plot: 'west', maxGates: 5, adjacent: true },
  midwest:   { name: 'West Midfield',      row: 'mid',  x0: 482, x1: 790, plot: 'west', maxGates: 5, adjacent: false },
  eastwing:  { name: 'East Pier',          row: 'main', x0: 1205, x1: 1510, plot: 'east', maxGates: 5, adjacent: true },
  mideast:   { name: 'East Midfield',      row: 'mid',  x0: 1210, x1: 1518, plot: 'east', maxGates: 5, adjacent: false },
  farwest:   { name: 'West Remote',        row: 'main', x0: 110, x1: 400, plot: 'farwest', maxGates: 5, adjacent: false },
  fareast:   { name: 'East Remote',        row: 'main', x0: 1600, x1: 1890, plot: 'fareast', maxGates: 5, adjacent: false },
};
export const SLOT_ORDER = ['main', 'midcenter', 'westwing', 'eastwing', 'midwest', 'mideast', 'farwest', 'fareast'];
// Concourse letters, as on real airport signage: gates are A1, B3 and so on.
export const TERMINAL_CODES = { main: 'A', midcenter: 'B', westwing: 'C', eastwing: 'D', midwest: 'E', mideast: 'F', farwest: 'G', fareast: 'H' };

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

export function gateStand(slotId, i, n) {
  const s = SLOTS[slotId];
  const cx = (s.x0 + s.x1) / 2;
  return {
    x: cx + (i - (n - 1) / 2) * GATE_SPACING,
    y: s.row === 'main' ? MAIN_STAND_Y : MID_STAND_Y,
    laneY: s.row === 'main' ? LANE2 : TWY_B,
  };
}

function nearestLane(x, avoid = -1) {
  let best = TAXILANES[1], bd = Infinity;
  for (const L of TAXILANES) {
    if (L === avoid) continue;
    const d = Math.abs(L - x);
    if (d < bd) { bd = d; best = L; }
  }
  return best;
}

// Lanes usable with the plots owned. 445 needs the west apron, 1555 the east.
export function lanesFor(plots) {
  return TAXILANES.filter((L) => (L === 445 ? plots.west : L === 1555 ? plots.east : true));
}

function nearestOwnedLane(x, plots) {
  const lanes = lanesFor(plots);
  let best = lanes[0], bd = Infinity;
  for (const L of lanes) { const d = Math.abs(L - x); if (d < bd) { bd = d; best = L; } }
  return best;
}

// Path from a runway exit (already on taxiway A) to a gate stand.
export function pathExitToGate(exitX, stand, plots) {
  const pts = [{ x: exitX, y: TWY_A }];
  if (stand.laneY === TWY_B) {
    pts.push({ x: stand.x, y: TWY_A }, { x: stand.x, y: stand.y });
  } else {
    const L = nearestOwnedLane(stand.x, plots);
    pts.push({ x: L, y: TWY_A }, { x: L, y: LANE2 }, { x: stand.x, y: LANE2 }, { x: stand.x, y: stand.y });
  }
  return dedupe(pts);
}

// Path from a remote hold spot to a gate (used after waiting for a gate).
export function pathFromTo(from, stand, plots) {
  const pts = [{ x: from.x, y: from.y }];
  if (from.y !== TWY_A) pts.push({ x: from.x, y: TWY_A });
  return dedupe(pts.concat(pathExitToGate(from.x, stand, plots)));
}

// After pushback the aircraft sits on its lane facing the terminal.
export function pathGateToHold(stand, plots) {
  const pts = [{ x: stand.x, y: stand.laneY }];
  if (stand.laneY === LANE2) {
    const L = nearestOwnedLane(stand.x, plots);
    pts.push({ x: L, y: LANE2 }, { x: L, y: TWY_B });
  }
  pts.push({ x: HOLD_POINT.x + 30, y: TWY_B }, { x: HOLD_POINT.x, y: TWY_B });
  return dedupe(pts);
}

// Where planes wait when their terminal has no free gate.
export const WAIT_SPOTS = [
  { x: 1450, y: TWY_A }, { x: 1530, y: TWY_A }, { x: 1610, y: TWY_A }, { x: 1690, y: TWY_A },
  { x: 1370, y: TWY_A }, { x: 1290, y: TWY_A },
];

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
  if (type === 'walkway') {
    return [{ x: MAIN_CENTER.x, y: MAIN_CENTER.y }, { x: west ? 860 : 1140, y: MAIN_CENTER.y }, { x: west ? s.x1 : s.x0, y: MAIN_CENTER.y }, { x: c.x, y: MAIN_CENTER.y }];
  }
  if (type === 'shuttle') {
    if (s.row === 'main') {
      return [{ x: MAIN_CENTER.x, y: SERVICE_Y }, { x: c.x, y: SERVICE_Y }];
    }
    const sx = west ? 848 : 1152;
    return [{ x: MAIN_CENTER.x, y: SERVICE_Y }, { x: sx, y: SERVICE_Y }, { x: sx, y: 470 }, { x: c.x, y: 470 }];
  }
  if (type === 'monorail') {
    if (s.row === 'main') return [{ x: MAIN_CENTER.x, y: 662 }, { x: c.x, y: 662 }];
    const mx = west ? 905 : 1095;
    return [{ x: mx, y: 645 }, { x: mx, y: 520 }, { x: c.x, y: 490 }, { x: c.x, y: 430 }];
  }
  // tunnel: straight underground
  return [{ x: MAIN_CENTER.x, y: 690 }, { x: c.x, y: s.row === 'main' ? 690 : 420 }];
}

// Where a shuttle crosses the apron lane — aircraft must yield there.
export function apronCrossing(slotId) {
  const s = SLOTS[slotId];
  if (s.row !== 'mid') return null;
  const west = slotCenter(slotId).x < 1000;
  return { x: west ? 848 : 1152, y: LANE2 };
}
