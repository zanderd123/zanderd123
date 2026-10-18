// Midfield taxiway stress test: a grown airport with its north field and the
// midfield taxiway. Main-terminal arrivals divert to the north runway and
// taxi across: none may collide or get stuck, and they must reach their gates.
//   node tools/midfield.mjs            (DT=0.05, SEED=0, RUNWAY2=0|1, MINUTES=20)
import * as S from '../src/sim.js';
const DT = Number(process.env.DT || 0.05), minutes = Number(process.env.MINUTES || 20);
let pass = true;
for (const runway2 of (process.env.RUNWAY2 ? [process.env.RUNWAY2 === '1'] : [false, true])) {
  const game = { cash: 1e12, airports: [] };
  const ap = S.createAirport(0, 11 + Number(process.env.SEED || 0) * 100);
  game.airports.push(ap);
  ap.tower = 4; ap.level = 8; ap.expandReady = true;
  for (const p of ['west', 'east', 'north', 'n.core', 'n.west', 'n.east']) S.buyPlot(game, ap, p);
  if (runway2) S.buyUpgrade(game, ap, 'runway2');
  const control = process.env.NOMID === '1'; // the same airport without it, to compare
  const err = control ? null : S.buyUpgrade(game, ap, 'midfield');
  if (err) { console.log('could not build midfield:', err); process.exit(1); }
  for (const s of ['midcenter', 'westwing', 'eastwing', 'n.main', 'n.midcenter']) S.buildTerminal(game, ap, s, s.includes('.') ? 'tunnel' : s === 'midcenter' ? 'shuttle' : 'walkway');
  for (const T of ap.terminals) { T.buildLeft = 0; if (T.connector) T.connector.buildLeft = 0; T.gates = S.maxGates(ap, T.slot); T.heavy = true; }
  ap.securityLanes = 14; ap.staffing.atc = 'surge'; ap.upgrades.radar = true; ap.upgrades.automation = true;
  ap.contracts = [];
  const mainSlots = ['main', 'midcenter', 'westwing', 'eastwing'];
  for (let i = 0; i < 22; i++) {
    ap.offers = [{ id: 'x' + i, airline: 'A', code: 'AA', color: '#fff', city: 'X', cls: ['regional', 'narrow', 'narrow', 'wide'][i % 4], freq: 0.9, paxFee: 10, load: 0.8, expires: 1e9, bonus: 0 }];
    S.acceptOffer(game, ap, 'x' + i, i % 6 === 5 ? 'n.main' : mainSlots[i % 4]);
  }
  const N = ap.fieldViews.N;
  let overlaps = 0, worst = Infinity, xferSeen = new Set(), xferGate = 0, landings = 0, gated = 0, depSeen = new Set(), depOut = 0, takeoffs = 0;
  const seen = new Set();
  for (let t = 0; t < minutes * 60; t += DT) {
    S.step(game, ap, DT);
    for (const F of S.fields(ap)) {
      const g = F.planes.filter((p) => p.alt <= 0.5 && p.state !== 'gate');
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
        const d = Math.hypot(g[i].x - g[j].x, g[i].y - g[j].y) / (g[i].r + g[j].r);
        if (d < worst) worst = d;
        if (d < 0.97) { overlaps++; if (overlaps <= 3) console.log('overlap', F.field || 'main', t.toFixed(1), g[i].id, g[i].state, g[j].id, g[j].state, Math.round(g[i].x), Math.round(g[i].y)); }
      }
    }
    for (const p of N.planes) if (p.xfer) xferSeen.add(p);
    for (const p of ap.planes) if (p.xferDep) depSeen.add(p);
    for (const p of depSeen) if (p.state === 'takeoff' && !seen.has('d' + p.id)) { seen.add('d' + p.id); depOut++; }
    if (process.env.DEBUG && !ap.dumped) {
      for (const F of S.fields(ap)) {
        const st = F.planes.find((p) => p.blockedFor > 58 && p.alt <= 0.5);
        if (!st) continue;
        ap.dumped = true;
        const fmt = (p) => `${p.id} ${p.state}${p.xfer ? ' xfer' : ''} @${p.x.toFixed(0)},${p.y.toFixed(0)} d${p.d.toFixed(0)}/${(p.len || 0).toFixed(0)} blk ${p.blockedFor.toFixed(1)} why[${p.why}] crossing ${p.crossAt != null ? `${(p.crossAt || 0).toFixed(0)}-${(p.crossEnd || 0).toFixed(0)} ${p.crossing ? 'on' : ''}${p.crossed ? 'done' : ''}` : '-'} cw ${p.crossWait || 0}`;
        console.log('field', F.field || 'main', 't', t.toFixed(1), fmt(st));
        for (const o of F.planes) if (o !== st && o.alt <= 0.5 && Math.hypot(o.x - st.x, o.y - st.y) < 260) console.log('   ', fmt(o));
        const R = F.runways[0];
        console.log('   rw0 occ', R.occupant && R.occupant.id, 'res', R.reservedArr && R.reservedArr.id, 'crossers', [...R.crossers].map((x) => x.id), 'depQ', F.depQueue.map((x) => x.id + ':' + x.state), 'tokens', F.atcTokens.toFixed(2));
      }
    }
    for (const p of xferSeen) if (p.state === 'gate' && !seen.has(p)) { seen.add(p); xferGate++; }
    for (const p of S.allPlanes(ap)) {
      if (p.state === 'rollout' && !seen.has('l' + p.id)) { seen.add('l' + p.id); landings++; }
      if (p.state === 'takeoff' && !seen.has('t' + p.id)) { seen.add('t' + p.id); takeoffs++; }
      if (p.state === 'gate' && !seen.has('g' + p.id)) { seen.add('g' + p.id); gated++; }
    }
  }
  const stuck = [...xferSeen, ...depSeen].filter((p) => p.state !== 'gate' && p.state !== 'gone' && p.blockedFor > 60);
  const ok = overlaps === 0 && !(ap.gridlocks > 0) && (control || (xferGate > 0 && depOut > 0)) && !stuck.length;
  pass &&= ok;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${control ? 'no midfield' : 'midfield'}${runway2 ? ' + second runway' : ''}: ${landings} landings, ${takeoffs} take-offs, ${xferSeen.size} landed north (${xferGate} at gate), ${depSeen.size} left north (${depOut} airborne), ${gated} at gates in all, overlaps ${overlaps}, closest ${worst.toFixed(2)}x, gridlocks ${(ap.gridlocks || 0)}${stuck.length ? `, stuck ${stuck.map((p) => p.id + ':' + p.state + ' ' + p.why).join(' ')}` : ''}`);
}
process.exit(pass ? 0 : 1);
