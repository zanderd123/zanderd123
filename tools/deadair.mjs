/**
 * Why did the shooting stop?
 *
 * `tools/audit.mjs` counts stretches of dead air but cannot say what caused
 * one — it only knows nothing was firing. This replays the same seeds, and
 * whenever a quiet stretch runs past the threshold it takes a snapshot of the
 * moment: who was alive, where they were, what they were holding, and how far
 * apart the two sides had drifted. A stall has only a handful of possible
 * causes and they look nothing alike:
 *
 *   - the two fleets are out of contact and neither is closing (a search
 *     failure, or two leashes that do not overlap)
 *   - they can see each other and cannot shoot — fire control never resolves,
 *     so every gun is held at the unpainted range
 *   - one side is intact and the other is a handful of stragglers the winner
 *     will not chase (the end of a decided match, harmless but it should not
 *     run 30 seconds)
 *   - everything is alive, in range, and idle — a real fault
 *
 *   node tools/deadair.mjs [matches] [threshold-seconds]
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
const THRESHOLD = Number(process.argv[3] || 25);
const POINTS = 1000;
const STEP = 1 / 30;
const PLANET = new THREE.Vector3(...WORLD.planetCenter);

/** Everything worth knowing about the instant the guns went quiet. */
function snapshot(game, faction) {
  const mine = game.units.filter((u) => u.alive && u.faction === faction);
  const foe = game.units.filter((u) => u.alive && u.faction !== faction);
  let nearest = Infinity;
  let seen = 0;
  let painted = 0;
  let holding = 0;
  let ships = 0;
  let crewed = 0;
  for (const u of mine) {
    if (!u.isGround) ships++;
    crewed += u.craft.filter((c) => c.alive).length;
    for (const c of u.craft) if (c.alive && c.target && c.target.alive) holding++;
    for (const e of foe) {
      const d = u.pos.distanceTo(e.pos);
      if (d < nearest) nearest = d;
    }
  }
  for (const e of foe) {
    // seenBy is a per-CRAFT flag; a Unit has no such field. Reading it off the
    // squadron returned undefined for every hull, so an earlier version of
    // this probe reported "sees 0" in every snapshot it ever took — a metric
    // that could only ever print one value.
    if (e.craft.some((c) => c.alive && c.seenBy[faction])) seen++;
    if (e.paintedFor(faction)) painted++;
  }
  const centroid = new THREE.Vector3();
  let n = 0;
  for (const u of mine) if (!u.isGround) { centroid.add(u.pos); n++; }
  if (n) centroid.divideScalar(n);
  return {
    units: mine.length,
    ships,
    crewed,
    holding,
    seen,
    painted,
    nearest,
    toPlanet: n ? centroid.distanceTo(PLANET) : Infinity,
    stances: mine.reduce((acc, u) => {
      acc[u.stance] = (acc[u.stance] || 0) + 1;
      return acc;
    }, {}),
  };
}

const found = [];

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

  // Same split as the audit: odd matches are played by hand on the attacking
  // side so the player code path is exercised, even matches are AI v AI.
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
  let lastLive = 0;
  let contact = false;
  let reported = false;

  while (!ended && t < TIME_LIMIT + 1) {
    const before = game.projectiles.list.length;
    game.step(STEP);
    if (attackAI) attackAI.update(STEP);
    defenseAI.update(STEP);
    t += STEP;

    let live = game.projectiles.list.length > 0 || before > 0;
    for (const u of game.units) {
      if (!u.alive) continue;
      if (u.siegeLock) live = true;
      for (const c of u.craft) if (c.alive && c.target && c.target.alive) live = true;
    }
    if (live) {
      contact = true;
      lastLive = t;
      reported = false;
    } else if (contact && !reported && t - lastLive > THRESHOLD) {
      // Snapshot the moment the stretch crosses the line, not the moment it
      // ends — by then whatever broke it has already happened.
      reported = true;
      found.push({
        m: m + 1,
        hand: handPlayed,
        at: lastLive,
        t,
        sweeping: !!defenseAI.sweeping,
        attack: snapshot(game, FACTION.ATTACK),
        defense: snapshot(game, FACTION.DEFENSE),
        crust: game.planet ? game.planet.fraction : 1,
      });
    }
  }

  // A stretch that ran to the end of the match never crosses the line above
  // while the loop is running if the match ends first, so catch the tail.
  if (contact && !reported && t - lastLive > THRESHOLD) {
    found.push({
      m: m + 1, hand: handPlayed, at: lastLive, t, trailing: true,
      sweeping: !!defenseAI.sweeping,
      attack: snapshot(game, FACTION.ATTACK),
      defense: snapshot(game, FACTION.DEFENSE),
      crust: game.planet ? game.planet.fraction : 1,
    });
  }
}

const f = (n) => (Number.isFinite(n) ? n.toFixed(0) : '—');
console.log(`\n  ${MATCHES} matches · stretches of quiet over ${THRESHOLD}s\n`);
if (!found.length) console.log('  none\n');

for (const s of found) {
  console.log(`  match ${s.m}  ${s.hand ? 'hand-played' : 'AI v AI'}`
    + `  quiet from ${s.at.toFixed(0)}s`
    + `${s.trailing ? ' to the end of the match' : ''}`
    + `${s.sweeping ? '  [defence sweeping]' : ''}`
    + `  crust ${(s.crust * 100).toFixed(0)}%`);
  for (const [name, side] of [['attack ', s.attack], ['defense', s.defense]]) {
    console.log(`    ${name}  ${String(side.units).padStart(3)} squadrons`
      + ` (${side.ships} flying, ${side.crewed} hulls)`
      + `   sees ${side.seen}, resolves ${side.painted}`
      + `   nearest foe ${f(side.nearest)}`
      + `   centroid ${f(side.toPlanet)} from the planet`
      + `   ${JSON.stringify(side.stances)}`);
  }
  console.log('');
}
