// The airport simulation. One Airport object per owned site; all of them run
// every frame whether or not they are on screen. No DOM, no canvas: the
// renderer reads this state and listens to `ap.fx` for things worth drawing.

import {
  AIRCRAFT, AIRCRAFT_ORDER, FLIGHT, PAX, STAFFING, COSTS, TERMINAL, CONNECTORS,
  UPGRADES, SECURITY as SEC, PARKING, LEVELS, UNLOCKS, SITES, NETWORK, CONTRACTS,
  LANDSIDE, LANDSIDE_ORDER, HANGAR, DEMOLISH_REFUND, MANAGER,
  AIRLINES, CITIES, WEATHER, GOLD, BREAKDOWNS,
} from './config.js';
import {
  RW, RUNWAY_HALF, TWY_A, TWY_B, LANE2, EXITS, HOLD_POINT, IAF, PLOTS, SLOTS, LONG_RUNWAY_X1,
  gateStand, pathExitToGate, pathGateToHold, lanesFor, XW, XW_HOLD, pathGateToCrosswind, crosswindTakeoff,
  connectorRoute, apronCrossing, slotCenter, TERMINAL_CODES, PARKING_SITES, placeName,
  slotField, SLOT_ORDER, PLOT_ORDER, PARKING_ORDER,
} from './layout.js';
import {
  HUB_SLOT_ORDER, HUB_PLOT_ORDER, HUB_NO_PLOTS, HUB_NO_SLOTS, POCKETS, STAR, STAR_LINES, STAR_THRESHOLD, STAR_EXIT, STAR_LANE,
  WEDGES, starPoint, siteFields, EXPAND_TERMINALS,
} from './hub.js';
import { mulberry32, clamp, dist, pick, pathLength, pointAlong, money } from './util.js';

const DEG = Math.PI / 180;

// ======================================================================
// creation & persistence
// ======================================================================

export function createAirport(siteIndex, seed = Date.now()) {
  const site = SITES[siteIndex];
  const ap = {
    siteIndex,
    id: site.id,
    name: site.name,
    // the hub comes with its south field and the star; the north, east and
    // west fields are for sale
    plots: site.hub ? { core: true, west: true, east: true, south: true } : { core: true },
    hubV: site.hub ? 2 : undefined,
    terminals: [newTerminal('main', true)],
    securityLanes: SEC.startLanes,
    upgrades: site.hub ? { longRunway: true, rapidExits: true, radar: true } : site.longRunway ? { longRunway: true } : {},
    parking: { front: 'lot' },
    hangars: {},
    staffing: { atc: 'standard', security: 'standard', ground: 'standard' },
    contracts: [],
    offers: [],
    paxServed: 0,
    level: 1,
    rep: 62,
    nextOfferAt: 6,
    flightCounter: 0,
    t: 0,
    weather: { stormUntil: 0, nextStorm: 300 },
    perMin: { net: 0, operating: 0 },
    lifetime: { revenue: 0, flights: 0 },
  };
  hydrate(ap, seed);
  // Every airport opens with one small route so the field is alive at once.
  const starter = rollOffer(ap, null, 'regional');
  starter.bonus = 0;
  ap.offers.push(starter);
  acceptOffer({ cash: 0 }, ap, starter.id, 'main');
  ap.contracts[0].nextStd = ap.t + 8;
  return ap;
}

function newTerminal(slot, built, gates = TERMINAL.startGates) {
  return {
    slot,
    gates,
    heavy: false,
    retail: 0,
    buildLeft: built ? 0 : TERMINAL.buildTime,
    connector: null,
  };
}

// Transient state is rebuilt on load: aircraft, queues, rolling stats.
export function hydrate(ap, seed = Date.now()) {
  ap.rand = mulberry32(seed);
  ap.planes = [];
  ap.flights = new Map();
  ap.secQ = new PaxQueue();
  ap.holdQueue = [];
  ap.holdPhase = 0;
  ap.zonesKey = '';
  ap.busBlocks = [];
  ap.depQueue = [];
  // the two parallel runways, then the crosswind (departures only)
  ap.runways = newRunways();
  ap.depQueueX = [];
  ap.atcTokens = 2;
  ap.ledger = [];
  ap.bucket = {};
  ap.bucketT = 0;
  ap.rolling = { otp: 0.9, missed: 0, crowd: 0, secWait: 0, flowPerMin: 0, landsidePerMin: 0 };
  ap.nextPlaneId = 1;
  ap.fx = null;
  ap.events = [];
  ap.buses = [];
  for (const T of ap.terminals) {
    T.waiting = new Map();
    T.arrivingHere = 0;
    if (T.connector) hydrateConnector(T, ap);
  }
  for (const c of ap.contracts) {
    c.nextStd = ap.t + 20 + ap.rand() * 30;
    c.otpHist = c.otpHist || [];
    c.unhappyFor = c.unhappyFor || 0;
  }
  ap.weather.stormUntil = 0;
  ap.weather.nextStorm = ap.t + 240;
  const extra = siteFields(ap.siteIndex);
  if (extra.length) {
    const views = {};
    for (const k of SITES[ap.siteIndex].hub ? [...extra, 'X'] : extra) views[k] = makeField(ap, k);
    Object.defineProperty(ap, 'fieldViews', { value: views, enumerable: false, configurable: true, writable: true });
  }
  ap.costLines = computeCosts(ap);
  return ap;
}

// the two parallel runways, then the crosswind (departures only)
function newRunways() {
  return [...RW, XW].map(() => ({ occupant: null, clearEta: 0, reservedArr: null, crossers: new Set() }));
}

// The hub's other airfields run the same aircraft code as the main one, in
// their own coordinates, on a view of the airport that has its own
// aircraft, queues, runways and tower, and sees only its own terminals and
// land. Everything else (money, flights, passengers, contracts) is shared:
// reads and writes go straight through to the airport. The star field ('X')
// has its own runway logic (updateStarPlanes); the pockets are the usual
// plan, turned (hub.js).
const FIELD_KEYS = new Set(['planes', 'holdQueue', 'holdPhase', 'depQueue', 'depQueueX', 'depQueues', 'lastMoves', 'runways', 'atcTokens',
  'arrGround', 'lastMove', 'zones', 'zonesKey', 'busBlocks', 'nextPlaneId', 'field', 'centreFree']);
function makeField(ap, key) {
  const S = { field: key, planes: [], holdQueue: [], holdPhase: 0, depQueue: [], depQueueX: [], depQueues: [[], [], []], lastMoves: [null, null, null],
    runways: newRunways(), atcTokens: 2, arrGround: 0, lastMove: null, zones: null, zonesKey: '', busBlocks: [], centreFree: 0,
    nextPlaneId: 100000 * (1 + 'NEWX'.indexOf(key)) };
  const k = key.toLowerCase();
  // effects carry the field they happened in, for the renderer to place
  const fx = (type, e) => { if (ap.fx) ap.fx(type, { ...e, field: key }); };
  // The field's land, upgrades and terminals are read many times a step:
  // each view is kept until what it is made from changes. (Land and
  // upgrades are only ever added; terminals are added or the list replaced.)
  const memo = { plots: null, pk: '', up: null, uk: null, un: -1, terms: null, tk: null, tn: -1 };
  const plotsOf = (t) => {
    if (key === 'X') return memo.plots || (memo.plots = { core: true });
    const P = t.plots, pk = `${!!P[k + '.core']}${!!P[k + '.west']}${!!P[k + '.east']}${!!P[k + '.farwest']}`;
    if (pk !== memo.pk) { memo.pk = pk; memo.plots = { core: !!P[k + '.core'], west: !!P[k + '.west'], east: !!P[k + '.east'], farwest: !!P[k + '.farwest'] }; }
    return memo.plots;
  };
  const upgradesOf = (t) => {
    const U = t.upgrades, n = Object.keys(U).length;
    if (U !== memo.uk || n !== memo.un) { memo.uk = U; memo.un = n; memo.up = { ...U, runway2: false, crosswind: false, longRunway: false }; }
    return memo.up;
  };
  const terminalsOf = (t) => {
    const L = t.terminals;
    if (L !== memo.tk || L.length !== memo.tn) { memo.tk = L; memo.tn = L.length; memo.terms = L.filter((T) => slotField(T.slot) === key); }
    return memo.terms;
  };
  return new Proxy(ap, {
    get(t, prop) {
      if (FIELD_KEYS.has(prop)) return S[prop];
      if (prop === 'plots') return plotsOf(t);
      if (prop === 'upgrades') return upgradesOf(t);
      if (prop === 'terminals') return terminalsOf(t);
      if (prop === 'fx') return t.fx ? fx : null;
      return t[prop];
    },
    set(t, prop, v) {
      if (FIELD_KEYS.has(prop)) S[prop] = v; else t[prop] = v;
      return true;
    },
  });
}
// Which of the hub's airfields are open: the star always, a pocket once
// its land is bought.
export function hasField(ap, key) { return !!(ap.fieldViews && ap.fieldViews[key] && (key === 'X' || ap.plots[key.toLowerCase() + '.core'])); }
// The field a terminal's aircraft use: the airport itself, or one of the hub's.
export function fieldFor(ap, slot) { const f = slotField(slot); return f && hasField(ap, f) ? ap.fieldViews[f] : ap; }
export function fields(ap) { return ap.fieldViews ? [ap, ...Object.keys(ap.fieldViews).filter((k) => hasField(ap, k)).map((k) => ap.fieldViews[k])] : [ap]; }
export function allPlanes(ap) { const F = fields(ap); return F.length > 1 ? F.flatMap((x) => x.planes) : ap.planes; }
export function allHolding(ap) { const F = fields(ap); return F.length > 1 ? F.flatMap((x) => x.holdQueue) : ap.holdQueue; }
const isStar = (F) => F.field === 'X';

function hydrateConnector(T, ap) {
  const C = T.connector;
  C.outQ = new PaxQueue(); C.inQ = new PaxQueue(); C.transit = [];
  C.brokenUntil = 0;
  C.route = connectorRoute(C.type, T.slot, ap.siteIndex);
  C.len = pathLength(C.route);
}

export function serializeAirport(ap) {
  return {
    siteIndex: ap.siteIndex,
    plots: ap.plots,
    terminals: ap.terminals.filter((T) => !T.demolishing).map((T) => ({
      slot: T.slot, gates: T.gates, heavy: T.heavy, retail: T.retail, buildLeft: T.buildLeft,
      connector: T.connector ? { type: T.connector.type, level: T.connector.level, buses: T.connector.buses, buildLeft: T.connector.buildLeft } : null,
      pendingConnector: T.pendingConnector ? { ...T.pendingConnector } : undefined,
    })),
    securityLanes: ap.securityLanes,
    upgrades: ap.upgrades,
    parking: ap.parking,
    hangars: ap.hangars,
    manager: !!ap.manager,
    staffing: ap.staffing,
    contracts: ap.contracts.map((c) => ({ ...c, otpHist: c.otpHist.slice(-12) })),
    offers: [],
    paxServed: ap.paxServed,
    level: ap.level,
    rep: ap.rep,
    flightCounter: ap.flightCounter,
    t: ap.t,
    weather: { stormUntil: 0, nextStorm: 0 },
    perMin: ap.perMin,
    lifetime: ap.lifetime,
    nextOfferAt: ap.t + 10,
    hubV: ap.hubV,
    expandReady: ap.expandReady || undefined,
    breakdowns: ap.breakdowns && ap.breakdowns.length ? ap.breakdowns.map((b) => ({ ...b, mgrAt: undefined, t0: 0 })) : undefined,
  };
}

