/**
 * Does the salvo layer behave the way the model says it should?
 *
 * Three claims worth testing, because each is the reason the mechanic exists:
 *
 *  1. It fires at all, and lands a meaningful share of the damage in a match.
 *     A volley nobody ever throws is dead code with a config block.
 *  2. Counterforce SUBTRACTS. Hughes' distinctive property is that point
 *     defence is a threshold, not a percentage — a little against a big salvo
 *     is nearly worthless, enough zeroes it outright. If interception scales
 *     smoothly with how much Flak is present, the mechanic is not doing what
 *     it claims and is just a damage modifier.
 *  3. Scouting pays. A salvo reaches 1.4x range on a resolved target and is
 *     held to the unpainted gun range otherwise, which should show up as a
 *     large difference in where volleys are thrown from.
 *
 *   node tools/salvo.mjs            match statistics over N matches
 *   node tools/salvo.mjs screen     counterforce threshold: Flak 0..4
 */
import { Game } from '../src/game.js';
import { Commander, generateFleet } from '../src/ai.js';
import { FACTION, TIME_LIMIT, SALVO, SHIPS, GROUND, budgetFor } from '../src/config.js';

const noopFx = {
  build() {}, disposeBatches() {}, update() {}, emitTrails() {},
  explode() {}, impact() {}, bubble() {}, syncShields() {}, applyGfx() {},
  tracers: { begin() {}, push() {}, end() {} },
};

const MODE = process.argv[2] === 'screen' ? 'screen' : 'match';
const MATCHES = Number(process.argv[3] || 24);
const BUDGET = 1000;
const STEP = 1 / 30;

/** Run one match, returning everything the salvo layer did in it. */
function play(seed, { attackRoster, defenseRoster } = {}) {
  const game = new Game(noopFx, { seed, fog: true });
  game.reset();
  game.start(
    attackRoster || generateFleet(budgetFor(FACTION.ATTACK, BUDGET), 'attack', seed),
    defenseRoster || generateFleet(BUDGET, 'defense', seed + 1),
    FACTION.ATTACK,
  );
  game.state = 'playing';
  const a = new Commander(game, FACTION.ATTACK, 'medium');
  const d = new Commander(game, FACTION.DEFENSE, 'medium');

  const stat = {
    thrown: 0, rounds: 0, intercepted: 0, landed: 0,
    zeroed: 0, reachSum: 0, reachN: 0, painted: 0,
    byFaction: { attack: 0, defense: 0 },
  };
  game.onSalvo = (unit, target, rounds, intercepted, landed) => {
    stat.thrown++;
    stat.rounds += rounds;
    stat.intercepted += Math.min(intercepted, rounds);
    stat.landed += landed;
    if (!landed) stat.zeroed++;
    stat.byFaction[unit.faction]++;
    const d2 = unit.pos.distanceTo(target.pos);
    stat.reachSum += d2 / unit.stats.range;
    stat.reachN++;
    if (target.paintedFor(unit.faction)) stat.painted++;
  };

  let ended = null;
  game.onEnd = (s) => { ended = s; };
  let t = 0;
  while (!ended && t < TIME_LIMIT + 1) {
    game.step(STEP); a.update(STEP); d.update(STEP); t += STEP;
  }
  stat.won = ended === 'victory';
  stat.secs = game.now;
  return stat;
}

