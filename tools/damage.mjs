/**
 * The damage model, printed.
 *
 * Every number here is computed by calling the real `accuracy()`,
 * `shotDamage()` and `armorFactor()` from src/combat.js against synthetic
 * craft, so it cannot drift from what the game does. It answers: what does
 * each hull actually do to each other hull, per second, once tracking,
 * evasion, armour and penetration are all applied.
 *
 *   node tools/damage.mjs           the matrix, plus the chain explained
 *   node tools/damage.mjs stance    prove whether ATTACK and DEFEND differ
 */
import { accuracy, shotDamage, motionFireFactor } from '../src/combat.js';
import { ALL_TYPES, SHIPS, COMBAT, SHIELDS, derive, unitCost } from '../src/config.js';

const ids = Object.keys(ALL_TYPES);
const armed = ids.filter((id) => ALL_TYPES[id].weapon);

/**
 * A stand-in craft. `speed` matters: a hull below `evasionMotionFloor` of its
 * top speed hands the shooter an accuracy bonus, so "moving" is the honest
 * default for a combat comparison.
 */
function craftOf(type, { moving = true, anchored = false, siege = false } = {}) {
  const stats = derive(type);
  const unit = {
    type, stats, isGround: !!type.ground,
    isAnchored: anchored, siegeLock: siege, gunnery: 1,
    shieldOn: false,
  };
  return {
    unit,
    speed: moving ? stats.maxSpeed : 0,
    alive: true, hp: stats.maxHealth, maxHealth: stats.maxHealth,
    damageReduction: 0, shield: 0,
    // Far away, so motionFireFactor's "target in range" shortcut cannot fire
    // and we measure the stance rule rather than the proximity rule.
    pos: { distanceToSquared: () => 1e9 }, target: null,
  };
}

/** Sustained squadron DPS of `a` against one hull of `b`. */
function effectiveDps(aId, bId, opts = {}) {
  const A = ALL_TYPES[aId];
  const B = ALL_TYPES[bId];
  const shooter = craftOf(A, opts.shooter);
  const target = craftOf(B, opts.target);
  const perShot = shotDamage(shooter, target);
  const acc = accuracy(shooter, target);
  // shotDamage is one round; rof rounds a second; count hulls in the squadron.
  return perShot * A.weapon.rof * acc * A.count;
}

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

const mode = process.argv[2];