export function restoreAirport(data) {
  const site = SITES[data.siteIndex];
  const ap = { ...data, id: site.id, name: site.name };
  if (ap.breakdowns) ap.breakdowns = Array.isArray(ap.breakdowns) ? ap.breakdowns.filter((b) => b && BD_KIND[b.kind] && Number.isFinite(b.cost)) : undefined;
  for (const T of ap.terminals) {
    if (T.connector) T.connector = { ...T.connector };
    if (T.pendingConnector) T.pendingConnector = { ...T.pendingConnector };
    else delete T.pendingConnector;
  }
  // a shared save code goes into the page's HTML: keep what it says plain
  for (const c of ap.contracts || []) {
    if (!/^#[0-9a-fA-F]{3,8}$/.test(String(c.color))) c.color = '#9aa0a6';
    if (typeof c.id === 'string') c.id = c.id.replace(/[^\w.-]/g, '');
  }
  ap.upgrades = { ...ap.upgrades };
  if (site.longRunway) ap.upgrades.longRunway = true;
  if (!ap.perMin || !Object.values(ap.perMin).every(Number.isFinite)) ap.perMin = { net: 0, operating: 0 };
  // Older saves had two garage upgrades instead of car park sites.
  ap.parking = data.parking ? { ...data.parking } : { front: 'lot' };
  ap.hangars = { ...(ap.hangars || {}) };
  if (ap.upgrades.garage1) ap.parking.southwest = 'garage';
  if (ap.upgrades.garage2) ap.parking.southeast = 'garage';
  delete ap.upgrades.garage1; delete ap.upgrades.garage2;
  if (site.hub && ap.hubV !== 2) migrateHub(ap);
  // land and runways the hub can't have (an advisor bug once sold them)
  if (site.hub) {
    for (const id of Object.keys(ap.plots)) if (!plotAvailable(ap, id)) delete ap.plots[id];
    delete ap.upgrades.runway2; delete ap.upgrades.crosswind;
  }
  // (after the hub's move: older hub saves had sites that no longer exist)
  ap.terminals = ap.terminals.filter((T) => SLOTS[T.slot]);
  for (const T of ap.terminals) T.gates = Math.min(T.gates, maxGates(ap, T.slot)); // older saves allowed 5
  hydrate(ap);
  return ap;
}

// Older saves of the hub had the usual plan (and, for a while, a mirrored
// second airfield). Keep what fits the new layout, move the rest of the
// terminals to the new sites (with the land they need, free), and drop
// what has nowhere to go.
function migrateHub(ap) {
  ap.hubV = 2;
  const keep = new Set(['core', 'west', 'east', 'south']);
  for (const id of Object.keys(ap.plots)) if (!keep.has(id)) delete ap.plots[id];
  delete ap.upgrades.runway2; delete ap.upgrades.crosswind;
  const free = HUB_SLOT_ORDER.slice();
  const moved = {};
  for (const T of ap.terminals) {
    if (SLOTS[T.slot] && !SLOTS[T.slot].field && !HUB_NO_SLOTS.has(T.slot)) continue;
    const to = free.shift();
    if (!to) { T.gone = true; continue; }
    moved[T.slot] = to;
    T.slot = to;
    T.gates = Math.min(T.gates, SLOTS[to].maxGates);
    if (T.connector && T.connector.type !== 'tunnel' && T.connector.type !== 'monorail') T.connector = { type: 'tunnel', level: 0, buses: 0, buildLeft: 0 };
    delete T.pendingConnector;
    const plot = SLOTS[to].plot;
    for (let pl = plot; pl && pl !== 'core'; pl = PLOTS[pl].needs) ap.plots[pl] = true; // with the land it needs
  }
  ap.terminals = ap.terminals.filter((T) => !T.gone);
  for (const c of ap.contracts) if (moved[c.terminal]) c.terminal = moved[c.terminal]; else if (!SLOTS[c.terminal] || HUB_NO_SLOTS.has(c.terminal)) c.terminal = 'main';
  for (const id of Object.keys(ap.hangars)) if (!SLOTS[id] || HUB_NO_SLOTS.has(id) || SLOTS[id].field) delete ap.hangars[id];
  for (const id of Object.keys(ap.parking)) if (!PARKING_SITES[id] || !keep.has(PARKING_SITES[id].plot)) delete ap.parking[id];
}

// ======================================================================
// derived numbers
// ======================================================================

export const site = (ap) => SITES[ap.siteIndex];
// A place name as the player sees it at this airport.
export const nm = (ap, name) => placeName(!!SITES[ap.siteIndex].mirror, name);
// Sites with room for a crosswind runway keep the far east field for it.
// The island has room for one terminal and one car park, nothing more.
export function slotAvailable(ap, slot) {
  if (site(ap).island) return slot === 'main';
  const S = SLOTS[slot];
  if (!S) return false;
  if (S.field) return site(ap).hub || (!S.hubOnly && grown(ap) && siteFields(ap.siteIndex).includes(S.field));
  if (site(ap).hub) return !HUB_NO_SLOTS.has(slot);
  return !(site(ap).crosswind && slot === 'fareast');
}
// Land this airport can ever own: another airfield's once it has grown.
export function plotAvailable(ap, id) {
  const P = PLOTS[id];
  if (site(ap).island) return id === 'core';
  if (!P) return false;
  if (P.field) return site(ap).hub || (!P.hubOnly && grown(ap) && siteFields(ap.siteIndex).includes(P.field));
  if (site(ap).hub) return !HUB_NO_PLOTS.has(id);
  return true;
}
// Room to grow: an airport that can add airfields, once it has this many
// terminals built out to every gate. Then it stays grown.
export const canGrow = (ap) => !site(ap).hub && siteFields(ap.siteIndex).length > 0;
export const grown = (ap) => !!ap.expandReady;
export function growProgress(ap) {
  return ap.terminals.filter((T) => isOpen(T) && !slotField(T.slot) && T.gates >= maxGates(ap, T.slot)).length;
}
// Every terminal site, parcel and landside site this airport can have.
export const slotList = (ap) => (ap.fieldViews ? SLOT_ORDER.concat(HUB_SLOT_ORDER) : SLOT_ORDER).filter((id) => slotAvailable(ap, id));
export const plotList = (ap) => (ap.fieldViews ? PLOT_ORDER.concat(HUB_PLOT_ORDER) : PLOT_ORDER).filter((id) => plotAvailable(ap, id));
export const parkingList = (ap) => PARKING_ORDER;
export function parkingAvailable(ap, id) {
  if (site(ap).island) return id === 'front';
  if (site(ap).hub) return !HUB_NO_PLOTS.has(PARKING_SITES[id].plot);
  return !(site(ap).crosswind && id === 'fareast');
}
// Why a site can't be used here.
const noRoom = (ap) => (site(ap).island ? 'No room on the island' : site(ap).hub ? 'No room at the hub' : 'Kept for the crosswind runway');
// Gates a terminal can grow to here (rural sites build small).
export function maxGates(ap, slot) { return Math.min(SLOTS[slot].maxGates, site(ap).maxGates || Infinity); }
export const builtTerminals = (ap) => ap.terminals.filter((T) => isOpen(T));
export const terminalBySlot = (ap, slot) => ap.terminals.find((T) => T.slot === slot);

export function isOpen(T) {
  return !T.demolishing && T.buildLeft <= 0 && (T.slot === 'main' || (T.connector && T.connector.buildLeft <= 0));
}

// Runways in this field (the star has three); totalRunways counts every
// field the airport has.
export function runwayCount(ap) { return isStar(ap) ? 3 : ap.upgrades.runway2 ? 2 : 1; }
export function totalRunways(ap) { return fields(ap).reduce((n, F) => n + runwayCount(F), 0); }
// Runways to maintain: the crosswind (departures only) too.
const runwaysKept = (ap) => totalRunways(ap) + (ap.upgrades.crosswind ? 1 : 0);

export function staffing(ap, dept) { return STAFFING[ap.staffing[dept]]; }

export function controllers(ap) {
  // One per runway and one per terminal: every terminal adds ground
  // movements that need their own controller.
  return fields(ap).reduce((n, F) => n + fieldControllers(F), 0);
}
// The ones working one field: each field has its own tower.
function fieldControllers(F) {
  const f = F.field || 0;
  return runwayCount(F) + F.terminals.filter((T) => T.buildLeft <= 0 && slotField(T.slot) === f).length;
}

// (loadReport plans for clear skies: a storm passes in a minute or so, and
// the ops board shows it while it lasts)
let clearSkies = false;
export function stormFactor(ap) {
  if (clearSkies || ap.t >= ap.weather.stormUntil) return 1;
  return ap.upgrades.cat3 ? WEATHER.stormRunwayCat3 : WEATHER.stormRunway;
}

export function atcCapacity(ap) {
  let per = COSTS.movementsPerController;
  if (ap.upgrades.radar) per *= UPGRADES.radar.atc;
  if (ap.upgrades.automation) per *= UPGRADES.automation.atc;
  return fieldControllers(ap) * per * staffing(ap, 'atc').capacity * stormFactor(ap);
}

// Departures a minute the crosswind runway handles on its own (measured
// with tools/runway.mjs).
export const XW_DEPARTURES = 11;
// The star field's movements a minute, as a multiple of one runway's.
export const STAR_PHYSICAL = 2.2;

export function runwayPhysical(ap) {
  // Measured with tools/runway.mjs and a realistic airport: a mixed-mode
  // runway handles about 14 movements a minute, 15-16 with rapid exits. A
  // second runway (arrivals north, departures south) adds about 30%: its
  // arrivals have to cross the main runway between take-offs.
  const single = ap.upgrades.rapidExits ? 14.5 : 13;
  // The star's three runways run at once, but take-offs cross the centre
  // one at a time.
  if (isStar(ap)) return single * STAR_PHYSICAL * stormFactor(ap);
  return (ap.upgrades.runway2 ? single * 1.3 : single) * stormFactor(ap);
}

export function securityRate(ap) {
  // passengers per second
  return ap.securityLanes * PAX.securityPerLane * staffing(ap, 'security').capacity * (ap.upgrades.ctScanners ? UPGRADES.ctScanners.security : 1);
}

// Drivers a minute a car park site holds at a given level.
export function parkingSiteCap(id, level) {
  if (level !== 'lot' && level !== 'garage') return 0;
  return (id === 'front' ? PARKING.base : PARKING.lot.cap) + (level === 'garage' ? PARKING.garage.cap : 0);
}

export function parkingCapacity(ap) {
  let cap = 0;
  for (const id in ap.parking) cap += parkingSiteCap(id, ap.parking[id]);
  for (const T of ap.terminals) if (T.connector) cap -= CONNECTORS[T.connector.type].land;
  return Math.max(20, cap);
}

export function connectorCap(C, ap) {
  // passengers per second, each direction
  const def = CONNECTORS[C.type];
  if (C.buildLeft > 0) return 0;
  if (ap && C.brokenUntil > ap.t) return 0;
  if (C.type === 'shuttle') {
    const b = def.bus;
    const round = 2 * C.len / def.speed + 2 * b.dwell;
    return C.buses * b.seats / round;
  }
  return def.cap * (C.level && def.upgrade ? def.upgrade.cap : 1);
}

export function connectorTravel(C) {
  const def = CONNECTORS[C.type];
  if (C.type === 'shuttle') return C.len / def.speed + def.bus.dwell * 1.5;
  return C.len / (def.speed * (C.level && def.upgrade ? def.upgrade.speed : 1));
}

export function connectorUpkeep(C) {
  const def = CONNECTORS[C.type];
  if (C.type === 'shuttle') return C.buses * def.bus.upkeep;
  return def.upkeep + (C.level && def.upgrade ? def.upgrade.upkeep : 0);
}

export function connectorBuildCost(type, slot, ap) {
  const def = CONNECTORS[type];
  const len = pathLength(connectorRoute(type, slot, ap && ap.siteIndex));
  let cost = def.buildBase + def.buildPerPx * len;
  if (type === 'shuttle') cost += 2 * def.bus.cost;
  return Math.round(cost * site(ap).cost);
}

export function connectorAllowed(type, slot) {
  const def = CONNECTORS[type];
  // the hub's other airfields lie across runways: under them or over them
  if (SLOTS[slot].field) return type === 'tunnel' || type === 'monorail';
  return !(def.adjacentOnly && !SLOTS[slot].adjacent);
}

// Each terminal costs more than the last. At the hub the climb is per
// airfield (each has its own land, taxiways and tower), so all thirty
// sites stay within reach; the first on a new field costs the base price.
export function terminalCost(ap, slot = null) {
  const f = slot && ap.fieldViews ? slotField(slot) : null;
  const n = f == null ? ap.terminals.length - 1 // main counts as the first
    : ap.terminals.filter((T) => slotField(T.slot) === f).length - (f ? 0 : 1);
  return Math.round(TERMINAL.baseCost * Math.pow(TERMINAL.costGrowth, n) * site(ap).cost);
}
// Security lanes the main terminal has room for (the hub's checkpoint
// screens every airfield's passengers, so it is twice the size).
export const maxLanes = (ap) => SEC.maxLanes * (site(ap).hub || grown(ap) ? 2 : 1);

export function gateCost(ap, T) {
  // A gate added to a heavy terminal is built heavy: it pays its share of
  // the conversion, so the order you buy them in costs the same.
  const heavyShare = T.heavy ? TERMINAL.heavyCost / 4 : 0;
  return Math.round((TERMINAL.gateCost * Math.pow(TERMINAL.gateCostGrowth, T.gates - 3 + totalGates(ap) / 6) + heavyShare) * site(ap).cost);
}

export function heavyCost(ap, T) { return Math.round(TERMINAL.heavyCost * (T.gates / 4) * site(ap).cost); }
export function retailCost(ap, T) {
  const L = TERMINAL.retailLevels[T.retail + 1];
  return L ? Math.round(L.cost * site(ap).cost) : null;
}
export function laneCost(ap) { return Math.round(SEC.laneCost * Math.pow(SEC.laneGrowth, ap.securityLanes - 1) * site(ap).cost); }
// (a grown airport's new airfields cost less than the hub's)
export function plotCost(ap, plot) { return Math.round(PLOTS[plot].price * site(ap).cost * (PLOTS[plot].field && !site(ap).hub ? GROW_PRICE : 1)); }
const GROW_PRICE = 0.3;
// What a car park site can become next: 'lot', 'garage' or null (done).
export function parkingNext(ap, id) {
  const lv = ap.parking[id];
  if (site(ap).island && lv) return null; // no room to build up
  return !lv ? 'lot' : lv === 'lot' ? 'garage' : null;
}

// Landside sites hold a car park, a hotel, a rental car centre or a solar
// farm. What a site can be turned into from what it is now:
export function landsideOptions(ap, id) {
  const u = ap.parking[id];
  if (!parkingAvailable(ap, id)) return []; // kept for the crosswind: tear down only
  if (!u) return ['lot', ...LANDSIDE_ORDER];
  return u === 'lot' && !site(ap).island ? ['garage'] : [];
}
export function landsideDef(use) { return use === 'lot' || use === 'garage' ? PARKING[use] : LANDSIDE[use]; }
export function landsideCost(ap, id, use) { return Math.round(landsideDef(use).cost * site(ap).cost); }
export function landsideBlocked(ap, id, use) {
  const P = PARKING_SITES[id];
  if (!parkingAvailable(ap, id)) return noRoom(ap);
  if (!ap.plots[P.plot]) return `Buy the ${nm(ap, PLOTS[P.plot].name)} first`;
  if (!landsideOptions(ap, id).includes(use)) return ap.parking[id] ? 'Already built' : 'Not here';
  return null;
}
export function buildLandside(game, ap, id, use) {
  const why = landsideBlocked(ap, id, use);
  if (why) return why;
  if (!spend(game, landsideCost(ap, id, use))) return 'Not enough cash';
  ap.parking[id] = use;
  ap.costLines = computeCosts(ap);
  return null;
}
// What tearing it down gives back (the front lot came free).
export function landsideRefund(ap, id) {
  const u = ap.parking[id];
  if (!u) return 0;
  let v = 0;
  if (u === 'lot' || u === 'garage') { if (id !== 'front') v += PARKING.lot.cost; if (u === 'garage') v += PARKING.garage.cost; } else v = LANDSIDE[u].cost;
  return Math.round(v * site(ap).cost * DEMOLISH_REFUND);
}
export function demolishLandside(game, ap, id) {
  if (!ap.parking[id]) return 'Nothing to tear down';
  game.cash += landsideRefund(ap, id);
  delete ap.parking[id];
  ap.costLines = computeCosts(ap);
  return null;
}
const countUse = (ap, use) => Object.values(ap.parking).filter((u) => u === use).length;

// Terminal sites can hold a maintenance hangar instead.
export const hangarCount = (ap) => Object.keys(ap.hangars || {}).length;
export function hangarBlocked(ap, slot) {
  if (slot === 'main') return 'The main terminal stays';
  if (!slotAvailable(ap, slot)) return noRoom(ap);
  if (!ap.plots[SLOTS[slot].plot]) return 'Buy the land first';
  if (terminalBySlot(ap, slot) || ap.hangars[slot]) return 'Already built';
  return null;
}
export function hangarCost(ap) { return Math.round(HANGAR.cost * site(ap).cost); }
export function buildHangar(game, ap, slot) {
  const why = hangarBlocked(ap, slot);
  if (why) return why;
  if (!spend(game, hangarCost(ap))) return 'Not enough cash';
  ap.hangars[slot] = true;
  ap.costLines = computeCosts(ap);
  return null;
}
export function demolishHangar(game, ap, slot) {
  if (!ap.hangars[slot]) return 'Nothing to tear down';
  game.cash += Math.round(HANGAR.cost * site(ap).cost * DEMOLISH_REFUND);
  delete ap.hangars[slot];
  ap.costLines = computeCosts(ap);
  return null;
}
export function parkingCost(ap, id) {
  const next = parkingNext(ap, id);
  return next ? Math.round(PARKING[next].cost * site(ap).cost) : 0;
}
export function parkingBlocked(ap, id) {
  const P = PARKING_SITES[id];
  if (!parkingAvailable(ap, id)) return noRoom(ap);
  if (ap.parking[id] && ap.parking[id] !== 'lot' && ap.parking[id] !== 'garage') return `It is a ${landsideDef(ap.parking[id]).name.toLowerCase()}`;
  if (!ap.plots[P.plot]) return `Buy the ${nm(ap, PLOTS[P.plot].name)} first`;
  if (!parkingNext(ap, id)) return 'Full size';
  return null;
}
export function upgradeCost(ap, key) { return Math.round(UPGRADES[key].cost * site(ap).cost); }

export function totalGates(ap) { return ap.terminals.reduce((s, T) => s + T.gates, 0); }

export function repMult(ap) { return 0.72 + 0.56 * (ap.rep / 100); }

export function networkMult(game) {
  return 1 + NETWORK.paxFeePerAirport * Math.max(0, game.airports.length - 1);
}

function parkingUpkeep(ap) {
  let v = 0;
  for (const id in ap.parking) {
    const lv = ap.parking[id];
    if (lv === 'lot' || lv === 'garage') {
      if (id !== 'front') v += PARKING.lot.upkeep; // the front lot comes with the airport
      if (lv === 'garage') v += PARKING.garage.upkeep;
    } else v += LANDSIDE[lv].upkeep;
  }
  return v;
}

export function computeCosts(ap) {
  const m = site(ap).cost;
  const built = ap.terminals.filter((T) => T.buildLeft <= 0);
  const hvacMult = (ap.upgrades.hvac ? UPGRADES.hvac.hvac : 1) * (ap.upgrades.solar ? UPGRADES.solar.hvac : 1) * Math.pow(LANDSIDE.solar.hvac, countUse(ap, 'solar'));
  const gates = built.reduce((s, T) => s + T.gates, 0);
  const lines = [
    { key: 'atc', label: `Air traffic control (${controllers(ap)} controllers)`, v: controllers(ap) * COSTS.controller * staffing(ap, 'atc').cost },
    { key: 'security', label: `Security staff (${ap.securityLanes} lanes)`, v: ap.securityLanes * COSTS.securityLaneStaff * staffing(ap, 'security').cost },
    { key: 'ground', label: `Ground crews (${gates} gates)`, v: gates * COSTS.groundCrewPerGate * staffing(ap, 'ground').cost },
    { key: 'hvac', label: 'Heating, cooling & power', v: built.reduce((s, T) => s + COSTS.hvacBase + COSTS.hvacPerGate * T.gates, 0) * hvacMult },
    { key: 'cleaning', label: 'Cleaning & upkeep', v: built.length * COSTS.cleaningBase + (ap.rolling ? ap.rolling.flowPerMin : 0) * COSTS.cleaningPerPaxMin },
    { key: 'runway', label: `Runway maintenance (${runwaysKept(ap)})`, v: runwaysKept(ap) * COSTS.runwayMaint },
    { key: 'connectors', label: 'Connector operations', v: ap.terminals.reduce((s, T) => s + (T.connector && T.connector.buildLeft <= 0 ? connectorUpkeep(T.connector) : 0), 0) },
    { key: 'parking', label: 'Car parks, hotels & landside', v: parkingUpkeep(ap) },
    { key: 'hangars', label: `Maintenance hangars (${hangarCount(ap)})`, v: hangarCount(ap) * HANGAR.upkeep },
    { key: 'manager', label: 'Station manager', v: ap.manager ? MANAGER.salary : 0 },
    { key: 'land', label: 'Property tax', v: (Object.keys(ap.plots).length - 1) * COSTS.plotTax },
  ];
  for (const l of lines) l.v *= m;
  return lines;
}

// ======================================================================
// load & forecast
// ======================================================================

function turnTime(ap, cls) {
  return AIRCRAFT[cls].turn * staffing(ap, 'ground').turn * Math.pow(HANGAR.turn, Math.min(2, hangarCount(ap))) * breakdownTurn(ap);
}

export function terminalSupports(ap, T, cls) {
  const A = AIRCRAFT[cls];
  if (A.heavy && !T.heavy) return false;
  return true;
}

export function classAllowed(ap, cls) {
  const A = AIRCRAFT[cls];
  if (site(ap).smallOnly && cls !== 'regional') return 'Only small aircraft fit the island strip';
  if (A.longRunway && !ap.upgrades.longRunway) return 'Needs the runway extension';
  if (A.heavy && !ap.terminals.some((T) => isOpen(T) && T.heavy)) return 'Needs a terminal with heavy gates';
  return null;
}

// Load against capacity across every bottleneck, optionally with an extra
// contract added on a given terminal. Rates are per minute.
// How long one flight keeps a gate, in minutes. The gate is reserved from
// landing clearance (so nobody lands without one) until the aircraft has
// pushed back: approach, landing roll and taxi in, the turnaround, then
// waiting to push. Measured with a moderately busy airport; the north
// runway's crossing makes everything a little longer.
function gateMinutes(ap, cls) {
  return (turnTime(ap, cls) + 30 + (ap.upgrades.runway2 ? 10 : 0)) / 60;
}

export function loadReport(ap, extra = null) {
  clearSkies = true;
  try { return planReport(ap, extra); } finally { clearSkies = false; }
}
function planReport(ap, extra) {
  const contracts = extra ? ap.contracts.concat([extra]) : ap.contracts;
  const r = {};
  let depPax = 0;
  const perT = new Map();
  for (const T of ap.terminals) perT.set(T.slot, { gateDemand: 0, pax: 0 });
  for (const c of contracts) {
    const A = AIRCRAFT[c.cls];
    const pax = A.pax * c.load * c.freq;
    depPax += pax;
    const pt = perT.get(c.terminal);
    if (pt) {
      pt.gateDemand += c.freq * gateMinutes(fieldFor(ap, c.terminal), c.cls);
      pt.pax += pax;
    }
  }
  // each airfield has its own runways and tower (the hub has up to five)
  r.runways = fields(ap).map((F) => runwayLoad(F, contracts.filter((c) => (slotField(c.terminal) || 0) === (F.field || 0))));
  r.runway = r.runways[0];
  r.security = { demand: depPax, cap: securityRate(ap) * 60 };
  r.parking = { demand: depPax * PAX.driveShare * (ap.upgrades.rail ? 0.7 : 1), cap: parkingCapacity(ap) };
  r.terminals = ap.terminals.map((T) => {
    const pt = perT.get(T.slot);
    const C = T.connector;
    return {
      slot: T.slot,
      open: isOpen(T),
      gates: T.gates,
      gateDemand: pt.gateDemand,
      pax: pt.pax,
      connCap: C ? connectorCap(C) * 60 : null,
    };
  });
  return r;
}

// Movements a minute one field's routes need, against what its runways and
// tower can handle.
function runwayLoad(F, contracts) {
  const movements = contracts.reduce((s, c) => s + 2 * c.freq, 0);
  let cap = Math.min(runwayPhysical(F), atcCapacity(F));
  if (F.upgrades.crosswind) {
    // Departures from the main-terminal row take off from the crosswind;
    // everything else shares the parallel runways. The busier side sets
    // the limit.
    const fromMainRow = contracts.reduce((s, c) => s + (SLOTS[c.terminal] && SLOTS[c.terminal].row === 'main' ? c.freq : 0), 0);
    const util = Math.max((movements - fromMainRow) / runwayPhysical(F), fromMainRow / XW_DEPARTURES, movements / atcCapacity(F));
    cap = util > 0 ? movements / util : Math.min(runwayPhysical(F) + XW_DEPARTURES, atcCapacity(F));
  }
  return { demand: movements, cap, atc: atcCapacity(F), physical: runwayPhysical(F), field: F.field || 0 };
}
// The runway load a terminal's routes count against.
export function runwayFor(rep, slot) { const f = slotField(slot) || 0; return rep.runways.find((x) => x.field === f) || rep.runway; }

export function utilisation(d, cap) { return cap > 0 ? d / cap : d > 0 ? 9 : 0; }

// The terminal a new contract would go to by default.
export function suggestTerminal(ap, cls) {
  const rep = loadReport(ap);
  let best = null, bestU = Infinity;
  for (const T of ap.terminals) {
    if (!isOpen(T) || !terminalSupports(ap, T, cls)) continue;
    const tr = rep.terminals.find((x) => x.slot === T.slot);
    let u = tr.gateDemand / T.gates;
    if (tr.connCap != null) u = Math.max(u, tr.pax / Math.max(1, tr.connCap));
    // at the hub, a quiet airfield's runway counts too
    if (rep.runways.length > 1) { const rw = runwayFor(rep, T.slot); u = Math.max(u, rw.demand / Math.max(0.1, rw.cap)); }
    if (u < bestU) { bestU = u; best = T.slot; }
  }
  return best;
}

// Revenue per minute a contract should produce if everything flows.
export function contractValue(ap, c, game) {
  const A = AIRCRAFT[c.cls];
  const s = site(ap);
  const pax = A.pax * c.load;
  const fees = pax * c.paxFee * A.paxFeeMult * repMult(ap) * (game ? networkMult(game) : 1) * (ap.upgrades.rail ? UPGRADES.rail.paxFee : 1);
  const retail = pax * 35 * PAX.retailPerPaxSec * TERMINAL.retailLevels[(terminalBySlot(ap, c.terminal) || { retail: 0 }).retail].mult;
  return c.freq * (A.landingFee + fees + retail) * s.rev;
}

// ======================================================================
// contracts
// ======================================================================

export function rollOffer(ap, game, forceCls = null) {
  const R = ap.rand;
  const lvl = ap.level;
  const classes = ['regional'];
  if (lvl >= UNLOCKS.narrow) classes.push('narrow', 'narrow');
  if (lvl >= UNLOCKS.wide) classes.push('wide', 'wide');
  if (lvl >= UNLOCKS.jumbo) classes.push('jumbo');
  if (lvl >= 4) classes.splice(0, 1); // big airports stop courting tiny routes
  if (SITES[ap.siteIndex].hub && lvl >= 2) classes.push('wide', 'wide', 'jumbo'); // the hub draws the big jets
  if (SITES[ap.siteIndex].smallOnly) classes.splice(0, classes.length, 'regional');
  const cls = forceCls || pick(R, classes);
  const al = pick(R, AIRLINES);
  const [f0, f1] = CONTRACTS.freq[cls];
  const demand = SITES[ap.siteIndex].demand;
  const freq = Math.round((f0 + (f1 - f0) * R()) * demand * 20) / 20;
  const others = game ? game.airports.filter((o) => o !== ap) : [];
  const network = others.length && R() < 0.3 ? pick(R, others) : null;
  const paxFee = Math.round((CONTRACTS.paxFee[0] + (CONTRACTS.paxFee[1] - CONTRACTS.paxFee[0]) * R() * (0.6 + ap.rep / 250)) * (network ? NETWORK.routeFeeBonus : 1) * 10) / 10;
  const load = Math.round((CONTRACTS.load[0] + (CONTRACTS.load[1] - CONTRACTS.load[0]) * R()) * 100) / 100;
  const offer = {
    id: `${ap.id}-${Math.floor(ap.t * 1000)}-${Math.floor(R() * 1e6)}`,
    airline: al.name, code: al.code, color: al.color,
    city: network ? network.name : pick(R, CITIES[cls]),
    network: network ? network.id : null,
    cls, freq, paxFee, load,
    expires: ap.t + CONTRACTS.offerLife,
  };
  const est = contractValue(ap, { ...offer, terminal: 'main' }, game);
  offer.bonus = Math.round(est * 0.6 / 50) * 50;
  return offer;
}

export function acceptOffer(game, ap, offerId, terminalSlot) {
  const i = ap.offers.findIndex((o) => o.id === offerId);
  if (i < 0) return 'Offer expired';
  const o = ap.offers[i];
  const why = classAllowed(ap, o.cls);
  if (why) return why;
  // only onto a terminal that is open (not closing) and takes the aircraft
  const T = terminalSlot && terminalBySlot(ap, terminalSlot);
  const slot = T && isOpen(T) && terminalSupports(ap, T, o.cls) ? terminalSlot : suggestTerminal(ap, o.cls);
  if (!slot) return 'No open terminal can take this aircraft';
  ap.offers.splice(i, 1);
  const c = {
    id: o.id, airline: o.airline, code: o.code, color: o.color, city: o.city, network: o.network, alliance: o.alliance,
    cls: o.cls, freq: o.freq, paxFee: o.paxFee, load: o.load, terminal: slot,
    otpHist: [], unhappyFor: 0, nextStd: 0, flown: 0,
  };
  c.nextStd = ap.t + turnTime(ap, c.cls) + inboundEstimate(ap, c) + 4;
  ap.contracts.push(c);
  earn(game, ap, 'bonus', o.bonus);
  return null;
}

export function declineOffer(ap, offerId) {
  ap.offers = ap.offers.filter((o) => o.id !== offerId);
}

export function cancelPenalty(ap, c, game) {
  return Math.round(contractValue(ap, c, game) * CONTRACTS.cancelPenaltyMins);
}

export function cancelContract(game, ap, contractId, forced = false) {
  const i = ap.contracts.findIndex((c) => c.id === contractId);
  if (i < 0) return;
  const c = ap.contracts[i];
  if (!forced) earn(game, ap, 'penalties', -cancelPenalty(ap, c, game));
  ap.contracts.splice(i, 1);
}

export function reassignContract(ap, contractId, slot) {
  const c = ap.contracts.find((x) => x.id === contractId);
  const T = terminalBySlot(ap, slot);
  if (!c || !T || !isOpen(T) || !terminalSupports(ap, T, c.cls)) return 'That terminal cannot take this aircraft';
  c.terminal = slot;
  return null;
}

// ======================================================================
// building
// ======================================================================

// Move a flight's passengers from one terminal (its lounge and the line for
// its connector) to another.
function moveFlightPax(ap, fid, from, to) {
  let n = from.waiting.get(fid) || 0;
  from.waiting.delete(fid);
  if (from.connector) n += from.connector.outQ.drop(fid);
  if (n <= 0 || !to) return;
  if (to.slot === 'main' || !to.connector) to.waiting.set(fid, (to.waiting.get(fid) || 0) + n);
  else to.connector.outQ.push(fid, n);
}

export function demolishBlocked(ap, slot) {
  const T = terminalBySlot(ap, slot);
  if (!T) return 'Nothing to tear down';
  if (slot === 'main') return 'The main terminal stays: security and the curb are there';
  if (T.demolishing) return 'Already closing';
  for (const c of ap.contracts) {
    if (c.terminal === slot && !ap.terminals.some((o) => o !== T && isOpen(o) && terminalSupports(ap, o, c.cls))) {
      return `No other terminal can take ${c.airline}'s ${AIRCRAFT[c.cls].name.toLowerCase()}s`;
    }
  }
  return null;
}
export function terminalRefund(ap, T) {
  const conn = T.connector ? connectorBuildCost(T.connector.type, T.slot, ap) : 0;
  return Math.round((TERMINAL.baseCost * site(ap).cost + conn) * DEMOLISH_REFUND);
}
// Its routes move to the other terminals at once; it closes for good when
// the aircraft at its gates have left.
export function demolishTerminal(game, ap, slot) {
  const why = demolishBlocked(ap, slot);
  if (why) return why;
  const T = terminalBySlot(ap, slot);
  game.cash += terminalRefund(ap, T);
  T.demolishing = true;
  delete T.pendingConnector;
  for (const c of ap.contracts) if (c.terminal === slot) c.terminal = suggestTerminal(ap, c.cls);
  for (const f of ap.flights.values()) {
    if (f.closed || f.terminal !== slot) continue;
    if (f.plane && f.plane.gate >= 0 && f.plane.state !== 'holding' && f.plane.state !== 'inbound') continue; // already coming in here
    const c = ap.contracts.find((x) => x.id === f.contract);
    let to = (c && c.terminal) || suggestTerminal(ap, f.cls);
    // an aircraft already on its way stays on its own airfield
    if (f.plane && slotField(to) !== (f.plane.field || 0)) {
      const same = ap.terminals.find((o) => o !== T && isOpen(o) && terminalSupports(ap, o, f.cls) && slotField(o.slot) === (f.plane.field || 0));
      if (same) to = same.slot;
    }
    moveFlightPax(ap, f.id, T, terminalBySlot(ap, to));
    f.terminal = to;
  }
  ap.costLines = computeCosts(ap);
  return null;
}

function finishDemolition(ap, T) {
  for (const [fid] of [...T.waiting]) {
    const f = ap.flights.get(fid);
    moveFlightPax(ap, fid, T, f && f.terminal !== T.slot ? terminalBySlot(ap, f.terminal) : null);
  }
  const C = T.connector;
  if (C) {
    for (const x of [...C.outQ]) { const f = ap.flights.get(x.f); const to = f && terminalBySlot(ap, f.terminal); if (to && to !== T) moveFlightPax(ap, x.f, T, to); }
    ap.paxServed += C.inQ.total;
    // riders on their way out go on to their flight's new terminal
    const onward = (x) => {
      const f = ap.flights.get(x.f), to = f && !f.closed && terminalBySlot(ap, f.terminal);
      if (!to || to === T) return;
      if (to.slot === 'main' || !to.connector) to.waiting.set(x.f, (to.waiting.get(x.f) || 0) + x.n);
      else to.connector.outQ.push(x.f, x.n);
    };
    for (const x of C.transit) if (x.dir === 'in') ap.paxServed += x.n; else onward(x);
    for (const b of C.fleet || []) for (const x of b.load) if (x.dir === 'in') ap.paxServed += x.n; else onward(x);
  }
  ap.terminals = ap.terminals.filter((x) => x !== T);
  ap.costLines = computeCosts(ap);
  notify(ap, 'built', `${nm(ap, SLOTS[T.slot].name)} has been torn down`);
}

function spend(game, amount) {
  if (game.cash < amount) return false;
  game.cash -= amount;
  return true;
}

export function buyPlot(game, ap, plot) {
  const P = PLOTS[plot];
  if (ap.plots[plot]) return 'Already owned';
  if (!plotAvailable(ap, plot)) return noRoom(ap);
  if (P.needs && !ap.plots[P.needs]) return `Buy the ${nm(ap, PLOTS[P.needs].name)} first`;
  if (!spend(game, plotCost(ap, plot))) return 'Not enough cash';
  ap.plots[plot] = true;
  ap.costLines = computeCosts(ap);
  return null;
}

export function buildTerminal(game, ap, slot, connectorType, buses = 2) {
  if (terminalBySlot(ap, slot)) return 'Already built';
  if (!slotAvailable(ap, slot)) return noRoom(ap);
  if (ap.hangars[slot]) return 'A hangar stands there';
  if (!ap.plots[SLOTS[slot].plot]) return 'Buy the land first';
  if (!connectorAllowed(connectorType, slot)) return 'That connector cannot reach this site';
  const cost = terminalCost(ap, slot) + connectorBuildCost(connectorType, slot, ap);
  if (!spend(game, cost)) return 'Not enough cash';
  const T = newTerminal(slot, false, Math.min(TERMINAL.startGates, maxGates(ap, slot)));
  T.waiting = new Map();
  T.arrivingHere = 0;
  T.connector = { type: connectorType, level: 0, buses: connectorType === 'shuttle' ? buses : 0, buildLeft: CONNECTORS[connectorType].buildTime };
  hydrateConnector(T, ap);
  ap.terminals.push(T);
  ap.costLines = computeCosts(ap);
  return null;
}

export function replaceConnector(game, ap, slot, type) {
  const T = terminalBySlot(ap, slot);
  if (T && T.demolishing) return 'Being torn down';
  if (!T || slot === 'main') return 'No connector here';
  if (!connectorAllowed(type, slot)) return 'That connector cannot reach this site';
  if (T.connector.type === type) return 'Already uses that';
  const cost = connectorBuildCost(type, slot, ap);
  if (!spend(game, cost)) return 'Not enough cash';
  // The old line keeps running until the new one opens.
  T.pendingConnector = { type, level: 0, buses: type === 'shuttle' ? 2 : 0, buildLeft: CONNECTORS[type].buildTime };
  return null;
}

export function upgradeConnector(game, ap, slot) {
  const T = terminalBySlot(ap, slot);
  if (T && T.demolishing) return 'Being torn down';
  const C = T && T.connector;
  const def = C && CONNECTORS[C.type];
  if (!def || !def.upgrade || C.level) return 'Nothing to upgrade';
  if (!spend(game, Math.round(def.upgrade.cost * site(ap).cost))) return 'Not enough cash';
  C.level = 1;
  ap.costLines = computeCosts(ap);
  return null;
}

export function setBuses(game, ap, slot, delta) {
  const T = terminalBySlot(ap, slot);
  if (T && T.demolishing) return 'Being torn down';
  const C = T && T.connector;
  if (!C || C.type !== 'shuttle') return 'Not a shuttle';
  const b = CONNECTORS.shuttle.bus;
  if (delta > 0) {
    if (C.buses >= b.max) return 'Fleet is at its maximum';
    if (!spend(game, Math.round(b.cost * site(ap).cost))) return 'Not enough cash';
    C.buses++;
  } else {
    if (C.buses <= 1) return 'Keep at least one bus';
    C.buses--;
    game.cash += Math.round(b.cost * site(ap).cost * 0.4);
  }
  ap.costLines = computeCosts(ap);
  return null;
}

export function addGate(game, ap, slot) {
  const T = terminalBySlot(ap, slot);
  if (T && T.demolishing) return 'Being torn down';
  if (!T || T.gates >= maxGates(ap, slot)) return 'No room for more gates';
  if (!spend(game, gateCost(ap, T))) return 'Not enough cash';
  T.gates++;
  ap.costLines = computeCosts(ap);
  return null;
}

export function buyHeavy(game, ap, slot) {
  const T = terminalBySlot(ap, slot);
  if (T && T.demolishing) return 'Being torn down';
  if (!T || T.heavy) return 'Already heavy';
  if (!spend(game, heavyCost(ap, T))) return 'Not enough cash';
  T.heavy = true;
  return null;
}

export function buyRetail(game, ap, slot) {
  const T = terminalBySlot(ap, slot);
  if (T && T.demolishing) return 'Being torn down';
  const cost = T && retailCost(ap, T);
  if (cost == null) return 'Retail is maxed out';
  if (!spend(game, cost)) return 'Not enough cash';
  T.retail++;
  return null;
}

export function addLane(game, ap) {
  if (ap.securityLanes >= maxLanes(ap)) return 'The checkpoint is full';
  if (!spend(game, laneCost(ap))) return 'Not enough cash';
  ap.securityLanes++;
  ap.costLines = computeCosts(ap);
  return null;
}

export function removeLane(ap) {
  if (ap.securityLanes <= 1) return 'Keep at least one lane';
  ap.securityLanes--;
  ap.costLines = computeCosts(ap);
  return null;
}

export function upgradeBlocked(ap, key) {
  const U = UPGRADES[key];
  if (U.onlyAt && !site(ap)[U.onlyAt]) return 'Not at this airport';
  if (U.needsPlot && !plotAvailable(ap, U.needsPlot)) return 'Not at this airport'; // no land for it
  if (ap.upgrades[key]) return 'Owned';
  if (key === 'crosswind' && ap.hangars.fareast) return 'The hangar on the far east field is in the way: tear it down first';
  if (key === 'crosswind' && terminalBySlot(ap, 'fareast')) return `The ${nm(ap, SLOTS.fareast.name)} terminal is in the way: tear it down first`;
  if (key === 'crosswind' && ap.parking.fareast) return `The ${nm(ap, PARKING_SITES.fareast.name).toLowerCase()} is in the way: tear it down first`;
  if (U.needs && !ap.upgrades[U.needs]) return `Needs ${UPGRADES[U.needs].name}`;
  if (U.needsPlot && !ap.plots[U.needsPlot]) return `Needs the ${nm(ap, PLOTS[U.needsPlot].name)}`;
  return null;
}

export function buyUpgrade(game, ap, key) {
  const why = upgradeBlocked(ap, key);
  if (why) return why;
  if (!spend(game, upgradeCost(ap, key))) return 'Not enough cash';
  ap.upgrades[key] = true;
  // arrivals still in the air switch to the new arrivals runway (from
  // where they are: no jump), so none lands across the new one's traffic
  if (key === 'runway2') {
    for (const p of ap.planes) {
      if (p.state !== 'inbound' && p.state !== 'holding') continue;
      p.rw = arrRunway(ap);
      if (p.state === 'holding') { const cx = IAF.x, cy = RW[p.rw].y + FLIGHT.holdRadius; p.holdA = Math.atan2(p.y - cy, p.x - cx); p.holdR = Math.hypot(p.x - cx, p.y - cy); }
    }
  }
  ap.costLines = computeCosts(ap);
  return null;
}

export function buildParking(game, ap, id) {
  const why = parkingBlocked(ap, id);
  if (why) return why;
  if (!spend(game, parkingCost(ap, id))) return 'Not enough cash';
  ap.parking[id] = parkingNext(ap, id);
  ap.costLines = computeCosts(ap);
  return null;
}

// How an offer would load this airport if signed at the terminal it would
// go to: the highest load of each kind, and whether it fits comfortably.
export function offerFit(ap, o, slot = suggestTerminal(ap, o.cls)) {
  if (classAllowed(ap, o.cls) || !slot) return { slot: null, fits: false, why: classAllowed(ap, o.cls) || 'No terminal can take it' };
  const r = loadReport(ap, { ...o, terminal: slot });
  const tr = r.terminals.find((t) => t.slot === slot);
  const loads = {
    runway: runwayFor(r, slot).demand / runwayFor(r, slot).cap,
    gates: tr ? tr.gateDemand / tr.gates : 0,
    security: r.security.demand / r.security.cap,
    connector: tr && tr.connCap != null ? tr.pax / Math.max(1, tr.connCap) : 0,
  };
  // running late: an unhappy airline, or several recent late departures
  const recentLate = (ap.lateLog || []).filter((e) => ap.t - e.t < 240).length;
  const late = ap.contracts.some((c) => c.unhappyFor > 0) || (ap.rolling.otp < 0.85 && recentLate >= 3);
  const over = Object.entries(loads).filter(([k, v]) => v > MANAGER.fits[k]).map(([k]) => k);
  return { slot, loads, late, fits: !late && !over.length, why: late ? 'flights are already running late' : over.length ? `${over.join(', ')} would be too busy` : '' };
}

// The station manager, if hired, works the contract desk: signs what fits,
// declines what does not, a little after each offer comes in.
function runManager(game, ap) {
  for (const o of [...ap.offers]) {
    if (ap.t - (o.seen || (o.seen = ap.t)) < 4) continue;
    const fit = offerFit(ap, o);
    if (fit.fits) { acceptOffer(game, ap, o.id, fit.slot); notify(ap, 'offer', `Station manager signed ${o.airline} to ${o.city}`); }
    else { declineOffer(ap, o.id); notify(ap, 'offer', `Station manager declined ${o.airline}: ${fit.why}`); }
  }
}
export function setManager(ap, on) { ap.manager = !!on; ap.costLines = computeCosts(ap); }

export function setStaffing(ap, dept, level) {
  ap.staffing[dept] = level;
  ap.costLines = computeCosts(ap);
}

// ======================================================================
// money
// ======================================================================

export function earn(game, ap, cat, amount) {
  game.cash += amount;
  ap.bucket[cat] = (ap.bucket[cat] || 0) + amount;
  if (amount > 0) ap.lifetime.revenue += amount;
}

function rollLedger(ap) {
  ap.ledger.push(ap.bucket);
  if (ap.ledger.length > 60) ap.ledger.shift();
  ap.bucket = {};
  const sum = {};
  for (const b of ap.ledger) for (const k in b) sum[k] = (sum[k] || 0) + b[k];
  // Scale up when we have less than a minute of history.
  const k = 60 / ap.ledger.length;
  for (const key in sum) sum[key] *= k;
  let net = 0;
  for (const key in sum) net += sum[key];
  sum.net = net;
  // What the airport makes from running, without one-off signing bonuses
  // and penalties: the number to judge it by.
  sum.operating = net - (sum.bonus || 0) - (sum.penalties || 0);
  ap.perMin = sum;
}

// ======================================================================
// the step
// ======================================================================

export function step(game, ap, dt) {
  // A zero-length step (a hidden tab, two frames on one timestamp) has
  // nothing to do, and rates computed over it would divide by zero.
  if (!(dt > 0)) return;
  ap.t += dt;
  const t = ap.t;

  // construction and demolition
  for (const T of [...ap.terminals]) {
    if (T.demolishing) {
      if (!(T.gateUse || []).some(Boolean)) finishDemolition(ap, T);
      continue;
    }
    if (T.buildLeft > 0) {
      T.buildLeft -= dt;
      if (T.buildLeft <= 0) { ap.costLines = computeCosts(ap); notify(ap, 'built', `${nm(ap, SLOTS[T.slot].name)} is open`); }
    }
    if (T.connector && T.connector.buildLeft > 0) {
      T.connector.buildLeft -= dt;
      if (T.connector.buildLeft <= 0) ap.costLines = computeCosts(ap);
    }
    if (T.pendingConnector) {
      T.pendingConnector.buildLeft -= dt;
      if (T.pendingConnector.buildLeft <= 0) {
        const old = T.connector;
        T.connector = { ...T.pendingConnector, buildLeft: 0 };
        delete T.pendingConnector;
        hydrateConnector(T, ap);
        // Carry passengers across so nobody vanishes in the switch.
        for (const x of old.outQ) T.connector.outQ.push(x.f, x.n);
        for (const x of old.inQ) T.connector.inQ.push(x.f, x.n);
        for (const x of old.transit) (x.dir === 'out' ? T.connector.outQ : T.connector.inQ).push(x.f, x.n);
        for (const b of old.fleet || []) for (const x of b.load) (x.dir === 'out' ? T.connector.outQ : T.connector.inQ).push(x.f, x.n);
        ap.costLines = computeCosts(ap);
        notify(ap, 'built', `New ${CONNECTORS[T.connector.type].name.toLowerCase()} to ${nm(ap, SLOTS[T.slot].name)} is running`);
      }
    }
  }

  // weather
  if (t >= ap.weather.nextStorm) {
    const len = WEATHER.stormLength[0] + ap.rand() * (WEATHER.stormLength[1] - WEATHER.stormLength[0]);
    ap.weather.stormUntil = t + len;
    ap.weather.nextStorm = t + len + WEATHER.stormEvery[0] + ap.rand() * (WEATHER.stormEvery[1] - WEATHER.stormEvery[0]);
    notify(ap, 'storm', 'Thunderstorm over the field: runway throughput is down');
  }

  // ATC tokens
  ap.atcTokens = Math.min(2, ap.atcTokens + atcCapacity(ap) / 60 * dt);

  // offers
  if (t >= ap.nextOfferAt) {
    ap.nextOfferAt = t + CONTRACTS.offerEvery / SITES[ap.siteIndex].demand * (0.7 + ap.rand() * 0.6);
    if (ap.offers.length < CONTRACTS.maxOffers) {
      ap.offers.push(rollOffer(ap, game));
      if (!ap.manager) notify(ap, 'offer', 'New contract offer');
    }
  }
  if (ap.manager && ap.offers.length) runManager(game, ap);
  ap.offers = ap.offers.filter((o) => o.expires > t);

  scheduleFlights(game, ap);
  flowPassengers(game, ap, dt);
  updateBuses(ap, dt);
  updatePlanes(game, ap, dt);
  for (const F of fields(ap)) {
    if (F === ap) continue;
    F.atcTokens = Math.min(2, F.atcTokens + atcCapacity(F) / 60 * dt);
    if (isStar(F)) updateStarPlanes(game, F, dt); else updatePlanes(game, F, dt);
  }
  updateContracts(game, ap, dt);
  updateRep(ap, dt);

  // running costs, charged continuously
  let cost = 0;
  for (const l of ap.costLines) cost += l.v;
  const costPerSec = cost / 60 * dt;
  game.cash -= costPerSec;
  ap.bucket.costs = (ap.bucket.costs || 0) - costPerSec;
  if (hangarCount(ap)) earn(game, ap, 'maintenance', hangarCount(ap) * HANGAR.income * site(ap).rev / 60 * dt);

  ap.bucketT += dt;
  if (ap.bucketT >= 1) {
    ap.bucketT -= 1;
    rollLedger(ap);
    ap.costLines = computeCosts(ap);
  }

  // Missed flights are reported in batches so a bad hour is one message.
  if (t >= (ap.missedReportAt || 0)) {
    ap.missedReportAt = t + 30;
    if ((ap.missedAcc || 0) >= 5) notify(ap, 'missed', missedMessage(ap));
    const w = ap.missedWhy || {}, r = ap.missedRecent || (ap.missedRecent = { security: 0, connector: 0, late: 0 });
    for (const k of ['security', 'connector', 'late']) r[k] = r[k] * 0.5 + (w[k] || 0);
    ap.missedAcc = 0;
    ap.missedWhy = { security: 0, connector: 0, late: 0 };
  }

  // room to grow
  if (!ap.expandReady && canGrow(ap) && growProgress(ap) >= EXPAND_TERMINALS) {
    ap.expandReady = true;
    ap.costLines = computeCosts(ap);
    notify(ap, 'level', `${ap.name} can grow: ${siteFields(ap.siteIndex).length} new airfields are for sale around it. Zoom out to see them.`);
  }

  if (ap.breakdowns && ap.breakdowns.length) {
    // (a terminal torn down takes its breakdown with it)
    if (ap.breakdowns.some((b) => !BD_KIND[b.kind] || !terminalBySlot(ap, b.slot))) ap.breakdowns = ap.breakdowns.filter((b) => BD_KIND[b.kind] && terminalBySlot(ap, b.slot));
    managerRepairs(game, ap);
  }

  // levels
  while (ap.level < LEVELS.length && ap.paxServed >= LEVELS[ap.level]) {
    ap.level++;
    notify(ap, 'level', `${ap.name} reached level ${ap.level}`);
  }
}

// ---------------------------------------------------------------- breakdowns

const BD_KIND = Object.fromEntries(BREAKDOWNS.kinds.map((k) => [k.id, k]));
export const breakdownKind = (b) => BD_KIND[b.kind];

export function breakdownsUnlocked(game) {
  const U = BREAKDOWNS.unlock;
  return game.airports.filter((a) => a.level >= U.level).length >= U.airports;
}

// Called with real seconds of play (not game seconds: at 4x speed things
// don't break four times as often). `idle`: nobody has touched the game.
export function tickBreakdowns(game, dt, idle) {
  if (!(dt > 0) || !breakdownsUnlocked(game)) return null;
  const B = BREAKDOWNS;
  if (!(game.breakIn > 0)) game.breakIn = B.every[0] + Math.random() * (B.every[1] - B.every[0]);
  game.breakIn -= dt * (idle ? B.idleRate : 1);
  if (game.breakIn > 0) return null;
  game.breakIn = 0;
  const open = game.airports.reduce((n, a) => n + ((a.breakdowns && a.breakdowns.length) || 0), 0);
  if (open >= B.maxOpen) { game.breakIn = 60; return null; } // try again in a minute
  const where = game.airports.filter((a) => a.level >= 2 && !(a.breakdowns && a.breakdowns.length) && a.terminals.some(isOpen));
  if (!where.length) { game.breakIn = 60; return null; }
  const ap = where[Math.floor(Math.random() * where.length)];
  const terms = ap.terminals.filter(isOpen);
  const T = terms[Math.floor(Math.random() * terms.length)];
  const K = B.kinds[Math.floor(Math.random() * B.kinds.length)];
  const b = { id: `b${Math.floor(ap.t)}${Math.floor(Math.random() * 1000)}`, kind: K.id, slot: T.slot, cost: repairCost(ap, K), t0: ap.t };
  (ap.breakdowns || (ap.breakdowns = [])).push(b);
  game.breakIn = B.every[0] + Math.random() * (B.every[1] - B.every[0]);
  notify(ap, 'breakdown', `${breakdownTitle(ap, b)}. ${ap.manager ? 'Your station manager is on it.' : 'Tap its red sign or the Advisor to repair it.'}`);
  return { ap, b };
}

function repairCost(ap, K) {
  const run = Math.max(0, (ap.perMin && ap.perMin.operating) || 0) * BREAKDOWNS.costMinutes;
  const c = Math.max(BREAKDOWNS.costMin * site(ap).cost, run) * K.cost;
  const unit = c > 20000 ? 1000 : c > 2000 ? 100 : 10;
  return Math.round(c / unit) * unit;
}

export function breakdownTitle(ap, b) {
  return `${breakdownKind(b).name} in ${nm(ap, SLOTS[b.slot] ? SLOTS[b.slot].name : 'the terminal')}`;
}

// The effects: the worst slowdown applies (everything goes through one
// ramp crew), the reputation hits add up.
export function breakdownTurn(ap) {
  let k = 1;
  if (ap.breakdowns) for (const b of ap.breakdowns) k = Math.max(k, breakdownKind(b).turn);
  return k;
}
export function breakdownHappy(ap) {
  let h = 0;
  if (ap.breakdowns) for (const b of ap.breakdowns) h += breakdownKind(b).happy;
  return h;
}

export function repairBreakdown(game, ap, id) {
  const b = (ap.breakdowns || []).find((x) => x.id === id);
  if (!b) return 'Already fixed';
  if (game.cash < b.cost) return 'Not enough cash';
  spend(game, b.cost);
  ap.bucket.repairs = (ap.bucket.repairs || 0) - b.cost;
  ap.breakdowns = ap.breakdowns.filter((x) => x !== b);
  return null;
}

// The station manager deals with it, if it costs under half the cash.
function managerRepairs(game, ap) {
  if (!ap.manager) return;
  for (const b of [...ap.breakdowns]) {
    if (b.cost >= BREAKDOWNS.managerShare * game.cash) { b.mgrAt = undefined; continue; }
    if (b.mgrAt == null) { b.mgrAt = ap.t + BREAKDOWNS.managerDelay; continue; }
    if (ap.t >= b.mgrAt && !repairBreakdown(game, ap, b.id)) notify(ap, 'built', `Station manager paid ${money(b.cost)} to repair: ${breakdownTitle(ap, b)}`);
  }
}

function missedMessage(ap) {
  const w = ap.missedWhy || { security: 0, connector: 0, late: 0 };
  const n = Math.round(ap.missedAcc);
  const top = Object.entries(w).sort((a, b) => b[1] - a[1])[0];
  if (top[0] === 'security' && top[1] > 0) return `${n} passengers missed flights stuck in the security line. See the Advisor tab.`;
  if (top[0] === 'connector' && top[1] > 0) return `${n} passengers missed flights waiting for a connector to their terminal. See the Advisor tab.`;
  return `${n} passengers missed flights. See the Advisor tab.`;
}

function notify(ap, kind, text) {
  ap.events.push({ kind, text, t: ap.t });
  if (ap.events.length > 30) ap.events.shift();
}

// ---------------------------------------------------------------- flights

function scheduleFlights(game, ap) {
  const t = ap.t;
  for (const c of ap.contracts) {
    // The flight record has to exist before its passengers start arriving
    // and before its inbound aircraft has to set off, whichever is earlier.
    const lead = turnTime(ap, c.cls) + inboundEstimate(ap, c) + FLIGHT.scheduleBuffer;
    while (c.nextStd - Math.max(PAX.arriveEarly, lead + 1) <= t) {
      const std = c.nextStd;
      const interval = 60 / c.freq;
      c.nextStd += interval * (0.85 + ap.rand() * 0.3);
      ap.flightCounter++;
      const A = AIRCRAFT[c.cls];
      const f = {
        id: ap.flightCounter,
        no: `${c.code}${100 + (ap.flightCounter % 900)}`,
        contract: c.id, cls: c.cls, color: c.color, city: c.city,
        terminal: c.terminal, std,
        expected: Math.round(A.pax * c.load),
        arriving: Math.round(A.pax * c.load * (0.85 + ap.rand() * 0.2)),
        generated: 0, boarded: 0, closed: false, missed: 0,
        spawnAt: std - lead,
        plane: null,
      };
      ap.flights.set(f.id, f);
    }
  }
  for (const f of ap.flights.values()) {
    if (!f.plane && !f.closed && t >= f.spawnAt) spawnPlane(fieldFor(ap, f.terminal), f);
  }
}

// (kept for a few seconds per route: it only sets how early flights are
// scheduled, and works out a whole route to do it)
function inboundEstimate(ap, c) {
  const m = c._ie;
  if (m && m.slot === c.terminal && ap.t - m.t < 5 && ap.t >= m.t) return m.v;
  const v = inboundEstimateNow(ap, c);
  Object.defineProperty(c, '_ie', { value: { slot: c.terminal, t: ap.t, v }, enumerable: false, configurable: true, writable: true });
  return v;
}
function inboundEstimateNow(ap, c) {
  const F = fieldFor(ap, c.terminal);
  if (isStar(F)) { const r = starArrivalRoute(c.terminal, gateStand(c.terminal, 0)); return 8 + (pathLength(r.route) - r.rollEnd) / FLIGHT.taxiSpeed * (1 + FLIGHT.taxiPad); }
  const r = arrivalRoute(F, arrRunway(F), c.cls, gateStand(c.terminal, 0));
  return 8 + (pathLength(r.route) - r.rollEnd) / FLIGHT.taxiSpeed * (1 + FLIGHT.taxiPad);
}

function arrRunway(ap) { return ap.upgrades.runway2 ? 1 : 0; }

// ---------------------------------------------------------------- aircraft
//
// In the air, ATC keeps aircraft apart: one landing slot at a time, and a
// holding stack where every aircraft has its own place in the circle.
//
// On the ground, every moving aircraft looks ahead along its own route.
//  1. It never moves into another aircraft's body.
//  2. Where two routes meet (a crossing or a merge), the aircraft closer
//     to the meeting point goes first; the other waits short of it. An
//     aircraft that has waited a long time gets priority.
//  3. It never stops inside a junction someone else needs to cross
//     ("don't block the box"), so queues leave crossings open.
// One-way taxiways (see layout.js) mean nobody meets nose to nose, and
// only so many departures may leave their gates at once, so the taxiways
// can never fill up completely.

const R_PLANE = 30;          // half-length of a scale-1 aircraft
const LOOK = 260;            // how far ahead a taxiing aircraft checks
const CLAIM = 130;           // how far ahead it claims the route at junctions
const SAMPLE = 5;
const MAX_DEP_GROUND = 6;    // departures allowed off their gates at once
const MAX_ARR_GROUND = 6;    // arrivals allowed to land and taxi in at once
const PUSH_SPEED = 22;

function spawnPlane(ap, f) {
  if (isStar(ap)) { spawnStarPlane(ap, f); return; }
  const A = AIRCRAFT[f.cls];
  const rw = RW[arrRunway(ap)];
  const a = (ap.rand() - 0.5) * 140 * DEG;
  const x = IAF.x - 420 * Math.cos(a);
  const y = rw.y + 420 * Math.sin(a);
  const p = {
    id: ap.nextPlaneId++, f, cls: f.cls, color: f.color, scale: A.scale, r: R_PLANE * A.scale,
    state: 'inbound', x, y, ang: Math.atan2(rw.y - y, IAF.x - x), alt: 160, speed: FLIGHT.cruiseSpeed,
    path: null, d: 0, blockedFor: 0,
    gate: -1, turnLeft: 0, turnTotal: 0, deplaned: 0,
    rw: arrRunway(ap),
    field: ap.field || 0,
    gold: rollGold(ap) || undefined,
  };
  f.plane = p;
  ap.planes.push(p);
}

// One plane in every 30 to 50 arrives golden: tap it for a bonus. (The
// count is kept per airport, its airfields share it.)
function rollGold(ap) {
  if (!(ap.goldIn > 0)) ap.goldIn = GOLD.every[0] + Math.floor(ap.rand() * (GOLD.every[1] - GOLD.every[0] + 1));
  return --ap.goldIn === 0;
}

// What a golden plane pays: a couple of minutes of what the whole network
// makes from running, so it is worth a tap at every stage of the game.
export function goldBonus(game) {
  const perMin = game.airports.reduce((s, a) => s + Math.max(0, (a.perMin && a.perMin.operating) || 0), 0);
  return Math.round(Math.max(GOLD.min, perMin * GOLD.minutes));
}

export function claimGold(game, ap, p) {
  if (!p.gold) return 0;
  p.gold = undefined;
  const amount = goldBonus(game);
  earn(game, ap, 'bonus', amount);
  if (ap.fx) ap.fx('gold', { x: p.x, y: p.y - 30, v: amount, field: p.field || 0 });
  return amount;
}

function setPath(p, pts) {
  p.path = pts;
  p.d = 0;
  p.len = pathLength(pts);
}

const DEP_OCCUPANCY = 4.2; // seconds a departure needs the runway

// Landing needs both a runway slot and a free gate: an aircraft with nowhere
// to park stays in the holding stack rather than clogging the taxiways.
function canClearArrival(ap, p, eta) {
  if (findGate(ap, p) < 0) { p.holdReason = 'gate'; return false; }
  // Nor while the turn-off it will use is still occupied: an aircraft that
  // cannot leave the runway would block every departure behind it.
  // Off the north runway it takes the first turn-off it can make that is
  // clear: its own, or a later one if that is busy (a later one is always
  // long enough). Those lead straight to the crossing; the main runway's
  // later turn-offs would meet taxiway A traffic from the earlier ones.
  const jy = RW[p.rw].exitY;
  const own = AIRCRAFT[p.cls].exitIndex;
  p.exitIdx = -1;
  for (let i = own; i < (p.rw === 1 ? EXITS.length : own + 1) && p.exitIdx < 0; i++) {
    if (!exitBusy(ap, p.rw, i, jy)) p.exitIdx = i;
  }
  if (p.exitIdx < 0) { p.holdReason = 'taxi'; return false; }
  // Ground control meters arrivals too, so the taxiways never fill up.
  if (ap.arrGround >= MAX_ARR_GROUND * runwayCount(ap)) { p.holdReason = 'taxi'; return false; }
  p.holdReason = 'runway';
  const R = ap.runways[p.rw];
  if (ap.atcTokens < 1 || R.reservedArr) return false;
  // An occupant that should have cleared by now but has not (it is waiting
  // to turn off) still blocks the runway.
  if (R.occupant && R.occupant.blockedFor > 0) return false;
  let freeAt = R.occupant ? Math.max(R.clearEta, ap.t + 1) : ap.t;
  if (R.crossers.size) freeAt = Math.max(freeAt, ap.t + 3);
  if (freeAt > ap.t + eta - 0.2) return false;
  // Mixed-mode runway with departures waiting: strictly alternate, one
  // landing then one take-off, so neither queue can starve the other.
  if (p.rw === 0 && ap.depQueue.length && ap.lastMove === 'arr') return false;
  if (p.rw === 0 && ap.depQueue.length) {
    // Once a departure has waited a little,
    // an arrival only gets a slot if a take-off still fits in front of it,
    // and it must leave a controller free for that take-off.
    const head = ap.depQueue[0];
    const waited = ap.t - head.holdSince;
    if (waited > 3 || ap.depQueue.length > 1) {
      if (freeAt + DEP_OCCUPANCY > ap.t + eta) return false;
      if (ap.atcTokens < 2) return false;
    }
  }
  return true;
}

// Is anything on the ground at a runway's turn-off? Every holding aircraft
// asks each step, so the answer is kept until the field's next step or
// the next clearance. (Holding aircraft are in the air, so never count.)
let exitMemo = { planes: null, t: -1, m: new Map() };
function exitBusy(ap, rw, i, jy) {
  if (exitMemo.planes !== ap.planes || exitMemo.t !== ap.t) exitMemo = { planes: ap.planes, t: ap.t, m: new Map() };
  const k = rw * 16 + i;
  let v = exitMemo.m.get(k);
  if (v === undefined) {
    const ex = EXITS[i];
    v = ap.planes.some((o) => o.alt <= 0.5 && o.state !== 'gate' && Math.abs(o.x - ex) < 55 && o.y > RW[rw].y + 5 && o.y < jy + (rw === 1 ? 75 : 30));
    exitMemo.m.set(k, v);
  }
  return v;
}

function tryClearArrival(ap, p) {
  const rw = RW[p.rw];
  const eta = dist(p.x, p.y, IAF.x, rw.y) / FLIGHT.cruiseSpeed + (rw.x0 - IAF.x) / FLIGHT.approachSpeed;
  if (!canClearArrival(ap, p, eta)) return false;
  clearArrival(ap, p, [{ x: p.x, y: p.y }, { x: IAF.x, y: rw.y }, { x: rw.x0, y: rw.y }]);
  return true;
}

function clearArrival(ap, p, pts) {
  exitMemo.t = -1;
  if (p.rw === 0) ap.lastMove = 'arr';
  const g = findGate(ap, p);
  if (g < 0) return false;
  const T = terminalBySlot(ap, p.f.terminal);
  p.gate = g; T.gateUse[g] = p;
  ap.arrGround++;
  p.stand = gateStand(T.slot, g);
  groundRoute(ap, p);
  const R = ap.runways[p.rw];
  R.reservedArr = p;
  ap.atcTokens -= 1;
  p.state = 'final';
  setPath(p, pts);
  p.altStart = p.alt;
  const i = ap.holdQueue.indexOf(p);
  if (i >= 0) ap.holdQueue.splice(i, 1);
}

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// Where an aircraft sits in the stack: seven to a ring, each ring wider
// and higher than the last, everyone evenly spaced around it.
function holdSlot(ap, idx) {
  const ring = Math.floor(idx / 7), k = idx % 7;
  return { R: FLIGHT.holdRadius + ring * 44, a: ap.holdPhase - k * (2 * Math.PI / 7), alt: 160 + ring * 40 };
}

const HOLD_OMEGA = FLIGHT.cruiseSpeed * 0.6 / FLIGHT.holdRadius;

function updatePlanes(game, ap, dt) {
  const t = ap.t;
  ap.holdPhase += HOLD_OMEGA * dt;

  // each holding aircraft's place in the stack, worked out once a step
  const holdIdx = new Map();
  ap.holdQueue.forEach((q, i) => holdIdx.set(q, i));

  // Clear whoever in the stack can land now, first come first served.
  ap.arrGround = 0;
  for (const o of ap.planes) if (o.state === 'rollout' || o.state === 'taxiIn' || o.state === 'final') ap.arrGround++;
  for (const p of ap.holdQueue) if (tryClearArrival(ap, p)) break;

  for (const p of ap.planes) {
    switch (p.state) {
      case 'inbound': {
        const rw = RW[p.rw];
        const tx = IAF.x, ty = rw.y;
        const d = dist(p.x, p.y, tx, ty);
        const step = p.speed * dt;
        p.ang = Math.atan2(ty - p.y, tx - p.x);
        if (d <= step + 1) {
          p.x = tx; p.y = ty;
          if (!ap.holdQueue.length && tryClearArrival(ap, p)) {
            // cleared straight in
          } else {
            p.state = 'holding';
            p.holdA = -Math.PI / 2;
            p.holdR = FLIGHT.holdRadius;
            ap.holdQueue.push(p);
          }
        } else {
          p.x += (tx - p.x) / d * step;
          p.y += (ty - p.y) / d * step;
        }
        break;
      }
      case 'holding': {
        const rw = RW[p.rw];
        p.heldFor = (p.heldFor || 0) + dt;
        // No terminal left in this field that can take it (one was torn
        // down): after half a minute it diverts elsewhere.
        if (diverts(game, ap, p, dt)) break;
        const slot = holdSlot(ap, holdIdx.has(p) ? holdIdx.get(p) : ap.holdQueue.indexOf(p));
        // Circle with the stack, sliding gently into this aircraft's own slot.
        p.holdA += HOLD_OMEGA * dt + clamp(wrapAngle(slot.a - p.holdA), -0.7 * dt, 0.7 * dt);
        p.holdR += (slot.R - p.holdR) * Math.min(1, dt);
        p.x = IAF.x + p.holdR * Math.cos(p.holdA);
        p.y = rw.y + FLIGHT.holdRadius + p.holdR * Math.sin(p.holdA);
        p.ang = p.holdA + Math.PI / 2;
        p.alt += (slot.alt - p.alt) * Math.min(1, dt);
        break;
      }
      case 'final': {
        p.d += FLIGHT.approachSpeed * dt;
        const q = pointAlong(p.path, p.d);
        p.x = q.x; p.y = q.y; p.ang = q.ang;
        const left = Math.max(0, p.len - p.d);
        p.alt = Math.min(p.altStart, left * 0.55);
        if (p.d >= p.len) touchdown(game, ap, p);
        break;
      }
      case 'rollout': {
        // On the runway: decelerate to the exit. The turn-off itself is
        // handled with the rest of the ground traffic.
        if (p.d >= p.rollEnd - 70) break;
        rollOn(ap, p, dt);
        break;
      }
      case 'gate': {
        if (!p.ready) turnaround(game, ap, p, dt);
        break;
      }
      case 'takeoff': {
        // taxi slowly onto the runway, then full power
        if (p.d < p.lineup) p.speed = Math.min(p.speed + 40 * dt, 48);
        else p.speed += FLIGHT.takeoffAccel * dt;
        p.d += p.speed * dt;
        const q = pointAlong(p.path, p.d);
        p.x = q.x; p.y = q.y; p.ang = q.ang;
        if (p.speed > FLIGHT.liftoffSpeed) p.alt += (p.speed - FLIGHT.liftoffSpeed + 30) * 0.35 * dt;
        const R = ap.runways[p.depRw || 0];
        if (R.occupant === p && p.speed > FLIGHT.liftoffSpeed + 20) R.occupant = null; // airborne
        // off the map, or at the end of a path that stays on it (the crosswind's)
        if (p.x > 2250 || p.y > 1800 || p.d >= p.len) p.state = 'gone';
        break;
      }
      case 'holdShort': {
        if (p.depRw === 2) {
          // The crosswind takes departures only: one at a time, the next
          // lining up once the one ahead is rolling well clear.
          if (ap.depQueueX[0] !== p) break;
          const R = ap.runways[2];
          const occ = R.occupant;
          if (ap.atcTokens >= 1 && (!occ || (occ.state === 'takeoff' && occ.y > XW.y0 + 160))) {
            ap.atcTokens -= 1;
            R.occupant = p;
            R.clearEta = t + DEP_OCCUPANCY;
            ap.depQueueX.shift();
            p.state = 'takeoff';
            p.speed = 30;
            const path = crosswindTakeoff();
            setPath(p, path);
            p.lineup = pathLength(path.slice(0, 4));
          }
          break;
        }
        if (ap.depQueue[0] !== p) break;
        const R = ap.runways[0];
        const arr = R.reservedArr;
        const arrEta = arr ? (arr.len - arr.d) / FLIGHT.approachSpeed : Infinity;
        // Line up behind a departure that is already rolling well clear.
        const occ = R.occupant;
        const free = (!occ || (occ.state === 'takeoff' && occ.x > RW[0].x0 + 140)) && !R.crossers.size;
        // Aircraft waiting to cross the runway get a gap between departures.
        const crossWaiting = ap.planes.some((o) => o.crossWait && t - o.crossWait > 2);
        if (ap.atcTokens >= 1 && free && arrEta > DEP_OCCUPANCY && !crossWaiting) {
          ap.atcTokens -= 1;
          R.occupant = p;
          R.clearEta = t + DEP_OCCUPANCY;
          ap.depQueue.shift();
          ap.lastMove = 'dep';
          p.state = 'takeoff';
          p.speed = 30;
          const rw = RW[0];
          const x1 = ap.upgrades.longRunway ? LONG_RUNWAY_X1 : rw.x1;
          const path = [{ x: HOLD_POINT.x, y: HOLD_POINT.y }, { x: HOLD_POINT.x + 18, y: rw.y + 26 }, { x: rw.x0 + 10, y: rw.y }, { x: x1 + 600, y: rw.y }];
          setPath(p, path);
          p.lineup = pathLength(path.slice(0, 3)) - 5;
        }
        break;
      }
    }
  }

  groundTraffic(game, ap, dt);

  if (ap.planes.some((p) => p.state === 'gone')) {
    for (const p of ap.planes) if (p.state === 'gone') ap.flights.delete(p.f.id);
    ap.planes = ap.planes.filter((p) => p.state !== 'gone');
  }
  // Flights whose aircraft never spawned because the contract went away
  // still need closing so their passengers are not stranded.
  for (const f of ap.flights.values()) {
    if (!f.plane && !f.closed && t > f.std + 120) closeFlight(game, ap, f);
    if (!f.plane && f.closed) ap.flights.delete(f.id);
  }
}

// The whole ground route, runway to stand, is fixed at landing clearance so
// taxiing traffic can give way to it before the aircraft even touches down.
// Landing roll to the turn-off, then the taxi route to the stand.
function arrivalRoute(ap, rwIdx, cls, stand, exitIdx = AIRCRAFT[cls].exitIndex) {
  const rw = RW[rwIdx];
  const ex = EXITS[exitIdx];
  const roll = [{ x: rw.x0, y: rw.y }, { x: ex - 60, y: rw.y }, { x: ex - 25, y: rw.y + 12 }, { x: ex, y: rw.exitY }];
  const r = { ex, rollEnd: pathLength(roll), crossAt: null };
  if (rwIdx === 0) {
    r.route = roll.concat(pathExitToGate(ex, stand, ap.plots).slice(1));
  } else {
    // Off the north runway: hold short of the main runway, then cross it.
    const hs = { x: ex, y: RW[0].y - 34 };
    r.route = roll.concat([hs], pathExitToGate(ex, stand, ap.plots));
    r.crossAt = r.rollEnd + (hs.y - rw.exitY);
    r.crossEnd = r.crossAt + (TWY_A - hs.y);
  }
  return r;
}

function groundRoute(ap, p) {
  const r = arrivalRoute(ap, p.rw, p.cls, p.stand, p.exitIdx >= 0 ? p.exitIdx : undefined);
  p.exitX = r.ex;
  p.rollEnd = r.rollEnd;
  p.route = r.route;
  p.crossAt = r.crossAt;
  p.crossEnd = r.crossEnd;
  p.routeLen = pathLength(p.route);
}

// Wheels down.
function touchdown(game, ap, p) {
  const rw = RW[p.rw];
  p.alt = 0;
  const R = ap.runways[p.rw];
  R.reservedArr = null;
  R.occupant = p;
  const A = AIRCRAFT[p.cls];
  const ex = p.exitX;
  const vx = ap.upgrades.rapidExits ? FLIGHT.exitSpeedRapid : FLIGHT.exitSpeed;
  const rollD = p.rollD || ex - 60 - rw.x0;
  p.decel = (FLIGHT.touchdownSpeed ** 2 - vx ** 2) / (2 * rollD);
  p.speed = FLIGHT.touchdownSpeed;
  p.exitSpeed = vx;
  setPath(p, p.route);
  R.clearEta = ap.t + 2 * rollD / (FLIGHT.touchdownSpeed + vx) + 48 / vx;
  p.state = 'rollout';
  earn(game, ap, 'landing', A.landingFee * site(ap).rev);
  ap.lifetime.flights++;
  if (ap.fx) ap.fx('money', { x: p.x + 40, y: p.y - 14, v: A.landingFee * site(ap).rev });
}

// ---------------------------------------------------------------- the star
//
// The hub's star field: three runways crossing at the centre. Each lands
// and takes off toward the centre from one end (STAR_LINES). Arrivals turn
// off well before the centre, into the box corner beside the runway, and
// taxi out along the corner's taxilane to their stand; departures carry on
// out along the same lane to the hold line at the runway's end, line up and
// are airborne before they reach the centre. So nothing on the ground ever
// crosses another runway, and the only thing the three runways share is the
// air over the centre: take-offs pass it one at a time.

const STAR_HS = 425;        // the hold line, out along the corner's taxilane
const STAR_IAF = 650;       // the approach fix, out beyond the threshold
const STAR_DEP_GROUND = 10; // departures off their stands at once
const STAR_BOXES = [];      // one lane per corner: no junctions to lock
const starP = (slot, s, o) => starPoint(WEDGES[slot].line, WEDGES[slot].n, s, o);
const along = (line, q) => (q.x - STAR.C.x) * STAR_LINES[line].ea.x + (q.y - STAR.C.y) * STAR_LINES[line].ea.y;

// Landing roll and turn-off into the corner, then out along its lane to
// the stand.
function starArrivalRoute(slot, stand) {
  const P = (sv, o) => starP(slot, sv, o);
  const roll = [P(STAR_THRESHOLD, 0), P(STAR_EXIT, 0), P(STAR_EXIT - 40, 16), P(STAR_EXIT - 58, 46)];
  const laneS = along(WEDGES[slot].line, stand.lane);
  const route = roll.concat([P(STAR_EXIT - 48, STAR_LANE - 6), P(STAR_EXIT - 28, STAR_LANE), P(laneS, STAR_LANE), { x: stand.x, y: stand.y }]);
  return { route, rollEnd: pathLength(roll), rollD: STAR_THRESHOLD - STAR_EXIT };
}
// Pushback onto the lane, out to the hold line.
function starDeparturePath(slot, stand) {
  return [{ x: stand.lane.x, y: stand.lane.y }, starP(slot, STAR_HS, STAR_LANE)];
}
// From the hold line onto the runway, and off toward the centre.
function starTakeoffPath(slot, line) {
  const P = (sv, o) => starP(slot, sv, o);
  const far = starPoint(line, { x: 0, y: 0 }, -1900, 0);
  return [P(STAR_HS, STAR_LANE), P(STAR_HS + 26, STAR_LANE - 22), P(STAR_HS + 30, 26), P(STAR_THRESHOLD, 0), far];
}
// The corner's taxiways as drawn: the turn-off, the lane, the line-up.
export function starTaxiLines(slot) {
  const P = (sv, o) => starP(slot, sv, o);
  return {
    exit: [P(STAR_EXIT + 20, 0), P(STAR_EXIT, 0), P(STAR_EXIT - 40, 16), P(STAR_EXIT - 58, 46), P(STAR_EXIT - 48, STAR_LANE - 6), P(STAR_EXIT - 28, STAR_LANE)],
    lane: [P(STAR_EXIT - 28, STAR_LANE), P(STAR_HS, STAR_LANE)],
    lineup: starTakeoffPath(slot, WEDGES[slot].line).slice(0, 4),
    hs: P(STAR_HS, STAR_LANE),
    apron: [P(STAR_EXIT - 70, STAR_LANE - 26), P(STAR_HS + 20, STAR_LANE - 26), P(STAR_HS + 20, 180), P(STAR_EXIT - 70, 180)],
  };
}
function starOffRunway(m) {
  const ea = STAR_LINES[m.rw].ea;
  const off = Math.abs((m.x - STAR.C.x) * ea.y - (m.y - STAR.C.y) * ea.x);
  return off >= RUNWAY_HALF + m.r + 3;
}
const starIAF = (line) => starPoint(line, { x: 0, y: 0 }, STAR_THRESHOLD + STAR_IAF, 0);
// the holding stack sits off to one side of the approach
function starHoldCentre(line) {
  const ea = STAR_LINES[line].ea, I = starIAF(line);
  return { x: I.x - ea.y * FLIGHT.holdRadius, y: I.y + ea.x * FLIGHT.holdRadius };
}
export function starHoldStacks(F) {
  return STAR_LINES.map((_, i) => ({ n: F.holdQueue.filter((p) => p.rw === i).length, c: starHoldCentre(i) }));
}

function spawnStarPlane(F, f) {
  const A = AIRCRAFT[f.cls];
  const line = WEDGES[f.terminal] ? WEDGES[f.terminal].line : 0;
  const I = starIAF(line), ea = STAR_LINES[line].ea;
  const a = (F.rand() - 0.5) * 140 * DEG, out = Math.atan2(ea.y, ea.x) + a;
  const x = I.x + 420 * Math.cos(out), y = I.y + 420 * Math.sin(out);
  const p = {
    id: F.nextPlaneId++, f, cls: f.cls, color: f.color, scale: A.scale, r: R_PLANE * A.scale,
    state: 'inbound', x, y, ang: Math.atan2(I.y - y, I.x - x), alt: 160, speed: FLIGHT.cruiseSpeed,
    path: null, d: 0, blockedFor: 0, gate: -1, turnLeft: 0, turnTotal: 0, deplaned: 0,
    rw: line, field: 'X', gold: rollGold(F) || undefined,
  };
  f.plane = p;
  F.planes.push(p);
}

function canClearStarArrival(F, p, eta) {
  const g = findGate(F, p);
  if (g < 0) { p.holdReason = 'gate'; return false; }
  // its terminal may have moved to a corner served by another runway
  const W = WEDGES[p.f.terminal];
  if (W && W.line !== p.rw) {
    // its terminal moved to another line: circle over to that line's stack
    // from where it is, rather than jumping there
    p.rw = W.line;
    if (p.state === 'holding') { const c = starHoldCentre(p.rw); p.holdA = Math.atan2(p.y - c.y, p.x - c.x); p.holdR = Math.hypot(p.x - c.x, p.y - c.y); }
    return false;
  }
  // the turn-off and the start of the corner's lane must be clear
  const ex = starP(p.f.terminal, STAR_EXIT - 40, 40);
  if (F.planes.some((o) => o !== p && o.alt <= 0.5 && o.state !== 'gate' && Math.hypot(o.x - ex.x, o.y - ex.y) < 75)) { p.holdReason = 'taxi'; return false; }
  if (F.arrGround >= MAX_ARR_GROUND * 3) { p.holdReason = 'taxi'; return false; }
  p.holdReason = 'runway';
  const R = F.runways[p.rw];
  if (F.atcTokens < 1 || R.reservedArr) return false;
  if (R.occupant && R.occupant.blockedFor > 0) return false;
  let freeAt = R.occupant ? Math.max(R.clearEta, F.t + 1) : F.t;
  if (freeAt > F.t + eta - 0.2) return false;
  // one landing then one take-off while departures wait
  const q = F.depQueues[p.rw];
  if (q.length && F.lastMoves[p.rw] === 'arr') return false;
  if (q.length && (F.t - q[0].holdSince > 3 || q.length > 1)) {
    if (freeAt + DEP_OCCUPANCY > F.t + eta) return false;
    if (F.atcTokens < 2) return false;
  }
  return true;
}
function tryClearStarArrival(F, p) {
  const I = starIAF(p.rw), T = starPoint(p.rw, { x: 0, y: 0 }, STAR_THRESHOLD, 0);
  const eta = dist(p.x, p.y, I.x, I.y) / FLIGHT.cruiseSpeed + STAR_IAF / FLIGHT.approachSpeed;
  if (!canClearStarArrival(F, p, eta)) return false;
  const g = findGate(F, p);
  if (g < 0) return false;
  F.lastMoves[p.rw] = 'arr';
  const Tm = terminalBySlot(F, p.f.terminal);
  p.gate = g; Tm.gateUse[g] = p;
  F.arrGround++;
  p.stand = gateStand(Tm.slot, g);
  const r = starArrivalRoute(Tm.slot, p.stand);
  p.route = r.route; p.rollEnd = r.rollEnd; p.rollD = r.rollD; p.routeLen = pathLength(r.route); p.crossAt = null;
  F.runways[p.rw].reservedArr = p;
  F.atcTokens -= 1;
  p.state = 'final';
  setPath(p, [{ x: p.x, y: p.y }, I, T]);
  p.altStart = p.alt;
  const i = F.holdQueue.indexOf(p);
  if (i >= 0) F.holdQueue.splice(i, 1);
  return true;
}

function updateStarPlanes(game, F, dt) {
  // each holding aircraft's place in its line's stack, once a step
  const starIdx = new Map(), perLine = [0, 0, 0];
  for (const q of F.holdQueue) starIdx.set(q, perLine[q.rw]++);
  const t = F.t;
  F.holdPhase += HOLD_OMEGA * dt;
  F.arrGround = 0;
  for (const o of F.planes) if (o.state === 'rollout' || o.state === 'taxiIn' || o.state === 'final') F.arrGround++;
  // first come first served, one clearance per runway at a time
  const tried = new Set();
  for (const p of [...F.holdQueue]) { if (tried.has(p.rw)) continue; tried.add(p.rw); tryClearStarArrival(F, p); }

  for (const p of F.planes) {
    switch (p.state) {
      case 'inbound': {
        const I = starIAF(p.rw);
        const d = dist(p.x, p.y, I.x, I.y), step = p.speed * dt;
        p.ang = Math.atan2(I.y - p.y, I.x - p.x);
        if (d <= step + 1) {
          p.x = I.x; p.y = I.y;
          if (!F.holdQueue.some((o) => o.rw === p.rw) && tryClearStarArrival(F, p)) break;
          p.state = 'holding';
          const c = starHoldCentre(p.rw);
          p.holdA = Math.atan2(p.y - c.y, p.x - c.x);
          p.holdR = FLIGHT.holdRadius;
          F.holdQueue.push(p);
        } else { p.x += (I.x - p.x) / d * step; p.y += (I.y - p.y) / d * step; }
        break;
      }
      case 'holding': {
        p.heldFor = (p.heldFor || 0) + dt;
        if (diverts(game, F, p, dt)) break;
        const c = starHoldCentre(p.rw);
        const slot = holdSlot(F, starIdx.has(p) ? starIdx.get(p) : 0);
        p.holdA += HOLD_OMEGA * dt + clamp(wrapAngle(slot.a - p.holdA), -0.7 * dt, 0.7 * dt);
        p.holdR += (slot.R - p.holdR) * Math.min(1, dt);
        p.x = c.x + p.holdR * Math.cos(p.holdA);
        p.y = c.y + p.holdR * Math.sin(p.holdA);
        p.ang = p.holdA + Math.PI / 2;
        p.alt += (slot.alt - p.alt) * Math.min(1, dt);
        break;
      }
      case 'final': {
        p.d += FLIGHT.approachSpeed * dt;
        const q = pointAlong(p.path, p.d);
        p.x = q.x; p.y = q.y; p.ang = q.ang;
        p.alt = Math.min(p.altStart, Math.max(0, p.len - p.d) * 0.55);
        if (p.d >= p.len) starTouchdown(game, F, p);
        break;
      }
      case 'rollout': {
        if (p.d >= p.rollEnd - 70) break;
        rollOn(F, p, dt);
        break;
      }
      case 'gate': if (!p.ready) turnaround(game, F, p, dt); break;
      case 'takeoff': {
        if (p.d < p.lineup) p.speed = Math.min(p.speed + 40 * dt, 48);
        else p.speed += FLIGHT.takeoffAccel * dt;
        p.d += p.speed * dt;
        const q = pointAlong(p.path, p.d);
        p.x = q.x; p.y = q.y; p.ang = q.ang;
        if (p.speed > FLIGHT.liftoffSpeed) p.alt += (p.speed - FLIGHT.liftoffSpeed + 30) * 0.35 * dt;
        const R = F.runways[p.depRw];
        if (R.occupant === p && p.speed > FLIGHT.liftoffSpeed + 20) R.occupant = null;
        if (dist(p.x, p.y, STAR.C.x, STAR.C.y) > 1500) p.state = 'gone';
        break;
      }
      case 'holdShort': {
        const L = p.depRw, q = F.depQueues[L];
        if (q[0] !== p) break;
        const R = F.runways[L];
        const arr = R.reservedArr;
        const arrEta = arr ? (arr.len - arr.d) / FLIGHT.approachSpeed : Infinity;
        const occ = R.occupant;
        const free = !occ || (occ.state === 'takeoff' && occ.d > occ.lineup + 140);
        if (F.atcTokens >= 1 && free && arrEta > DEP_OCCUPANCY && t >= F.centreFree) {
          F.atcTokens -= 1;
          R.occupant = p;
          R.clearEta = t + DEP_OCCUPANCY;
          q.shift();
          F.lastMoves[L] = 'dep';
          F.centreFree = t + STAR_CENTRE_GAP;
          p.state = 'takeoff';
          p.speed = 30;
          const path = starTakeoffPath(p.depSlot, L);
          setPath(p, path);
          p.lineup = pathLength(path.slice(0, 4)) - 5;
        }
        break;
      }
    }
  }

  groundTraffic(game, F, dt);

  if (F.planes.some((p) => p.state === 'gone')) {
    for (const p of F.planes) if (p.state === 'gone') F.flights.delete(p.f.id);
    F.planes = F.planes.filter((p) => p.state !== 'gone');
  }
}
// seconds between take-offs over the centre, from any of the three runways
const STAR_CENTRE_GAP = 3.2;

function starTouchdown(game, F, p) {
  p.alt = 0;
  const R = F.runways[p.rw];
  R.reservedArr = null;
  R.occupant = p;
  const A = AIRCRAFT[p.cls];
  const vx = F.upgrades.rapidExits ? FLIGHT.exitSpeedRapid : FLIGHT.exitSpeed;
  p.decel = (FLIGHT.touchdownSpeed ** 2 - vx ** 2) / (2 * p.rollD);
  p.speed = FLIGHT.touchdownSpeed;
  p.exitSpeed = vx;
  setPath(p, p.route);
  R.clearEta = F.t + 2 * p.rollD / (FLIGHT.touchdownSpeed + vx) + 48 / vx;
  p.state = 'rollout';
  earn(game, F, 'landing', A.landingFee * site(F).rev);
  F.lifetime.flights++;
  if (F.fx) F.fx('money', { x: p.x + 40, y: p.y - 14, v: A.landingFee * site(F).rev });
}

// ---------------------------------------------------------------- the ground

// Junctions nobody may stop in unless they can get all the way through
// ("don't block the box"). Rebuilt when the airport's layout changes.
// Anyone stopped outside a box is far enough from its centre for the
// largest aircraft to pass through it.
const BOX = 29; // with R_PLANE: 59, just short of the 62 px between taxiways A and B
function junctionBoxes(ap) {
  if (isStar(ap)) return STAR_BOXES;
  const key = JSON.stringify([ap.plots, ap.terminals.map((T) => [T.slot, T.gates, T.connector && T.connector.type]), !!ap.upgrades.runway2, !!ap.upgrades.crosswind]);
  if (ap.zonesKey === key) return ap.zones;
  // The runway turn-offs, so an aircraft can always get off a runway (one
  // stuck there would block every take-off, and take-offs are what drain
  // every queue on the field), and the taxilane and turn-off junctions on
  // taxiway B and the apron lane. Stands are left out: they sit every 64 px,
  // so their boxes would merge into one long one nobody could get through,
  // and a queue in front of a stand only delays the next aircraft into it.
  const z = [];
  for (const ex of EXITS) { z.push({ x: ex, y: TWY_A }); z.push({ x: ex, y: TWY_B }); }
  for (const L of lanesFor(ap.plots)) { z.push({ x: L.x, y: TWY_B }); z.push({ x: L.x, y: LANE2 }); }
  if (ap.upgrades.crosswind) z.push({ x: XW_HOLD.x, y: LANE2 });
  for (const T of ap.terminals) {
    const crossing = apronCrossing(T.slot);
    if (T.connector && T.connector.type === 'shuttle' && crossing && crossing.field === (ap.field || 0)) z.push({ x: crossing.x, y: LANE2 });
  }
  ap.zones = z;
  ap.zonesKey = key;
  return z;
}

// Distance along m's lookahead, from sample i, to where it is clear of every
// junction box; Infinity if that is beyond what it can see (or 0 when its
// route simply ends there).
function boxExit(zones, m, i) {
  for (let j = i; j < m.look.length; j++) if (boxAt(zones, m.look[j].x, m.look[j].y) < 0) return m.look[j].s;
  return m.d + LOOK >= m.len ? 0 : Infinity;
}

// A junction box is a cross: a stretch of the line through the junction and
// a stretch of the route that crosses it. Every box is the same size,
// whatever the aircraft, big enough that one stopped just outside leaves
// room for the largest to pass through the middle. Being a cross rather
// than a square, a box on taxiway B never reaches up onto taxiway A.
const BOX_E = BOX + R_PLANE;
function inBox(Z, x, y) {
  return (Math.abs(y - Z.y) < 3 && Math.abs(x - Z.x) < BOX_E) || (Math.abs(x - Z.x) < 3 && Math.abs(y - Z.y) < BOX_E);
}
function boxAt(zones, x, y) {
  for (let i = 0; i < zones.length; i++) if (inBox(zones[i], x, y)) return i;
  return -1;
}
function boxesAt(zones, x, y) {
  const out = [];
  for (let i = 0; i < zones.length; i++) if (inBox(zones[i], x, y)) out.push(i);
  return out;
}

// Points along an aircraft's route ahead of it, every SAMPLE px.
function lookahead(p) {
  const out = [];
  const end = Math.min(p.len, p.d + LOOK);
  for (let s = 0; p.d + s <= end + 0.01; s += SAMPLE) {
    const q = pointAlong(p.path, p.d + s);
    out.push({ s, x: q.x, y: q.y });
  }
  return out;
}

// The landing roll, down to the turn-off. Anything on the ground ahead (an
// aircraft still turning off at an earlier exit, say) and it brakes hard,
// stopping short of it if it must.
const ROLL_BRAKE = 140; // px/s², hard braking
function rollOn(ap, p, dt) {
  p.speed = Math.max(p.exitSpeed, p.speed - p.decel * dt);
  const reach = p.speed * p.speed / (2 * ROLL_BRAKE) + 30;
  let free = Infinity;
  const pts = [];
  for (let s = 0; s <= reach; s += 8) pts.push({ s, q: pointAlong(p.path, p.d + s) });
  for (const o of ap.planes) {
    if (o === p || o.alt > 0.5 || o.state === 'gate' || o.state === 'gone') continue;
    if (Math.abs(o.x - p.x) > reach + 80 || Math.abs(o.y - p.y) > reach + 80) continue;
    const rr = p.r + o.r + 2, now = Math.hypot(p.x - o.x, p.y - o.y);
    for (const { s, q } of pts) {
      if (s >= free) break;
      const d = Math.hypot(q.x - o.x, q.y - o.y);
      if (d < rr && d < now - 0.5) { free = Math.max(0, s - 8); break; }
    }
  }
  if (free < Infinity) p.speed = Math.min(p.speed, Math.sqrt(2 * ROLL_BRAKE * free));
  p.d += Math.min(p.speed * dt, free);
  const q = pointAlong(p.path, p.d);
  p.x = q.x; p.y = q.y; p.ang = q.ang;
}

// A holding aircraft gives up and diverts elsewhere: when no terminal on
// its airfield can take it any more (one was torn down), or when it has
// circled for five minutes (the gates are badly overbooked). Its
// passengers count as missed. Without the second, an overbooked airport's
// stack would grow for ever.
const HOLD_GIVE_UP = 300;
function diverts(game, F, p, dt) {
  if (p.heldFor <= 30 || Math.floor(p.heldFor) === Math.floor(p.heldFor - dt)) return false;
  const none = findGate(F, p) === -2;
  if (!none && p.heldFor < HOLD_GIVE_UP) return false;
  closeFlight(game, F, p.f);
  p.state = 'gone';
  F.holdQueue.splice(F.holdQueue.indexOf(p), 1);
  if (none) notify(F, 'missed', `${p.f.no} diverted: no open terminal on its airfield can take it`);
  else if (F.t - (F.lastDivertNote || -1e9) > 30) { F.lastDivertNote = F.t; notify(F, 'missed', `${p.f.no} diverted after circling for 5 minutes: not enough gates`); }
  return true;
}

function isMover(p) {
  return p.state === 'taxiIn' || p.state === 'taxiOut' || p.state === 'pushback'
    || (p.state === 'rollout' && p.d >= p.rollEnd - 70);
}

function groundTraffic(game, ap, dt) {
  const t = ap.t;
  const zones = junctionBoxes(ap);
  // Everything physically on the ground and outside a stand is an obstacle.
  const bodies = [];
  for (const p of ap.planes) {
    if (p.alt > 0.5 || p.state === 'gate' || p.state === 'gone') continue;
    bodies.push({ x: p.x, y: p.y, r: p.r, p });
  }
  for (const b of ap.busBlocks || []) bodies.push(b);
  // An aircraft being pushed back owns the spot on the lane it is backing
  // into, so nobody drives up to it in the meantime.
  for (const p of ap.planes) {
    if (p.state === 'pushback') bodies.push({ x: p.stand.lane.x, y: p.stand.lane.y, r: p.r, p });
  }

  const movers = ap.planes.filter(isMover);
  // Aircraft at a gate that are ready to push back are candidates.
  const depOnGround = ap.planes.filter((p) => p.state === 'pushback' || p.state === 'taxiOut' || p.state === 'holdShort').length;
  // With a second runway the main one only takes departures and drains the
  // queue faster, so more may taxi at once.
  const depCap = isStar(ap) ? STAR_DEP_GROUND : MAX_DEP_GROUND + (ap.upgrades.runway2 ? 4 : 0) + (ap.upgrades.crosswind ? 4 : 0);
  const pending = depOnGround < depCap ? ap.planes.filter((p) => p.state === 'gate' && p.ready) : [];

  // 1. how far each can go before touching another aircraft
  for (const m of movers.concat(pending)) {
    m.look = lookahead(m);
    m.blockBy = null;
    m.why = '';
    let free = m.look.length ? m.look[m.look.length - 1].s + (m.d + LOOK >= m.len ? 1e6 : 0) : 0;
    for (const o of bodies) {
      if (o.p === m) continue;
      if (Math.abs(o.x - m.x) > LOOK + 70 || Math.abs(o.y - m.y) > LOOK + 70) continue;
      const rr = m.r + o.r + 1;
      const now = Math.hypot(m.x - o.x, m.y - o.y);
      for (const q of m.look) {
        if (q.s >= free) break;
        const dq = Math.hypot(q.x - o.x, q.y - o.y);
        // Too close, and getting closer. Moving away is always allowed, so
        // two aircraft that end up near each other can always separate.
        if (dq < rr && dq < now - 0.5) {
          if (q.s - SAMPLE < free) { m.why = 'body ' + (o.p ? o.p.id : 'bus') + '@' + q.s; m.blockBy = o.p; }
          free = Math.min(free, Math.max(0, q.s - SAMPLE));
          break;
        }
      }
    }
    m.free = Math.max(0, free);
  }

  // 2. junctions: the aircraft nearer the meeting point goes first
  const claims = movers.map((m) => ({ m, pts: m.look.filter((q) => q.s <= Math.min(m.free, CLAIM)) }));
  // An aircraft still rolling down the runway already owns its turn-off:
  // nobody may start across the junctions it is about to use.
  for (const p of ap.planes) {
    if (!((p.state === 'rollout' && !isMover(p)) || p.state === 'final') || !p.route) continue;
    const pts = [];
    const d0 = p.state === 'final' ? -1e3 : p.d;
    for (let d = p.rollEnd - 30; d <= Math.min(p.routeLen, p.rollEnd + 100); d += SAMPLE) {
      const q = pointAlong(p.route, d);
      pts.push({ s: d - d0, x: q.x, y: q.y });
    }
    claims.push({ m: p, pts, pseudo: true });
  }
  for (const c of claims) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of c.pts) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
    c.box = [x0, y0, x1, y1];
  }
  const overlap = (a, b, pad) => a[0] - pad <= b[2] && b[0] - pad <= a[2] && a[1] - pad <= b[3] && b[1] - pad <= a[3];
  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const A = claims[i], B = claims[j];
      if (!A.pts.length || !B.pts.length) continue;
      const rr = A.m.r + B.m.r + 3;
      if (!overlap(A.box, B.box, rr)) continue;
      let hit = null;
      for (const a of A.pts) {
        for (const b of B.pts) {
          const dx = a.x - b.x, dy = a.y - b.y;
          if (dx * dx + dy * dy < rr * rr) { hit = [a.s, b.s]; break; }
        }
        if (hit) break;
      }
      if (!hit) continue;
      if (A.pseudo && B.pseudo) continue;
      // Aircraft leaving a runway (landing, or crossing the main one) go
      // first; then anyone already standing on the other's route or inside a
      // junction; then the one nearer the meeting point, with a little extra
      // standing for a long wait. A winner that is stuck behind the loser
      // hands its turn over.
      const offRunway = (x) => x.state === 'rollout' || ap.runways[0].crossers.has(x);
      const ka = hit[0] - A.m.blockedFor * 4 - (offRunway(A.m) ? 1000 : 0);
      const kb = hit[1] - B.m.blockedFor * 4 - (offRunway(B.m) ? 1000 : 0);
      let aWins = ka < kb - 0.5 || (Math.abs(ka - kb) <= 0.5 && A.m.id < B.m.id);
      // One just towed back to break a standoff gives way for a while, or
      // it would drive straight back into the same one.
      const towedA = !A.pseudo && t - (A.m.towT || -1e9) < 15, towedB = !B.pseudo && t - (B.m.towT || -1e9) < 15;
      const onRoute = (X, Y) => !X.pseudo && Y.pts.some((q) => (q.x - X.m.x) ** 2 + (q.y - X.m.y) ** 2 < rr * rr);
      const aOn = onRoute(A, B), bOn = onRoute(B, A);
      const aIn = !A.pseudo && boxAt(zones, A.m.x, A.m.y) >= 0;
      const bIn = !B.pseudo && boxAt(zones, B.m.x, B.m.y) >= 0;
      if (aOn && !bOn) aWins = true;
      else if (bOn && !aOn) aWins = false;
      else if (aIn && !bIn) aWins = true;
      else if (bIn && !aIn) aWins = false;
      if (aWins && A.m.blockBy === B.m && B.m.blockBy !== A.m) aWins = false;
      else if (!aWins && B.m.blockBy === A.m && A.m.blockBy !== B.m) aWins = true;
      if (towedA !== towedB) aWins = towedB;
      // A claim from an aircraft still on the runway can't be made to wait.
      if ((aWins ? B : A).pseudo) continue;
      const loser = aWins ? B.m : A.m;
      // Several aircraft each giving way to the next can wait on each other
      // in a circle. Someone who has given way a long time and has nothing
      // physically in front of it goes; its own body check still applies.
      if (loser.blockedFor > 6 && !loser.blockBy) continue;
      const ls = aWins ? hit[1] : hit[0];
      if (ls - SAMPLE < loser.free) loser.why += ' yield ' + (aWins ? A.m.id : B.m.id);
      // Stop well short, so the winner's whole body clears us; further short
      // of an aircraft swinging off a runway along the curve of its exit.
      const winner = aWins ? A.m : B.m;
      loser.free = Math.min(loser.free, Math.max(0, ls - (offRunway(winner) ? 5 : 3) * SAMPLE));
    }
  }

  // 3. pushback: only into a gap nobody is heading for
  for (const m of pending) {
    const need = (m.pushLen || 0) + 45;
    if (m.free < need) continue;
    let conflict = false;
    for (const c of claims) {
      const rr = m.r + c.m.r + 3;
      for (const a of m.look) {
        if (a.s > need) break;
        for (const b of c.pts) {
          const dx = a.x - b.x, dy = a.y - b.y;
          if (dx * dx + dy * dy < rr * rr) { conflict = true; break; }
        }
        if (conflict) break;
      }
      if (conflict) break;
    }
    if (conflict) continue;
    startPushback(ap, m);
    break; // one at a time, so two neighbours never push into each other
  }

  // 4. move
  for (const m of movers) {
    let allowed = m.free;
    // Don't stop inside a junction: enter one only with room to get out.
    // Junction boxes are also locks: one aircraft in a box at a time, and
    // nobody enters without room to get out the other side. A rollout is
    // exempt only until it reaches the taxiway it turns onto: it must get
    // off the runway, but not barge into the junctions beyond.
    {
      // (each look-ahead point's boxes, worked out once: they are asked again and again)
      const bxAt = (q) => q.bx || (q.bx = boxesAt(zones, q.x, q.y));
      const mine = new Set(boxesAt(zones, m.x, m.y));
      for (const k of mine) {
        const Z = zones[k];
        if (!Z.owner || Z.owner === m || t - Z.ownerT > 0.2) { Z.owner = m; Z.ownerT = t; }
      }
      const skip = m.state === 'rollout' ? m.rollEnd - m.d : -1;
      for (let i = 0; i < m.look.length; i++) {
        const q = m.look[i];
        if (q.s > allowed) break;
        const fresh = bxAt(q).filter((k) => !mine.has(k));
        if (!fresh.length) continue;
        if (q.s < skip) { for (const k of fresh) mine.add(k); continue; }
        const taken = fresh.some((k) => zones[k].owner && zones[k].owner !== m && t - zones[k].ownerT <= 0.2);
        let exitS = m.d + LOOK >= m.len ? 0 : Infinity;
        for (let j = i + 1; j < m.look.length; j++) {
          const here = bxAt(m.look[j]);
          if (!fresh.some((k) => here.includes(k))) { exitS = m.look[j].s; break; }
        }
        // An aircraft halfway across the main runway may always pull into
        // the junction on taxiway A beyond it: stopping on the runway instead
        // would hold up the departures that have to move to make it room.
        const offRunwayFirst = ap.runways[0].crossers.has(m) && fresh.every((k) => zones[k].y === TWY_A);
        if (taken || (!offRunwayFirst && m.free < exitS + m.r * 0.5)) {
          allowed = Math.max(0, q.s - SAMPLE);
          m.why = (m.why || '') + (taken ? ' +locked' : ' +box');
          break;
        }
        // Take it at the moment of entering, so nobody else starts into it.
        // Taking it earlier and then waiting would hold everyone else up.
        if (q.s <= 2 * SAMPLE) for (const k of fresh) { zones[k].owner = m; zones[k].ownerT = t; }
        for (const k of fresh) mine.add(k);
      }
    }
    // North-runway arrivals cross the main runway only when it is free and
    // there is room to get all the way across.
    if (m.crossAt != null && !m.crossed && !m.crossing) {
      const toHold = m.crossAt - m.d;
      if (toHold < allowed + 0.01) {
        const R0 = ap.runways[0];
        // Room to get across the runway and out of the junctions beyond it.
        let across = m.crossEnd - m.d + m.r;
        for (let i = 0; i < m.look.length; i++) {
          if (m.look[i].s < m.crossEnd - m.d) continue;
          across = Math.max(across, boxExit(zones, m, i) + m.r * 0.5);
          break;
        }
        // Ask the tower for a gap in departures only once there is room on
        // the far side; otherwise the departures it would stop are exactly
        // what has to move to make that room.
        if (toHold < 1 && m.free >= across) m.crossWait = m.crossWait || t;
        else m.crossWait = 0;
        // Several aircraft may cross together (at different turn-offs), but
        // not ahead of a landing about to touch down on the main runway.
        const arr0 = R0.reservedArr;
        const landing = arr0 && (arr0.len - arr0.d) / FLIGHT.approachSpeed < 8;
        if (toHold < 1 && !R0.occupant && !landing && m.free >= across) {
          m.crossing = true;
          m.crossWait = 0;
          R0.crossers.add(m);
        } else {
          allowed = Math.max(0, toHold);
        }
      }
    }

    let vmax = m.state === 'pushback' ? PUSH_SPEED : FLIGHT.taxiSpeed;
    if (m.state === 'rollout') vmax = Math.max(FLIGHT.taxiSpeed, m.speed - m.decel * dt);
    // Slow for corners.
    const ahead = pointAlong(m.path, Math.min(m.len, m.d + 22));
    if (m.state !== 'pushback' && Math.abs(wrapAngle(ahead.ang - m.ang)) > 0.5) vmax = Math.min(vmax, 32);
    const stopV = Math.sqrt(2 * 90 * allowed);
    const target = Math.min(vmax, stopV);
    m.speed = target > m.speed ? Math.min(target, m.speed + 70 * dt) : target;
    const step = Math.min(m.speed * dt, allowed);
    if (step < 0.05 && m.d < m.len - 0.5) {
      m.blockedFor += dt;
      // Standoff: aircraft blocking each other in a circle. The one with the
      // least claim (the newest) is towed back a little to break it. If even
      // that is impossible after a full minute, count a gridlock (the stress
      // test fails on any).
      if (m.blockedFor > 5 && m.blockBy && m.state !== 'rollout') {
        const ring = [m];
        let x = m.blockBy;
        while (x && !ring.includes(x) && ring.length < 8) { ring.push(x); x = x.blockBy; }
        // Only a real standoff: every one of them stopped (an aircraft
        // that blocks another from far ahead may just be creeping along).
        // Tow the newest that is not still turning off a runway and can
        // move back; failing that (someone close behind, or towed as far
        // as it goes), the next newest; after 20 seconds, even one turning
        // off, if backing up keeps it off any runway it doesn't hold.
        if (x === m && ring.every((r) => r.blockedFor > 5)) {
          const order = (a, b) => b.id - a.id;
          const cands = ring.filter((r) => r.state !== 'rollout').sort(order);
          if (m.blockedFor > 20 && cands.length) cands.push(...ring.filter((r) => r.state === 'rollout').sort(order));
          let pick = cands.find((r) => canTow(r, bodies, ap));
          // nobody can back up: make room behind one of them instead (a
          // queue nose to tail behind the junction)
          if (!pick) {
            for (const r of cands) {
              const seen = new Set(ring);
              for (let b = behind(r, bodies); b && !seen.has(b) && seen.size < ring.length + 6; b = behind(b, bodies)) {
                seen.add(b);
                if (b.blockedFor <= 5 || b.state === 'rollout') break;
                if (canTow(b, bodies, ap)) { pick = b; break; }
              }
              if (pick) break;
            }
          }
          if (pick && pick.towStep !== t) {
            pick.towStep = t; // once a step, however many of the ring ask
            if (towBack(pick, bodies, dt, ap)) pick.towT = t; // and it gives way for a while
          }
        }
      }
      if (m.blockedFor > 60) ap.gridlocks = (ap.gridlocks || 0) + 1;
    } else {
      m.blockedFor = Math.max(0, m.blockedFor - dt * 2);
      if (step > 1) m.towed = 0;
    }
    if (ap.busBlocks && ap.busBlocks.length && step < 0.05) {
      for (const b of ap.busBlocks) if (Math.hypot(b.x - m.x, b.y - m.y) < m.r + 60) { m.busDelay = (m.busDelay || 0) + dt; break; }
    }
    m.d += step;
    const q = pointAlong(m.path, m.d);
    m.x = q.x; m.y = q.y;
    if (m.state === 'pushback') {
      m.ang = m.stand.ang; // being pushed backwards, nose to the terminal
    } else if (m.state === 'rollout' && m.d < m.rollEnd) {
      m.ang = q.ang;
    } else {
      m.ang += wrapAngle(q.ang - m.ang) * Math.min(1, dt * 6);
    }

    // transitions
    // The runway is free once the whole aircraft is clear of its edge.
    if (m.state === 'rollout' && (m.d >= m.rollEnd || (isStar(ap) ? starOffRunway(m) : m.y >= RW[m.rw].y + RUNWAY_HALF + m.r + 3))) {
      const R = ap.runways[m.rw];
      if (R.occupant === m) R.occupant = null;
      if (m.d >= m.rollEnd) m.state = 'taxiIn';
    }
    if (m.crossing) {
      // The runway is free as soon as the tail is clear of its edge, even if
      // the aircraft then has to stop short of the taxiway: holding the
      // runway there would stop the departures it may be waiting for.
      const R0 = ap.runways[0];
      if (m.y >= RW[0].y + RUNWAY_HALF + m.r + 3) R0.crossers.delete(m);
      if (m.d >= m.crossEnd) {
        R0.crossers.delete(m);
        m.crossing = false;
        m.crossed = true;
      }
    }
    if (m.state === 'pushback' && m.d >= m.pushLen) {
      const T = terminalBySlot(ap, m.f.terminal);
      if (T && T.gateUse && T.gateUse[m.gate] === m) T.gateUse[m.gate] = null;
      m.gate = -1;
      m.state = 'taxiOut';
    }
    if (m.d >= m.len - 0.01) {
      if (m.state === 'taxiIn') arriveAtGate(game, ap, m);
      else if (m.state === 'taxiOut') { m.state = 'holdShort'; m.holdSince = t; m.speed = 0; (isStar(ap) ? ap.depQueues[m.depRw] : m.depRw === 2 ? ap.depQueueX : ap.depQueue).push(m); }
    }
  }
}

