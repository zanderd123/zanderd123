/**
 * Run a lot of matches and report what is actually happening in them.
 *
 * `selfplay.mjs` answers "who won". This answers "why", and "what is broken" —
 * per-hull damage dealt and taken, kills, survival, points efficiency, how
 * matches end, and how much of each fleet ever fires a shot. It is the tool
 * for finding things worth changing, rather than for confirming a change.
 *
 * Both sides are actively commanded, so this measures the DESIGN rather than
 * any particular way of playing. For the standing-order cases a person
 * actually plays, use tools/balance.mjs.
 *
 *   node tools/analyse.mjs [matches] [budget] [difficulty]
 */
import { Game } from '../src/game.js';
import { Commander, generateFleet } from '../src/ai.js';
import {
  FACTION, TIME_LIMIT, ALL_TYPES, SHIPS, GROUND, unitCost, derive, budgetFor,
} from '../src/config.js';

const noopFx = {
  build() {}, disposeBatches() {}, update() {}, emitTrails() {},
  explode() {}, impact() {}, bubble() {}, syncShields() {}, applyGfx() {},
  tracers: { begin() {}, push() {}, end() {} },
};

const MATCHES = Number(process.argv[2] || 100);
const POINTS = Number(process.argv[3] || 1000);
const DIFFICULTY = process.argv[4] || 'medium';
const STEP = 1 / 30;

/** Per-type accumulators across the whole run. */
const stat = {};
const typeStat = (id) => (stat[id] ||= {
  id,
  bought: 0,          // squadrons fielded
  hulls: 0,           // hulls fielded
  hullsLost: 0,
  dealt: 0,           // damage dealt to enemy hulls
  taken: 0,
  kills: 0,
  everFired: 0,       // hulls that landed at least one shot
  healed: 0,          // HP restored to allies (support hulls do no damage)
  points: 0,
});

const outcome = { attack: 0, defense: 0, timeout: 0, draw: 0, planetFell: 0 };
let totalSeconds = 0;
let totalShotsFired = 0;
let totalShotsHit = 0;

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
  const attackAI = new Commander(game, FACTION.ATTACK, DIFFICULTY);
  const defenseAI = new Commander(game, FACTION.DEFENSE, DIFFICULTY);

  // Hit rate: the muzzle roll decides guided (a hit) vs unguided (a miss),
  // so counting guided-vs-total at the projectile spawner measures accuracy
  // as the simulation actually experiences it, weighted by who is shooting.
  //
  // Damage is accumulated here too. The unit's own damageIn/OutAccum fields
  // are drained into the dps meters every frame, so reading them at the end
  // would report a single frame, not the match.
  let fired = 0;
  let hit = 0;
  const shooters = new Set();
  const originalFire = game.projectiles.fire.bind(game.projectiles);
  game.projectiles.fire = (craft, target, guided, dmg) => {
    if (target && !target.isPlanet) {
      fired++;
      if (guided) { hit++; shooters.add(craft); }
    }
    return originalFire(craft, target, guided, dmg);
  };

  // Support hulls deal no damage by design, so judging them on damage alone
  // would be meaningless. Credit the HP they put back instead.
  const originalRepair = game.applyRepair.bind(game);
  game.applyRepair = (unit, dt, rate) => {
    let before = 0;
    for (const u of game.units) {
      if (u.faction !== unit.faction || !u.alive) continue;
      for (const c of u.craft) if (c.alive) before += c.hp;
    }
    const out = originalRepair(unit, dt, rate);
    let after = 0;
    for (const u of game.units) {
      if (u.faction !== unit.faction || !u.alive) continue;
      for (const c of u.craft) if (c.alive) after += c.hp;
    }
    typeStat(unit.type.id).healed += Math.max(0, after - before);
    return out;
  };

  const originalHit = game.onProjectileHit.bind(game);
  game.onProjectileHit = (p) => {
    // Hold the target: a killing blow runs breakLocksOn, which nulls p.target
    // on every projectile chasing that hull — this one included.
    const tgt = p.target;
    const shooter = p.shooter;
    const before = tgt && !tgt.isPlanet && tgt.alive ? tgt.hp : null;
    const dealt = originalHit(p);
    if (before !== null && shooter) {
      // Attribute what actually landed, after armour, shields and reduction.
      const actual = Math.max(0, before - tgt.hp);
      typeStat(shooter.unit.type.id).dealt += actual;
      typeStat(tgt.unit.type.id).taken += actual;
      if (!tgt.alive) typeStat(shooter.unit.type.id).kills++;
    }
    return dealt;
  };

  // Snapshot what was fielded before anything dies.
  const startCount = new Map();
  for (const u of game.units) {
    const s = typeStat(u.type.id);
    s.bought++;
    s.hulls += u.craft.length;
    s.points += unitCost(u.type);
    startCount.set(u.id, u.craft.length);
  }

  let ended = null;
  game.onEnd = (state) => { ended = state; };
  // Broods are fielded mid-match, so count them when they appear.
  game.onHatch = (parent, brood) => {
    const s = typeStat(brood.type.id);
    s.hulls += 1;
  };

  let t = 0;
  while (!ended && t < TIME_LIMIT + 1) {
    game.step(STEP);
    attackAI.update(STEP);
    defenseAI.update(STEP);
    t += STEP;
  }

  for (const u of game.units) {
    const s = typeStat(u.type.id);
    for (const c of u.craft) {
      if (!c.alive) s.hullsLost++;
      if (shooters.has(c)) s.everFired++;
    }
  }

  totalSeconds += game.now;
  totalShotsFired += fired;
  totalShotsHit += hit;

  if (game.planetFell) outcome.planetFell++;
  if (game.timedOut) { outcome.timeout++; outcome.defense++; }
  else if (ended === 'victory') outcome.attack++;
  else if (ended === 'defeat') outcome.defense++;
  else outcome.draw++;
}

