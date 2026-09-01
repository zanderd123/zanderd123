/**
 * Balance sweep: run the human-play scenarios across a range of settings and
 * print the win rates side by side.
 *
 * The target is not 50/50 on any single line — it is that neither chair is a
 * dominant strategy. Concretely: a person playing the defence on standing
 * orders should not be able to win most of the time, and a person playing the
 * attack should not be locked out of winning at all.
 *
 *   node tools/balance.mjs check        just measure the settings as they are
 *   node tools/balance.mjs siege        sweep SIEGE.hpPerAttackPoint
 *   node tools/balance.mjs regen        sweep SIEGE.regenPerSecond
 *   node tools/balance.mjs cruise       sweep TRANSIT.cruiseSpeed
 *   node tools/balance.mjs clock        sweep the match length
 *   node tools/balance.mjs multiplier   sweep BUDGET.attackerMultiplier
 *   node tools/balance.mjs stagger      sweep the crossing distance
 *
 * Read the columns together, never one alone. A points handicap
 * (`multiplier`) looks great in the first column and then blows the third one
 * out, because in a symmetric fleet fight combat power scales superlinearly
 * with numbers — so +30% points is close to decisive. Levers that add no
 * combat power (`siege`, `clock`) move the attacking role without touching an
 * even engagement, which is what this game actually needs.
 */
import { Game } from '../src/game.js';
import { Commander, generateFleet } from '../src/ai.js';
import { FACTION, TIME_LIMIT, BUDGET, WORLD, SIEGE, TRANSIT, budgetFor } from '../src/config.js';
import * as THREE from 'three';

const PLANET = new THREE.Vector3(...WORLD.planetCenter);

const noopFx = {
  build() {}, disposeBatches() {}, update() {}, emitTrails() {},
  explode() {}, impact() {}, bubble() {}, syncShields() {}, applyGfx() {},
  tracers: { begin() {}, push() {}, end() {} },
};

const MATCHES = Number(process.env.MATCHES || 24);
const POINTS = Number(process.env.POINTS || 1000);
const DIFFICULTY = process.env.DIFFICULTY || 'medium';
const STEP = 1 / 30;

/**
 * One match. `human` is the side on standing orders; the other side gets a
 * Commander. `human = null` runs AI against AI.
 */
function play(seed, human, timeLimit = TIME_LIMIT) {
  const game = new Game(noopFx, { seed, fog: true, timeLimit });
  game.reset();
  const attackRoster = generateFleet(budgetFor(FACTION.ATTACK, POINTS), 'attack', seed);
  const defenseRoster = generateFleet(budgetFor(FACTION.DEFENSE, POINTS), 'defense', seed + 1);

  // playerFaction only decides which way `victory`/`defeat` reads.
  const player = human || FACTION.ATTACK;
  const playerRoster = player === FACTION.ATTACK ? attackRoster : defenseRoster;
  const otherRoster = player === FACTION.ATTACK ? defenseRoster : attackRoster;
  game.start(playerRoster, otherRoster, player);
  game.state = 'playing';

  const commanders = [];
  if (human) {
    const ai = human === FACTION.DEFENSE ? FACTION.ATTACK : FACTION.DEFENSE;
    commanders.push(new Commander(game, ai, DIFFICULTY));
    // The standing order each chair actually gets given, once, and never
    // revisited. A defending player presses G and leaves it; an attacking
    // player sends the fleet at the objective on ATTACK. Using DEFEND for
    // both would test a move nobody makes.
    const standingOrder = (u) => {
      u.autocast = true;
      if (human === FACTION.DEFENSE) u.defend('planet');
      else u.order(PLANET, { attack: null, stance: 'attack' });
    };
    for (const u of game.units) if (u.faction === human) standingOrder(u);
    game.onHatch = (parent, brood) => {
      if (brood.faction === human) standingOrder(brood);
    };
  } else {
    commanders.push(new Commander(game, FACTION.ATTACK, DIFFICULTY));
    commanders.push(new Commander(game, FACTION.DEFENSE, DIFFICULTY));
  }

  let ended = null;
  game.onEnd = (state) => { ended = state; };
  let t = 0;
  while (!ended && t < timeLimit + 1) {
    game.step(STEP);
    for (const c of commanders) c.update(STEP);
    t += STEP;
  }

  // Resolve to a faction, so every scenario reports on the same axis.
  if (game.timedOut) return FACTION.DEFENSE;
  if (ended === 'victory') return player;
  if (ended === 'defeat') return player === FACTION.ATTACK ? FACTION.DEFENSE : FACTION.ATTACK;
  return null;
}