// Move an aircraft back along its route, only while that takes it further
// from everything around it; at most 45 px in all.
// Can an aircraft be towed back a little without backing into anyone?
function canTow(m, bodies, ap) {
  if ((m.towed || 0) > 45 || m.d < 2) return false;
  const back = pointAlong(m.path, Math.max(0, m.d - 3));
  // never back onto a runway it doesn't hold (one it has turned off, or
  // finished crossing): a take-off there would run into it
  if (ap && !isStar(ap)) {
    for (const rw of RW) {
      if (rw.id === 1 && !ap.upgrades.runway2) continue;
      const R = ap.runways[rw.id];
      if (R.occupant !== m && !R.crossers.has(m) && Math.abs(back.y - rw.y) < RUNWAY_HALF + m.r + 3 && Math.abs(back.y - rw.y) < Math.abs(m.y - rw.y)) return false;
    }
  }
  for (const o of bodies) {
    if (o.p === m) continue;
    const now = Math.hypot(m.x - o.x, m.y - o.y), then = Math.hypot(back.x - o.x, back.y - o.y);
    if (then < now && then < m.r + o.r + 2) return false;
  }
  return true;
}
// The aircraft right behind m that stops it backing up, if any.
function behind(m, bodies) {
  if (m.d < 2) return null;
  const back = pointAlong(m.path, Math.max(0, m.d - 3));
  for (const o of bodies) {
    if (o.p === m || !o.p || !o.p.path) continue;
    const now = Math.hypot(m.x - o.x, m.y - o.y), then = Math.hypot(back.x - o.x, back.y - o.y);
    if (then < now && then < m.r + o.r + 2) return o.p;
  }
  return null;
}
function towBack(m, bodies, dt, ap) {
  if (!canTow(m, bodies, ap)) return false;
  const step = Math.min(10 * dt, m.d);
  m.d -= step;
  m.towed = (m.towed || 0) + step;
  m.tow = true;
  const q = pointAlong(m.path, m.d); // where it is now, for everyone else's checks
  m.x = q.x; m.y = q.y;
  return step > 0;
}

