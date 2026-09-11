/**
 * Bug hunt: run matches and assert things that must never be true.
 *
 * The in-game Recorder does some of this, but it needs a browser and it only
 * watches the player's fleet. This checks both sides, every tick, headlessly,
 * and adds the invariants the Recorder cannot see — internal state consistency,
 * projectile sanity, the AI's own station-keeping contract.
 *
 * Anything reported here is a bug, not a balance opinion. Run it after any
 * change to the flight model, the damage chain, or the AI.
 *
 *   node tools/invariants.mjs [matches] [budget]
 */
import * as THREE from 'three';
import { Game } from '../src/game.js';
import { Commander, generateFleet } from '../src/ai.js';
import { FACTION, TIME_LIMIT, WORLD, DEFENCE, budgetFor } from '../src/config.js';

const noopFx = {
  build() {}, disposeBatches() {}, update() {}, emitTrails() {},
  explode() {}, impact() {}, bubble() {}, syncShields() {}, applyGfx() {},
  tracers: { begin() {}, push() {}, end() {} },
};

const MATCHES = Number(process.argv[2] || 20);
const POINTS = Number(process.argv[3] || 1000);
const STEP = 1 / 30;
const PLANET = new THREE.Vector3(...WORLD.planetCenter);
const ORBIT_FLOOR = WORLD.planetRadius + 45;

/** key -> { count, first } so one broken unit cannot flood the report. */
const found = new Map();
let checks = 0;

