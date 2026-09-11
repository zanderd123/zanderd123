/**
 * Does the bombardment win condition actually function?
 *
 * The game is called Siege of Kepler-9, so the attacker is supposed to have a
 * second route to victory: grind the crust instead of destroying the fleet.
 * Win-rate sweeps could not see whether that route works, because they only
 * report who won — and sweeping planet HP or crust regen moved the win rate
 * not at all, which could equally have meant "the planet is irrelevant" or
 * "the planet is never even shot at".
 *
 * This measures the mechanism directly: how long attackers stay locked into a
 * bombardment, how many shells they actually get off, how close they get, and
 * how much crust that removes. Run it after any change to SIEGE, to the AI's
 * manageSiege, or to how long an attacker survives near the planet.
 *
 *   node tools/siege-probe.mjs [matches] [budget]
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

const MATCHES = Number(process.argv[2] || 8);
const POINTS = Number(process.argv[3] || 1000);
const STEP = 1 / 30;
const PLANET = new THREE.Vector3(...WORLD.planetCenter);

let everLocked = 0;
let planetFell = 0;
let everDamaged = 0;
let totalLockSecs = 0;
let totalShots = 0;
let totalWorstFraction = 0;

for (let m = 0; m < MATCHES; m++) {
  const seed = 1000 + m * 137;
  const game = new Game(noopFx, { seed, fog: true });
  game.reset();
  // The hard case: a human defence that simply parks on the objective.
  game.start(
    generateFleet(budgetFor(FACTION.DEFENSE, POINTS), 'defense', seed + 1),
    generateFleet(budgetFor(FACTION.ATTACK, POINTS), 'attack', seed),
    FACTION.DEFENSE,
  );
  game.state = 'playing';
  const ai = new Commander(game, FACTION.ATTACK, 'medium');
  for (const u of game.units) {
    if (u.faction !== FACTION.DEFENSE) continue;
    u.defend('planet');
    u.autocast = true;
  }

  // Count shells aimed at the crust, by wrapping the projectile spawner.
  let shots = 0;
  const originalFire = game.projectiles.fire.bind(game.projectiles);
  game.projectiles.fire = (craft, target, guided, dmg) => {
    if (target && target.isPlanet) shots++;
    return originalFire(craft, target, guided, dmg);
  };

  let ended = null;
  game.onEnd = (state) => { ended = state; };

  const full = game.planet ? game.planet.maxHealth : 0;
  let lockSecs = 0;
  let inRangeSecs = 0;
  let closest = Infinity;
  // The planet regenerates, so the final reading understates the damage done —
  // track the low-water mark instead.
  let worst = 1;

  let t = 0;
  while (!ended && t < TIME_LIMIT + 1) {
    game.step(STEP);
    ai.update(STEP);
    t += STEP;
    let anyLocked = false;
    for (const u of game.units) {
      if (!u.alive || u.faction !== FACTION.ATTACK || !u.siegeLock) continue;
      anyLocked = true;
      for (const c of u.craft) {
        if (!c.alive) continue;
        const d = c.pos.distanceTo(PLANET);
        if (d < closest) closest = d;
        if (d - WORLD.planetRadius <= u.stats.range) inRangeSecs += STEP;
      }
    }
    if (anyLocked) lockSecs += STEP;
    if (game.planet) worst = Math.min(worst, game.planet.fraction);
  }

  if (game.planetFell) planetFell++;
  if (lockSecs > 0) everLocked++;
  if (worst < 0.999) everDamaged++;
  totalLockSecs += lockSecs;
  totalShots += shots;
  totalWorstFraction += worst;

  console.log(`  match ${String(m + 1).padStart(2)}`
    + `  locked ${lockSecs.toFixed(0).padStart(3)}s`
    + `  hull-seconds in range ${inRangeSecs.toFixed(0).padStart(4)}`
    + `  shells ${String(shots).padStart(4)}`
    + `  closest ${closest === Infinity ? '  n/a' : `${closest.toFixed(0)}u`.padStart(6)}`
    + `  crust low-water ${(worst * 100).toFixed(0).padStart(3)}%`);
}

console.log(`\n  ${everLocked}/${MATCHES} matches where a bombardment was ever established`);
console.log(`  ${everDamaged}/${MATCHES} matches where the crust took ANY damage`);
console.log(`  ${planetFell}/${MATCHES} matches WON by destroying the planet`);
console.log(`  mean seconds locked   ${(totalLockSecs / MATCHES).toFixed(0)} of ${TIME_LIMIT}`);
console.log(`  mean shells fired     ${(totalShots / MATCHES).toFixed(0)}`);
console.log(`  mean crust low-water  ${((totalWorstFraction / MATCHES) * 100).toFixed(0)}%`);
console.log('\n  A healthy siege route should show the crust well below 100% in a'
  + ' decent share of matches.\n  If it sits at 100%, bombardment is decorative and'
  + ' tuning SIEGE will change nothing.');