if (MODE === 'match') {
  const tot = {
    thrown: 0, rounds: 0, intercepted: 0, landed: 0, zeroed: 0,
    reachSum: 0, reachN: 0, painted: 0, secs: 0, wins: 0,
    byFaction: { attack: 0, defense: 0 },
  };
  for (let m = 0; m < MATCHES; m++) {
    const r = play(1000 + m * 137);
    for (const k of ['thrown', 'rounds', 'intercepted', 'landed', 'zeroed',
      'reachSum', 'reachN', 'painted', 'secs']) tot[k] += r[k];
    tot.byFaction.attack += r.byFaction.attack;
    tot.byFaction.defense += r.byFaction.defense;
    tot.wins += r.won ? 1 : 0;
  }
  const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(0)}%` : '—');
  console.log(`\n  ${MATCHES} matches · ${BUDGET}pts · medium\n`);
  console.log(`  salvos thrown            ${String(tot.thrown).padStart(6)}`
    + `   (${(tot.thrown / MATCHES).toFixed(1)} a match,`
    + ` ${tot.byFaction.attack} attacking / ${tot.byFaction.defense} defending)`);
  console.log(`  rounds in those salvos   ${String(tot.rounds).padStart(6)}`);
  console.log(`  shot down on the way in  ${String(tot.intercepted).padStart(6)}   ${pct(tot.intercepted, tot.rounds)}`);
  console.log(`  arrived                  ${String(tot.landed).padStart(6)}   ${pct(tot.landed, tot.rounds)}`);
  console.log(`  volleys stopped dead     ${String(tot.zeroed).padStart(6)}   ${pct(tot.zeroed, tot.thrown)}`);
  console.log(`  thrown at a resolved hull${String(tot.painted).padStart(6)}   ${pct(tot.painted, tot.thrown)}`);
  console.log(`  mean throw distance      ${(tot.reachSum / Math.max(1, tot.reachN)).toFixed(2)}x the hull's gun range`);
  console.log(`  (a salvo reaches ${SALVO.paintedReach}x on a resolved target)`);
  console.log(`\n  attacker wins ${tot.wins}/${MATCHES}   mean length ${(tot.secs / MATCHES).toFixed(0)}s`);
}

if (MODE === 'screen') {
  // The threshold test. A fixed attacking fleet of Bastions throws 6-round
  // salvos; the defence is the same every time except for how many Flak
  // Walkers (3 counterforce each) are standing with it. If counterforce
  // subtracts, interception should climb in steps and hit 100% between 2 and
  // 3 walkers — not rise smoothly from nothing.
  console.log(`\n  Bastion salvo is ${SHIPS.bastion.salvo.rounds} rounds;`
    + ` a Flak Walker screens ${GROUND.flak.counterforce},`
    + ` an Aegis ${SHIPS.aegis.counterforce}.\n`);
  console.log('  flak   salvos   rounds   intercepted   arrived   volleys stopped dead');
  for (let flak = 0; flak <= 4; flak++) {
    const attackRoster = [{ typeId: 'bastion', qty: 4 }, { typeId: 'falcon', qty: 2 }];
    const defenseRoster = [{ typeId: 'warden', qty: 4 }, { typeId: 'bastion', qty: 2 }];
    if (flak) defenseRoster.push({ typeId: 'flak', qty: flak });
    let thrown = 0; let rounds = 0; let inter = 0; let landed = 0; let zero = 0;
    for (let m = 0; m < MATCHES; m++) {
      const r = play(1000 + m * 137, { attackRoster, defenseRoster });
      thrown += r.byFaction.attack;
      // Only the attacker's volleys are the experiment; the defence has no
      // Sentries in this roster so every salvo counted is a Bastion's.
      rounds += r.rounds;
      inter += r.intercepted;
      landed += r.landed;
      zero += r.zeroed;
    }
    const pc = (n) => (rounds ? `${((n / rounds) * 100).toFixed(0)}%` : '—');
    console.log(`  ${String(flak).padStart(4)}   ${String(thrown).padStart(6)}`
      + `   ${String(rounds).padStart(6)}`
      + `   ${String(inter).padStart(6)} ${pc(inter).padStart(5)}`
      + `   ${String(landed).padStart(5)} ${pc(landed).padStart(5)}`
      + `   ${String(zero).padStart(6)}`
      + `  ${thrown ? `${((zero / thrown) * 100).toFixed(0)}%` : '—'}`);
  }
  console.log(`\n  ${MATCHES} matches a row, identical fleets but for the Flak count.`);
}