function fail(key, detail) {
  const rec = found.get(key);
  if (rec) { rec.count++; return; }
  found.set(key, { count: 1, first: detail });
}

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
  const attackAI = new Commander(game, FACTION.ATTACK, 'medium');
  const defenseAI = new Commander(game, FACTION.DEFENSE, 'medium');

  // Deaths counted independently of game.kills, to check the scoreboard.
  //
  // Two traps here, both of which made the game look wrong when it was not.
  // A carrier's brood is created with alive=false and revived on launch, so an
  // unreleased hull is not a death. And releaseBroodHull revives ANY dead slot,
  // so one craft object can legitimately die more than once — which means this
  // has to count death EVENTS by watching the alive flag flip, not unique ids.
  const wasAlive = new Map();
  const lastDist = new Map();
  const openFor = new Map();
  let deaths = 0;
  let ended = null;
  game.onEnd = (state) => { ended = state; };

  let t = 0;
  while (!ended && t < TIME_LIMIT + 1) {
    game.step(STEP);
    attackAI.update(STEP);
    defenseAI.update(STEP);
    t += STEP;
    checks++;

    for (const u of game.units) {
      const tag = `${u.type.id}`;

      // --- squadron bookkeeping -------------------------------------------
      const living = u.craft.filter((c) => c.alive).length;
      if (u.count !== living) {
        fail(`count-mismatch:${tag}`,
          `${u.label} reports count=${u.count} but ${living} craft are alive`);
      }
      if (u.alive !== living > 0) {
        fail(`alive-mismatch:${tag}`,
          `${u.label} alive=${u.alive} with ${living} living craft`);
      }
      if (!Number.isFinite(u.pos.x + u.pos.y + u.pos.z)) {
        fail(`unit-nan:${tag}`, `${u.label} centroid is not finite`);
      }
      // A siege lock only ever belongs to the attacker, and only while the
      // planet is alive.
      if (u.siegeLock && u.faction !== FACTION.ATTACK) {
        fail(`defender-sieging:${tag}`, `${u.label} is a defender with siegeLock`);
      }
      if (u.siegeLock && (!game.planet || !game.planet.alive)) {
        fail('siege-after-planet', `${u.label} still sieging a dead planet`);
      }

      // --- the defending AI's station-keeping contract ---------------------
      //
      // The question is whether the leash is being ENFORCED, not whether the
      // squadron is inside it this instant. Being outside and heading home is
      // correct — a squadron promoted into the close guard when its predecessor
      // died may legitimately be 2,000 units out and need half a minute to get
      // back. Being outside and still heading AWAY is the actual failure.
      if (u.alive && u.faction === FACTION.DEFENSE && !u.isGround && u.leashRadius) {
        // 1.25x covers the soft turn band plus one AI tick of drift.
        const slack = u.leashRadius * 1.25;
        for (const c of u.craft) {
          if (!c.alive) continue;
          const d = c.pos.distanceTo(PLANET);
          const prev = lastDist.get(c.id);
          lastDist.set(c.id, d);
          // A hull has a turning circle: it keeps opening for a second or so
          // after the leash bends its heading, which is the flight model
          // working, not the leash failing. Only a SUSTAINED opening is a bug.
          const opening = d > slack && prev !== undefined && d > prev + 0.5;
          const run = opening ? (openFor.get(c.id) || 0) + STEP : 0;
          openFor.set(c.id, run);
          if (run > 3) {
            fail(`leash-not-enforced:${tag}`,
              `${u.label} at ${d.toFixed(0)}u, opening for ${run.toFixed(1)}s,`
              + ` leash ${u.leashRadius.toFixed(0)}u`);
          }
        }
      }

      // --- per-craft ------------------------------------------------------
      for (const c of u.craft) {
        if (!c.alive) {
          if (c.hp > 0) fail(`dead-with-hp:${tag}`, `${u.label} dead craft has hp ${c.hp}`);
          continue;
        }
        if (![c.pos.x, c.pos.y, c.pos.z, c.hp, c.speed].every(Number.isFinite)) {
          fail(`craft-nan:${tag}`, `${u.label} has a non-finite field`);
          continue;
        }
        if (c.hp <= 0) fail(`alive-no-hp:${tag}`, `${u.label} alive at hp ${c.hp}`);
        if (c.hp > c.maxHealth + 0.01) {
          fail(`overheal:${tag}`, `${u.label} at ${c.hp.toFixed(1)}/${c.maxHealth}`);
        }
        if (c.speed < -1e-6) fail(`negative-speed:${tag}`, `${u.label} speed ${c.speed}`);
        if (u.isGround) continue;

        if (Math.hypot(c.pos.x, c.pos.z) > WORLD.arenaRadius + 2) {
          fail(`outside-wall:${tag}`,
            `${u.label} at radius ${Math.hypot(c.pos.x, c.pos.z).toFixed(0)}`);
        }
        if (Math.abs(c.pos.y) > WORLD.arenaHeight + 2) {
          fail(`outside-slab:${tag}`, `${u.label} at y ${c.pos.y.toFixed(0)}`);
        }
        if (c.pos.distanceTo(PLANET) < ORBIT_FLOOR - 2) {
          fail(`inside-planet:${tag}`,
            `${u.label} at ${c.pos.distanceTo(PLANET).toFixed(0)}u, floor ${ORBIT_FLOOR}`);
        }
        // The transit cruise floor must never exceed itself.
        const top = Math.max(u.stats.maxSpeed, 200);
        if (c.speed > top + 1) {
          fail(`overspeed:${tag}`, `${u.label} at ${c.speed.toFixed(0)} u/s`);
        }
      }
    }

    // --- projectiles -------------------------------------------------------
    for (const p of game.projectiles.list) {
      if (![p.pos.x, p.pos.y, p.pos.z, p.damage].every(Number.isFinite)) {
        fail('projectile-nan', 'a projectile has a non-finite field');
      }
      if (p.damage < 0) fail('projectile-negative', `damage ${p.damage}`);
      if (p.life < -1) fail('projectile-immortal', `life ${p.life}`);
    }

    // --- the planet --------------------------------------------------------
    if (game.planet) {
      const pl = game.planet;
      if (!Number.isFinite(pl.hp)) fail('planet-nan', 'planet hp is not finite');
      if (pl.hp < 0) fail('planet-negative', `planet hp ${pl.hp}`);
      if (pl.hp > pl.maxHealth + 0.01) {
        fail('planet-overheal', `planet ${pl.hp.toFixed(0)}/${pl.maxHealth}`);
      }
      if (pl.alive !== pl.hp > 0) {
        fail('planet-alive-mismatch', `alive=${pl.alive} hp=${pl.hp}`);
      }
    }

    for (const u of game.units) {
      for (const c of u.craft) {
        if (wasAlive.get(c.id) && !c.alive) deaths++;
        wasAlive.set(c.id, c.alive);
      }
    }
  }

  // --- scoreboard ----------------------------------------------------------
  const scored = game.kills.attack + game.kills.defense;
  if (scored !== deaths) {
    fail('kill-count', `scoreboard ${scored} vs ${deaths} deaths observed`);
  }
  if (!ended && !game.timedOut) {
    fail('no-resolution', `match ${m + 1} ran past the clock without ending`);
  }
}

console.log(`\n${MATCHES} matches, ${checks.toLocaleString()} ticks checked\n`);
if (!found.size) {
  console.log('  no invariant violations');
} else {
  console.log(`  ${found.size} distinct violation(s):\n`);
  for (const [key, rec] of [...found.entries()].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  x${String(rec.count).padStart(7)}  ${key}`);
    console.log(`             ${rec.first}`);
  }
  process.exitCode = 1;
}