// ---------------------------------------------------------------------------
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(0)}%` : '—');

console.log(`\n${'='.repeat(86)}`);
console.log(`${MATCHES} matches · ${POINTS}pts a side · ${DIFFICULTY} · both sides actively commanded`);
console.log('='.repeat(86));

console.log('\nOUTCOMES');
console.log(`  attacker wins   ${padL(outcome.attack, 4)}  ${pct(outcome.attack, MATCHES)}`);
console.log(`  defender wins   ${padL(outcome.defense, 4)}  ${pct(outcome.defense, MATCHES)}`
  + `   (${outcome.timeout} of them on the clock)`);
if (outcome.draw) console.log(`  draws           ${padL(outcome.draw, 4)}`);
console.log(`  planet actually destroyed: ${outcome.planetFell}/${MATCHES}`);
console.log(`  mean match length: ${(totalSeconds / MATCHES).toFixed(0)}s of ${TIME_LIMIT}`);
console.log(`  shots landed: ${pct(totalShotsHit, totalShotsFired)}`
  + ` (${totalShotsHit.toLocaleString()} of ${totalShotsFired.toLocaleString()})`);

console.log('\nPER HULL TYPE');
console.log(`  ${pad('type', 9)}${padL('fielded', 8)}${padL('lost', 6)}${padL('survive', 8)}`
  + `${padL('dmg dealt', 11)}${padL('taken', 10)}${padL('kills', 7)}`
  + `${padL('healed', 10)}${padL('value/pt', 9)}${padL('fired', 7)}`);
// Damage and healing are both "work done", so rank on their sum per point —
// otherwise every support hull sorts to the bottom by construction.
const value = (s) => (s.dealt + s.healed) / Math.max(1, s.points);
const rows = Object.values(stat).sort((a, b) => value(b) - value(a));
for (const s of rows) {
  console.log(`  ${pad(s.id, 9)}${padL(s.hulls, 8)}${padL(s.hullsLost, 6)}`
    + `${padL(pct(s.hulls - s.hullsLost, s.hulls), 8)}`
    + `${padL(Math.round(s.dealt).toLocaleString(), 11)}`
    + `${padL(Math.round(s.taken).toLocaleString(), 10)}`
    + `${padL(s.kills, 7)}`
    + `${padL(Math.round(s.healed).toLocaleString(), 10)}`
    + `${padL(value(s).toFixed(1), 9)}`
    + `${padL(pct(s.everFired, s.hulls), 7)}`);
}

console.log('\n  value/pt is (damage dealt + HP healed) per point spent, so support'
  + ' hulls are\n  credited for the work they actually do rather than scoring zero'
  + ' by construction.\n  "fired" is the share of hulls that ever landed a shot; low'
  + ' means the hull is\n  dying, idle, or out of position rather than fighting.');

// ---------------------------------------------------------------------------
console.log('\nDESIGN REFERENCE — what each hull does on paper');
console.log(`  ${pad('type', 9)}${padL('cost', 6)}${padL('hulls', 6)}${padL('hp ea', 7)}`
  + `${padL('dps ea', 7)}${padL('shot', 7)}${padL('rof', 6)}${padL('pen', 6)}`
  + `${padL('armor', 7)}${padL('range', 7)}${padL('track', 7)}`);
for (const id of Object.keys(ALL_TYPES)) {
  const t = ALL_TYPES[id];
  const d = derive(t);
  const w = t.weapon;
  console.log(`  ${pad(id, 9)}${padL(unitCost(t), 6)}${padL(t.count, 6)}`
    + `${padL(d.maxHealth.toFixed(0), 7)}${padL(d.dps.toFixed(1), 7)}`
    + `${padL(w ? (d.dps / w.rof).toFixed(1) : '—', 7)}`
    + `${padL(w ? w.rof : '—', 6)}`
    + `${padL(w ? (w.penetration ?? 0.5) : '—', 6)}`
    + `${padL(d.armor, 7)}${padL(d.range, 7)}${padL(d.tracking.toFixed(0), 7)}`);
}
console.log('');
