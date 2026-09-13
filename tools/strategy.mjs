/**
 * Is there more than one way to win as the attacker?
 *
 * The question this answers is not "is the attacker balanced" — humanplay.mjs
 * covers that — but "does the *choice* of plan matter". A player who selects
 * every squadron at t=0, right-clicks the planet, and never touches the mouse
 * again is making no decisions at all. If that scores as well as anything
 * else, the tactical layer is decoration.
 *
 *   node tools/strategy.mjs [matches] [budget] [difficulty] [strategy|all]
 *
 * Strategies, all played from the ATTACK chair against a Commander:
 *
 *   blob      select everything, ATTACK-move at the planet, never touch again
 *   ontarget  the same click, but landing on a defender parked over the world
 *             — which is what a player gets when a hull is under the cursor
 *   nosiege   the same blob, with auto-bombardment suppressed (the
 *             counterfactual: how far does the blob get on gunnery alone)
 *   staged    light/fast squadrons go in first; heavies wait for contact
 *   siegerush only the siege capitals go; escorts hold at the staging area
 *   escort    capitals ordered to bombard, everything else sent to cover them
 *   passive   no orders at all, the do-nothing floor
 *
 * SIEGE_HP=<n> overrides SIEGE.hpPerAttackPoint for a sweep.
 */
import { Game } from '../src/game.js';
import { Commander, generateFleet } from '../src/ai.js';
import { FACTION, TIME_LIMIT, WORLD, SIEGE, budgetFor } from '../src/config.js';

const noopFx = {
  build() {}, disposeBatches() {}, update() {}, emitTrails() {},
  explode() {}, impact() {}, bubble() {}, syncShields() {}, applyGfx() {},
  tracers: { begin() {}, push() {}, end() {} },
};

const MATCHES = Number(process.argv[2] || 40);
const BUDGET = Number(process.argv[3] || 1000);
const DIFFICULTY = process.argv[4] || 'medium';
const WHICH = process.argv[5] || 'all';
const STEP = 1 / 30;

const PLANET = { x: WORLD.planetCenter[0], y: WORLD.planetCenter[1], z: WORLD.planetCenter[2] };

if (process.env.SIEGE_HP) SIEGE.hpPerAttackPoint = Number(process.env.SIEGE_HP);

/** Order shapes a person can actually give with the mouse and the stance keys. */
const STRATEGIES = {
  // Everything, at the planet, on ATTACK. One drag-select and one click.
  blob: {
    open(game) { for (const u of mine(game)) send(u); },
  },
  // The same drag-select and the same click, except the cursor was over a
  // defender rather than over empty sky — so the order carries a named target.
  ontarget: {
    open(game) {
      const mark = nearestDefenderToPlanet(game);
      for (const u of mine(game)) send(u, mark);
    },
  },
  // Same orders, but the auto-siege gate can never fire. Isolates how much of
  // the blob's result is bombardment and how much is just mass.
  nosiege: {
    lockRange: 0,
    open(game) { for (const u of mine(game)) send(u); },
  },
  // Fast movers make contact first; the heavies follow when the shooting
  // starts. This is the shape the transit-cruise note in config.js describes
  // as "the window the whole idea lives in".
  staged: {
    open(game) {
      for (const u of mine(game)) {
        if (u.stats.maxSpeed >= 90) send(u);
        else u.order(u.pos, { stance: 'hold' });
      }
    },
    onContact(game) { for (const u of mine(game)) if (u.stance === 'hold') send(u); },
  },
  // The bombardment as a dedicated plan: capitals go, everything else holds
  // back out of the fight entirely.
  siegerush: {
    open(game) {
      for (const u of mine(game)) {
        if (u.siegeCapital) send(u);
        else u.order(u.pos, { stance: 'hold' });
      }
    },
  },
  // The bombardment as a combined-arms plan: capitals commit to the crust,
  // everything else is sent to keep the defence off them.
  escort: {
    open(game) {
      for (const u of mine(game)) {
        u.autocast = true;
        if (u.siegeCapital) u.beginSiege();
        else send(u);
      }
    },
  },
  passive: { open() {} },
};

function mine(game) {
  return game.units.filter((u) => u.faction === FACTION.ATTACK && u.alive && !u.broodOf);
}

