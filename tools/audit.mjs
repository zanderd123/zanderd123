/**
 * Behavioural audit: things that are legal but wrong.
 *
 * `tools/invariants.mjs` asserts what must never be true — NaN, overheal,
 * hulls inside the planet. This looks for the other kind of bug, the kind that
 * breaks no rule and still means the game is not working: dead air where
 * nothing is shooting, squadrons that spend a whole match contributing
 * nothing, fleets that never reach each other. Every real defect found from a
 * player's session report this month was of that kind, and none of them would
 * have tripped an assertion.
 *
 * Half the matches are played by hand on the attacking side, for the same
 * reason invariants.mjs does it: with a Commander on both sides the player
 * code path never executes.
 *
 *   node tools/audit.mjs [matches] [budget] [difficulty]
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

const MATCHES = Number(process.argv[2] || 50);
const POINTS = Number(process.argv[3] || 1000);
const DIFFICULTY = process.argv[4] || 'medium';
const STEP = 1 / 30;
const PLANET = new THREE.Vector3(...WORLD.planetCenter);

/** Seconds of no shots anywhere before it counts as the battle having stalled. */
const DEAD_AIR = 25;

const outcomes = { victory: 0, defeat: 0, draw: 0, unresolved: 0 };
let timedOut = 0;
let totalSeconds = 0;
let crustLowSum = 0;
let everSieged = 0;
// Squadrons that fired nothing all match, by type.
const silent = new Map();
const built = new Map();
// Dead-air stretches: how long, and when.
const stalls = [];
// Matches where the two fleets never made contact at all.
let noContact = 0;
const sweepWhileThreatened = [];
let handPlayedCount = 0;

// Salvo behaviour. A capital that never throws, or one that sits at full
// charge for minutes because it never gets a launch window, is the legal-but-
// wrong shape of fault the assertions cannot see.
let capitals = 0;
let capitalsSilent = 0;
let salvosThrown = 0;
let salvosStopped = 0;
let stalledTicks = 0;
let chargedTicks = 0;
const heldTooLong = [];

const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);

for (let m = 0; m < MATCHES; m++) {
  const seed = 1000 + m * 137;
  const game = new Game(noopFx, { seed, fog: true });
  game.reset();
  game.start(
    generateFleet(budgetFor(FACTION.ATTACK, POINTS), 'attack', seed),
    generateFleet(budgetFor(FACTION.DEFENSE, POINTS), 'defense', seed + 1),
    FACTION.ATTACK,
  );
  game.state = 'playing';

  const handPlayed = m % 2 === 1;
  if (handPlayed) handPlayedCount++;
  const attackAI = handPlayed ? null : new Commander(game, FACTION.ATTACK, DIFFICULTY);
  const defenseAI = new Commander(game, FACTION.DEFENSE, DIFFICULTY);
  if (handPlayed) {
    for (const u of game.units) {
      if (u.faction !== FACTION.ATTACK || u.broodOf) continue;
      u.order(PLANET, { stance: 'attack' });
      u.autocast = true;
    }
  }

  // Track shots by watching damage dealt, which is what actually matters —
  // a squadron whose rounds all miss is still participating.
  const everFired = new Set();
  for (const u of game.units) bump(built, u.type.id);

  const threw = new Set();
  game.onSalvo = (unit, target, rounds, intercepted, landed) => {
    salvosThrown++;
    threw.add(unit.id);
    if (!landed) salvosStopped++;
  };
  // Per-craft: how long has this hull been sitting at a full charge?
  const fullSince = new Map();
  const longest = new Map();

  let ended = null;
  game.onEnd = (s) => { ended = s; };
  let t = 0;
  let lastShotAt = 0;
  let worstStall = 0;
  let worstStallAt = 0;
  let contact = false;
  let crustLow = 1;
  let sieged = false;

  while (!ended && t < TIME_LIMIT + 1) {
    const before = game.projectiles.list.length;
    game.step(STEP);
    if (attackAI) attackAI.update(STEP);
    defenseAI.update(STEP);
    t += STEP;

    // Anything in flight, or anyone holding a target, counts as live combat.
    let live = game.projectiles.list.length > 0 || before > 0;
    for (const u of game.units) {
      if (!u.alive) continue;
      if (u.siegeLock) { sieged = true; live = true; }
      for (const c of u.craft) {
        if (c.alive && c.target && c.target.alive) { live = true; everFired.add(u.id); }
      }
    }
    if (live) {
      contact = true;
      const gap = t - lastShotAt;
      if (contact && gap > worstStall) { worstStall = gap; worstStallAt = lastShotAt; }
      lastShotAt = t;
    }
    if (game.planet) crustLow = Math.min(crustLow, game.planet.fraction);

    for (const u of game.units) {
      if (!u.alive || !u.hasSalvo) continue;
      for (const c of u.craft) {
        if (!c.alive) continue;
        if (c.salvoCharge >= 1) {
          chargedTicks++;
          const since = fullSince.get(c.id) ?? t;
          fullSince.set(c.id, since);
          const held = t - since;
          // A volley is thrown the moment it can be, so a full charge should
          // never persist. Anything past a few seconds means the hull is
          // loaded and has no legal target — worth knowing how often.
          if (held > 3) stalledTicks++;
          longest.set(c.id, Math.max(longest.get(c.id) ?? 0, held));
        } else {
          // The hold ended — record it once, as an episode. Counting ticks
          // here reported 34,261 "occurrences" for what was a few dozen hulls
          // waiting, which is a metric measuring its own sample rate.
          const was = longest.get(c.id);
          if (was !== undefined) {
            heldTooLong.push({ m: m + 1, unit: u.label, held: was });
            longest.delete(c.id);
          }
          fullSince.delete(c.id);
        }
      }
    }

    // The defence sweeping out to the staging area while something of the
    // attacker's is sitting on the objective would be a serious fault.
    if (defenseAI.sweeping) {
      const near = game.units.some((u) => u.alive && u.faction === FACTION.ATTACK
        && !u.isGround && u.pos.distanceTo(PLANET) < WORLD.planetRadius + 1200);
      if (near) sweepWhileThreatened.push(`match ${m + 1} at ${t.toFixed(0)}s`);
    }
  }

  // A trailing stall: the battle went quiet and then simply ended.
  if (contact && t - lastShotAt > worstStall) {
    worstStall = t - lastShotAt;
    worstStallAt = lastShotAt;
  }
  if (!contact) noContact++;
  if (worstStall > DEAD_AIR) {
    stalls.push({ m: m + 1, len: worstStall, at: worstStallAt, hand: handPlayed });
  }

  for (const u of game.units) {
    if (!everFired.has(u.id) && u.type.weapon) bump(silent, u.type.id);
    if (u.hasSalvo) {
      capitals++;
      if (!threw.has(u.id)) capitalsSilent++;
    }
  }

  if (game.timedOut) timedOut++;
  totalSeconds += game.now;
  crustLowSum += crustLow;
  if (sieged) everSieged++;
  if (ended === 'victory') outcomes.victory++;
  else if (ended === 'defeat') outcomes.defeat++;
  else if (ended === 'draw') outcomes.draw++;
  else outcomes.unresolved++;
}