/** Attacker win rate, as a percentage, over MATCHES seeds. */
function attackerWinRate(human, timeLimit) {
  let wins = 0;
  for (let m = 0; m < MATCHES; m++) {
    if (play(1000 + m * 137, human, timeLimit) === FACTION.ATTACK) wins++;
  }
  return (wins / MATCHES) * 100;
}

function row(label, timeLimit = TIME_LIMIT) {
  const parked = attackerWinRate(FACTION.DEFENSE, timeLimit);  // human parks on defence
  const pushing = attackerWinRate(FACTION.ATTACK, timeLimit);  // human parks on attack
  const even = attackerWinRate(null, timeLimit);               // AI both sides
  const bar = (v) => '#'.repeat(Math.round(v / 4)).padEnd(25);
  console.log(`  ${String(label).padEnd(10)}`
    + `${parked.toFixed(0).padStart(4)}%  ${bar(parked)}`
    + `${pushing.toFixed(0).padStart(5)}%  ${even.toFixed(0).padStart(5)}%`);
  return { parked, pushing, even };
}

function header(title) {
  console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`);
  console.log(`  ${MATCHES} matches a cell · ${POINTS}pts · ${DIFFICULTY}`);
  console.log('  ATTACKER win rate in three scenarios:\n');
  console.log(`  ${''.padEnd(10)}${'vs parked defence'.padEnd(31)}`
    + `${'as attacker'.padStart(6)}  ${'AI v AI'.padStart(6)}`);
}

const mode = process.argv[2] || 'check';

if (mode === 'check') {
  header(`CURRENT SETTINGS  (attackerMultiplier ${BUDGET.attackerMultiplier})`);
  row('now');
} else if (mode === 'multiplier') {
  header('SWEEP: BUDGET.attackerMultiplier');
  const original = BUDGET.attackerMultiplier;
  for (const m of [1, 1.15, 1.3, 1.45, 1.6]) {
    BUDGET.attackerMultiplier = m;
    row(`x${m}`);
  }
  BUDGET.attackerMultiplier = original;
} else if (mode === 'siege') {
  // The attacker's OTHER win condition. Unlike a points handicap this adds no
  // combat power, so it cannot inflate an even fleet fight — it only makes
  // bombardment a route that is actually worth taking.
  header('SWEEP: SIEGE.hpPerAttackPoint (how tough the planet is)');
  const original = SIEGE.hpPerAttackPoint;
  for (const hp of [6, 4.5, 3, 2, 1.5]) {
    SIEGE.hpPerAttackPoint = hp;
    row(`${hp}/pt`);
  }
  SIEGE.hpPerAttackPoint = original;
} else if (mode === 'cruise') {
  // The transit cruise floor: how fast a slow hull makes way on a long march.
  header('SWEEP: TRANSIT.cruiseSpeed (arrival cohesion)');
  const original = TRANSIT.cruiseSpeed;
  for (const v of [0, 60, 78, 95, 110]) {
    // 0 disables the floor entirely, reproducing the old speed-ordered arrival.
    TRANSIT.cruiseSpeed = v;
    row(v === 0 ? 'off' : `${v}u/s`);
  }
  TRANSIT.cruiseSpeed = original;
} else if (mode === 'regen') {
  // The crust knits back together at `regenPerSecond` of FULL health per
  // second once it has been left alone for `regenDelay`. At the shipped 0.6%
  // that is ~39 HP/s on a 6,500 HP planet — comparable to the whole
  // bombardment's output — so siege damage evaporates instead of accumulating.
  header('SWEEP: SIEGE.regenPerSecond (how fast the crust heals)');
  const original = SIEGE.regenPerSecond;
  for (const r of [0.006, 0.003, 0.0015, 0]) {
    SIEGE.regenPerSecond = r;
    row(`${(r * 100).toFixed(2)}%/s`);
  }
  SIEGE.regenPerSecond = original;
} else if (mode === 'clock') {
  // A timeout currently hands the defender an outright win. Shortening the
  // match makes that edge bite sooner; lengthening it gives the attacker more
  // time to convert. Neither adds combat power either.
  header('SWEEP: time limit (a timeout is a DEFENDER win)');
  for (const limit of [600, 750, 900]) row(`${limit}s`, limit);
} else if (mode === 'stagger') {
  header('SWEEP: attacker start distance (arrival stagger)');
  const original = [...WORLD.attackAnchor];
  for (const z of [-3900, -3400, -2900, -2400]) {
    WORLD.attackAnchor[2] = z;
    row(`z=${z}`);
  }
  WORLD.attackAnchor[0] = original[0];
  WORLD.attackAnchor[1] = original[1];
  WORLD.attackAnchor[2] = original[2];
}
console.log('');
