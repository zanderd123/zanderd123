/**
 * Does the battle play the same at 8x as it does at 1x?
 *
 * The sim runs on a fixed timestep and the speed control multiplies how many
 * steps are taken per frame rather than the step size, specifically so that
 * the answer is yes — game.js says as much at the top of the file. Nothing has
 * ever checked it, and there is one place the two clocks can come apart: the
 * simulation advances in whole 1/30s chunks, while the AI commander is updated
 * once per FRAME with dt * speed. At 1x a frame buys the commander half a
 * step; at 8x it buys four. If the commander's think timer therefore lands in
 * a different place relative to the steps, the fleets get their orders at
 * different moments and the battle diverges — which the player would see as
 * the game playing differently depending on which speed they happened to be
 * watching at.
 *
 * This replays one seed at each speed through the real frame loop and compares
 * a checksum of the whole board, taken at fixed simulated times so the
 * comparison is between identical moments.
 *
 *   node tools/speed.mjs [matches]
 */
import * as THREE from 'three';
import { Game } from '../src/game.js';
import { Commander, generateFleet } from '../src/ai.js';
import { FACTION, WORLD, budgetFor } from '../src/config.js';

const noopFx = {
  build() {}, disposeBatches() {}, update() {}, emitTrails() {},
  explode() {}, impact() {}, bubble() {}, syncShields() {}, applyGfx() {},
  tracers: { begin() {}, push() {}, end() {} },
};

const MATCHES = Number(process.argv[2] || 20);
const SPEEDS = [1, 2, 4, 8];
const FRAME = 1 / 60;
const UNTIL = 120;          // simulated seconds to compare over
const SAMPLE = 10;          // checksum every N simulated seconds
const PLANET = new THREE.Vector3(...WORLD.planetCenter);

/**
 * A number that changes if anything about the board changes. Positions are
 * quantised to 1/1000 so the checksum is about the simulation and not about
 * floating-point noise in the last bit.
 */
function checksum(game) {
  let h = 2166136261 >>> 0;
  const mix = (x) => {
    h ^= Math.round(x * 1000) | 0;
    h = Math.imul(h, 16777619) >>> 0;
  };
  for (const u of game.units) {
    mix(u.alive ? 1 : 0);
    for (const c of u.craft) {
      mix(c.alive ? 1 : 0);
      mix(c.pos.x); mix(c.pos.y); mix(c.pos.z);
      mix(c.hp);
    }
  }
  mix(game.projectiles.list.length);
  mix(game.planet ? game.planet.hp : 0);
  mix(game.kills.attack); mix(game.kills.defense);
  return h;
}

/**
 * Play one seed at one speed.
 *
 * `tick` picks where the AI's clock comes from. 'shipped' is what main.js now
 * does: the commander rides the game's own onStep hook, once per fixed step.
 * 'frame' is what it used to do — one update per rendered frame, of
 * dt * speed — kept as the contrast that shows why this matters.
 */
function play(seed, speed, tick = 'shipped') {
  const game = new Game(noopFx, { seed, fog: true });
  game.reset();
  game.start(
    generateFleet(budgetFor(FACTION.ATTACK, 1000), 'attack', seed),
    generateFleet(budgetFor(FACTION.DEFENSE, 1000), 'defense', seed + 1),
    FACTION.ATTACK,
  );
  game.state = 'playing';
  game.speed = speed;
  const a = new Commander(game, FACTION.ATTACK, 'medium');
  const d = new Commander(game, FACTION.DEFENSE, 'medium');

  // Sample by STEP COUNT, not by clock.
  //
  // The obvious version of this — checksum on the first frame where game.now
  // passes 10s — compares different moments at different speeds. A 1x frame
  // buys half a step so it lands on the mark; an 8x frame buys four and
  // overshoots it by up to three. That version reported all sixty comparisons
  // diverging at the first sample, which was the sampler talking, not the
  // simulation. Counting steps makes the two runs comparable by construction.
  const marks = [];
  const every = Math.round(SAMPLE / (1 / 30));
  let steps = 0;
  const realStep = game.step.bind(game);
  if (tick === 'shipped') {
    game.onStep = (step) => { a.update(step); d.update(step); };
  }
  game.step = (dt) => {
    realStep(dt);
    steps++;
    if (steps % every === 0) marks.push({ at: steps, sum: checksum(game) });
  };

  // Exactly what main.js does every frame, and in that order.
  while (game.now < UNTIL && game.state === 'playing') {
    game.update(FRAME);
    if (tick === 'frame' && game.state === 'playing') {
      a.update(FRAME * game.speed);
      d.update(FRAME * game.speed);
    }
  }
  return { marks, state: game.state, now: game.now };
}

for (const tick of ['shipped', 'frame']) {
let diverged = 0;
const firstDivergence = [];

for (let m = 0; m < MATCHES; m++) {
  const seed = 1000 + m * 137;
  const base = play(seed, SPEEDS[0], tick);
  for (const speed of SPEEDS.slice(1)) {
    const run = play(seed, speed, tick);
    const n = Math.min(base.marks.length, run.marks.length);
    let at = null;
    for (let i = 0; i < n; i++) {
      if (base.marks[i].sum !== run.marks[i].sum) { at = base.marks[i].at; break; }
    }
    if (at === null && base.marks.length !== run.marks.length) {
      at = Math.min(base.marks.length, run.marks.length) * 30 * SAMPLE;
    }
    if (at !== null) {
      diverged++;
      firstDivergence.push({ m: m + 1, speed, at });
    }
  }
}

const comparisons = MATCHES * (SPEEDS.length - 1);
console.log(`\n  ${MATCHES} seeds · ${SPEEDS.join('x, ')}x · compared every ${SAMPLE}s to ${UNTIL}s`);
console.log(`  AI clock: ${tick === 'shipped'
  ? "the game's own step hook (what main.js does now)"
  : 'once per rendered frame, dt x speed (what it used to do)'}\n`);
console.log(`  comparisons          ${comparisons}`);
console.log(`  identical throughout ${comparisons - diverged}`);
console.log(`  diverged             ${diverged}`);
if (firstDivergence.length) {
  console.log('\n  first point of difference:');
  const byWhen = new Map();
  for (const d of firstDivergence) byWhen.set(d.at, (byWhen.get(d.at) || 0) + 1);
  for (const [at, c] of [...byWhen].sort((a, b) => a[0] - b[0])) {
    console.log(`    step ${String(at).padStart(5)} (${(at / 30).toFixed(0)}s)   ${c} runs`);
  }
  console.log('\n  examples:');
  for (const d of firstDivergence.slice(0, 8)) {
    console.log(`    seed ${1000 + (d.m - 1) * 137}  at ${d.speed}x  differs from step ${d.at} (${(d.at / 30).toFixed(0)}s)`);
  }
}
console.log('');
}