if (mode === 'stance') {
  // ---------------------------------------------------------------------
  console.log('\nDOES STANCE CHANGE DAMAGE?\n' + '='.repeat(64));
  console.log('\nSame two hulls, only the stance flag changed.\n');
  console.log(`  ${pad('shooter', 9)}${pad('target', 9)}${padL('vs MOVE', 10)}`
    + `${padL('vs DEFEND', 11)}${padL('difference', 12)}`);
  let anyDiff = false;
  for (const aId of ['falcon', 'bastion', 'wasp', 'sentry']) {
    for (const bId of ['warden', 'bastion', 'wasp']) {
      const vsMoving = effectiveDps(aId, bId, { target: { moving: true, anchored: false } });
      const vsAnchored = effectiveDps(aId, bId, { target: { moving: true, anchored: true } });
      const diff = vsAnchored - vsMoving;
      if (Math.abs(diff) > 1e-9) anyDiff = true;
      console.log(`  ${pad(aId, 9)}${pad(bId, 9)}${padL(vsMoving.toFixed(1), 10)}`
        + `${padL(vsAnchored.toFixed(1), 11)}${padL(diff.toFixed(3), 12)}`);
    }
  }
  console.log(`\n  => taking damage ${anyDiff ? 'DOES' : 'does NOT'} depend on stance.`);

  console.log('\nWhat a full stop costs you, in accuracy handed to the enemy:\n');
  console.log(`  ${pad('target', 9)}${padL('moving', 9)}${padL('stopped', 9)}${padL('extra', 8)}`);
  for (const bId of ['wasp', 'falcon', 'warden', 'bastion']) {
    const moving = accuracy(craftOf(ALL_TYPES.falcon), craftOf(ALL_TYPES[bId], { moving: true }));
    const still = accuracy(craftOf(ALL_TYPES.falcon), craftOf(ALL_TYPES[bId], { moving: false }));
    console.log(`  ${pad(bId, 9)}${padL(moving.toFixed(3), 9)}${padL(still.toFixed(3), 9)}`
      + `${padL(`+${(still - moving).toFixed(3)}`, 8)}`);
  }
  console.log('  (a Falcon shooting; the rule is the same whoever fires)');

  console.log('\nOUTGOING fire, by stance — motionFireFactor:\n');
  console.log(`  ${pad('hull', 9)}${padL('MOVE, parked', 14)}${padL('DEFEND, parked', 16)}`
    + `${padL('anything, in range', 20)}`);
  for (const id of ['falcon', 'bastion', 'wasp']) {
    const parkedMove = motionFireFactor(craftOf(ALL_TYPES[id], { moving: false }));
    const parkedDefend = motionFireFactor(
      craftOf(ALL_TYPES[id], { moving: false, anchored: true }));
    console.log(`  ${pad(id, 9)}${padL(parkedMove.toFixed(2), 14)}`
      + `${padL(parkedDefend.toFixed(2), 16)}${padL('1.00', 20)}`);
  }
  console.log('\n  The MOVE penalty only applies with NOTHING in weapon range, so in an');
  console.log('  actual engagement every stance fires at full rate. It exists to stop');
  console.log('  a fleet drifting to a halt in empty space and still shooting fully.');
  console.log('');
} else {
  // ---------------------------------------------------------------------
  console.log(`\nEFFECTIVE DPS — one squadron of ROW against one hull of COLUMN`);
  console.log('='.repeat(96));
  console.log('Tracking vs agility, then penetration vs armour. Target moving.\n');
  console.log(pad('', 10) + ids.map((s) => padL(s.slice(0, 7), 9)).join(''));
  for (const aId of armed) {
    const cells = ids.map((bId) => padL(effectiveDps(aId, bId).toFixed(0), 9));
    console.log(pad(aId, 10) + cells.join(''));
  }

  console.log(`\nSAME, PER POINT SPENT  (effective dps / squadron cost x 100)`);
  console.log('='.repeat(96) + '\n');
  console.log(pad('', 10) + ids.map((s) => padL(s.slice(0, 7), 9)).join(''));
  for (const aId of armed) {
    const cost = unitCost(ALL_TYPES[aId]);
    const cells = ids.map((bId) =>
      padL(((effectiveDps(aId, bId) / cost) * 100).toFixed(0), 9));
    console.log(pad(aId, 10) + cells.join(''));
  }

  console.log(`\nHIT CHANCE  (row shooting at column, target moving)`);
  console.log('='.repeat(96) + '\n');
  console.log(pad('', 10) + ids.map((s) => padL(s.slice(0, 7), 9)).join(''));
  for (const aId of armed) {
    const cells = ids.map((bId) => padL(
      `${(accuracy(craftOf(ALL_TYPES[aId]), craftOf(ALL_TYPES[bId])) * 100).toFixed(0)}%`, 9));
    console.log(pad(aId, 10) + cells.join(''));
  }

  console.log(`\nARMOUR PASS-THROUGH  (what fraction of a landed shot gets through)`);
  console.log('='.repeat(96));
  console.log('mul = 1 - armour x (1 - penetration). Flak also gets x1.9 vs agility>=60'
    + ' and x0.45 vs health>=75.\n');
  console.log(pad('', 10) + ids.map((s) => padL(s.slice(0, 7), 9)).join(''));
  for (const aId of armed) {
    const A = ALL_TYPES[aId];
    const cells = ids.map((bId) => {
      const shooter = craftOf(A);
      const target = craftOf(ALL_TYPES[bId]);
      // shotDamage divided by the unmodified per-shot value isolates the
      // armour/anti-fighter multiplier.
      const base = derive(A).dps / A.weapon.rof;
      return padL((shotDamage(shooter, target) / base).toFixed(2), 9);
    });
    console.log(pad(aId, 10) + cells.join(''));
  }

  console.log(`\n\nTHE CHAIN, ONE SHOT`);
  console.log('='.repeat(96));
  console.log(`
  1  RATE      rof shots/sec, x2 while Sentry Overcharge is up,
               x${SHIELDS.fireRate} while your own shields are raised.

  2  ACCURACY  0.5 + (tracking - target.agility) / ${COMBAT.accuracySpread}
               tracking = agility x0.5 + skill x0.5  (+${COMBAT.groundTrackingBias} for ground)
               + up to ${(COMBAT.evasionMotionFloor * 0.9).toFixed(3)} more if the target is nearly stopped
                 (below ${COMBAT.evasionMotionFloor} of its own top speed)
               clamped to [${COMBAT.accuracyMin}, ${COMBAT.accuracyMax}]
               Flak ignores all of this and always rolls 0.75.
               Rolled at the muzzle: a hit becomes a guided round, a miss
               becomes an unguided one that visibly flies wide.

  3  DAMAGE    perShot = dps / rof
               x (1 - target.armour x (1 - penetration))
               x motionFireFactor   (1.0 with anything in range)
               x gunnery            (0.75 on EASY, else 1.0 - AI only)

  4  ARRIVAL   x (1 - damageReduction)   Bastion Overcharge = 0.50
               x ${SHIELDS.damageTaken} if the target's shields are up
               then absorbed by any shield pool (Warden bubble)
               remainder comes off hull HP

  Penetration is the counter to armour, and it is the whole rock-paper-scissors:
  a Wasp (pen ${SHIPS.wasp.weapon.penetration}) loses ${((1 - (1 - SHIPS.bastion.armor * (1 - SHIPS.wasp.weapon.penetration))) * 100).toFixed(0)}% of every shot to a Bastion's armour,
  while a Bastion (pen ${SHIPS.bastion.weapon.penetration}) ignores armour entirely.
`);
}
