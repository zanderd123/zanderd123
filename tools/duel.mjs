/**
 * Head-to-head matchup matrix.
 *
 * Runs every ship type against every other in an isolated duel — no planet,
 * no terrain, no AI commander, nothing but the two squadrons and the combat
 * model — and reports who wins, how fast, and how much of the winner is left.
 *
 * Two views, because they answer different questions:
 *
 *   SQUADRON  one squadron as you buy it, against one of theirs. This is the
 *             literal "what happens if these two meet" answer, and it is NOT
 *             points-fair: a Falcon squadron costs 204 and a Bastion 82.
 *   PER POINT the same duel with both sides scaled to roughly equal points,
 *             which is the question that actually matters when building a
 *             fleet under a budget.
 *
 * Both sides are set to ATTACK so they close and fight rather than sit at
 * their spawn. Abilities autocast, as they do in a real battle.
 *
 *   node tools/duel.mjs            both views
 *   node tools/duel.mjs squadron   just the first
 *   node tools/duel.mjs point      just the second
 */
import * as THREE from 'three';
import { Game } from '../src/game.js';
import { SHIPS, unitCost, FACTION } from '../src/config.js';

// ---------------------------------------------------------------------------
// A renderer that does nothing, so the simulation can run headless.
// ---------------------------------------------------------------------------
const noopFx = {
  build() {}, disposeBatches() {}, update() {}, emitTrails() {},
  explode() {}, impact() {}, bubble() {}, syncShields() {},
  tracers: { begin() {}, push() {}, end() {} },
};

const SHIP_IDS = Object.keys(SHIPS);
const STEP = 1 / 30;
const MAX_SECONDS = 180;
/** Far enough from the planet that nobody tries to bombard it. */
const ARENA_Z = -2500;
const SEPARATION = 700;

function place(unit, pos) {
  const delta = pos.clone().sub(unit.pos);
  for (const c of unit.craft) c.pos.add(delta);
  unit.updateCentroid();
  unit.movePos.copy(unit.pos);
}

/**
 * One duel. `aQty`/`bQty` let the caller buy more than one squadron a side so
 * the two can be matched on points.
 */
function duel(aId, bId, seed, aQty = 1, bQty = 1) {
  const game = new Game(noopFx, { seed, timeLimit: 0, fog: false });
  game.reset();
  game.start(
    [{ typeId: aId, qty: aQty }],
    [{ typeId: bId, qty: bQty }],
    FACTION.ATTACK,
  );
  // A pure ship-vs-ship test: no objective to distract either side.
  game.planet = null;

  const side = (f) => game.units.filter((u) => u.faction === f);
  const attackers = side(FACTION.ATTACK);
  const defenders = side(FACTION.DEFENSE);

  // Face them off well clear of the world, then let them come to each other.
  attackers.forEach((u, i) => {
    place(u, new THREE.Vector3((i - (attackers.length - 1) / 2) * 220, 0, ARENA_Z - SEPARATION / 2));
    u.stance = 'attack';
  });
  defenders.forEach((u, i) => {
    place(u, new THREE.Vector3((i - (defenders.length - 1) / 2) * 220, 0, ARENA_Z + SEPARATION / 2));
    u.stance = 'attack';
  });

  const aliveOn = (f) => game.units.some((u) => u.faction === f && u.alive);
  const hpOn = (f) => {
    let hp = 0;
    let full = 0;
    for (const u of game.units) {
      if (u.faction !== f) continue;
      // A carrier's dormant brood is not "missing health" — count only what
      // is or was actually in play.
      for (const c of u.craft) { if (c.alive) { hp += c.hp; full += c.maxHealth; } }
    }
    return full ? hp / full : 0;
  };

  let t = 0;
  while (t < MAX_SECONDS && aliveOn(FACTION.ATTACK) && aliveOn(FACTION.DEFENSE)) {
    game.step(STEP);
    t += STEP;
  }

  const aAlive = aliveOn(FACTION.ATTACK);
  const bAlive = aliveOn(FACTION.DEFENSE);
  let result = 'draw';
  if (aAlive && !bAlive) result = 'a';
  else if (bAlive && !aAlive) result = 'b';
  return { result, seconds: t, aHp: hpOn(FACTION.ATTACK), bHp: hpOn(FACTION.DEFENSE) };
}