function startPushback(ap, p) {
  p.ready = false;
  p.state = 'pushback';
  p.speed = 0;
  p.blockedFor = 0;
  // On-time is judged when the aircraft actually leaves the gate.
  const f = p.f;
  const delay = Math.max(0, ap.t - f.std);
  const onTime = delay <= FLIGHT.onTimeSlack;
  const c = ap.contracts.find((x) => x.id === f.contract);
  if (c) { c.otpHist.push(onTime ? 1 : 0); if (c.otpHist.length > 12) c.otpHist.shift(); c.flown = (c.flown || 0) + 1; c.lastDelay = delay; }
  ap.rolling.otp += ((onTime ? 1 : 0) - ap.rolling.otp) * 0.06;
  if (!onTime) {
    const why = p.lateWhy || 'traffic';
    ap.lateWhy = ap.lateWhy || {};
    ap.lateWhy[why] = (ap.lateWhy[why] || 0) + 1;
    // The last few minutes of late departures, for the advisor.
    ap.lateLog = (ap.lateLog || []).filter((e) => ap.t - e.t < 240);
    ap.lateLog.push({ t: ap.t, why, slot: f.terminal, delay });
  }
}

function findGate(ap, p) {
  let T = terminalBySlot(ap, p.f.terminal);
  // (a terminal on another of the hub's airfields is out of reach)
  if (!T || !isOpen(T) || !terminalSupports(ap, T, p.cls) || slotField(T.slot) !== (ap.field || 0)) {
    // Contract moved or terminal closed: fall back to any terminal that fits.
    const was = T;
    const f = ap.field || 0;
    T = ap.terminals.find((x) => isOpen(x) && terminalSupports(ap, x, p.cls) && slotField(x.slot) === f);
    if (!T) return -2;
    if (was) moveFlightPax(ap, p.f.id, was, T);
    p.f.terminal = T.slot;
  }
  if (!T.gateUse || T.gateUse.length !== T.gates) {
    const old = T.gateUse || [];
    T.gateUse = Array.from({ length: T.gates }, (_, i) => old[i] || null);
  }
  // Lower-numbered gates are nearer the middle: shortest walk.
  for (let g = 0; g < T.gates; g++) if (!T.gateUse[g]) return g;
  return -1;
}

