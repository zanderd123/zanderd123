// The advisor: reads the airport the way an operations manager would and
// says, in plain words, what is actually wrong, why it matters, and the
// cheapest thing that fixes it. Each fix carries the same action the
// matching button elsewhere in the panel would send.

import { AIRCRAFT, CONNECTORS, UPGRADES, STAFFING, TERMINAL, PAX, COSTS, CONTRACTS, SECURITY as SECCFG } from './config.js';
import { SLOTS, PLOTS, TERMINAL_CODES } from './layout.js';
import * as S from './sim.js';

const name = (slot) => `${TERMINAL_CODES[slot]} · ${SLOTS[slot].name}`;

// A fix the player can apply with one click.
function fix(label, act, data, cost) {
  return { label, act, data, cost };
}

function upgradeFix(ap, key, why) {
  const blocked = S.upgradeBlocked(ap, key);
  if (blocked === 'Owned') return null;
  const U = UPGRADES[key];
  if (blocked && U.needsPlot && !ap.plots[U.needsPlot]) {
    return fix(`Buy the ${PLOTS[U.needsPlot].name} (needed for ${U.name.toLowerCase()})`, 'plot', { id: U.needsPlot }, S.plotCost(ap, U.needsPlot));
  }
  if (blocked) return null;
  return { ...fix(U.name, 'upgrade', { id: key }, S.upgradeCost(ap, key)), why };
}

