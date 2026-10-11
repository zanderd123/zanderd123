// The airport simulation. One Airport object per owned site; all of them run
// every frame whether or not they are on screen. No DOM, no canvas: the
// renderer reads this state and listens to `ap.fx` for things worth drawing.

import {
  AIRCRAFT, AIRCRAFT_ORDER, FLIGHT, PAX, STAFFING, COSTS, TERMINAL, CONNECTORS,
  UPGRADES, SECURITY as SEC, PARKING, LEVELS, UNLOCKS, SITES, NETWORK, CONTRACTS,
  AIRLINES, CITIES, WEATHER,
} from './config.js';
import {
  RW, RUNWAY_HALF, TWY_A, TWY_B, LANE2, EXITS, HOLD_POINT, IAF, PLOTS, SLOTS, LONG_RUNWAY_X1,
  gateStand, pathExitToGate, pathGateToHold, lanesFor,
  connectorRoute, apronCrossing, slotCenter, TERMINAL_CODES,
} from './layout.js';
import { mulberry32, clamp, dist, pick, pathLength, pointAlong } from './util.js';

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
    plots: { core: true },
    terminals: [newTerminal('main', true)],
    securityLanes: SEC.startLanes,
    upgrades: {},
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

function newTerminal(slot, built) {
  return {
    slot,
    gates: TERMINAL.startGates,
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
  ap.runways = RW.map(() => ({ occupant: null, clearEta: 0, reservedArr: null }));
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
    if (T.connector) hydrateConnector(T);
  }
  for (const c of ap.contracts) {
    c.nextStd = ap.t + 20 + ap.rand() * 30;
    c.otpHist = c.otpHist || [];
    c.unhappyFor = c.unhappyFor || 0;
  }
  ap.weather.stormUntil = 0;
  ap.weather.nextStorm = ap.t + 240;
  ap.costLines = computeCosts(ap);
  return ap;
}

function hydrateConnector(T) {
  const C = T.connector;
  C.outQ = new PaxQueue(); C.inQ = new PaxQueue(); C.transit = [];
  C.brokenUntil = 0;
  C.route = connectorRoute(C.type, T.slot);
  C.len = pathLength(C.route);
}

export function serializeAirport(ap) {
  return {
    siteIndex: ap.siteIndex,
    plots: ap.plots,
    terminals: ap.terminals.map((T) => ({
      slot: T.slot, gates: T.gates, heavy: T.heavy, retail: T.retail, buildLeft: T.buildLeft,
      connector: T.connector ? { type: T.connector.type, level: T.connector.level, buses: T.connector.buses, buildLeft: T.connector.buildLeft } : null,
      pendingConnector: T.pendingConnector ? { ...T.pendingConnector } : undefined,
    })),
    securityLanes: ap.securityLanes,
    upgrades: ap.upgrades,
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
  };
}

export function restoreAirport(data) {
  const site = SITES[data.siteIndex];
  const ap = { ...data, id: site.id, name: site.name };
  for (const T of ap.terminals) {
    if (T.connector) T.connector = { ...T.connector };
    if (T.pendingConnector) T.pendingConnector = { ...T.pendingConnector };
    else delete T.pendingConnector;
    T.gates = Math.min(T.gates, SLOTS[T.slot].maxGates); // older saves allowed 5
  }
  hydrate(ap);
  return ap;
}

// ======================================================================
// derived numbers
// ======================================================================

export const site = (ap) => SITES[ap.siteIndex];
export const builtTerminals = (ap) => ap.terminals.filter((T) => isOpen(T));
export const terminalBySlot = (ap, slot) => ap.terminals.find((T) => T.slot === slot);

export function isOpen(T) {
  return T.buildLeft <= 0 && (T.slot === 'main' || (T.connector && T.connector.buildLeft <= 0));
}

export function runwayCount(ap) { return ap.upgrades.runway2 ? 2 : 1; }

export function staffing(ap, dept) { return STAFFING[ap.staffing[dept]]; }

export function controllers(ap) {
  // One per runway and one per terminal: every terminal adds ground
  // movements that need their own controller.
  return runwayCount(ap) + ap.terminals.filter((T) => T.buildLeft <= 0).length;
}

