/**
 * How much of a salvo is wasted?
 *
 * A volley's value was tuned assuming its rounds land. They do not always:
 * when a target dies, every round still in flight has its target nulled and
 * deals nothing. That interacts badly with target selection, which deliberately
 * favours hulls that are already hurt — so the game may be aiming its biggest
 * volleys at exactly the targets that will die to the third round.
 *
 * This measures, per volley: how many rounds were fired, how many actually
 * dealt damage, and how healthy the target was when the trigger was pulled.
 *
 *   node tools/overkill.mjs [matches]
 */
import { Game } from '../src/game.js';
import { Commander, generateFleet } from '../src/ai.js';
import { FACTION, TIME_LIMIT, budgetFor } from '../src/config.js';

const noopFx = {
  build() {}, disposeBatches() {}, update() {}, emitTrails() {},
  explode() {}, impact() {}, bubble() {}, syncShields() {}, applyGfx() {},
  tracers: { begin() {}, push() {}, end() {} },
};

const MATCHES = Number(process.argv[2] || 40);
const STEP = 1 / 30;

let volleys = 0;
let roundsFired = 0;
let roundsGuided = 0;
let roundsLanded = 0;
let lostLock = 0;
let ranOut = 0;
let killedTheTarget = 0;
const healthBuckets = new Map();   // target health at release -> [volleys, wasteFraction]
let wasteSum = 0;

for (let m = 0; m < MATCHES; m++) {
  const seed = 1000 + m * 137;
  const game = new Game(noopFx, { seed, fog: true });
  game.reset();
  game.start(
    generateFleet(budgetFor(FACTION.ATTACK, 1000), 'attack', seed),
    generateFleet(1000, 'defense', seed + 1),
    FACTION.ATTACK,
  );
  game.state = 'playing';
  const a = new Commander(game, FACTION.ATTACK, 'medium');
  const d = new Commander(game, FACTION.DEFENSE, 'medium');

  // Tag the rounds of each volley as they are fired, then watch what becomes
  // of them. A round is "landed" if it hit something; "wasted" if it expired
  // with nothing to hit, which is what happens once its target is gone.
  const live = [];
  const origFire = game.projectiles.fire.bind(game.projectiles);
  let tagging = null;
  game.projectiles.fire = (craft, target, guided, damage) => {
    origFire(craft, target, guided, damage);
    if (tagging) {
      const p = game.projectiles.list[game.projectiles.list.length - 1];
      p.__volley = tagging;
      // Whether the round left the rail with a firing solution at all. An
      // accuracy miss is fired unguided and flies wide, which ordinary gunfire
      // does just as often — it is not salvo-specific waste and must not be
      // counted as such. Losing a live lock IS salvo-specific: it means the
      // target died before the round arrived.
      p.__guided = guided;
      tagging.fired++;
      if (guided) tagging.guided++;
    }
  };
  game.onSalvo = (unit, target, rounds, intercepted, landed) => {
    if (!landed) return;
    const rec = {
      fired: 0, guided: 0, hit: 0, lostLock: 0, ranOut: 0, rounds,
      health: target.healthFraction,
      targetDied: false,
      target,
    };
    live.push(rec);
    volleys++;
    tagging = rec;
    // The rounds are fired synchronously inside releaseSalvo, right after this
    // callback returns — so arm the tag and disarm it on the next tick.
    setTimeoutLike();
  };
  // No timers in a headless sim; clear the tag each step instead.
  function setTimeoutLike() {}

  const origHit = game.onProjectileHit.bind(game);
  game.onProjectileHit = (p) => {
    if (p.__volley) { p.__volley.hit++; }
    return origHit(p);
  };

  // Expiry is where the waste shows up: a round whose target died is still in
  // the list, now with target === null.
  const origUpdate = game.projectiles.update.bind(game.projectiles);
  game.projectiles.update = (dt, now, onHit, onExpire) => origUpdate(dt, now, onHit, (p) => {
    if (p.__volley && p.__guided) {
      if (p.target) p.__volley.ranOut++;
      else p.__volley.lostLock++;
    }
    if (onExpire) onExpire(p);
  });

  let ended = null;
  game.onEnd = (s) => { ended = s; };
  let t = 0;
  while (!ended && t < TIME_LIMIT + 1) {
    game.step(STEP);
    tagging = null;             // volley rounds are all fired within one step
    a.update(STEP);
    d.update(STEP);
    t += STEP;
  }

  for (const rec of live) {
    roundsFired += rec.fired;
    roundsGuided += rec.guided;
    roundsLanded += rec.hit;
    lostLock += rec.lostLock;
    ranOut += rec.ranOut;
    if (!rec.target.alive) killedTheTarget++;
    // Waste that is the salvo's own: rounds that had a solution and lost it.
    const waste = rec.guided ? rec.lostLock / rec.guided : 0;
    wasteSum += waste;
    const bucket = `${Math.floor(rec.health * 4) * 25}-${Math.floor(rec.health * 4) * 25 + 25}%`;
    const b = healthBuckets.get(bucket) || { n: 0, waste: 0 };
    b.n++;
    b.waste += waste;
    healthBuckets.set(bucket, b);
  }
}

console.log(`\n  ${MATCHES} matches · ${volleys} volleys that got at least one round away\n`);
const pc = (n, d) => (d ? `${((n / d) * 100).toFixed(0)}%` : '—');
console.log(`  rounds fired                       ${String(roundsFired).padStart(6)}`);
console.log(`  of those, left the rail on target  ${String(roundsGuided).padStart(6)}`
  + `  ${pc(roundsGuided, roundsFired)}   (the rest are ordinary accuracy misses,`
  + ` which gunfire has too)`);
console.log(`  hit something                      ${String(roundsLanded).padStart(6)}`
  + `  ${pc(roundsLanded, roundsGuided)} of those on target`);
console.log(`  LOST THEIR TARGET in flight        ${String(lostLock).padStart(6)}`
  + `  ${pc(lostLock, roundsGuided)}  <- waste unique to a volley`);
console.log(`  expired still tracking             ${String(ranOut).padStart(6)}`
  + `  ${pc(ranOut, roundsGuided)}`);
console.log(`  mean per volley                    ${volleys ? `${((wasteSum / volleys) * 100).toFixed(0)}%` : '—'} of its aimed rounds wasted`);
console.log(`  volleys whose target ended the match dead: ${killedTheTarget}`
  + `  ${volleys ? `${((killedTheTarget / volleys) * 100).toFixed(0)}%` : '—'}`);

console.log('\n  waste by how healthy the target was when the trigger was pulled:');
for (const [k, v] of [...healthBuckets.entries()].sort()) {
  console.log(`    ${k.padStart(8)}  ${String(v.n).padStart(5)} volleys`
    + `   mean waste ${((v.waste / v.n) * 100).toFixed(0)}%`);
}