export function advise(game, ap) {
  const issues = [];
  const rep = S.loadReport(ap);
  const snap = S.opsSnapshot(ap);
  const add = (sev, area, title, detail, fixes = [], tip = '') => issues.push({ sev, area, title, detail, fixes: fixes.filter(Boolean), tip });

  // ------------------------------------------------------------ runway
  const rwU = S.utilisation(rep.runway.demand, rep.runway.cap);
  const holdRunway = ap.holdQueue.filter((p) => p.holdReason === 'runway').length;
  if (rwU > 0.85 || holdRunway > 2) {
    const atcLimited = rep.runway.atc < rep.runway.physical;
    const fixes = [];
    if (atcLimited) {
      fixes.push(upgradeFix(ap, 'radar', '+25% movements per controller'));
      if (ap.upgrades.radar) fixes.push(upgradeFix(ap, 'automation', '+30% movements per controller'));
      if (ap.staffing.atc !== 'surge') fixes.push(fix('Surge tower staffing', 'staff', { dept: 'atc', level: 'surge' }, 0));
    } else {
      fixes.push(upgradeFix(ap, 'rapidExits', 'planes leave the runway sooner'));
      fixes.push(upgradeFix(ap, 'runway2', 'nearly doubles runway capacity'));
    }
    add(rwU >= 1 ? 3 : 2, 'runway', rwU >= 1 ? 'The runway is overbooked' : 'The runway is nearly full',
      `Your routes need ${rep.runway.demand.toFixed(1)} landings and take-offs a minute; you can handle ${rep.runway.cap.toFixed(1)}. ` +
      `The limit right now is ${atcLimited ? 'your control tower: each terminal and runway adds a controller, and upgrades make each one faster' : 'the runway itself'}. ` +
      'Arrivals that cannot land circle in the holding stack, and every flight behind them runs late.',
      fixes, rwU >= 1 ? 'Until it is fixed, decline new routes: every extra flight makes all of them later.' : '');
  }

  // ------------------------------------------------------------ gates
  for (const tr of rep.terminals) {
    if (!tr.open) continue;
    const T = S.terminalBySlot(ap, tr.slot);
    const u = tr.gateDemand / tr.gates;
    const waiting = ap.holdQueue.filter((p) => p.holdReason === 'gate' && p.f.terminal === tr.slot).length;
    if (u > 0.85 || waiting) {
      const fixes = [];
      if (T.gates < SLOTS[tr.slot].maxGates) fixes.push(fix(`Add a gate to ${TERMINAL_CODES[tr.slot]}`, 'gate', { slot: tr.slot }, S.gateCost(ap, T)));
      const spare = rep.terminals.find((o) => o.open && o.slot !== tr.slot && o.gateDemand / o.gates < 0.5);
      if (spare) fixes.push(fix(`Move routes to ${name(spare.slot)} (Contracts tab)`, 'tab', { tab: 'contracts' }, 0));
      else fixes.push(fix('Plan a new terminal (Build tab)', 'tab', { tab: 'build' }, 0));
      add(u >= 1 ? 3 : 2, 'gates', `${name(tr.slot)} is short of gates`,
        `Routes assigned here keep ${tr.gateDemand.toFixed(1)} gates busy on average; it has ${tr.gates}. ` +
        (waiting ? `${waiting} aircraft are circling because no gate is free. ` : '') +
        'A plane with no gate cannot land, so it holds, arrives late, and its passengers wait.', fixes);
    }
  }

  // ------------------------------------------------------------ security
  const secU = S.utilisation(rep.security.demand, rep.security.cap);
  if (secU > 0.85 || snap.secWait > 30) {
    const perLane = rep.security.cap / ap.securityLanes;
    const need = Math.max(0, Math.ceil(rep.security.demand / (perLane * 0.85)) - ap.securityLanes);
    const room = SECCFG.maxLanes - ap.securityLanes;
    const fixes = [];
    if (need > 0 && room > 0) fixes.push(fix(`Open a lane (${Math.min(need, room)} more needed)`, 'lane+', {}, S.laneCost(ap)));
    fixes.push(upgradeFix(ap, 'ctScanners', '+40% per lane'));
    if (ap.staffing.security !== 'surge') fixes.push(fix('Surge security staffing', 'staff', { dept: 'security', level: 'surge' }, 0));
    const hopeless = need > room;
    add(secU >= 1 || snap.secWait > 60 ? 3 : 2, 'security', 'Security can\'t keep up',
      `${Math.round(rep.security.demand)} departing passengers a minute are booked; ${ap.securityLanes} lanes screen ${Math.round(rep.security.cap)}. ` +
      `${Math.round(snap.secQueue)} people are in line now (about ${Math.round(snap.secWait)}s). ` +
      'Passengers still in line when their plane leaves miss it, and you refund them.',
      fixes, hopeless ? 'Even a full checkpoint cannot screen this many people. The real fix is fewer or smaller routes, or CT scanners.' : '');
  }

  // ------------------------------------------------------------ connectors
  for (const tr of rep.terminals) {
    if (!tr.open || tr.connCap == null) continue;
    const T = S.terminalBySlot(ap, tr.slot);
    const C = T.connector;
    const u = tr.pax / Math.max(1, tr.connCap);
    const q = (C.outSize || 0) + (C.inSize || 0);
    if (u > 0.85 || q > 80) {
      const def = CONNECTORS[C.type];
      const fixes = [];
      if (C.type === 'shuttle' && C.buses < def.bus.max) fixes.push(fix(`Add a bus to ${TERMINAL_CODES[tr.slot]}`, 'bus+', { slot: tr.slot }, Math.round(def.bus.cost * S.site(ap).cost)));
      if (def.upgrade && !C.level) fixes.push(fix(def.upgrade.name, 'connup', { slot: tr.slot }, Math.round(def.upgrade.cost * S.site(ap).cost)));
      fixes.push(fix(`Look at faster connectors for ${TERMINAL_CODES[tr.slot]}`, 'detail', { kind: 'terminal', id: tr.slot }, 0));
      add(u >= 1 ? 3 : 2, 'connector', `The ${def.name.toLowerCase()} to ${SLOTS[tr.slot].name} is overloaded`,
        `About ${Math.round(tr.pax)} passengers a minute each way need it; it carries ${Math.round(tr.connCap)}. ${Math.round(q)} are waiting on the platforms. ` +
        'Passengers who don\'t reach the gate in time miss their flight.', fixes);
    }
  }

  // ------------------------------------------------------------ missed flights
  const why = ap.missedRecent || {};
  const missedTotal = (why.security || 0) + (why.connector || 0) + (why.late || 0);
  if (ap.rolling.missed > 0.03 && missedTotal > 0) {
    const top = Object.entries(why).sort((a, b) => b[1] - a[1])[0][0];
    const cause = { security: 'stuck in the security line', connector: 'waiting for the connector to their terminal', late: 'not at the gate when the doors closed' }[top];
    add(3, 'missed', 'Passengers are missing flights',
      `${Math.round(ap.rolling.missed * 100)}% of passengers are missing their flights. Most were ${cause}. Each one is refunded, hurts your reputation, and lowers the airline's on-time score.`,
      [], top === 'security' ? 'See "Security can\'t keep up" above.' : top === 'connector' ? 'See the connector advice above.' : '');
  }

  // ------------------------------------------------------------ parking
  if (rep.parking.demand > rep.parking.cap * 1.05) {
    add(1, 'parking', 'The car park is full',
      `${Math.round(rep.parking.demand)} drivers a minute want to park; ${Math.round(rep.parking.cap)} fit. The rest pay you nothing. It only costs revenue, so fix it when cash allows.`,
      [upgradeFix(ap, 'garage1', `+${UPGRADES.garage1.parking} spaces a minute`), ap.upgrades.garage1 ? upgradeFix(ap, 'garage2', `+${UPGRADES.garage2.parking}`) : null]);
  }

  // ------------------------------------------------------------ crowding
  for (const T of ap.terminals) {
    if (!S.isOpen(T) || !T.comfort) continue;
    const c = T.occupancy / T.comfort;
    if (c > 1.1) {
      add(2, 'crowding', `${name(T.slot)} is packed`,
        `${Math.round(T.occupancy)} people in a terminal comfortable for ${Math.round(T.comfort)}. Crowds spend less in shops and hurt your reputation. ${T.slot === 'main' ? 'Here it is usually the security line: shorten it and the crowd goes.' : 'Usually passengers are waiting for a late plane.'}`,
        T.gates < SLOTS[T.slot].maxGates ? [fix(`Add a gate to ${TERMINAL_CODES[T.slot]} (more room too)`, 'gate', { slot: T.slot }, S.gateCost(ap, T))] : []);
    }
  }

  // ------------------------------------------------------------ unhappy airlines
  for (const c of ap.contracts) {
    if (c.unhappyFor > 0) {
      add(3, 'airline', `${c.airline} may leave`,
        `Its ${c.city} flights are on time ${Math.round((c.otp || 0) * 100)}% of the time. Below ${Math.round(CONTRACTS.unhappyOtp * 100)}% for ${CONTRACTS.leaveAfter}s and it pulls the route. Fix the bottleneck above, or move the route to a quieter terminal.`,
        [fix('Open Contracts', 'tab', { tab: 'contracts' }, 0)]);
    }
  }

  // ------------------------------------------------------------ offers you can't take
  for (const o of ap.offers) {
    const blocked = S.classAllowed(ap, o.cls);
    if (!blocked) continue;
    add(1, 'offer', `${o.airline} wants to fly ${AIRCRAFT[o.cls].name.toLowerCase()}s here`, `${blocked}.`, offerUnlockFixes(ap, o.cls));
  }

  // ------------------------------------------------------------ idle terminals
  for (const tr of rep.terminals) {
    if (!tr.open || tr.slot === 'main') continue;
    if (tr.gateDemand / tr.gates < 0.2) {
      const T = S.terminalBySlot(ap, tr.slot);
      const cost = (COSTS.controller + T.gates * (COSTS.groundCrewPerGate + COSTS.hvacPerGate) + COSTS.hvacBase + COSTS.cleaningBase + (T.connector ? S.connectorUpkeep(T.connector) : 0)) * S.site(ap).cost;
      add(1, 'idle', `${name(tr.slot)} is nearly empty`,
        `It costs about ${(cost / 60).toFixed(1)} $/s in staff and upkeep but has almost no routes. Sign routes for it, or move busy routes over from a crowded terminal.`,
        [fix('Open Contracts', 'tab', { tab: 'contracts' }, 0)]);
    }
  }

  // ------------------------------------------------------------ money
  const net = ap.perMin.operating || 0;
  const money = moneyBreakdown(ap);
  if (net < 0 && ap.t > 30) {
    const fixes = [];
    const lines = [...ap.costLines].sort((a, b) => b.v - a.v);
    if (secU < 0.5 && ap.securityLanes > 1) fixes.push(fix('Close an idle security lane', 'lane-', {}, 0));
    if (secU < 0.6 && ap.staffing.security !== 'lean') fixes.push(fix('Lean security staffing', 'staff', { dept: 'security', level: 'lean' }, 0));
    if (rwU < 0.5 && ap.staffing.atc !== 'lean') fixes.push(fix('Lean tower staffing', 'staff', { dept: 'atc', level: 'lean' }, 0));
    const spareRunway = rwU < 0.75, spareGates = rep.terminals.some((t) => t.open && t.gateDemand / t.gates < 0.6);
    if (spareRunway && spareGates) fixes.push(fix('Sign more routes (Contracts tab)', 'tab', { tab: 'contracts' }, 0));
    let reason;
    if ((ap.perMin.refunds || 0) < -0.3 * money.revenue) reason = `Refunds to passengers who missed flights are eating ${Math.round(-(ap.perMin.refunds || 0) / Math.max(1, money.revenue) * 100)}% of your revenue. Fix whatever is making them miss flights first.`;
    else if (money.revenue < 1) reason = 'No flights have paid yet. Sign a route in the Contracts tab.';
    else reason = `You earn ${(money.revenue / 60).toFixed(1)} $/s but spend ${(money.costs / 60).toFixed(1)} $/s. The biggest bill is ${lines[0].label.toLowerCase()} at ${(lines[0].v / 60).toFixed(1)} $/s. ${spareRunway && spareGates ? 'You have spare runway and gate capacity: more routes would pay for it.' : 'Your capacity is full, so trim staff you are not using.'}`;
    add(3, 'money', `Losing ${(-net / 60).toFixed(1)} $/s`, reason, fixes);
  }

  // ------------------------------------------------------------ good next steps
  if (!issues.some((i) => i.sev >= 2)) {
    const ideas = [];
    if (rwU < 0.7 && rep.terminals.some((t) => t.open && t.gateDemand / t.gates < 0.6)) ideas.push(fix('Sign more routes: you have spare capacity', 'tab', { tab: 'contracts' }, 0));
    const main = S.terminalBySlot(ap, 'main');
    if (main.retail < 2 && S.retailCost(ap, main) != null) ideas.push({ ...fix(`Better shops in ${TERMINAL_CODES.main}`, 'retail', { slot: 'main' }, S.retailCost(ap, main)), why: `waiting passengers spend ×${TERMINAL.retailLevels[main.retail + 1].mult}` });
    if (ap.terminals.length >= 2) ideas.push(upgradeFix(ap, 'hvac', 'cuts climate bills 35%'));
    if (!ap.terminals.some((T) => T.heavy) && ap.level >= 3) {
      const T = ap.terminals.find((x) => S.isOpen(x));
      ideas.push({ ...fix(`Heavy gates for ${TERMINAL_CODES[T.slot]}`, 'heavy', { slot: T.slot }, S.heavyCost(ap, T)), why: 'unlocks widebody routes, which pay the most per flight' });
    }
    add(0, 'ok', 'Everything is flowing', 'No bottlenecks right now. Good moments to invest:', ideas.filter(Boolean));
  }

  issues.sort((a, b) => b.sev - a.sev);
  // The best next step is the first fix for the most urgent problem that
  // can be afforded now (opening a tab counts: sometimes the fix is a choice).
  let best = null;
  for (const i of issues) { best = i.fixes.find((f) => f.cost <= game.cash) || null; if (best) break; }
  const recommended = new Set(issues.filter((i) => i.sev >= 1).flatMap((i) => i.fixes).map((f) => key(f)));
  return { issues, best, recommended, money };
}

export function key(f) { return `${f.act}:${f.data.id || f.data.slot || f.data.dept || ''}`; }

export function offerUnlockFixes(ap, cls) {
  const A = AIRCRAFT[cls];
  const out = [];
  if (A.heavy && !ap.terminals.some((T) => S.isOpen(T) && T.heavy)) {
    const T = ap.terminals.filter((x) => S.isOpen(x)).sort((a, b) => S.heavyCost(ap, a) - S.heavyCost(ap, b))[0];
    out.push(fix(`Convert ${TERMINAL_CODES[T.slot]} to heavy gates`, 'heavy', { slot: T.slot }, S.heavyCost(ap, T)));
  }
  if (A.longRunway && !ap.upgrades.longRunway) out.push(upgradeFix(ap, 'longRunway', 'superjumbos need it'));
  return out.filter(Boolean);
}

export function moneyBreakdown(ap) {
  const pm = ap.perMin;
  const revenue = ['landing', 'paxFees', 'retail', 'parking'].reduce((s, k) => s + Math.max(0, pm[k] || 0), 0);
  const costs = ap.costLines.reduce((s, l) => s + l.v, 0);
  return { revenue, costs, refunds: -(pm.refunds || 0) };
}

export { STAFFING, PAX };