export function stormFactor(ap) {
  if (ap.t >= ap.weather.stormUntil) return 1;
  return ap.upgrades.cat3 ? WEATHER.stormRunwayCat3 : WEATHER.stormRunway;
}

export function atcCapacity(ap) {
  let per = COSTS.movementsPerController;
  if (ap.upgrades.radar) per *= UPGRADES.radar.atc;
  if (ap.upgrades.automation) per *= UPGRADES.automation.atc;
  return controllers(ap) * per * staffing(ap, 'atc').capacity * stormFactor(ap);
}

export function runwayPhysical(ap) {
  // Measured with tools/runway.mjs: a saturated mixed-mode runway handles
  // about 15 movements a minute, 16.5 with rapid exits, and a second runway
  // (arrivals north, departures south) brings that to about 27.
  const single = ap.upgrades.rapidExits ? 16 : 14;
  return (ap.upgrades.runway2 ? single * 1.65 : single) * stormFactor(ap);
}

export function securityRate(ap) {
  // passengers per second
  return ap.securityLanes * PAX.securityPerLane * staffing(ap, 'security').capacity * (ap.upgrades.ctScanners ? UPGRADES.ctScanners.security : 1);
}

export function parkingCapacity(ap) {
  let cap = PARKING.base;
  if (ap.upgrades.garage1) cap += UPGRADES.garage1.parking;
  if (ap.upgrades.garage2) cap += UPGRADES.garage2.parking;
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
  const len = pathLength(connectorRoute(type, slot));
  let cost = def.buildBase + def.buildPerPx * len;
  if (type === 'shuttle') cost += 2 * def.bus.cost;
  return Math.round(cost * site(ap).cost);
}

export function connectorAllowed(type, slot) {
  const def = CONNECTORS[type];
  return !(def.adjacentOnly && !SLOTS[slot].adjacent);
}

export function terminalCost(ap) {
  const n = ap.terminals.length; // main counts as the first
  return Math.round(TERMINAL.baseCost * Math.pow(TERMINAL.costGrowth, n - 1) * site(ap).cost);
}

export function gateCost(ap, T) {
  return Math.round(TERMINAL.gateCost * Math.pow(TERMINAL.gateCostGrowth, T.gates - 3 + totalGates(ap) / 6) * site(ap).cost);
}

export function heavyCost(ap, T) { return Math.round(TERMINAL.heavyCost * (T.gates / 4) * site(ap).cost); }
export function retailCost(ap, T) {
  const L = TERMINAL.retailLevels[T.retail + 1];
  return L ? Math.round(L.cost * site(ap).cost) : null;
}
export function laneCost(ap) { return Math.round(SEC.laneCost * Math.pow(SEC.laneGrowth, ap.securityLanes - 1) * site(ap).cost); }
export function plotCost(ap, plot) { return Math.round(PLOTS[plot].price * site(ap).cost); }
export function upgradeCost(ap, key) { return Math.round(UPGRADES[key].cost * site(ap).cost); }

export function totalGates(ap) { return ap.terminals.reduce((s, T) => s + T.gates, 0); }

export function repMult(ap) { return 0.72 + 0.56 * (ap.rep / 100); }

export function networkMult(game) {
  return 1 + NETWORK.paxFeePerAirport * Math.max(0, game.airports.length - 1);
}

