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

function busCrossX(slotId) {
  return slotCenter(slotId).x < 1000 ? 848 : 1152;
}

// Where a shuttle crosses the apron lane. Aircraft and buses take turns.
export function apronCrossing(slotId) {
  const s = SLOTS[slotId];
  if (s.row !== 'mid') return null;
  return { x: busCrossX(slotId), y: LANE2 };
}
