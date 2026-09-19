/**
 * A loaded capital is not firing. Which gate is stopping it?
 *
 * Three conditions have to hold at once for a volley to leave: the target must
 * be resolved (painted), inside SALVO.paintedReach of the hull's rated range,
 * and not screened hard enough to put the volley below break-even. Two in five
 * salvo-capable squadrons never throw at all across 100 matches, and 87% of the
 * time a hull spends loaded is spent waiting — so knowing WHICH condition is
 * binding is the difference between a gate that is working and one that is
 * quietly broken.
 *
 *   node tools/salvo-gate.mjs [matches]
 */
import { Game } from '../src/game.js';
import { Commander, generateFleet } from '../src/ai.js';
import {
  FACTION, TIME_LIMIT, SALVO, budgetFor, salvoBreakEven,
} from '../src/config.js';

const noopFx = {
  build() {}, disposeBatches() {}, update() {}, emitTrails() {},
  explode() {}, impact() {}, bubble() {}, syncShields() {}, applyGfx() {},
  tracers: { begin() {}, push() {}, end() {} },
};

const MATCHES = Number(process.argv[2] || 30);
const STEP = 1 / 30;

const reason = new Map();
let loadedTicks = 0;
// Capitals that never threw: what were they doing?
let capitals = 0;
const neverThrew = [];

const bump = (k) => reason.set(k, (reason.get(k) || 0) + 1);

for (let m = 0; m < MATCHES; m++) {
  const seed = 1000 + m * 137;
  const game = new Game(noopFx, { seed, fog: true });
  game.reset();
  game.start(
    generateFleet(budgetFor(FACTION.ATTACK, 1000), 'attack', seed),
    generateFleet(1000, 'defense', seed + 1),
    FACTION.ATTACK,
  );
  game.state = 'playing';
  const a = new Commander(game, FACTION.ATTACK, 'medium');
  const d = new Commander(game, FACTION.DEFENSE, 'medium');

  const threw = new Set();
  game.onSalvo = (u) => threw.add(u.id);
  // Per salvo hull: seconds alive, seconds with any target, peak charge.
  const life = new Map();

  let ended = null;
  game.onEnd = (s) => { ended = s; };
  let t = 0;
  let sampleAt = 0;

  while (!ended && t < TIME_LIMIT + 1) {
    game.step(STEP);
    a.update(STEP);
    d.update(STEP);
    t += STEP;

    for (const u of game.units) {
      if (!u.hasSalvo) continue;
      const rec = life.get(u.id)
        || { u, alive: 0, withTarget: 0, inReach: 0, peak: 0, siege: 0 };
      life.set(u.id, rec);
      if (!u.alive) continue;
      rec.alive += STEP;
      if (u.siegeLock) rec.siege += STEP;
      const reach = u.stats.range * SALVO.paintedReach;
      let hasTarget = false;
      let inReach = false;
      for (const c of u.craft) {
        if (!c.alive) continue;
        rec.peak = Math.max(rec.peak, c.salvoCharge);
        const tg = c.target;
        if (!tg || !tg.alive) continue;
        hasTarget = true;
        const dist = c.pos.distanceTo(tg.pos);
        if (dist <= reach) inReach = true;
        // Only attribute a blocked launch for hulls that are actually loaded.
        if (c.salvoCharge < 1) continue;
        loadedTicks++;
        if (u.siegeLock) { bump('bombarding — salvo suspended'); continue; }
        if (dist > reach) { bump('target outside salvo reach'); continue; }
        if (!tg.paintedBy[u.faction]) { bump('target not resolved'); continue; }
        const rounds = u.type.salvo.rounds;
        const through = rounds - game.counterforceFor(tg);
        if (through / rounds < salvoBreakEven()) { bump('screened below break-even'); continue; }
        bump('clear — should have fired this tick');
      }
      if (hasTarget) rec.withTarget += STEP;
      if (inReach) rec.inReach += STEP;
    }
  }

  for (const rec of life.values()) {
    capitals++;
    if (threw.has(rec.u.id)) continue;
    neverThrew.push(rec);
  }
}

const pc = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');
console.log(`\n  ${MATCHES} matches · ${loadedTicks.toLocaleString()} hull-ticks loaded with a live target\n`);
console.log('  why a loaded hull did not fire:');
for (const [k, n] of [...reason.entries()].sort((x, y) => y[1] - x[1])) {
  console.log(`    ${String(n).padStart(9)}  ${pc(n, loadedTicks).padStart(6)}  ${k}`);
}

console.log(`\n  salvo-capable squadrons that never threw: ${neverThrew.length} / ${capitals}`
  + `  ${pc(neverThrew.length, capitals)}`);
if (neverThrew.length) {
  const mean = (f) => (neverThrew.reduce((s, r) => s + f(r), 0) / neverThrew.length).toFixed(0);
  console.log(`    mean seconds alive                  ${mean((r) => r.alive)}`);
  console.log(`    ...of which with any live target    ${mean((r) => r.withTarget)}`);
  console.log(`    ...of which with one inside reach   ${mean((r) => r.inReach)}`);
  console.log(`    ...of which bombarding the planet   ${mean((r) => r.siege)}`);
  console.log(`    mean peak charge reached            ${(neverThrew.reduce((s, r) => s + r.peak, 0) / neverThrew.length * 100).toFixed(0)}%`);
  const never = neverThrew.filter((r) => r.inReach < 1).length;
  console.log(`    never had a target inside reach at all: ${never}`
    + `  ${pc(never, neverThrew.length)}`);
}
