/**
 * The side nobody has ever tested.
 *
 * Every other probe in this directory passes FACTION.ATTACK as the player
 * faction, so across every hundred-match run ever done here, `playerFaction`
 * has only ever held one value. That matters, because it is not a cosmetic
 * field: it decides which way round a result is reported, who wins a timeout,
 * which hulls the fog renders, and which side the planet falling is a disaster
 * for. The game lets you pick a side in the builder. Half of that choice has
 * never been simulated.
 *
 * This plays the DEFENCE by hand against an attacking Commander and checks the
 * things that can only be wrong on this side:
 *
 *  - a destroyed world must read 'defeat', and the clock running out must read
 *    'victory'. On the attacking side both of those are the other word, so a
 *    swapped comparison is invisible in every existing run.
 *  - the planet must actually be defensible: if the hand-played defence never
 *    wins, either the side is broken or the objective is.
 *  - the same structural invariants the attacking runs assert.
 *
 * Three arms, because "the player loses" is only a finding once it is clear
 * WHAT loses — the side, or the order given on it:
 *
 *   guard  every ship told to defend the planet, which is what a person does
 *   loose  no orders at all, the fleet left as it spawns
 *   ai     a Commander holds the side, the existing 58% baseline
 *
 *   node tools/defend.mjs [matches] [guard|loose|ai|all]
 */
import * as THREE from 'three';
import { Game } from '../src/game.js';
import { Commander, generateFleet } from '../src/ai.js';
import { FACTION, TIME_LIMIT, WORLD, budgetFor } from '../src/config.js';

const noopFx = {
  build() {}, disposeBatches() {}, update() {}, emitTrails() {},
  explode() {}, impact() {}, bubble() {}, syncShields() {}, applyGfx() {},
  tracers: { begin() {}, push() {}, end() {} },
};

const MATCHES = Number(process.argv[2] || 100);
const ARM = process.argv[3] || 'all';
const POINTS = 1000;
const STEP = 1 / 30;
const PLANET = new THREE.Vector3(...WORLD.planetCenter);

const fails = [];
let checks = 0;
const check = (cond, msg) => { checks++; if (!cond) fails.push(msg); };

