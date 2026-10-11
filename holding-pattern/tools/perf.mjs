// Measures how long one simulation step takes on a comfortable and on an
// overbooked airport (64 aircraft, thousands in the security line).
//
//   node tools/perf.mjs
//   node --cpu-prof tools/perf.mjs     to see where the time goes

import { createAirport, step, acceptOffer } from '../src/sim.js';
import * as S from '../src/sim.js';

function busy(seed, load) {
  const game = { cash: 1e9, airports: [] };
  const ap = createAirport(0, seed);
  game.airports.push(ap);
  for (const p of ['west', 'east', 'farwest', 'fareast']) S.buyPlot(game, ap, p);
  for (const s of ['midcenter', 'westwing', 'eastwing', 'midwest', 'mideast', 'farwest', 'fareast']) S.buildTerminal(game, ap, s, s.startsWith('mid') ? 'shuttle' : 'tunnel', 4);
  for (const T of ap.terminals) { T.buildLeft = 0; if (T.connector) T.connector.buildLeft = 0; T.gates = 4; T.heavy = true; }
  ap.securityLanes = 6; ap.upgrades.radar = true;
  ap.contracts = [];
  const slots = ap.terminals.map((T) => T.slot);
  const classes = ['regional', 'narrow', 'narrow', 'wide'];
  for (let i = 0; i < load; i++) {
    ap.offers = [{ id: 'x' + i, airline: 'A', code: 'AA', color: '#fff', city: 'X', cls: classes[i % 4], freq: 0.6, paxFee: 10, load: 0.85, expires: 1e9, bonus: 0 }];
    acceptOffer(game, ap, 'x' + i, slots[i % slots.length]);
  }
  return { game, ap };
}

for (const [label, load] of [['comfortable (10 routes)', 10], ['overbooked (24 routes)', 24]]) {
  const { game, ap } = busy(3, load);
  const dt = 1 / 60;
  for (let t = 0; t < 300; t += dt) step(game, ap, dt); // warm up to a steady state
  const N = 3600;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) step(game, ap, dt);
  const ms = (performance.now() - t0) / N;
  let q = 0; for (const x of ap.secQ) q++;
  console.log(`${label}: ${ms.toFixed(3)} ms per step · ${ap.planes.length} aircraft · ${ap.holdQueue.length} holding · security queue ${Math.round(ap.secQueue)} pax in ${q} entries`);
}