function arriveAtGate(game, ap, p) {
  p.state = 'gate';
  p.x = p.stand.x; p.y = p.stand.y; p.ang = p.stand.ang;
  // Crews hurry a late aircraft: up to a quarter off the turnaround.
  const late = Math.max(0, ap.t - (p.f.std - turnTime(ap, p.cls)));
  p.f.gateInLate = ap.t - (p.f.std - turnTime(ap, p.cls));
  p.turnTotal = turnTime(ap, p.cls) * Math.max(0.75, 1 - late / 120 * 0.25);
  p.turnLeft = p.turnTotal;
  p.deplaned = 0;
  p.speed = 0;
}

function turnaround(game, ap, p, dt) {
  const f = p.f;
  const T = terminalBySlot(ap, f.terminal);
  p.turnLeft -= dt;
  const done = 1 - p.turnLeft / p.turnTotal;
  // Deplane over the first 35% of the turn.
  const target = Math.min(f.arriving, f.arriving * done / 0.35);
  const n = target - p.deplaned;
  if (n > 0) {
    p.deplaned = target;
    ap.rentalWant = (ap.rentalWant || 0) + n * LANDSIDE.rental.share;
    if (T.slot === 'main') {
      ap.paxServed += n;
      ap.rolling.flowPerMin += 0; // counted in served
      if (ap.fx) ap.fx('deplane', { p, n, slot: T.slot });
    } else {
      T.connector.inQ.push(f.id, n, Math.floor(ap.t));
      if (ap.fx) ap.fx('deplane', { p, n, slot: T.slot });
    }
  }
  // Board over the last 40%.
  if (done > 0.6) {
    const w = T.waiting.get(f.id) || 0;
    const rate = f.expected / (0.4 * p.turnTotal);
    const b = Math.min(w, rate * dt * 1.5);
    if (b > 0) {
      T.waiting.set(f.id, w - b);
      f.boarded += b;
      if (ap.fx) ap.fx('board', { p, n: b, slot: T.slot });
    }
  }
  const allAboard = f.boarded >= f.expected - 0.5;
  if (p.turnLeft <= 0 && !allAboard && !p.paxWait) p.paxWait = ap.t;
  if (p.turnLeft <= 0 && (allAboard || ap.t >= f.std + FLIGHT.boardingGrace)) {
    // Doors closed. Anyone already in the lounge makes it on board.
    const w = T.waiting.get(f.id) || 0;
    if (w > 0) { f.boarded += w; T.waiting.set(f.id, 0); }
    // Late in: if it circled, why it was held (no gate, no landing slot, or
    // full taxiways); otherwise it was slowed on the ground.
    if (f.gateInLate > 12) p.lateWhy = (p.heldFor || 0) > 5 ? (p.holdReason || 'runway') : 'traffic';
    else if (p.paxWait && ap.t - p.paxWait > 3) p.lateWhy = 'pax';
    else p.lateWhy = 'traffic';
    closeFlight(game, ap, f);
    p.ready = true;
    p.readyAt = ap.t;
    if (isStar(ap)) {
      // out along the corner's taxilane to the hold line by the runway's end
      p.depRw = WEDGES[f.terminal].line;
      p.depSlot = f.terminal;
      setPath(p, [{ x: p.stand.x, y: p.stand.y }].concat(starDeparturePath(f.terminal, p.stand)));
    } else {
      // Main-row departures use the crosswind runway when there is one.
      p.depRw = ap.upgrades.crosswind && p.stand.laneY === LANE2 ? 2 : 0;
      setPath(p, [{ x: p.stand.x, y: p.stand.y }].concat(p.depRw === 2 ? pathGateToCrosswind(p.stand) : pathGateToHold(p.stand, ap.plots)));
    }
    p.pushLen = Math.hypot(p.stand.x - p.stand.lane.x, p.stand.y - p.stand.lane.y);
  }
}

