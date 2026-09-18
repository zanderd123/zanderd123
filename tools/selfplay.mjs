/**
 * Headless self-play: run whole battles with an AI on both sides.
 *
 * This is the check the browser smoke test cannot give cheaply — a full match
 * takes minutes of wall clock in a real page, and dozens of them is the only
 * way to see whether battles actually resolve, and which side wins.
 *
 *   node tools/selfplay.mjs [matches] [budget] [difficulty]
 */
import { Game } from '../src/game.js';
import { Commander, generateFleet } from '../src/ai.js';
import { FACTION, TIME_LIMIT, budgetFor } from '../src/config.js';
import { SCOUTING, SALVO } from '../src/config.js';

/** A renderer that does nothing, so the simulation can run outside a browser. */
const noopFx = {
  build() {}, disposeBatches() {}, update() {}, emitTrails() {},
  explode() {}, impact() {}, bubble() {}, syncShields() {}, applyGfx() {},
  tracers: { begin() {}, push() {}, end() {} },
};

const MATCHES = Number(process.argv[2] || 20);
const BUDGET = Number(process.argv[3] || 1000);
const DIFFICULTY = process.argv[4] || 'medium';
const STEP = 1 / 30;

// NOSALVO=1 turns the salvo layer off in place for an A/B.
if (process.env.NOSALVO) SALVO.enabled = false;
// SALVO_PREMIUM sweeps how much better concentrated damage is than spread.
if (process.env.SALVO_PREMIUM) SALVO.premium = Number(process.env.SALVO_PREMIUM);
if (process.env.SALVO_CHARGE) SALVO.charge = Number(process.env.SALVO_CHARGE);

// NOSCOUT=1 neutralises the scouting rule in place, so the same seeds can be
// played with and without it.
if (process.env.NOSCOUT) {
  SCOUTING.unpaintedRangeFactor = 1;
  SCOUTING.paintedBonus = 0;
  SCOUTING.unpaintedPenalty = 0;
  SCOUTING.focusUnpainted = SCOUTING.focusPainted;
  SCOUTING.gateFocusOnPaint = false;
}

const tally = { attack: 0, defense: 0, timeout: 0, draw: 0 };
let totalSeconds = 0;
let totalPlanet = 0;

for (let m = 0; m < MATCHES; m++) {
  const seed = 1000 + m * 137;
  const game = new Game(noopFx, { seed, fog: true });
  game.reset();
  const attackRoster = generateFleet(
    budgetFor(FACTION.ATTACK, BUDGET), 'attack', seed);
  const defenseRoster = generateFleet(
    budgetFor(FACTION.DEFENSE, BUDGET), 'defense', seed + 1);
  // playerFaction is ATTACK, but both sides get a Commander — nobody is
  // driving from the UI here.
  game.start(attackRoster, defenseRoster, FACTION.ATTACK);
  game.state = 'playing';

  const attackAI = new Commander(game, FACTION.ATTACK, DIFFICULTY);
  const defenseAI = new Commander(game, FACTION.DEFENSE, DIFFICULTY);

  let ended = null;
  game.onEnd = (state) => { ended = state; };

  let t = 0;
  while (!ended && t < TIME_LIMIT + 1) {
    game.step(STEP);
    attackAI.update(STEP);
    defenseAI.update(STEP);
    t += STEP;
  }

  // `victory`/`defeat` are relative to playerFaction, which is ATTACK here.
  let winner;
  if (game.timedOut) { winner = 'timeout'; tally.timeout++; }
  else if (ended === 'victory') { winner = 'attack'; tally.attack++; }
  else if (ended === 'defeat') { winner = 'defense'; tally.defense++; }
  else { winner = 'draw'; tally.draw++; }

  totalSeconds += game.now;
  const planet = game.planet ? game.planet.fraction : 1;
  totalPlanet += planet;

  console.log(`  match ${String(m + 1).padStart(2)}  ${winner.padEnd(8)}`
    + ` at ${game.now.toFixed(0).padStart(3)}s`
    + `  planet ${(planet * 100).toFixed(0).padStart(3)}%`
    + `  kills ${game.kills.attack}/${game.kills.defense}`);
}

// A timeout is a defender win by the rules, so report both readings.
const defenderWins = tally.defense + tally.timeout;
console.log(`\n  ${MATCHES} matches at ${BUDGET}pts, ${DIFFICULTY}`);
console.log(`  attacker wins  ${tally.attack}  (${((tally.attack / MATCHES) * 100).toFixed(0)}%)`);
console.log(`  defender wins  ${defenderWins}  (${((defenderWins / MATCHES) * 100).toFixed(0)}%)`
  + `  — ${tally.defense} by destruction, ${tally.timeout} on the clock`);
if (tally.draw) console.log(`  draws          ${tally.draw}`);
console.log(`  mean length    ${(totalSeconds / MATCHES).toFixed(0)}s`);
console.log(`  mean planet    ${((totalPlanet / MATCHES) * 100).toFixed(0)}%`);