const pct = (n) => `${((n / MATCHES) * 100).toFixed(0)}%`;

console.log(`\n  ${MATCHES} matches · ${POINTS}pts · ${DIFFICULTY}`
  + ` · ${handPlayedCount} played by hand on the attack\n`);
console.log(`  attacker wins      ${String(outcomes.victory).padStart(3)}  ${pct(outcomes.victory)}`);
console.log(`  defender wins      ${String(outcomes.defeat).padStart(3)}  ${pct(outcomes.defeat)}`);
if (outcomes.draw) console.log(`  draws              ${String(outcomes.draw).padStart(3)}`);
if (outcomes.unresolved) {
  console.log(`  UNRESOLVED         ${String(outcomes.unresolved).padStart(3)}  <- ran past the clock`);
}
console.log(`  decided on time    ${String(timedOut).padStart(3)}  ${pct(timedOut)}`);
console.log(`  mean length        ${(totalSeconds / MATCHES).toFixed(0)}s`);
console.log(`  bombardment set up ${String(everSieged).padStart(3)}  ${pct(everSieged)}`);
console.log(`  mean crust low     ${((crustLowSum / MATCHES) * 100).toFixed(0)}%`);

console.log(`\n  fleets that never made contact: ${noContact}`);
console.log(`  stretches of dead air over ${DEAD_AIR}s: ${stalls.length}`);
for (const s of stalls.slice(0, 8)) {
  console.log(`    match ${String(s.m).padStart(2)}${s.hand ? ' (by hand)' : '         '}`
    + `  ${s.len.toFixed(0)}s of nothing from ${s.at.toFixed(0)}s`);
}
if (stalls.length > 8) console.log(`    ... and ${stalls.length - 8} more`);

console.log(`\n  squadrons that never engaged anything, by type`
  + ` (count / total built):`);
const rows = [...built.entries()]
  .map(([id, n]) => [id, silent.get(id) || 0, n])
  .filter(([, s]) => s > 0)
  .sort((a, b) => (b[1] / b[2]) - (a[1] / a[2]));
if (!rows.length) console.log('    none');
for (const [id, s, n] of rows) {
  console.log(`    ${id.padEnd(9)} ${String(s).padStart(4)} / ${String(n).padStart(4)}`
    + `  ${((s / n) * 100).toFixed(0)}%`);
}

console.log(`\n  salvos`);
console.log(`    volleys thrown            ${salvosThrown}`
  + `  (${(salvosThrown / MATCHES).toFixed(1)} a match)`);
console.log(`    stopped dead by a screen  ${salvosStopped}`
  + `  ${salvosThrown ? `${((salvosStopped / salvosThrown) * 100).toFixed(0)}%` : '—'}`);
console.log(`    salvo hulls that never threw  ${capitalsSilent} / ${capitals}`
  + `  ${capitals ? `${((capitalsSilent / capitals) * 100).toFixed(0)}%` : '—'}`);
console.log(`    hull-ticks held at full charge with no launch window: `
  + `${stalledTicks.toLocaleString()} of ${chargedTicks.toLocaleString()} charged`
  + `  ${chargedTicks ? `${((stalledTicks / chargedTicks) * 100).toFixed(0)}%` : '—'}`);
if (heldTooLong.length) {
  const sorted = [...heldTooLong].sort((a, b) => b.held - a.held);
  const mean = heldTooLong.reduce((n, w) => n + w.held, 0) / heldTooLong.length;
  console.log(`    loaded-and-waiting episodes: ${heldTooLong.length}`
    + `   mean ${mean.toFixed(1)}s   longest ${sorted[0].held.toFixed(0)}s`
    + ` (${sorted[0].unit}, match ${sorted[0].m})`);
  const long = heldTooLong.filter((w) => w.held > 60).length;
  console.log(`    episodes over 60s: ${long}`
    + `  ${((long / heldTooLong.length) * 100).toFixed(0)}%`);
}

if (sweepWhileThreatened.length) {
  console.log(`\n  FAULT: defence swept to the staging area with an attacker on the`
    + ` objective, ${sweepWhileThreatened.length} ticks:`);
  for (const w of sweepWhileThreatened.slice(0, 5)) console.log(`    ${w}`);
} else {
  console.log('\n  defence never swept while the objective was threatened');
}
