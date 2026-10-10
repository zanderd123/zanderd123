// Stress test for ground traffic: saturates airports of several shapes and
// checks that aircraft never overlap and never gridlock.
//
//   node tools/traffic.mjs [minutes]
//
// "overlaps" counts moments when two aircraft on the ground (outside their
// stands) are closer than the sum of their radii. "gridlocks" counts the
// safety valve in sim.js firing; both must stay at zero.

import { createAirport, step, acceptOffer } from '../src/sim.js';
import * as S from '../src/sim.js';

const minutes = Number(process.argv[2] || 15);

function scenario(name, seed, setup) {
  if (only && only !== name) return true;
  const game = { cash: 1e9, airports: [] };
  const ap = createAirport(0, seed + Number(process.env.SEED || 0) * 100);
  game.airports.push(ap);
  const slots = setup(game, ap);
  for (const T of ap.terminals) { T.buildLeft = 0; if (T.connector) T.connector.buildLeft = 0; T.gates = 4; T.heavy = true; }
  ap.securityLanes = 14; ap.staffing.atc = 'surge'; ap.upgrades.radar = true; ap.upgrades.automation = true;
  ap.contracts = [];
  const classes = ['regional', 'narrow', 'narrow', 'wide'];
  for (let i = 0; i < 20; i++) {
    ap.offers = [{ id: 'x' + i, airline: 'A', code: 'AA', color: '#fff', city: 'X', cls: classes[i % 4], freq: 0.9, paxFee: 10, load: 0.8, expires: 1e9, bonus: 0 }];
    acceptOffer(game, ap, 'x' + i, slots[i % slots.length]);
  }
  let overlaps = 0, worst = Infinity, landings = 0, takeoffs = 0;
  const seen = new Set();
  for (let t = 0; t < minutes * 60; t += 0.05) {
    step(game, ap, 0.05);
    const g = ap.planes.filter((p) => p.alt <= 0.5 && p.state !== 'gate');
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        const a = g[i], b = g[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y) / (a.r + b.r);
        if (d < worst) worst = d;
        if (d < 0.97) {
          overlaps++;
          if (process.env.DEBUG === name && overlaps <= 3) console.log('overlap t', t.toFixed(1), [a, b].map((p) => `${p.id} ${p.state} @${p.x.toFixed(0)},${p.y.toFixed(0)} d${p.d.toFixed(0)}/${(p.len || 0).toFixed(0)} rollEnd ${p.rollEnd && p.rollEnd.toFixed(0)} why[${p.why}]`).join(' | '));
        }
      }
    }
    if (process.env.TRACE && process.env.DEBUG === name && t > Number(process.env.TRACE) && t < Number(process.env.TRACE) + 12 && Math.abs(t % 1) < 0.05) {
      const R = ap.runways[0];
      console.log('trace', t.toFixed(1), 'occ', R.occupant && `${R.occupant.id}:${R.occupant.state}@${R.occupant.x.toFixed(0)},${R.occupant.y.toFixed(0)} blk${R.occupant.blockedFor.toFixed(1)}`, 'res', R.reservedArr && R.reservedArr.id, 'tok', ap.atcTokens.toFixed(2), 'depQ', ap.depQueue.map((p) => p.id).join(','), 'cross', ap.planes.filter((p) => p.crossWait).map((p) => p.id).join(','), 'hold', ap.holdQueue.length);
    }
    if (process.env.DEBUG === name && !ap.dumped) {
      const st = ap.planes.find((p) => p.blockedFor > Number(process.env.STALL || 50) && ['taxiIn', 'taxiOut', 'pushback', 'rollout'].includes(p.state));
      if (st) {
        ap.dumped = true;
        const fmt = (p) => `${p.id} ${p.state} @${p.x.toFixed(0)},${p.y.toFixed(0)} d${p.d.toFixed(0)}/${p.len.toFixed(0)} free ${p.free} blk ${p.blockedFor.toFixed(1)} why[${p.why}] path ${JSON.stringify(p.path.map((q) => [Math.round(q.x), Math.round(q.y)]))}`;
        console.log('t', t.toFixed(1), fmt(st));
        for (const o of ap.planes) if (o !== st && o.alt <= 0.5 && Math.hypot(o.x - st.x, o.y - st.y) < 220) console.log('   ', fmt(o));
      }
    }
    for (const p of ap.planes) {
      if (p.state === 'rollout' && !seen.has('l' + p.id)) { seen.add('l' + p.id); landings++; }
      if (p.state === 'takeoff' && !seen.has('t' + p.id)) { seen.add('t' + p.id); takeoffs++; }
    }
  }
  const ok = overlaps === 0 && !(ap.gridlocks > 0);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${landings} landings, ${takeoffs} take-offs, overlaps ${overlaps}, closest ${worst.toFixed(2)}×(r1+r2), gridlocks ${ap.gridlocks || 0}`);
  return ok;
}

const all = (game, ap, plots, slots, type) => {
  for (const p of plots) S.buyPlot(game, ap, p);
  for (const s of slots) S.buildTerminal(game, ap, s, type(s));
  return ['main', ...slots];
};

let pass = true;
const only = process.env.DEBUG;
pass &= scenario('core only', 1, (g, ap) => all(g, ap, [], ['midcenter'], () => 'shuttle'));
pass &= scenario('west and east, shuttles crossing the apron', 2, (g, ap) => all(g, ap, ['west', 'east'], ['midcenter', 'westwing', 'eastwing', 'midwest', 'mideast'], (s) => (s.startsWith('mid') ? 'shuttle' : 'walkway')));
pass &= scenario('everything, one runway', 3, (g, ap) => all(g, ap, ['west', 'east', 'farwest', 'fareast'], ['midcenter', 'westwing', 'eastwing', 'midwest', 'mideast', 'farwest', 'fareast'], () => 'tunnel'));
pass &= scenario('everything, two runways', 4, (g, ap) => { ap.upgrades.runway2 = true; ap.upgrades.rapidExits = true; return all(g, ap, ['west', 'east', 'farwest', 'fareast', 'north'], ['midcenter', 'westwing', 'eastwing', 'midwest', 'mideast', 'farwest', 'fareast'], () => 'monorail'); });
process.exit(pass ? 0 : 1);
