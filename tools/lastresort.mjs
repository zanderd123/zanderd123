/**
 * How often is the attacker left with hulls that COULD break the crust and
 * nothing that tells them to?
 *
 * Two different predicates gate bombardment:
 *   canSiege     — any flying squadron with a weapon. This is what the damage
 *                  code checks, so it is what can actually hurt the planet.
 *   siegeCapital — the narrower "worth committing" test: heavy, penetrating,
 *                  not a sniper. This is what the auto-siege trigger and the
 *                  AI's siege planner both read.
 *
 * Between the two lies a state nobody planned for: the heavies are dead, the
 * light hulls are alive and in orbit, and nothing in the game will ever tell
 * them to shoot the objective. The attacker cannot win and the clock still has
 * to run out. Match 57 of the audit spends its last 220 seconds there, with a
 * carrier hovering over an untouched crust feeding wasps to a Flak Walker one
 * at a time.
 *
 *   node tools/lastresort.mjs [matches]
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
const STEP = 1 / 30;
const PLANET = new THREE.Vector3(...WORLD.planetCenter);

let matchesInState = 0;
let secondsInState = 0;
let longest = { secs: 0, m: 0 };
const cases = [];
let timedOut = 0;
let attackerWins = 0;

for (let m = 0; m < MATCHES; m++) {
  const seed = 1000 + m * 137;
  const game = new Game(noopFx, { seed, fog: true });
  game.reset();
  game.start(
    generateFleet(budgetFor(FACTION.ATTACK, 1000), 'attack', seed),
    generateFleet(budgetFor(FACTION.DEFENSE, 1000), 'defense', seed + 1),
    FACTION.ATTACK,
  );
  game.state = 'playing';
  const handPlayed = m % 2 === 1;
  const attackAI = handPlayed ? null : new Commander(game, FACTION.ATTACK, 'medium');
  const defenseAI = new Commander(game, FACTION.DEFENSE, 'medium');
  if (handPlayed) {
    for (const u of game.units) {
      if (u.faction !== FACTION.ATTACK || u.broodOf) continue;
      u.order(PLANET, { stance: 'attack' });
      u.autocast = true;
    }
  }

  let ended = null;
  game.onEnd = (s) => { ended = s; };
  let t = 0;
  let inState = 0;
  let startedAt = null;
  let crustAtStart = 1;

  while (!ended && t < TIME_LIMIT + 1) {
    game.step(STEP);
    if (attackAI) attackAI.update(STEP);
    defenseAI.update(STEP);
    t += STEP;

    const live = game.units.filter((u) => u.alive && u.faction === FACTION.ATTACK);
    const heavies = live.filter((u) => u.siegeCapital).length;
    const armed = live.filter((u) => u.canSiege).length;
    const sieging = live.some((u) => u.siegeLock);
    if (armed > 0 && heavies === 0 && !sieging) {
      if (startedAt === null) { startedAt = t; crustAtStart = game.planet.fraction; }
      inState += STEP;
    } else if (startedAt !== null) {
      startedAt = null;
    }
  }

  if (inState > 0) {
    matchesInState++;
    secondsInState += inState;
    if (inState > longest.secs) longest = { secs: inState, m: m + 1 };
    if (inState > 30) {
      cases.push({
        m: m + 1, hand: handPlayed, secs: inState,
        from: startedAt, crust: crustAtStart,
        crustEnd: game.planet.fraction, ended, length: game.now,
      });
    }
  }
  if (game.timedOut) timedOut++;
  if (ended === 'victory') attackerWins++;
}

console.log(`\n  ${MATCHES} matches\n`);
console.log(`  attacker wins                          ${attackerWins}`);
console.log(`  ran out the clock                      ${timedOut}`);
console.log(`  matches that entered the gap           ${matchesInState}`
  + `  ${((matchesInState / MATCHES) * 100).toFixed(0)}%`);
console.log(`  mean seconds spent there (all matches) ${(secondsInState / MATCHES).toFixed(1)}s`);
console.log(`  longest single stretch                 ${longest.secs.toFixed(0)}s (match ${longest.m})`);
console.log(`\n  stretches over 30s — armed hulls in orbit, nothing telling them to shoot:`);
if (!cases.length) console.log('    none');
for (const c of cases.sort((a, b) => b.secs - a.secs)) {
  console.log(`    match ${String(c.m).padStart(3)} ${c.hand ? 'hand' : 'AI  '}`
    + `  ${c.secs.toFixed(0).padStart(4)}s`
    + `   crust ${(c.crust * 100).toFixed(0)}% -> ${(c.crustEnd * 100).toFixed(0)}%`
    + `   match ended '${c.ended}' at ${c.length.toFixed(0)}s`);
}
console.log('');