function send(u, attack = null) {
  u.order(PLANET, { stance: 'attack', attack });
  u.autocast = true;
}

/** Whatever hull a player's cursor would most likely be over near the world. */
function nearestDefenderToPlanet(game) {
  let best = null;
  let bestD = Infinity;
  for (const u of game.units) {
    if (!u.alive || u.faction !== FACTION.DEFENSE || u.isGround) continue;
    const dx = u.pos.x - PLANET.x;
    const dy = u.pos.y - PLANET.y;
    const dz = u.pos.z - PLANET.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) { bestD = d; best = u; }
  }
  return best;
}

function play(name, seed) {
  const plan = STRATEGIES[name];
  const savedLock = SIEGE.lockRange;
  if (plan.lockRange !== undefined) SIEGE.lockRange = plan.lockRange;

  const game = new Game(noopFx, { seed, fog: true });
  game.reset();
  const attackRoster = generateFleet(budgetFor(FACTION.ATTACK, BUDGET), 'attack', seed);
  const defenseRoster = generateFleet(budgetFor(FACTION.DEFENSE, BUDGET), 'defense', seed + 1);
  game.start(attackRoster, defenseRoster, FACTION.ATTACK);
  game.state = 'playing';

  const ai = new Commander(game, FACTION.DEFENSE, DIFFICULTY);
  game.onHatch = (parent, brood) => { if (brood.faction === FACTION.ATTACK) send(brood); };

  let ended = null;
  game.onEnd = (s) => { ended = s; };
  plan.open(game);

  let t = 0;
  let contact = false;
  let crustLow = 1;
  let sieged = 0;
  while (!ended && t < TIME_LIMIT + 1) {
    game.step(STEP);
    ai.update(STEP);
    t += STEP;
    if (game.planet) crustLow = Math.min(crustLow, game.planet.fraction);
    const s = mine(game).filter((u) => u.siegeLock).length;
    if (s > sieged) sieged = s;
    if (!contact && plan.onContact && game.units.some((u) => u.alive && u.dpsIn > 0)) {
      contact = true;
      plan.onContact(game);
    }
  }

  const hulls = (f) => game.units.filter((u) => u.faction === f && u.alive)
    .reduce((s, u) => s + u.count, 0);
  SIEGE.lockRange = savedLock;
  return {
    won: ended === 'victory',
    viaPlanet: !!game.planetFell,
    timedOut: game.timedOut,
    now: game.now,
    mine: hulls(FACTION.ATTACK),
    theirs: hulls(FACTION.DEFENSE),
    crustLow,
    sieged,
  };
}

const names = WHICH === 'all' ? Object.keys(STRATEGIES) : [WHICH];
const rows = [];
for (const name of names) {
  let wins = 0; let planet = 0; let secs = 0; let crust = 0; let sieged = 0;
  let mineLeft = 0; let theirsLeft = 0;
  for (let m = 0; m < MATCHES; m++) {
    const r = play(name, 1000 + m * 137);
    wins += r.won ? 1 : 0;
    planet += r.viaPlanet ? 1 : 0;
    secs += r.now;
    crust += r.crustLow;
    sieged += r.sieged;
    mineLeft += r.mine;
    theirsLeft += r.theirs;
  }
  rows.push({
    name,
    win: (wins / MATCHES) * 100,
    planet: (planet / MATCHES) * 100,
    secs: secs / MATCHES,
    crust: (crust / MATCHES) * 100,
    sieged: sieged / MATCHES,
    mineLeft: mineLeft / MATCHES,
    theirsLeft: theirsLeft / MATCHES,
  });
  const r = rows[rows.length - 1];
  console.log(`  ${name.padEnd(10)} win ${r.win.toFixed(0).padStart(3)}%`
    + `  (by planet ${r.planet.toFixed(0).padStart(3)}%)`
    + `  mean ${r.secs.toFixed(0).padStart(3)}s`
    + `  crust low ${r.crust.toFixed(0).padStart(3)}%`
    + `  peak sieging ${r.sieged.toFixed(1)}`
    + `  hulls left ${r.mineLeft.toFixed(1)} v ${r.theirsLeft.toFixed(1)}`);
}

console.log(`\n  ${MATCHES} matches each · attacker played by hand · ${BUDGET}pts · ${DIFFICULTY}`);