function closeFlight(game, ap, f) {
  if (f.closed) return;
  f.closed = true;
  const A = AIRCRAFT[f.cls];
  const c = ap.contracts.find((x) => x.id === f.contract);
  const fee = (c ? c.paxFee : 9) * A.paxFeeMult * repMult(ap) * networkMult(game) * (ap.upgrades.rail ? UPGRADES.rail.paxFee : 1) * site(ap).rev;
  const boarded = Math.round(f.boarded);
  earn(game, ap, 'paxFees', boarded * fee);
  ap.paxServed += boarded;
  f.missed = Math.max(0, f.expected - boarded);
  // Where were the ones left behind when the doors closed? They leave the
  // lines either way.
  const sec = ap.secQ.drop(f.id);
  let conn = 0;
  const C = terminalBySlot(ap, f.terminal) && terminalBySlot(ap, f.terminal).connector;
  if (C) {
    conn += C.outQ.drop(f.id);
    for (const x of C.transit) if (x.f === f.id && x.dir === 'out') conn += x.n;
    for (const b of C.fleet || []) {
      for (const x of b.load) if (x.f === f.id && x.dir === 'out') conn += x.n;
      b.load = b.load.filter((x) => !(x.f === f.id && x.dir === 'out'));
    }
  }
  if (f.missed > 0) {
    earn(game, ap, 'refunds', -f.missed * PAX.missedRefund * site(ap).rev);
    ap.missedAcc = (ap.missedAcc || 0) + f.missed;
    const w = ap.missedWhy || (ap.missedWhy = { security: 0, connector: 0, late: 0 });
    w.security += sec; w.connector += conn; w.late += Math.max(0, f.missed - sec - conn);
    ap.missedWhyTotal = ap.missedWhyTotal || { security: 0, connector: 0, late: 0 };
    ap.missedWhyTotal.security += sec; ap.missedWhyTotal.connector += conn; ap.missedWhyTotal.late += Math.max(0, f.missed - sec - conn);
  }
  ap.rolling.missed += ((f.missed / Math.max(1, f.expected)) - ap.rolling.missed) * 0.08;
  const T = terminalBySlot(ap, f.terminal);
  if (T) T.waiting.delete(f.id);
}

