// Plays the game headless with a simple greedy strategy and prints how the
// money grows. Used to check that expanding stays profitable and that the
// congestion systems bite before they are fixed.
//
//   node tools/bot.mjs [minutes] [--quiet]

import { newGame, stepGame, activeAirport, siteStatus, buySite, nextSite } from '../src/game.js';
import * as S from '../src/sim.js';
import { UPGRADE_ORDER, AIRCRAFT } from '../src/config.js';
import { SLOT_ORDER, SLOTS, PLOT_ORDER, PLOTS } from '../src/layout.js';
import { money } from '../src/util.js';

const minutes = Number(process.argv[2] || 60);
const quiet = process.argv.includes('--quiet');
const game = newGame();
const DT = 0.1;
let lastReport = 0;
const log = [];

function think(ap) {
  const rep = S.loadReport(ap);
  const rwU = rep.runway.demand / rep.runway.cap;
  const secU = rep.security.demand / rep.security.cap;

  // Fix the worst bottleneck first.
  if (secU > 0.8) S.addLane(game, ap);
  for (const tr of rep.terminals) {
    if (!tr.open) continue;
    const T = S.terminalBySlot(ap, tr.slot);
    if (tr.gateDemand / tr.gates > 0.75 && T.gates < SLOTS[tr.slot].maxGates) S.addGate(game, ap, tr.slot);
    if (T.connector && T.connector.type === 'shuttle' && tr.pax / 60 > S.connectorCap(T.connector) * 0.75) S.setBuses(game, ap, tr.slot, +1);
    if (T.retail < 2 && game.cash > S.retailCost(ap, T) * 3) S.buyRetail(game, ap, tr.slot);
  }
  if (rwU > 0.75) {
    for (const k of ['radar', 'rapidExits', 'automation', 'runway2']) if (!ap.upgrades[k]) { S.buyUpgrade(game, ap, k); break; }
  }
  for (const k of ['hvac', 'ctScanners']) if (game.cash > S.upgradeCost(ap, k) * 4) S.buyUpgrade(game, ap, k);
  const rep0 = S.loadReport(ap);
  if (rep0.parking.demand > rep0.parking.cap) {
    const id = ['front', 'west', 'east', 'southwest', 'southeast', 'farwest', 'fareast'].find((p) => !S.parkingBlocked(ap, p));
    if (id && game.cash > S.parkingCost(ap, id) * 4) S.buildParking(game, ap, id);
  }

  // Need a new terminal?
  const open = rep.terminals.filter((t) => t.open);
  const gateU = open.reduce((s, t) => s + t.gateDemand, 0) / Math.max(1, open.reduce((s, t) => s + t.gates, 0));
  const building = ap.terminals.some((T) => !S.isOpen(T));
  if (gateU > 0.6 && !building) {
    for (const slot of SLOT_ORDER) {
      if (S.terminalBySlot(ap, slot)) continue;
      const plot = SLOTS[slot].plot;
      if (!ap.plots[plot]) { S.buyPlot(game, ap, plot); }
      if (!ap.plots[plot]) break;
      const type = SLOTS[slot].adjacent ? 'walkway' : (game.cash > S.terminalCost(ap) + S.connectorBuildCost('tunnel', slot, ap) * 1.5 ? 'tunnel' : 'shuttle');
      const err = S.buildTerminal(game, ap, slot, type, 3);
      if (!err) log.push(`${fmt(ap.t)} ${ap.id} built ${slot} with ${type}`);
      break;
    }
  }
  if (rep.terminals.some((t) => t.open) && ap.level >= 3 && !ap.terminals.some((T) => T.heavy)) {
    const T = ap.terminals.find((x) => S.isOpen(x));
    S.buyHeavy(game, ap, T.slot);
  }

  // Take offers that fit under 85% load.
  for (const o of [...ap.offers]) {
    if (S.classAllowed(ap, o.cls)) continue;
    const slot = S.suggestTerminal(ap, o.cls);
    if (!slot) continue;
    const r2 = S.loadReport(ap, { ...o, terminal: slot });
    const t2 = r2.terminals.find((t) => t.slot === slot);
    const secOk = r2.security.demand / r2.security.cap < 0.9;
    const gateOk = t2.gateDemand / t2.gates < 0.78;
    const ok = r2.runway.demand / r2.runway.cap < 0.8 && gateOk && secOk && (t2.connCap == null || t2.pax < t2.connCap * 0.85);
    if (ok) S.acceptOffer(game, ap, o.id, slot);
    else {
      // invest in whatever is in the way
      if (!secOk) S.addLane(game, ap);
      if (!gateOk) S.addGate(game, ap, slot);
    }
  }
}

