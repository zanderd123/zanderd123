/**
 * Does scouting pay, and does it pay the hulls it is supposed to?
 *
 * Two questions this answers, which no win rate can:
 *
 *  1. What share of shots are fired on a real firing solution? If it is ~100%
 *     the rule is decoration — every fight is close enough to paint itself.
 *     If it is ~0% the fleet can never concentrate and gunnery is broken.
 *  2. WHO is doing the painting? The whole point is that the long guns cannot
 *     resolve their own targets and light hulls can. If Bastions paint for
 *     themselves the role split does not exist.
 *
 *   node tools/scouting.mjs [matches] [budget] [difficulty]
 */
import { Game } from '../src/game.js';
import { Commander, generateFleet } from '../src/ai.js';
import { FACTION, TIME_LIMIT, SCOUTING, SHIPS, unitCost, budgetFor } from '../src/config.js';

const noopFx = {
  build() {}, disposeBatches() {}, update() {}, emitTrails() {},
  explode() {}, impact() {}, bubble() {}, syncShields() {}, applyGfx() {},
  tracers: { begin() {}, push() {}, end() {} },
};

const MATCHES = Number(process.argv[2] || 20);
const BUDGET = Number(process.argv[3] || 1000);
const DIFFICULTY = process.argv[4] || 'medium';
const STEP = 1 / 30;

// Shots fired with and without a solution, by the shooter's type.
const byType = new Map();
let painted = 0;
let blind = 0;
// Who is providing the paint, by type: how many enemy hulls each type is
// close enough to resolve, summed over samples.
const spotters = new Map();
let samples = 0;

const bump = (map, key, field) => {
  const row = map.get(key) || { painted: 0, blind: 0, spots: 0, reach: 0, n: 0 };
  row[field]++;
  map.set(key, row);
};

for (let m = 0; m < MATCHES; m++) {
  const seed = 1000 + m * 137;
  const game = new Game(noopFx, { seed, fog: true });
  game.reset();
  game.start(
    generateFleet(budgetFor(FACTION.ATTACK, BUDGET), 'attack', seed),
    generateFleet(BUDGET, 'defense', seed + 1),
    FACTION.ATTACK,
  );
  game.state = 'playing';
  const a = new Commander(game, FACTION.ATTACK, DIFFICULTY);
  const d = new Commander(game, FACTION.DEFENSE, DIFFICULTY);

  let ended = null;
  game.onEnd = (s) => { ended = s; };
  let t = 0;
  let sampleAt = 0;

  while (!ended && t < TIME_LIMIT + 1) {
    game.step(STEP);
    a.update(STEP);
    d.update(STEP);
    t += STEP;

    if (t < sampleAt) continue;
    sampleAt = t + 1;

    // Every craft currently shooting at something: solved, or not? And how
    // far out is it fighting, as a share of the range it paid for? That share
    // is the real cost of fighting blind — an unresolved contact is closed on
    // rather than held at arm's length, so the penalty shows up as lost
    // standoff, not as missed shots.
    for (const u of game.units) {
      if (!u.alive || !u.type.weapon || !u.stats.range) continue;
      for (const c of u.craft) {
        if (!c.alive || !c.target || !c.target.alive) continue;
        const share = c.pos.distanceTo(c.target.pos) / u.stats.range;
        const row = byType.get(u.type.id) || { painted: 0, blind: 0, spots: 0, reach: 0, n: 0 };
        row.reach += Math.min(share, 2);
        row.n++;
        byType.set(u.type.id, row);
        if (c.target.paintedBy[u.faction]) { painted++; bump(byType, u.type.id, 'painted'); }
        else { blind++; bump(byType, u.type.id, 'blind'); }
      }
    }

    // Credit paint to whoever is close enough to be providing it. A hull is
    // credited once per enemy squadron it is resolving.
    for (const u of game.units) {
      if (!u.alive) continue;
      const reach = u.stats.sensor * SCOUTING.paintFraction;
      let spots = 0;
      for (const e of game.units) {
        if (!e.alive || e.faction === u.faction) continue;
        if (u.pos.distanceTo(e.pos) <= reach + 90) spots++;
      }
      if (!spots) continue;
      bump(spotters, u.type.id, 'spots');
      spotters.get(u.type.id).spots += spots - 1;
    }
    samples++;
  }
}