// ---------------------------------------------------------------- people

// A FIFO line of passenger groups {f, n}. Groups for the same flight that
// join within the same second share one entry, and a flight's groups are
// removed when it closes, so the line stays short and its total exact.
class PaxQueue {
  constructor() { this.a = []; this.h = 0; this.total = 0; }
  get length() { return this.a.length - this.h; }
  *[Symbol.iterator]() { for (let i = this.h; i < this.a.length; i++) yield this.a[i]; }
  push(f, n, b = -1) {
    if (n <= 0) return;
    this.total += n;
    for (let i = this.a.length - 1; i >= this.h && this.a[i].b === b && b >= 0; i--) {
      if (this.a[i].f === f) { this.a[i].n += n; return; }
    }
    this.a.push({ f, n, b });
  }
  // Pull up to `amount` passengers off the front. Returns [{f, n}].
  take(amount) {
    const out = [];
    while (amount > 1e-6 && this.h < this.a.length) {
      const head = this.a[this.h];
      const n = Math.min(head.n, amount);
      head.n -= n; amount -= n; this.total -= n;
      if (n > 0) out.push({ f: head.f, n });
      if (head.n <= 1e-6) { this.total -= head.n; this.h++; }
    }
    this.compact();
    if (this.length === 0) this.total = 0;
    return out;
  }
  // Remove everyone booked on flight f; returns how many there were.
  drop(f) {
    let n = 0;
    const keep = [];
    for (let i = this.h; i < this.a.length; i++) { const x = this.a[i]; if (x.f === f) n += x.n; else keep.push(x); }
    if (n > 0) { this.a = keep; this.h = 0; this.total = Math.max(0, this.total - n); }
    return n;
  }
  compact() {
    if (this.h > 256 && this.h * 2 > this.a.length) { this.a = this.a.slice(this.h); this.h = 0; }
  }
}