export function computeCosts(ap) {
  const m = site(ap).cost;
  const built = ap.terminals.filter((T) => T.buildLeft <= 0);
  const hvacMult = (ap.upgrades.hvac ? UPGRADES.hvac.hvac : 1) * (ap.upgrades.solar ? UPGRADES.solar.hvac : 1);
  const gates = built.reduce((s, T) => s + T.gates, 0);
  const lines = [
    { key: 'atc', label: `Air traffic control (${controllers(ap)} controllers)`, v: controllers(ap) * COSTS.controller * staffing(ap, 'atc').cost },
    { key: 'security', label: `Security staff (${ap.securityLanes} lanes)`, v: ap.securityLanes * COSTS.securityLaneStaff * staffing(ap, 'security').cost },
    { key: 'ground', label: `Ground crews (${gates} gates)`, v: gates * COSTS.groundCrewPerGate * staffing(ap, 'ground').cost },
    { key: 'hvac', label: 'Heating, cooling & power', v: built.reduce((s, T) => s + COSTS.hvacBase + COSTS.hvacPerGate * T.gates, 0) * hvacMult },
    { key: 'cleaning', label: 'Cleaning & upkeep', v: built.length * COSTS.cleaningBase + (ap.rolling ? ap.rolling.flowPerMin : 0) * COSTS.cleaningPerPaxMin },
    { key: 'runway', label: `Runway maintenance (${runwayCount(ap)})`, v: runwayCount(ap) * COSTS.runwayMaint },
    { key: 'connectors', label: 'Connector operations', v: ap.terminals.reduce((s, T) => s + (T.connector && T.connector.buildLeft <= 0 ? connectorUpkeep(T.connector) : 0), 0) },
    { key: 'land', label: 'Property tax', v: (Object.keys(ap.plots).length - 1) * COSTS.plotTax },
  ];
  for (const l of lines) l.v *= m;
  return lines;
}

// ======================================================================
// load & forecast
// ======================================================================

function turnTime(ap, cls) {
  return AIRCRAFT[cls].turn * staffing(ap, 'ground').turn;
}

export function terminalSupports(ap, T, cls) {
  const A = AIRCRAFT[cls];
  if (A.heavy && !T.heavy) return false;
  return true;
}

export function classAllowed(ap, cls) {
  const A = AIRCRAFT[cls];
  if (A.longRunway && !ap.upgrades.longRunway) return 'Needs the runway extension';
  if (A.heavy && !ap.terminals.some((T) => isOpen(T) && T.heavy)) return 'Needs a terminal with heavy gates';
  return null;
}

