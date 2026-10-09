// Measures what one runway really handles: saturate it and count movements.
//   node tools/runway.mjs
import { createAirport, step, acceptOffer } from '../src/sim.js';
import * as S from '../src/sim.js';

function measure(label, setup) {
  const game = { cash: 1e9, airports: [] };
  const ap = createAirport(0, 1);
  game.airports.push(ap);
  for (const p of ['west', 'east', 'farwest', 'fareast', 'north']) S.buyPlot(game, ap, p);
  for (const s of ['midcenter', 'westwing', 'eastwing', 'midwest', 'mideast']) S.buildTerminal(game, ap, s, 'tunnel');
  for (const T of ap.terminals) { T.buildLeft = 0; if (T.connector) T.connector.buildLeft = 0; T.gates = 4; T.heavy = true; }
  ap.securityLanes = 14; ap.staffing.atc = 'surge'; ap.upgrades.radar = true; ap.upgrades.automation = true;
  setup(ap);
  ap.contracts = [];
  const slots = ap.terminals.map((T) => T.slot);
  for (let i = 0; i < 18; i++) {
    ap.offers = [{ id: 'x' + i, airline: 'A', code: 'AA', color: '#fff', city: 'X', cls: i % 3 ? 'narrow' : 'regional', freq: 1.2, paxFee: 10, load: 0.8, expires: 1e9, bonus: 0 }];
    acceptOffer(game, ap, 'x' + i, slots[i % slots.length]);
  }
  let moves = 0;
  const seen = new Set();
  for (let t = 0; t < 900; t += 0.05) {
    step(game, ap, 0.05);
    if (t > 300) for (const p of ap.planes) {
      if ((p.state === 'rollout' || p.state === 'takeoff') && !seen.has(p.id + p.state)) { seen.add(p.id + p.state); moves++; }
    }
  }
  console.log(`${label}: ${(moves / 10).toFixed(1)} movements/min measured · model says ${S.runwayPhysical(ap).toFixed(1)} · holding ${ap.holdQueue.length} · dep queue ${ap.depQueue.length}`);
}
measure('one runway', () => {});
measure('rapid exits', (ap) => { ap.upgrades.rapidExits = true; });
measure('two runways', (ap) => { ap.upgrades.rapidExits = true; ap.upgrades.runway2 = true; });