/** Buy roughly `budget` points of a type, at least one squadron. */
function qtyFor(id, budget) {
  return Math.max(1, Math.round(budget / unitCost(SHIPS[id])));
}

function runMatrix(label, quantities) {
  const SEEDS = 9;
  const rows = [];
  const winRate = {};

  for (const a of SHIP_IDS) {
    const row = {};
    for (const b of SHIP_IDS) {
      if (a === b) { row[b] = null; continue; }
      let wins = 0;
      let draws = 0;
      let secs = 0;
      let hp = 0;
      for (let s = 0; s < SEEDS; s++) {
        const [qa, qb] = quantities(a, b);
        const r = duel(a, b, 1000 + s * 77, qa, qb);
        if (r.result === 'a') { wins++; hp += r.aHp; }
        else if (r.result === 'draw') draws++;
        secs += r.seconds;
      }
      row[b] = {
        pct: Math.round((wins / SEEDS) * 100),
        draw: Math.round((draws / SEEDS) * 100),
        secs: secs / SEEDS,
        hp: wins ? hp / wins : 0,
      };
    }
    rows.push([a, row]);
    const played = SHIP_IDS.filter((b) => b !== a);
    winRate[a] = played.reduce((s, b) => s + row[b].pct, 0) / played.length;
  }

  // ---- matrix ----
  console.log(`\n${'='.repeat(78)}\n${label}\n${'='.repeat(78)}`);
  console.log('Row beats column, % of 9 duels.\n');
  const pad = (s, n) => String(s).padEnd(n);
  const padL = (s, n) => String(s).padStart(n);
  console.log(pad('', 10) + SHIP_IDS.map((s) => padL(s.slice(0, 7), 8)).join(''));
  for (const [a, row] of rows) {
    const cells = SHIP_IDS.map((b) => {
      if (row[b] === null) return padL('—', 8);
      // A stalemate is a real outcome and must not read as a loss.
      return padL(row[b].draw >= 50 ? 'stale' : `${row[b].pct}%`, 8);
    });
    console.log(pad(a, 10) + cells.join(''));
  }

  // ---- overall ----
  console.log('\nOverall win rate across all opponents:');
  for (const [id, wr] of Object.entries(winRate).sort((x, y) => y[1] - x[1])) {
    const cost = unitCost(SHIPS[id]);
    const bar = '#'.repeat(Math.round(wr / 3));
    console.log(`  ${pad(id, 10)} ${padL(wr.toFixed(0) + '%', 5)}  ${pad(bar, 34)} ${padL(cost + 'pts', 8)}`);
  }

  // ---- the lopsided pairs, which is where the design actually lives ----
  const decisive = [];
  for (const [a, row] of rows) {
    for (const b of SHIP_IDS) {
      if (row[b] === null) continue;
      if (row[b].pct >= 89) {
        decisive.push({ a, b, pct: row[b].pct, secs: row[b].secs, hp: row[b].hp });
      }
    }
  }
  decisive.sort((x, y) => (y.pct - x.pct) || (x.secs - y.secs));
  console.log('\nHard counters (>=89% and how comfortably):');
  if (!decisive.length) console.log('  none — no matchup is that one-sided');
  for (const d of decisive) {
    console.log(`  ${pad(d.a, 9)} beats ${pad(d.b, 9)} ${padL(d.pct + '%', 5)}`
      + `  in ${padL(d.secs.toFixed(0) + 's', 5)}`
      + `  with ${(d.hp * 100).toFixed(0)}% health left`);
  }
  return rows;
}

const which = process.argv[2];
if (!which || which === 'squadron') {
  runMatrix('SQUADRON vs SQUADRON  (one squadron each, as bought — not points-fair)',
    () => [1, 1]);
}
if (!which || which === 'point') {
  const BUDGET = 400;
  runMatrix(`EQUAL POINTS  (~${BUDGET}pts a side — the fleet-building question)`,
    (a, b) => [qtyFor(a, BUDGET), qtyFor(b, BUDGET)]);
}