function run(mode) {
const outcomes = { victory: 0, defeat: 0, draw: 0, unresolved: 0 };
let timedOut = 0;
let planetFell = 0;
let totalSeconds = 0;
let crustLowSum = 0;
let everFired = 0;
let noContact = 0;
// Can the defence physically reach what is killing the world? Sampled once a
// second: the share of living defending hulls with any live attacker inside
// their own weapon range, and the share standing on the besieged FACE of the
// planet — the hemisphere the bombardment is coming from.
let inRangeSum = 0;
let onFaceSum = 0;
let samples = 0;
// Shooting is gated on more than distance. A hull must have a firing solution
// (paint) to use its full range at all, and a parked fleet does no scouting —
// so raw "in range" can overstate what the defence can actually do. These
// three say whether the guns are earning their keep: how much of the attack
// the defence has resolved, how many of its hulls are actually engaging, and
// how fast they are moving (which is what the evasion rule charges for).
let paintedSum = 0;
let firingSum = 0;
let speedSum = 0;

for (let m = 0; m < MATCHES; m++) {
  const seed = 1000 + m * 137;
  const game = new Game(noopFx, { seed, fog: true });
  game.reset();
  game.start(
    generateFleet(budgetFor(FACTION.ATTACK, POINTS), 'attack', seed),
    generateFleet(budgetFor(FACTION.DEFENSE, POINTS), 'defense', seed + 1),
    // The whole point: the human is holding the world, not taking it.
    FACTION.DEFENSE,
  );
  game.state = 'playing';

  const attackAI = new Commander(game, FACTION.ATTACK, 'medium');
  const defenseAI = mode === 'ai' ? new Commander(game, FACTION.DEFENSE, 'medium') : null;

  // How a person actually defends: put the fleet on the objective and leave
  // it there. Ground emplacements are already seated and take no order.
  if (mode === 'guard') {
    for (const u of game.units) {
      if (u.faction !== FACTION.DEFENSE || u.broodOf) continue;
      if (u.isGround) continue;
      u.defend('planet');
      u.autocast = true;
    }
  }

  let ended = null;
  game.onEnd = (s) => { ended = s; };
  let t = 0;
  let crustLow = 1;
  let contact = false;

  while (!ended && t < TIME_LIMIT + 1) {
    game.step(STEP);
    attackAI.update(STEP);
    if (defenseAI) defenseAI.update(STEP);
    t += STEP;
    if (game.planet) crustLow = Math.min(crustLow, game.planet.fraction);

    if (Math.abs((t * 30) % 30) < 0.5) {
      const foe = [];
      for (const u of game.units) {
        if (u.alive && u.faction === FACTION.ATTACK) {
          for (const c of u.craft) if (c.alive) foe.push({ c, siege: u.siegeLock });
        }
      }
      // The besieged face is defined by whatever is actually bombarding; with
      // nothing sieging there is no face to be on and the sample is skipped.
      const besieger = foe.find((f) => f.siege);
      let axis = null;
      if (besieger) axis = besieger.c.pos.clone().sub(PLANET).normalize();
      let live = 0; let inRange = 0; let onFace = 0;
      for (const u of game.units) {
        if (!u.alive || u.faction !== FACTION.DEFENSE || u.isGround) continue;
        for (const c of u.craft) {
          if (!c.alive) continue;
          live++;
          if (foe.some((f) => c.pos.distanceTo(f.c.pos) <= u.stats.range)) inRange++;
          if (axis && c.pos.clone().sub(PLANET).normalize().dot(axis) > 0) onFace++;
        }
      }
      const foeUnits = game.units.filter((u) => u.alive && u.faction === FACTION.ATTACK);
      let painted = 0;
      for (const u of foeUnits) if (u.paintedFor(FACTION.DEFENSE)) painted++;
      let firing = 0;
      let speed = 0;
      for (const u of game.units) {
        if (!u.alive || u.faction !== FACTION.DEFENSE || u.isGround) continue;
        for (const c of u.craft) {
          if (!c.alive) continue;
          speed += c.speed / Math.max(1, u.stats.maxSpeed);
          if (c.target && c.target.alive
              && c.pos.distanceTo(c.target.pos) <= (c.fireRange ?? u.stats.range)) firing++;
        }
      }
      if (live) {
        samples++;
        inRangeSum += inRange / live;
        firingSum += firing / live;
        speedSum += speed / live;
        if (foeUnits.length) paintedSum += painted / foeUnits.length;
        if (axis) onFaceSum += onFace / live;
      }
    }
    for (const u of game.units) {
      if (!u.alive) continue;
      for (const c of u.craft) {
        if (c.alive && c.target && c.target.alive) contact = true;
      }
    }
    // Fog renders from the player's point of view. With the player on the
    // defence, a defending hull must never be hidden from its own side.
    if (mode === 'guard' && Math.abs(t - 60) < STEP / 2) {
      for (const u of game.units) {
        if (u.faction !== FACTION.DEFENSE) continue;
        for (const c of u.craft) {
          if (c.alive) check(c.visible, `match ${m + 1}: own defending hull not visible to the player`);
        }
      }
    }
  }

  // The two comparisons that are the other word round on the attacking side.
  if (game.planetFell) {
    planetFell++;
    check(ended === 'defeat',
      `match ${m + 1}: the world was destroyed and the defending player was told '${ended}'`);
  }
  if (game.timedOut) {
    timedOut++;
    check(ended === 'victory',
      `match ${m + 1}: the clock ran out and the defending player was told '${ended}'`);
  }
  check(ended !== null, `match ${m + 1}: no result announced`);

  if (!contact) noContact++; else everFired++;
  totalSeconds += game.now;
  crustLowSum += crustLow;
  if (ended === 'victory') outcomes.victory++;
  else if (ended === 'defeat') outcomes.defeat++;
  else if (ended === 'draw') outcomes.draw++;
  else outcomes.unresolved++;
}

  return {
    mode, outcomes, timedOut, planetFell, totalSeconds, crustLowSum, everFired, noContact,
    inRange: samples ? inRangeSum / samples : 0,
    onFace: samples ? onFaceSum / samples : 0,
    painted: samples ? paintedSum / samples : 0,
    firing: samples ? firingSum / samples : 0,
    speed: samples ? speedSum / samples : 0,
  };
}

const pct = (n) => `${((n / MATCHES) * 100).toFixed(0)}%`;
const arms = ARM === 'all' ? ['guard', 'loose', 'ai'] : [ARM];
console.log(`\n  ${MATCHES} matches · the player holds the world\n`);
console.log('  arm     holds   loses   world lost   mean length   crust low'
  + '   in range   firing   attack resolved   mean speed');
for (const a of arms) {
  const r = run(a);
  console.log(`  ${a.padEnd(6)}`
    + `  ${String(r.outcomes.victory).padStart(4)} ${pct(r.outcomes.victory).padStart(5)}`
    + `  ${String(r.outcomes.defeat).padStart(4)}`
    + `   ${String(r.planetFell).padStart(6)} ${pct(r.planetFell).padStart(5)}`
    + `   ${(r.totalSeconds / MATCHES).toFixed(0).padStart(9)}s`
    + `   ${(((r.crustLowSum / MATCHES)) * 100).toFixed(0).padStart(7)}%`
    + `   ${(r.inRange * 100).toFixed(0).padStart(7)}%`
    + `   ${(r.firing * 100).toFixed(0).padStart(5)}%`
    + `   ${(r.painted * 100).toFixed(0).padStart(14)}%`
    + `   ${(r.speed * 100).toFixed(0).padStart(9)}%`);
}
console.log(`\n  ${checks} checks run`);
if (!fails.length) console.log('  no failures\n');
else {
  console.log(`  ${fails.length} FAILURES:`);
  for (const f of fails.slice(0, 20)) console.log(`    ${f}`);
  console.log('');
  process.exitCode = 1;
}
