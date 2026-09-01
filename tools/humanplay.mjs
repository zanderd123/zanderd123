/**
 * The scenario a human actually plays, which self-play never produces.
 *
 * `tools/selfplay.mjs` puts a Commander on both sides and comes out roughly
 * even — but a Commander never parks. It reissues move orders every tick, so
 * its squadrons are always in motion and never sit on DEFEND.
 *
 * A person does the opposite. Selecting the whole fleet, pressing G, and
 * leaving it there is the single most common way to play the defence, and it
 * is the case that keeps winning. This harness reproduces exactly that: one
 * side is driven by the AI, the other is set once and never touched again.
 *
 *   node tools/humanplay.mjs [matches] [budget] [difficulty] [side]
 *
 * `side` is the side the *human* plays — defense (the default) or attack, so
 * the same standing-order strategy can be measured from both chairs.
 */
import { Game } from '../src/game.js';
import { Commander, generateFleet } from '../src/ai.js';
import { FACTION, TIME_LIMIT, budgetFor } from '../src/config.js';

const noopFx = {
  build() {}, disposeBatches() {}, update() {}, emitTrails() {},
  explode() {}, impact() {}, bubble() {}, syncShields() {}, applyGfx() {},
  tracers: { begin() {}, push() {}, end() {} },
};

const MATCHES = Number(process.argv[2] || 30);
const BUDGET = Number(process.argv[3] || 1000);
const DIFFICULTY = process.argv[4] || 'medium';
const HUMAN = process.argv[5] || 'defense';
const STEP = 1 / 30;

const AI_SIDE = HUMAN === 'defense' ? FACTION.ATTACK : FACTION.DEFENSE;

const tally = { human: 0, ai: 0, timeout: 0, draw: 0 };
let totalSeconds = 0;
let humanHullsLeft = 0;
let aiHullsLeft = 0;

for (let m = 0; m < MATCHES; m++) {
  const seed = 1000 + m * 137;
  const game = new Game(noopFx, { seed, fog: true });
  game.reset();

  const attackRoster = generateFleet(budgetFor(FACTION.ATTACK, BUDGET), 'attack', seed);
  const defenseRoster = generateFleet(budgetFor(FACTION.DEFENSE, BUDGET), 'defense', seed + 1);
  const humanRoster = HUMAN === 'defense' ? defenseRoster : attackRoster;
  const enemyRoster = HUMAN === 'defense' ? attackRoster : defenseRoster;

  game.start(humanRoster, enemyRoster, HUMAN);
  game.state = 'playing';

  // Only the AI side gets a commander. The human side is set once, below.
  const ai = new Commander(game, AI_SIDE, DIFFICULTY);

  // The standing order, given once and never revisited: everything defends
  // the planet, and nothing is ever told to move again.
  for (const u of game.units) {
    if (u.faction !== HUMAN) continue;
    u.defend('planet');
    u.autocast = true;
  }

  let ended = null;
  game.onEnd = (state) => { ended = state; };

  // A carrier's brood is born without orders; a person would give it the same
  // standing order, so newly hatched squadrons inherit it.
  game.onHatch = (parent, brood) => {
    if (brood.faction === HUMAN) { brood.defend('planet'); brood.autocast = true; }
  };

  let t = 0;
  while (!ended && t < TIME_LIMIT + 1) {
    game.step(STEP);
    ai.update(STEP);
    t += STEP;
  }

  const hulls = (f) => game.units
    .filter((u) => u.faction === f && u.alive)
    .reduce((s, u) => s + u.count, 0);
  const mine = hulls(HUMAN);
  const theirs = hulls(AI_SIDE);
  humanHullsLeft += mine;
  aiHullsLeft += theirs;

  // A timeout is a defender win by the rules, so it counts for whoever is
  // holding — which may be the AI.
  let winner;
  if (game.timedOut) {
    if (HUMAN === 'defense') { winner = 'human (clock)'; tally.human++; }
    else { winner = 'ai (clock)'; tally.ai++; }
    tally.timeout++;
  } else if (ended === 'victory') { winner = 'human'; tally.human++; }
  else if (ended === 'defeat') { winner = 'ai'; tally.ai++; }
  else { winner = 'draw'; tally.draw++; }

  totalSeconds += game.now;
  console.log(`  match ${String(m + 1).padStart(2)}  ${winner.padEnd(13)}`
    + ` at ${game.now.toFixed(0).padStart(3)}s`
    + `  hulls ${String(mine).padStart(3)} v ${String(theirs).padStart(3)}`
    + `  kills ${game.kills[HUMAN]}/${game.kills[AI_SIDE]}`);
}

const pct = (n) => `${((n / MATCHES) * 100).toFixed(0)}%`;
console.log(`\n  ${MATCHES} matches · human plays ${HUMAN.toUpperCase()} on standing orders`
  + ` · ${BUDGET}pts · ${DIFFICULTY}`);
console.log(`  human wins  ${String(tally.human).padStart(3)}  (${pct(tally.human)})`);
console.log(`  AI wins     ${String(tally.ai).padStart(3)}  (${pct(tally.ai)})`);
if (tally.draw) console.log(`  draws       ${String(tally.draw).padStart(3)}`);
console.log(`  ${tally.timeout} decided on the clock`);
console.log(`  mean length      ${(totalSeconds / MATCHES).toFixed(0)}s`);
console.log(`  mean hulls left  human ${(humanHullsLeft / MATCHES).toFixed(1)}`
  + `  ·  AI ${(aiHullsLeft / MATCHES).toFixed(1)}`);