function fmt(t) { return `${Math.floor(t / 60)}m${String(Math.floor(t % 60)).padStart(2, '0')}`; }

let acc = 0;
for (let t = 0; t < minutes * 60; t += DT) {
  stepGame(game, DT);
  acc += DT;
  if (acc >= 2) {
    acc = 0;
    for (const ap of game.airports) think(ap);
    const n = nextSite(game);
    if (n >= 0 && siteStatus(game, n).state === 'available' && game.cash > siteStatus(game, n).price * 1.3) {
      buySite(game, n);
      log.push(`${fmt(t)} bought airport ${n}`);
    }
  }
  if (t - lastReport >= 120) {
    lastReport = t;
    const parts = game.airports.map((ap) => {
      const o = S.opsSnapshot(ap);
      const rep = S.loadReport(ap);
      return `${ap.id} L${ap.level} net ${money(ap.perMin.net)}/m rep ${ap.rep.toFixed(0)} otp ${(ap.rolling.otp * 100).toFixed(0)}% c${ap.contracts.length} T${ap.terminals.length} g${S.totalGates(ap)} rw ${(rep.runway.demand).toFixed(1)}/${rep.runway.cap.toFixed(1)} hold ${o.holding} sec ${o.secQueue.toFixed(0)} planes ${ap.planes.length}`;
    });
    if (!quiet) console.log(`${fmt(t)} cash ${money(game.cash)} | ${parts.join(' | ')}`);
  }
}
console.log(log.join('\n'));
const ap = activeAirport(game);
console.log('ledger', Object.fromEntries(Object.entries(ap.perMin).map(([k, v]) => [k, Math.round(v)])));
console.log('costs', ap.costLines.map((l) => `${l.key}:${Math.round(l.v)}`).join(' '));

if (process.argv.includes('--dump')) {
  for (const ap of game.airports) {
    const st = {};
    for (const p of ap.planes) st[p.state] = (st[p.state] || 0) + 1;
    console.log(ap.id, JSON.stringify(st));
    for (const c of ap.contracts) console.log(' ', c.cls, c.freq, c.terminal, 'otp', c.otpHist.join(''), 'lastDelay', (c.lastDelay || 0).toFixed(0));
    for (const T of ap.terminals) console.log(' T', T.slot, 'gates', T.gates, 'occ', (T.occupancy || 0).toFixed(0), T.connector ? `${T.connector.type} b${T.connector.buses} out ${(T.connector.outSize || 0).toFixed(0)} in ${(T.connector.inSize || 0).toFixed(0)} cap ${S.connectorCap(T.connector, ap).toFixed(2)}/s` : '');
    const stuck = ap.planes.filter((p) => p.blockedFor > 1).map((p) => `${p.state}@${p.x.toFixed(0)},${p.y.toFixed(0)}`);
    console.log('  blocked:', stuck.join(' '));
    const gates = ap.planes.filter((p) => p.state === 'gate').map((p) => `${p.f.terminal} left ${p.turnLeft.toFixed(0)} std ${(p.f.std - ap.t).toFixed(0)} b ${p.f.boarded.toFixed(0)}/${p.f.expected}`);
    console.log('  at gate:', gates.join(' | '));
  }
}
