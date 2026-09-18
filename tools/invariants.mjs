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
import {
  FACTION, TIME_LIMIT, WORLD, DEFENCE, SCOUTING, budgetFor,
} from '../src/config.js';

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

/**
 * How many times each assertion was actually evaluated.
 *
 * A check that never runs passes silently, and in the output that is
 * indistinguishable from a check that runs and holds. Every assertion added
 * here increments a counter, and the report prints them — so "clean" reads as
 * "clean over N evaluations" rather than being taken on trust.
 */
const covered = new Map();
const saw = (key) => covered.set(key, (covered.get(key) || 0) + 1);

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

  // Half the matches are played BY HAND on the attacking side.
  //
  // This matters more than it looks. A Commander on both sides never touches
  // `isPlayerControlled`, so the entire player path — updateAttackStance, the
  // auto-siege gate, standing attack orders, and a carrier brood adopting its
  // parent's orders — was never executed by this harness at all. Coverage
  // counters proved it: the brood assertion evaluated exactly zero times over
  // 50 AI-vs-AI matches, because the AI reissues its broods' orders every
  // tick and they are therefore never unordered. Every bug found in that path
  // this week came from a session report rather than from here.
  //
  // The hand-played arm gives one order at the start and never intervenes,
  // which is both the commonest way a person actually plays and the case that
  // leaves broods and standing orders to look after themselves.
  const handPlayed = m % 2 === 1;
  const attackAI = handPlayed ? null : new Commander(game, FACTION.ATTACK, 'medium');
  const defenseAI = new Commander(game, FACTION.DEFENSE, 'medium');
  if (handPlayed) {
    saw('match played by hand on the attacking side');
    for (const u of game.units) {
      // Docked broods are deliberately left out: a drag-select does not pick
      // them up either, which is exactly the condition being tested.
      if (u.faction !== FACTION.ATTACK || u.broodOf) continue;
      u.order(PLANET, { stance: 'attack' });
      u.autocast = true;
    }
  }

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
  const staleOrder = new Map();
  const broodAdrift = new Map();
  let deaths = 0;
  let ended = null;
  game.onEnd = (state) => { ended = state; };
  game.onSalvo = (unit, target, rounds, intercepted, landed) => {
    saw('salvo thrown');
    if (rounds !== unit.type.salvo.rounds) {
      fail('salvo-round-count', `${unit.label} threw ${rounds}, rated ${unit.type.salvo.rounds}`);
    }
    if (landed > rounds || landed < 0) {
      fail('salvo-landed-range', `${unit.label} landed ${landed} of ${rounds}`);
    }
    if (intercepted < 0) fail('salvo-negative-screen', `${unit.label} ${intercepted}`);
    // The launch gate: never at a contact the fleet has not resolved.
    if (!target.paintedFor(unit.faction)) {
      fail('salvo-at-unresolved', `${unit.label} threw at unresolved ${target.label}`);
    }
    // A volley is never thrown into a screen that would annihilate it — the
    // charge is held instead. At least one round must have been able to get
    // through, or the hull wasted its commitment.
    if (landed <= 0) {
      fail('salvo-wasted',
        `${unit.label} threw ${rounds} at ${target.label} into ${intercepted} counterforce`);
    }
  };

  let t = 0;
  while (!ended && t < TIME_LIMIT + 1) {
    game.step(STEP);
    if (attackAI) attackAI.update(STEP);
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

      // --- orders -----------------------------------------------------------
      //
      // A standing attack order must never survive its target. Combat scores
      // the ordered hull 6x, so a stale one is a whole fleet aiming at a
      // corpse — which is exactly the failure mode the order-persistence
      // change could have introduced.
      if (u.alive && u.orderedTarget) saw('ordered target held');
      if (u.alive && u.orderedTarget && !u.orderedTarget.alive) {
        saw('ordered target outlived its hull');
        const held = (staleOrder.get(u.id) || 0) + STEP;
        staleOrder.set(u.id, held);
        // One AI tick of slack: the sweep that clears it runs at 0.4s.
        if (held > 1.5) {
          fail(`stale-ordered-target:${tag}`,
            `${u.label} still ordered onto dead ${u.orderedTarget.label} for ${held.toFixed(1)}s`);
        }
      } else {
        staleOrder.delete(u.id);
      }

      // --- carrier broods ----------------------------------------------------
      //
      // A brood nobody has ordered follows its carrier. If it is drifting far
      // from its parent it has been stranded — the bug a session report caught,
      // where two Spawners' whole output loitered at the staging area.
      if (u.alive && u.broodOf && u.orderCount === 0 && u.broodOf.alive) {
        saw('unordered brood following a carrier');
        const gap = u.pos.distanceTo(u.broodOf.pos);
        // A wing that is FIGHTING is supposed to leave its carrier — that is
        // the whole point of launching it, and an earlier version of this
        // check called it a stranding. The fault is a brood that is far away
        // with nothing to do: nobody is steering it and it is not fighting.
        const busy = u.stance === 'attack' && u.attackTarget && u.attackTarget.alive;
        if (gap > 1400 && busy) saw('brood fighting away from its carrier');
        const far = gap > 1400 && !busy;
        const run = far ? (broodAdrift.get(u.id) || 0) + STEP : 0;
        broodAdrift.set(u.id, run);
        // Generous: a freshly launched hull has to cross the formation, and a
        // carrier under way can outrun it briefly. Only a sustained gap is a
        // stranding.
        if (run > 20) {
          fail(`brood-adrift:${tag}`,
            `${u.label} is ${gap.toFixed(0)}u from carrier ${u.broodOf.label}`
            + ` for ${run.toFixed(0)}s with nothing to fight and no orders of its own`);
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

        // --- fire control ---------------------------------------------------
        // Reach is either the rated range or the unpainted fraction of it, and
        // never anything else. A drifting or NaN fireRange would silently
        // change every engagement distance in the game.
        if (u.stats.range > 0) {
          saw('fireRange within bounds');
          if (c.fireRange < u.stats.range - 1e-6) saw('fireRange cut by a poor picture');
          if (u.isGround) saw('emplacement exempt from fire control');
          const full = u.stats.range;
          const cut = full * SCOUTING.unpaintedRangeFactor;
          if (!Number.isFinite(c.fireRange)) {
            fail(`firerange-nan:${tag}`, `${u.label} fireRange ${c.fireRange}`);
          } else if (c.fireRange > full + 1e-6) {
            fail(`firerange-over:${tag}`,
              `${u.label} reaches ${c.fireRange.toFixed(0)} of a rated ${full.toFixed(0)}`);
          } else if (c.fireRange < cut - 1e-6) {
            fail(`firerange-under:${tag}`,
              `${u.label} reaches ${c.fireRange.toFixed(0)}, below the ${cut.toFixed(0)} floor`);
          }
          // An emplacement is exempt and must always have its full reach.
          if (u.isGround && c.fireRange < full - 1e-6) {
            fail(`firerange-ground:${tag}`,
              `${u.label} is an emplacement reaching only ${c.fireRange.toFixed(0)}/${full.toFixed(0)}`);
          }
        }

        // --- salvo -----------------------------------------------------------
        if (u.hasSalvo) {
          saw('salvo charge within bounds');
          if (!Number.isFinite(c.salvoCharge) || c.salvoCharge < 0 || c.salvoCharge > 1) {
            fail(`salvo-charge:${tag}`, `${u.label} charge ${c.salvoCharge}`);
          }
        } else if (c.salvoCharge !== 0) {
          fail(`salvo-on-nonsalvo:${tag}`,
            `${u.label} cannot throw salvos but has charge ${c.salvoCharge}`);
        }

        // A hull is always resolved by its own side — the visibility pass sets
        // that unconditionally, and half the gunnery reads it.
        saw('hull resolved by its own side');
        if (!c.paintedBy[u.faction]) {
          fail(`unpainted-by-own-side:${tag}`, `${u.label} is not painted for ${u.faction}`);
        }
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
console.log('  assertion coverage — how many times each new check actually ran:');
for (const [k, n] of [...covered.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${n.toLocaleString().padStart(12)}  ${k}`);
}
console.log('');
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