// Load against capacity across every bottleneck, optionally with an extra
// contract added on a given terminal. Rates are per minute.
export function loadReport(ap, extra = null) {
  const contracts = extra ? ap.contracts.concat([extra]) : ap.contracts;
  const r = {};
  let movements = 0, depPax = 0;
  const perT = new Map();
  for (const T of ap.terminals) perT.set(T.slot, { gateDemand: 0, pax: 0 });
  for (const c of contracts) {
    const A = AIRCRAFT[c.cls];
    movements += 2 * c.freq;
    const pax = A.pax * c.load * c.freq;
    depPax += pax;
    const pt = perT.get(c.terminal);
    if (pt) {
      pt.gateDemand += c.freq * (turnTime(ap, c.cls) + 14) / 60;
      pt.pax += pax;
    }
  }
  const runwayCap = Math.min(runwayPhysical(ap), atcCapacity(ap));
  r.runway = { demand: movements, cap: runwayCap, atc: atcCapacity(ap), physical: runwayPhysical(ap) };
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

function rollOffer(ap, game, forceCls = null) {
  const R = ap.rand;
  const lvl = ap.level;
  const classes = ['regional'];
  if (lvl >= UNLOCKS.narrow) classes.push('narrow', 'narrow');
  if (lvl >= UNLOCKS.wide) classes.push('wide', 'wide');
  if (lvl >= UNLOCKS.jumbo) classes.push('jumbo');
  if (lvl >= 4) classes.splice(0, 1); // big airports stop courting tiny routes
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
  const slot = terminalSlot || suggestTerminal(ap, o.cls);
  if (!slot) return 'No open terminal can take this aircraft';
  ap.offers.splice(i, 1);
  const c = {
    id: o.id, airline: o.airline, code: o.code, color: o.color, city: o.city, network: o.network,
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

function spend(game, amount) {
  if (game.cash < amount) return false;
  game.cash -= amount;
  return true;
}

export function buyPlot(game, ap, plot) {
  const P = PLOTS[plot];
  if (ap.plots[plot]) return 'Already owned';
  if (P.needs && !ap.plots[P.needs]) return `Buy the ${PLOTS[P.needs].name} first`;
  if (!spend(game, plotCost(ap, plot))) return 'Not enough cash';
  ap.plots[plot] = true;
  ap.costLines = computeCosts(ap);
  return null;
}

export function buildTerminal(game, ap, slot, connectorType, buses = 2) {
  if (terminalBySlot(ap, slot)) return 'Already built';
  if (!ap.plots[SLOTS[slot].plot]) return 'Buy the land first';
  if (!connectorAllowed(connectorType, slot)) return 'That connector cannot reach this site';
  const cost = terminalCost(ap) + connectorBuildCost(connectorType, slot, ap);
  if (!spend(game, cost)) return 'Not enough cash';
  const T = newTerminal(slot, false);
  T.waiting = new Map();
  T.arrivingHere = 0;
  T.connector = { type: connectorType, level: 0, buses: connectorType === 'shuttle' ? buses : 0, buildLeft: CONNECTORS[connectorType].buildTime };
  hydrateConnector(T);
  ap.terminals.push(T);
  ap.costLines = computeCosts(ap);
  return null;
}

export function replaceConnector(game, ap, slot, type) {
  const T = terminalBySlot(ap, slot);
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
  if (!T || T.gates >= SLOTS[slot].maxGates) return 'No room for more gates';
  if (!spend(game, gateCost(ap, T))) return 'Not enough cash';
  T.gates++;
  ap.costLines = computeCosts(ap);
  return null;
}

export function buyHeavy(game, ap, slot) {
  const T = terminalBySlot(ap, slot);
  if (!T || T.heavy) return 'Already heavy';
  if (!spend(game, heavyCost(ap, T))) return 'Not enough cash';
  T.heavy = true;
  return null;
}

export function buyRetail(game, ap, slot) {
  const T = terminalBySlot(ap, slot);
  const cost = T && retailCost(ap, T);
  if (cost == null) return 'Retail is maxed out';
  if (!spend(game, cost)) return 'Not enough cash';
  T.retail++;
  return null;
}

export function addLane(game, ap) {
  if (ap.securityLanes >= SEC.maxLanes) return 'The checkpoint is full';
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
  if (ap.upgrades[key]) return 'Owned';
  if (U.needs && !ap.upgrades[U.needs]) return `Needs ${UPGRADES[U.needs].name}`;
  if (U.needsPlot && !ap.plots[U.needsPlot]) return `Needs the ${PLOTS[U.needsPlot].name}`;
  return null;
}

export function buyUpgrade(game, ap, key) {
  const why = upgradeBlocked(ap, key);
  if (why) return why;
  if (!spend(game, upgradeCost(ap, key))) return 'Not enough cash';
  ap.upgrades[key] = true;
  ap.costLines = computeCosts(ap);
  return null;
}

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
  ap.t += dt;
  const t = ap.t;

  // construction
  for (const T of ap.terminals) {
    if (T.buildLeft > 0) {
      T.buildLeft -= dt;
      if (T.buildLeft <= 0) { ap.costLines = computeCosts(ap); notify(ap, 'built', `${SLOTS[T.slot].name} is open`); }
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
        hydrateConnector(T);
        // Carry passengers across so nobody vanishes in the switch.
        for (const x of old.outQ) T.connector.outQ.push(x.f, x.n);
        for (const x of old.inQ) T.connector.inQ.push(x.f, x.n);
        for (const x of old.transit) (x.dir === 'out' ? T.connector.outQ : T.connector.inQ).push(x.f, x.n);
        ap.costLines = computeCosts(ap);
        notify(ap, 'built', `New ${CONNECTORS[T.connector.type].name.toLowerCase()} to ${SLOTS[T.slot].name} is running`);
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
      notify(ap, 'offer', 'New contract offer');
    }
  }
  ap.offers = ap.offers.filter((o) => o.expires > t);

  scheduleFlights(game, ap);
  flowPassengers(game, ap, dt);
  updateBuses(ap, dt);
  updatePlanes(game, ap, dt);
  updateContracts(game, ap, dt);
  updateRep(ap, dt);

  // running costs, charged continuously
  let cost = 0;
  for (const l of ap.costLines) cost += l.v;
  const costPerSec = cost / 60 * dt;
  game.cash -= costPerSec;
  ap.bucket.costs = (ap.bucket.costs || 0) - costPerSec;

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

  // levels
  while (ap.level < LEVELS.length && ap.paxServed >= LEVELS[ap.level]) {
    ap.level++;
    notify(ap, 'level', `${ap.name} reached level ${ap.level}`);
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
    // Pax start arriving PAX.arriveEarly before departure, so the flight
    // record exists that long before the aircraft does.
    while (c.nextStd - PAX.arriveEarly <= t) {
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
        spawnAt: std - turnTime(ap, c.cls) - inboundEstimate(ap, c) - FLIGHT.scheduleBuffer,
        plane: null,
      };
      ap.flights.set(f.id, f);
    }
  }
  for (const f of ap.flights.values()) {
    if (!f.plane && !f.closed && t >= f.spawnAt) spawnPlane(ap, f);
  }
}

function inboundEstimate(ap, c) {
  const A = AIRCRAFT[c.cls];
  const ex = EXITS[A.exitIndex];
  const stand = gateStand(c.terminal, 0);
  const taxi = pathLength(pathExitToGate(ex, stand, ap.plots));
  return 8 + taxi / FLIGHT.taxiSpeed;
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
  };
  f.plane = p;
  ap.planes.push(p);
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
  const ex = EXITS[AIRCRAFT[p.cls].exitIndex];
  const jy = RW[p.rw].exitY;
  for (const o of ap.planes) {
    if (o === p || o.alt > 0.5 || o.state === 'gate') continue;
    if (Math.abs(o.x - ex) < 55 && o.y > RW[p.rw].y + 5 && o.y < jy + (p.rw === 1 ? 75 : 30)) { p.holdReason = 'taxi'; return false; }
  }
  // Ground control meters arrivals too, so the taxiways never fill up.
  if (ap.arrGround >= MAX_ARR_GROUND) { p.holdReason = 'taxi'; return false; }
  p.holdReason = 'runway';
  const R = ap.runways[p.rw];
  if (ap.atcTokens < 1 || R.reservedArr) return false;
  // An occupant that should have cleared by now but has not (it is waiting
  // to turn off) still blocks the runway.
  if (R.occupant && R.occupant.blockedFor > 0) return false;
  const freeAt = R.occupant ? Math.max(R.clearEta, ap.t + 1) : ap.t;
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

function clearArrival(ap, p, pts) {
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

  // Clear whoever in the stack can land now, first come first served.
  ap.arrGround = 0;
  for (const o of ap.planes) if (o.state === 'rollout' || o.state === 'taxiIn' || o.state === 'final') ap.arrGround++;
  for (const p of ap.holdQueue) {
    const rw = RW[p.rw];
    const eta = dist(p.x, p.y, IAF.x, rw.y) / FLIGHT.cruiseSpeed + (rw.x0 - IAF.x) / FLIGHT.approachSpeed;
    if (canClearArrival(ap, p, eta)) {
      clearArrival(ap, p, [{ x: p.x, y: p.y }, { x: IAF.x, y: rw.y }, { x: rw.x0, y: rw.y }]);
      break;
    }
  }

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
          const pts = [{ x: tx, y: ty }, { x: rw.x0, y: rw.y }];
          if (!ap.holdQueue.length && canClearArrival(ap, p, (rw.x0 - tx) / FLIGHT.approachSpeed)) {
            clearArrival(ap, p, pts);
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
        const slot = holdSlot(ap, ap.holdQueue.indexOf(p));
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
        p.speed = Math.max(p.exitSpeed, p.speed - p.decel * dt);
        p.d += p.speed * dt;
        const q = pointAlong(p.path, p.d);
        p.x = q.x; p.y = q.y; p.ang = q.ang;
        break;
      }
      case 'gate': {
        if (!p.ready) turnaround(game, ap, p, dt);
        break;
      }
      case 'takeoff': {
        const rw = RW[0];
        if (p.x < rw.x0 + 5) p.speed = Math.min(p.speed + 40 * dt, 48);
        else p.speed += FLIGHT.takeoffAccel * dt;
        p.d += p.speed * dt;
        const q = pointAlong(p.path, p.d);
        p.x = q.x; p.y = q.y; p.ang = q.ang;
        if (p.speed > FLIGHT.liftoffSpeed) p.alt += (p.speed - FLIGHT.liftoffSpeed + 30) * 0.35 * dt;
        const R = ap.runways[0];
        if (R.occupant === p && p.speed > FLIGHT.liftoffSpeed + 20) R.occupant = null; // airborne
        if (p.x > 2250) p.state = 'gone';
        break;
      }
      case 'holdShort': {
        if (ap.depQueue[0] !== p) break;
        const R = ap.runways[0];
        const arr = R.reservedArr;
        const arrEta = arr ? (arr.len - arr.d) / FLIGHT.approachSpeed : Infinity;
        // Line up behind a departure that is already rolling well clear.
        const occ = R.occupant;
        const free = !occ || (occ.state === 'takeoff' && occ.x > RW[0].x0 + 140);
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
          setPath(p, [{ x: HOLD_POINT.x, y: HOLD_POINT.y }, { x: HOLD_POINT.x + 18, y: rw.y + 26 }, { x: rw.x0 + 10, y: rw.y }, { x: x1 + 600, y: rw.y }]);
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
function groundRoute(ap, p) {
  const rw = RW[p.rw];
  const A = AIRCRAFT[p.cls];
  const ex = EXITS[A.exitIndex];
  const roll = [{ x: rw.x0, y: rw.y }, { x: ex - 60, y: rw.y }, { x: ex - 25, y: rw.y + 12 }, { x: ex, y: rw.exitY }];
  p.exitX = ex;
  p.rollEnd = pathLength(roll);
  if (p.rw === 0) {
    p.route = roll.concat(pathExitToGate(ex, p.stand, ap.plots).slice(1));
    p.crossAt = null;
  } else {
    // Off the north runway: hold short of the main runway, then cross it.
    const hs = { x: ex, y: RW[0].y - 34 };
    p.route = roll.concat([hs], pathExitToGate(ex, p.stand, ap.plots));
    p.crossAt = p.rollEnd + (hs.y - rw.exitY);
    p.crossEnd = p.crossAt + (TWY_A - hs.y);
  }
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
  const rollD = ex - 60 - rw.x0;
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

// ---------------------------------------------------------------- the ground

// Junctions nobody may stop in unless they can get all the way through
// ("don't block the box"). Rebuilt when the airport's layout changes.
// Anyone stopped outside a box is far enough from its centre for the
// largest aircraft to pass through it.
const BOX = 29; // with R_PLANE: 59, just short of the 62 px between taxiways A and B
function junctionBoxes(ap) {
  const key = JSON.stringify([ap.plots, ap.terminals.map((T) => [T.slot, T.gates, T.connector && T.connector.type]), !!ap.upgrades.runway2]);
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
  for (const T of ap.terminals) {
    const crossing = apronCrossing(T.slot);
    if (T.connector && T.connector.type === 'shuttle' && crossing) z.push({ x: crossing.x, y: LANE2 });
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
    if (p.state === 'pushback') bodies.push({ x: p.stand.x, y: p.stand.laneY, r: p.r, p });
  }

  const movers = ap.planes.filter(isMover);
  // Aircraft at a gate that are ready to push back are candidates.
  const depOnGround = ap.planes.filter((p) => p.state === 'pushback' || p.state === 'taxiOut' || p.state === 'holdShort').length;
  const pending = depOnGround < MAX_DEP_GROUND ? ap.planes.filter((p) => p.state === 'gate' && p.ready) : [];

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
      // Aircraft leaving a runway go first; then anyone already standing on
      // the other's route or inside a junction; then the one nearer the
      // meeting point, with a little extra standing for a long wait. A
      // winner that is stuck behind the loser hands its turn over.
      const ka = hit[0] - A.m.blockedFor * 4 - (A.m.state === 'rollout' ? 1000 : 0);
      const kb = hit[1] - B.m.blockedFor * 4 - (B.m.state === 'rollout' ? 1000 : 0);
      let aWins = ka < kb - 0.5 || (Math.abs(ka - kb) <= 0.5 && A.m.id < B.m.id);
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
      // A claim from an aircraft still on the runway can't be made to wait.
      if ((aWins ? B : A).pseudo) continue;
      const loser = aWins ? B.m : A.m;
      // Several aircraft each giving way to the next can wait on each other
      // in a circle. Someone who has given way a long time and has nothing
      // physically in front of it goes; its own body check still applies.
      if (loser.blockedFor > 6 && !loser.blockBy) continue;
      const ls = aWins ? hit[1] : hit[0];
      if (ls - SAMPLE < loser.free) loser.why += ' yield ' + (aWins ? A.m.id : B.m.id);
      // Stop well short, so the winner's whole body clears us.
      loser.free = Math.min(loser.free, Math.max(0, ls - 3 * SAMPLE));
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
      const mine = new Set(boxesAt(zones, m.x, m.y));
      for (const k of mine) {
        const Z = zones[k];
        if (!Z.owner || Z.owner === m || t - Z.ownerT > 0.2) { Z.owner = m; Z.ownerT = t; }
      }
      const skip = m.state === 'rollout' ? m.rollEnd - m.d : -1;
      for (let i = 0; i < m.look.length; i++) {
        const q = m.look[i];
        if (q.s > allowed) break;
        const fresh = boxesAt(zones, q.x, q.y).filter((k) => !mine.has(k));
        if (!fresh.length) continue;
        if (q.s < skip) { for (const k of fresh) mine.add(k); continue; }
        const taken = fresh.some((k) => zones[k].owner && zones[k].owner !== m && t - zones[k].ownerT <= 0.2);
        let exitS = m.d + LOOK >= m.len ? 0 : Infinity;
        for (let j = i + 1; j < m.look.length; j++) {
          const here = boxesAt(zones, m.look[j].x, m.look[j].y);
          if (!fresh.some((k) => here.includes(k))) { exitS = m.look[j].s; break; }
        }
        if (taken || m.free < exitS + m.r * 0.5) {
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
        if (toHold < 1 && !R0.occupant && m.free >= across) {
          m.crossing = true;
          m.crossWait = 0;
          R0.occupant = m;
          R0.clearEta = t + 2.5;
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
        if (x === m && Math.max(...ring.map((r) => r.id)) === m.id) towBack(m, bodies, dt);
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
      m.ang = Math.PI / 2; // being pushed backwards, nose to the terminal
    } else if (m.state === 'rollout' && m.d < m.rollEnd) {
      m.ang = q.ang;
    } else {
      m.ang += wrapAngle(q.ang - m.ang) * Math.min(1, dt * 6);
    }

    // transitions
    // The runway is free once the whole aircraft is clear of its edge.
    if (m.state === 'rollout' && (m.d >= m.rollEnd || m.y >= RW[m.rw].y + RUNWAY_HALF + m.r + 3)) {
      const R = ap.runways[m.rw];
      if (R.occupant === m) R.occupant = null;
      if (m.d >= m.rollEnd) m.state = 'taxiIn';
    }
    if (m.crossing) {
      // The runway is free as soon as the tail is clear of its edge, even if
      // the aircraft then has to stop short of the taxiway: holding the
      // runway there would stop the departures it may be waiting for.
      const R0 = ap.runways[0];
      if (R0.occupant === m && m.y >= RW[0].y + RUNWAY_HALF + m.r + 3) R0.occupant = null;
      if (m.d >= m.crossEnd) {
        if (R0.occupant === m) R0.occupant = null;
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
      else if (m.state === 'taxiOut') { m.state = 'holdShort'; m.holdSince = t; m.speed = 0; ap.depQueue.push(m); }
    }
  }
}

// Move an aircraft back along its route, only while that takes it further
// from everything around it; at most 45 px in all.
function towBack(m, bodies, dt) {
  if ((m.towed || 0) > 45 || m.d < 2) return;
  const back = pointAlong(m.path, Math.max(0, m.d - 3));
  for (const o of bodies) {
    if (o.p === m) continue;
    const now = Math.hypot(m.x - o.x, m.y - o.y), then = Math.hypot(back.x - o.x, back.y - o.y);
    if (then < now && then < m.r + o.r + 2) return;
  }
  const step = Math.min(10 * dt, m.d);
  m.d -= step;
  m.towed = (m.towed || 0) + step;
  m.tow = true;
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
    const why = p.lateWhy || 'turn';
    ap.lateWhy = ap.lateWhy || {};
    ap.lateWhy[why] = (ap.lateWhy[why] || 0) + 1;
  }
}

function findGate(ap, p) {
  let T = terminalBySlot(ap, p.f.terminal);
  if (!T || !isOpen(T) || !terminalSupports(ap, T, p.cls)) {
    // Contract moved or terminal closed: fall back to any terminal that fits.
    T = ap.terminals.find((x) => isOpen(x) && terminalSupports(ap, x, p.cls));
    if (!T) return -1;
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
  p.x = p.stand.x; p.y = p.stand.y; p.ang = Math.PI / 2;
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
    if (f.gateInLate > 12) p.lateWhy = p.holdReason === 'gate' ? 'gate' : 'runway';
    else if (p.paxWait && ap.t - p.paxWait > 3) p.lateWhy = 'pax';
    else p.lateWhy = 'traffic';
    closeFlight(game, ap, f);
    p.ready = true;
    p.readyAt = ap.t;
    setPath(p, [{ x: p.stand.x, y: p.stand.y }].concat(pathGateToHold(p.stand, ap.plots)));
    p.pushLen = p.stand.y - p.stand.laneY;
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
  if (C) { conn += C.outQ.drop(f.id); for (const x of C.transit) if (x.f === f.id && x.dir === 'out') conn += x.n; }
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
      if (ap.fx) ap.fx('secOut', { n, slot: 'main' });
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
        notify(ap, 'breakdown', `Monorail to ${SLOTS[T.slot].name} broke down`);
      }
    }
    const cap = connectorCap(C, ap) * dt;
    const travel = connectorTravel(C);
    for (const x of C.outQ.take(cap)) { board(C.transit, x, 'out', t + travel); if (ap.fx) ap.fx('conn', { slot: T.slot, dir: 'out', n: x.n, travel }); }
    // Arriving passengers never have a flight to miss; take them straight.
    for (const x of C.inQ.take(cap)) { board(C.transit, x, 'in', t + travel); if (ap.fx) ap.fx('conn', { slot: T.slot, dir: 'in', n: x.n, travel }); }
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
    while (C.fleet.length < C.buses) C.fleet.push({ d: (C.fleet.length / C.buses) * C.len, dir: 1, dwell: 0 });
    C.fleet.length = C.buses;
    for (const b of C.fleet) {
      if (b.dwell > 0) {
        b.dwell -= dt;
        if (b.dwell <= 0) b.dir = -b.dir;
      } else {
        let nd = b.d + b.dir * def.speed * dt;
        if (sX != null && Math.abs(b.d - sX) >= 30 && Math.abs(nd - sX) < 30) {
          // Wait at the line if an aircraft is in the crossing.
          const busy = ap.planes.some((p) => p.alt <= 0.5 && p.state !== 'gate' && Math.hypot(p.x - X.x, p.y - X.y) < p.r + 40);
          if (busy) nd = b.d;
        }
        b.d = nd;
        if (b.d >= C.len) { b.d = C.len; b.dwell = def.bus.dwell; b.dir = 1; }
        if (b.d <= 0) { b.d = 0; b.dwell = def.bus.dwell; b.dir = -1; }
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
  );
  ap.rep += (target - ap.rep) * Math.min(1, dt / 60);
  ap.rep = clamp(ap.rep, 0, 100);
}

// A quick view of what is going on, for the ops board.
export function opsSnapshot(ap) {
  const holding = ap.holdQueue.length;
  const holdingForGate = ap.holdQueue.filter((p) => p.holdReason === 'gate').length;
  const waitingPush = ap.planes.filter((p) => p.state === 'gate' && p.ready).length;
  const depQ = ap.depQueue.length;
  return { holding, holdingForGate, waitingPush, waitingGate: holdingForGate, depQ, secQueue: ap.secQueue || 0, secWait: (ap.secQueue || 0) / Math.max(0.01, securityRate(ap)) };
}

export { TERMINAL_CODES, slotCenter };