// Put a group on a connector car. Groups for the same flight that leave
// within half a second ride together.
function board(transit, x, dir, at) {
  for (let i = transit.length - 1; i >= 0 && transit[i].at > at - 0.5; i--) {
    const y = transit[i];
    if (y.f === x.f && y.dir === dir) { y.n += x.n; return; }
  }
  transit.push({ f: x.f, n: x.n, dir, at });
}

function flowPassengers(game, ap, dt) {
  const t = ap.t;
  const s = site(ap);
  const parkingShare = Math.min(1, parkingCapacity(ap) / Math.max(1, ap.rolling.landsidePerMin * PAX.driveShare * (ap.upgrades.rail ? 0.7 : 1)));
  let landside = 0;

  // 1. departing passengers reach the curb
  for (const f of ap.flights.values()) {
    if (f.closed || f.generated >= f.expected) continue;
    if (t < f.std - PAX.arriveEarly) continue;
    const n = Math.min(f.expected - f.generated, f.expected * dt / PAX.arriveWindow);
    f.generated += n;
    landside += n;
    ap.secQ.push(f.id, n, Math.floor(t));
  }
  if (landside > 0) {
    const drive = PAX.driveShare * (ap.upgrades.rail ? 0.7 : 1);
    earn(game, ap, 'parking', landside * drive * parkingShare * PAX.parkingPerPax * s.rev);
    if (ap.fx) ap.fx('curb', { n: landside });
    // some stayed at an airport hotel the night before
    const hotels = countUse(ap, 'hotel');
    if (hotels) {
      const H = LANDSIDE.hotel;
      const guests = Math.min(landside * H.share, hotels * H.cap / 60 * dt);
      earn(game, ap, 'hotel', guests * H.perPax * s.rev);
    }
  }
  // arrivals who rent a car (counted as they get off their aircraft)
  const rentals = countUse(ap, 'rental');
  if (rentals && ap.rentalWant) {
    const RC = LANDSIDE.rental;
    const n = Math.min(ap.rentalWant, rentals * RC.cap / 60 * dt);
    earn(game, ap, 'rental', n * RC.perPax * s.rev);
    ap.rentalWant = Math.min(ap.rentalWant - n, rentals * RC.cap / 6); // the rest give up and take a taxi
  }
  ap.rolling.landsidePerMin += (landside / dt * 60 - ap.rolling.landsidePerMin) * Math.min(1, dt / 20);

  // 2. security
  const cleared = ap.secQ.take(securityRate(ap) * dt);
  for (const { f: fid, n } of cleared) {
    const f = ap.flights.get(fid);
    const T = terminalBySlot(ap, f.terminal);
    if (!T || T.slot === 'main' || !T.connector) {
      const M = terminalBySlot(ap, 'main');
      M.waiting.set(fid, (M.waiting.get(fid) || 0) + n);
      if (ap.fx) ap.fx('secOut', { n, slot: 'main', fid });
    } else {
      T.connector.outQ.push(fid, n, Math.floor(t));
      if (ap.fx) ap.fx('secOut', { n, slot: T.slot });
    }
  }
  const secQ = ap.secQ.total;
  ap.secQueue = secQ;
  const secWait = secQ / Math.max(0.01, securityRate(ap));
  ap.rolling.secWait += (secWait - ap.rolling.secWait) * Math.min(1, dt / 10);

  // 3. connectors
  for (const T of ap.terminals) {
    const C = T.connector;
    if (!C) continue;
    const def = CONNECTORS[C.type];
    if (def.breakdown && !(C.level && def.upgrade.noBreakdown) && C.buildLeft <= 0 && C.brokenUntil <= t) {
      if (ap.rand() < def.breakdown * dt / 60) {
        C.brokenUntil = t + 18;
        notify(ap, 'breakdown', `Monorail to ${nm(ap, SLOTS[T.slot].name)} broke down`);
      }
    }
    // Shuttle buses carry their passengers themselves (see updateBuses);
    // walkways, monorails and tunnels move a steady stream.
    if (C.type !== 'shuttle') {
      const cap = connectorCap(C, ap) * dt;
      const travel = connectorTravel(C);
      for (const x of C.outQ.take(cap)) { board(C.transit, x, 'out', t + travel); if (ap.fx) ap.fx('conn', { slot: T.slot, dir: 'out', n: x.n, travel }); }
      // Arriving passengers never have a flight to miss; take them straight.
      for (const x of C.inQ.take(cap)) { board(C.transit, x, 'in', t + travel); if (ap.fx) ap.fx('conn', { slot: T.slot, dir: 'in', n: x.n, travel }); }
    }
    if (C.transit.length) {
      const keep = [];
      for (const x of C.transit) {
        if (x.at > t) { keep.push(x); continue; }
        if (x.dir === 'out') {
          const f = ap.flights.get(x.f);
          if (f && !f.closed) T.waiting.set(x.f, (T.waiting.get(x.f) || 0) + x.n);
        } else {
          ap.paxServed += x.n;
        }
      }
      C.transit = keep;
    }
    C.outSize = C.outQ.total;
    C.inSize = C.inQ.total;
  }

  // 4. dwell and retail
  let crowdWorst = 0;
  for (const T of ap.terminals) {
    if (T.buildLeft > 0) continue;
    let occ = 0;
    for (const [fid, n] of T.waiting) {
      const f = ap.flights.get(fid);
      if (!f || f.closed) { T.waiting.delete(fid); continue; }
      occ += n;
    }
    const waiting = occ;
    if (T.slot === 'main') {
      occ += secQ;
      for (const U of ap.terminals) if (U.connector) occ += U.connector.outSize || 0;
    } else if (T.connector) {
      occ += T.connector.inSize || 0;
    }
    const comfort = T.gates * PAX.terminalComfortPerGate + (T.slot === 'main' ? 160 : 0);
    const crowd = occ / comfort;
    T.occupancy = occ;
    T.comfort = comfort;
    crowdWorst = Math.max(crowdWorst, crowd);
    const crowdFactor = crowd <= 0.8 ? 1 : crowd <= 1.2 ? 1 - (crowd - 0.8) * 0.6 : 0.76 / (crowd - 0.2);
    const r = waiting * PAX.retailPerPaxSec * TERMINAL.retailLevels[T.retail].mult * crowdFactor * s.rev * dt;
    if (r > 0) earn(game, ap, 'retail', r);
  }
  ap.rolling.crowd += (Math.max(0, crowdWorst - 1) - ap.rolling.crowd) * Math.min(1, dt / 15);
  ap.rolling.flowPerMin = ap.rolling.landsidePerMin * 2;
}

// Buses are simulated here, not just drawn, because aircraft and buses take
// turns where a midfield bus route crosses the apron lane.
// A bus at a stop: everyone riding gets off, then whoever is waiting gets
// on as it leaves, up to its seats. At the main terminal it takes departing
// passengers out; at the satellite it brings arrivals back.
function busAlight(ap, T, C, b, end) {
  let n = 0;
  for (const x of b.load) {
    if (end === 'far' && x.dir === 'out') {
      const f = ap.flights.get(x.f);
      if (f && !f.closed) T.waiting.set(x.f, (T.waiting.get(x.f) || 0) + x.n);
    } else if (end === 'main' && x.dir === 'in') {
      ap.paxServed += x.n;
    } else continue;
    n += x.n;
  }
  b.load = b.load.filter((x) => (end === 'far' ? x.dir !== 'out' : x.dir !== 'in'));
  if (n > 0 && ap.fx) { const q = pointAlong(C.route, b.d); ap.fx('bus', { slot: T.slot, end, off: n, x: q.x, y: q.y }); }
}
function busBoard(ap, T, C, b, end) {
  const out = end === 'main';
  let n = 0;
  for (const x of (out ? C.outQ : C.inQ).take(CONNECTORS.shuttle.bus.seats)) { b.load.push({ f: x.f, n: x.n, dir: out ? 'out' : 'in' }); n += x.n; }
  if (n > 0 && ap.fx) { const q = pointAlong(C.route, b.d); ap.fx('bus', { slot: T.slot, end, on: n, x: q.x, y: q.y }); }
}

function updateBuses(ap, dt) {
  ap.buses.length = 0;
  ap.busBlocks = [];
  const def = CONNECTORS.shuttle;
  for (const T of ap.terminals) {
    const C = T.connector;
    if (!C || C.type !== 'shuttle' || C.buildLeft > 0) continue;
    const X = apronCrossing(T.slot);
    let sX = null;
    if (X) {
      // distance along the route to the crossing
      let acc = 0;
      for (let i = 1; i < C.route.length; i++) {
        const a = C.route[i - 1], b = C.route[i];
        const seg = Math.hypot(b.x - a.x, b.y - a.y);
        if (Math.abs(a.x - X.x) < 1 && Math.abs(b.x - X.x) < 1 && (a.y - X.y) * (b.y - X.y) <= 0) { sX = acc + Math.abs(a.y - X.y); break; }
        acc += seg;
      }
    }
    if (!C.fleet) C.fleet = [];
    while (C.fleet.length < C.buses) C.fleet.push({ d: (C.fleet.length / C.buses) * C.len, dir: 1, dwell: 0, load: [] });
    if (C.fleet.length > C.buses) {
      // a sold bus drops its passengers back at the stops
      for (const b of C.fleet.slice(C.buses)) for (const x of b.load) (x.dir === 'out' ? C.outQ : C.inQ).push(x.f, x.n);
      C.fleet.length = C.buses;
    }
    for (const b of C.fleet) {
      if (b.dwell > 0) {
        b.dwell -= dt;
        if (b.dwell <= 0) {
          busBoard(ap, T, C, b, b.d <= 0 ? 'main' : 'far');
          b.dir = -b.dir;
        }
      } else {
        let nd = b.d + b.dir * def.speed * dt;
        if (sX != null && Math.abs(b.d - sX) >= 30 && Math.abs(nd - sX) < 30) {
          // Wait at the line if an aircraft is in the crossing.
          const busy = ap.planes.some((p) => p.alt <= 0.5 && p.state !== 'gate' && Math.hypot(p.x - X.x, p.y - X.ly) < p.r + 40);
          if (busy) nd = b.d;
        }
        b.d = nd;
        if (b.d >= C.len) { b.d = C.len; b.dwell = def.bus.dwell; b.dir = 1; busAlight(ap, T, C, b, 'far'); }
        if (b.d <= 0) { b.d = 0; b.dwell = def.bus.dwell; b.dir = -1; busAlight(ap, T, C, b, 'main'); }
      }
      const q = pointAlong(C.route, b.d);
      ap.buses.push({ x: q.x, y: q.y, ang: q.ang + (b.dir > 0 ? 0 : Math.PI), slot: T.slot });
      // Only a bus actually in the crossing blocks it; one waiting at the
      // line does not.
      if (sX != null && Math.abs(b.d - sX) < 24) ap.busBlocks.push({ x: q.x, y: q.y, r: 10, p: null });
    }
  }
}

// ---------------------------------------------------------------- relations

function updateContracts(game, ap, dt) {
  for (const c of [...ap.contracts]) {
    const h = c.otpHist;
    if (h.length >= 5) {
      const otp = h.reduce((a, b) => a + b, 0) / h.length;
      c.otp = otp;
      if (otp < CONTRACTS.unhappyOtp) {
        if (!c.unhappyFor) notify(ap, 'unhappy', `${c.airline} is unhappy with delays on the ${c.city} route`);
        c.unhappyFor += dt;
        if (c.unhappyFor > CONTRACTS.leaveAfter) {
          notify(ap, 'left', `${c.airline} pulled its ${c.city} route over delays`);
          cancelContract(game, ap, c.id, true);
        }
      } else {
        c.unhappyFor = Math.max(0, c.unhappyFor - dt * 2);
      }
    }
  }
}

function updateRep(ap, dt) {
  const r = ap.rolling;
  const target = 100 * (
    0.5 * r.otp +
    0.25 * (1 - Math.min(1, r.missed * 6)) +
    0.15 * (1 - Math.min(1, r.crowd)) +
    0.10 * (1 - Math.min(1, r.secWait / 60))
  ) - breakdownHappy(ap);
  ap.rep += (target - ap.rep) * Math.min(1, dt / 60);
  ap.rep = clamp(ap.rep, 0, 100);
}

// A quick view of what is going on, for the ops board.
export function opsSnapshot(ap) {
  const hq = allHolding(ap);
  const holding = hq.length;
  const holdingForGate = hq.filter((p) => p.holdReason === 'gate').length;
  const waitingPush = allPlanes(ap).filter((p) => p.state === 'gate' && p.ready).length;
  const depQ = fields(ap).reduce((s, F) => s + F.depQueue.length + F.depQueueX.length + (isStar(F) ? F.depQueues.reduce((n, q) => n + q.length, 0) : 0), 0);
  return { holding, holdingForGate, waitingPush, waitingGate: holdingForGate, depQ, secQueue: ap.secQueue || 0, secWait: (ap.secQueue || 0) / Math.max(0.01, securityRate(ap)) };
}

export { TERMINAL_CODES, slotCenter };
