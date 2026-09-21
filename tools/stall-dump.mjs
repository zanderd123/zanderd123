/**
 * Replay one match and narrate a chosen window, hull by hull.
 *
 * tools/deadair.mjs says a stretch of quiet happened and roughly what the
 * board looked like. This is the next zoom level: every surviving squadron,
 * every second, with the fields that decide whether it will shoot — what it
 * can see, what it has resolved, what it is holding, how far it is from the
 * nearest enemy and from the objective, and where it has been told to go.
 *
 *   node tools/stall-dump.mjs [match] [from] [to]
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

const MATCH = Number(process.argv[2] || 57);
const FROM = Number(process.argv[3] || 380);
const TO = Number(process.argv[4] || 420);
const STEP = 1 / 30;
const PLANET = new THREE.Vector3(...WORLD.planetCenter);

const m = MATCH - 1;
const seed = 1000 + m * 137;
const game = new Game(noopFx, { seed, fog: true });
game.reset();
game.start(
  generateFleet(budgetFor(FACTION.ATTACK, 1000), 'attack', seed),
  generateFleet(budgetFor(FACTION.DEFENSE, 1000), 'defense', seed + 1),
  FACTION.ATTACK,
);
game.state = 'playing';

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
let nextReport = FROM;
// When did each side last lose a squadron? A stall that begins the instant
// the board thins out is a different animal from one that begins mid-fight.
const deaths = [];
const wasAlive = new Set(game.units.filter((u) => u.alive).map((u) => u.id));

console.log(`\n  match ${MATCH} (seed ${seed}) · ${handPlayed ? 'hand-played' : 'AI v AI'}`);
console.log(`  planet radius ${WORLD.planetRadius}\n`);

while (!ended && t < TIME_LIMIT + 1) {
  game.step(STEP);
  if (attackAI) attackAI.update(STEP);
  defenseAI.update(STEP);
  t += STEP;

  for (const u of game.units) {
    if (!u.alive && wasAlive.has(u.id)) {
      wasAlive.delete(u.id);
      deaths.push({ t, label: u.label, type: u.type.id, faction: u.faction });
    }
  }

  if (t >= nextReport && t <= TO) {
    nextReport += 5;
    console.log(`  t=${t.toFixed(0)}s   crust ${(game.planet.fraction * 100).toFixed(0)}%`
      + `   in flight ${game.projectiles.list.length}`
      + `${defenseAI.sweeping ? '   [defence sweeping]' : ''}`);
    for (const u of game.units) {
      if (!u.alive) continue;
      const foes = game.units.filter((e) => e.alive && e.faction !== u.faction);
      let near = Infinity;
      let nearLabel = '—';
      for (const e of foes) {
        const d = u.pos.distanceTo(e.pos);
        if (d < near) { near = d; nearLabel = e.label; }
      }
      const live = u.craft.filter((c) => c.alive);
      const holding = live.filter((c) => c.target && c.target.alive).length;
      const seesAny = foes.filter((e) => e.craft.some((c) => c.alive && c.seenBy[u.faction])).length;
      const paints = foes.filter((e) => e.paintedFor(u.faction)).length;
      const dest = u.dest ? u.dest.distanceTo(PLANET).toFixed(0) : '—';
      console.log(`    ${u.faction === 'attack' ? 'A' : 'D'} ${u.label.padEnd(10)}`
        + ` ${u.type.id.padEnd(8)}`
        + ` ${String(live.length).padStart(3)} hulls`
        + `  ${u.isGround ? 'ground' : 'flying'}`
        + `  stance ${u.stance.padEnd(6)}`
        + `  sensor ${String(u.stats.sensor).padStart(4)}`
        + `  range ${String(u.stats.range).padStart(4)}`
        + `  ${near === Infinity ? '' : `nearest ${near.toFixed(0)} (${nearLabel})`}`
        + `  d(planet) ${u.pos.distanceTo(PLANET).toFixed(0)}`
        + `  sees ${seesAny}/${foes.length}  resolves ${paints}`
        + `  holding ${holding}`
        + `  siege ${u.siegeLock ? 'yes' : 'no'}`
        + `${u.siegeCapital ? '' : ' (cannot bombard)'}`
        + `  dest d(planet) ${dest}`);
    }
    console.log('');
  }
}

console.log(`  ended '${ended}' at ${game.now.toFixed(0)}s\n`);
console.log('  last squadrons lost:');
for (const d of deaths.slice(-8)) {
  console.log(`    ${d.t.toFixed(0).padStart(4)}s  ${d.faction === 'attack' ? 'A' : 'D'}`
    + ` ${d.label} (${d.type})`);
}
console.log('');