const total = painted + blind;
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(0)}%` : '   —');

console.log(`\n  ${MATCHES} matches · ${BUDGET}pts · ${DIFFICULTY}`
  + ` · ${total.toLocaleString()} shooting hulls sampled\n`);
console.log(`  fired on a firing solution   ${painted.toLocaleString().padStart(8)}  ${pct(painted, total)}`);
console.log(`  fired on a distant contact   ${blind.toLocaleString().padStart(8)}  ${pct(blind, total)}`);

console.log('\n  by shooter — how often each hull has a solution on what it is shooting:');
const rows = [...byType.entries()].sort((x, y) => {
  const px = x[1].painted / (x[1].painted + x[1].blind);
  const py = y[1].painted / (y[1].painted + y[1].blind);
  return px - py;
});
for (const [id, r] of rows) {
  const n = r.painted + r.blind;
  console.log(`    ${id.padEnd(9)} ${pct(r.painted, n).padStart(5)} solved`
    + `   fighting at ${((r.reach / Math.max(1, r.n)) * 100).toFixed(0).padStart(3)}%`
    + ` of its rated range   (${n.toLocaleString()} samples)`);
}

console.log('\n  by spotter — enemy squadrons resolved per second of match, by type:');
const srows = [...spotters.entries()].sort((x, y) => y[1].spots - x[1].spots);
for (const [id, r] of srows) {
  console.log(`    ${id.padEnd(9)} ${(r.spots / Math.max(1, samples)).toFixed(2).padStart(5)}`);
}

// ---------------------------------------------------------------------------
// The decisive test: does buying eyes actually pay for itself?
//
// Two attacking fleets at the same budget, on the same seeds, against the same
// defence. One spends part of its points on a forward element that can resolve
// contacts (Wasps and a Specter); the other spends those same points on line
// hulls. If the rule works, the fleet with eyes wins more — and its Bastions
// fight nearer their rated range, which is the mechanism by which it happens.
//
//   node tools/scouting.mjs ab [matches] [budget]
// ---------------------------------------------------------------------------
if (process.argv[2] === 'ab') {
  const N = Number(process.argv[3] || 24);
  const B = Number(process.argv[4] || 1000);
  if (process.env.PAINT) SCOUTING.paintFraction = Number(process.env.PAINT);
  if (process.env.BLIND) SCOUTING.unpaintedRangeFactor = Number(process.env.BLIND);
  console.log(`\n  paintFraction ${SCOUTING.paintFraction}`
    + `  unpaintedRangeFactor ${SCOUTING.unpaintedRangeFactor}`);

  const rosters = {
    'with eyes': [
      { typeId: 'wasp', qty: 2 }, { typeId: 'specter', qty: 1 },
      { typeId: 'falcon', qty: 1 }, { typeId: 'bastion', qty: 3 },
      { typeId: 'warden', qty: 2 },
    ],
    'all line': [
      { typeId: 'falcon', qty: 2 }, { typeId: 'bastion', qty: 3 },
      { typeId: 'warden', qty: 5 },
    ],
  };

  for (const [name, roster] of Object.entries(rosters)) {
    let wins = 0;
    let standoff = 0;
    let samples = 0;
    let solved = 0;
    let shots = 0;
    for (let m = 0; m < N; m++) {
      const seed = 1000 + m * 137;
      const game = new Game(noopFx, { seed, fog: true });
      game.reset();
      game.start(roster, generateFleet(B, 'defense', seed + 1), FACTION.ATTACK);
      game.state = 'playing';
      const a = new Commander(game, FACTION.ATTACK, DIFFICULTY);
      const d = new Commander(game, FACTION.DEFENSE, DIFFICULTY);
      let ended = null;
      game.onEnd = (s) => { ended = s; };
      let t = 0;
      let at = 0;
      while (!ended && t < TIME_LIMIT + 1) {
        game.step(STEP); a.update(STEP); d.update(STEP); t += STEP;
        if (t < at) continue;
        at = t + 1;
        for (const u of game.units) {
          if (!u.alive || u.faction !== FACTION.ATTACK || u.type.id !== 'bastion') continue;
          for (const c of u.craft) {
            if (!c.alive || !c.target || !c.target.alive) continue;
            standoff += Math.min(c.pos.distanceTo(c.target.pos) / u.stats.range, 2);
            samples++;
            shots++;
            if (c.target.paintedBy[u.faction]) solved++;
          }
        }
      }
      if (ended === 'victory') wins++;
    }
    const pts = roster.reduce((s, r) => s + unitCost(SHIPS[r.typeId]) * r.qty, 0);
    const cost = roster.reduce((s, r) => s + r.qty, 0);
    console.log(`  ${name.padEnd(10)} win ${((wins / N) * 100).toFixed(0).padStart(3)}%`
      + `   ${cost} squadrons, ${pts}pts`
      + `   Bastions fight at ${((standoff / Math.max(1, samples)) * 100).toFixed(0)}%`
      + ` of rated range, ${((solved / Math.max(1, shots)) * 100).toFixed(0)}% solved`);
  }
  console.log(`\n  ${N} matches each · ${B}pts · ${DIFFICULTY}`);
}
