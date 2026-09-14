/**
 * Non-circular regression guard on the combat maths.
 *
 * Pulls the ORIGINAL minified combat functions straight out of the committed
 * bundle (recovered/siege-of-kepler-9-artifact.html), evaluates them, and
 * compares them against the reconstructed ones over thousands of randomised
 * inputs. It is non-circular because the reference is the shipped build, not
 * another copy of the same source — so an accidental change to a coefficient
 * shows up here even if it looks perfectly reasonable in the diff.
 *
 * ONE divergence is intentional and is asserted rather than tolerated:
 * `accuracy()` no longer exempts DEFEND squadrons from the stationary-target
 * bonus. For a moving target the two implementations must still agree exactly;
 * for a parked DEFEND target the reconstruction must be HIGHER by precisely
 * the bonus the old build was withholding. Anything else is drift.
 *
 *   node tools/verify-combat.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMBAT, SCOUTING, SHIPS, GROUND, derive } from '../src/config.js';
import { clamp } from '../src/util.js';
import { accuracy, shotDamage, motionFireFactor, armorFactor } from '../src/combat.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const BUNDLE = join(root, 'recovered', 'siege-of-kepler-9-artifact.html');

let src;
try {
  src = readFileSync(BUNDLE, 'utf8');
} catch {
  console.log('skip  reference bundle not present — nothing to compare against');
  process.exit(0);
}

/** Slice one whole function out of the minified source by brace matching. */
function fn(sig) {
  const i = src.indexOf(sig);
  if (i < 0) throw new Error(`not found in the reference bundle: ${sig}`);
  let depth = 0;
  let k = src.indexOf('{', i);
  for (; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) { k++; break; } }
  }
  return src.slice(i, k);
}

// In the minified build: Ce = COMBAT, Ne = clamp, Kl = accuracy,
// cg = motionFireFactor, $l = shotDamage, Aw = armorFactor.
const orig = new Function('Ce', 'Ne', `
  ${fn('function Kl(s,A){')}
  ${fn('function cg(s){')}
  ${fn('function $l(s,A){')}
  ${fn('function Aw(s,A,e,i=!0){')}
  return { acc: Kl, motion: cg, dmg: $l, armor: Aw };
`)(COMBAT, clamp);

const ALL = { ...SHIPS, ...GROUND };
const ids = Object.keys(ALL);
// tryFire() returns early on an unarmed hull, so it never reaches these.
const armed = ids.filter((k) => ALL[k].weapon);

// Its own generator, so this file's inputs never shift when the game's does.
let seed = 12345;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

function craftOf(type, { speed, anchored, siege, hp = 1, painted = true }) {
  const stats = derive(type);
  const unit = {
    type, stats, isGround: !!type.ground, faction: 'attack',
    isAnchored: anchored, siegeLock: siege, gunnery: 1,
  };
  return {
    unit, speed, alive: true, hp: stats.maxHealth * hp, maxHealth: stats.maxHealth,
    // Fire control, added after the original bundle was built. Neutralised by
    // config for the comparison below — see the note there.
    paintedBy: { attack: painted, defense: painted },
    // Far enough that motionFireFactor's in-range shortcut never fires.
    pos: { distanceToSquared: () => 1e9 }, target: null,
  };
}

/**
 * A view of `target` that claims not to be anchored.
 *
 * Removing the exemption means exactly one thing: a DEFEND target is now
 * treated the way the ORIGINAL build already treated everything else. So the
 * expected value is the original function run against this view — the bundle's
 * own code produces it, and the test never reimplements the formula it is
 * checking. (Adding the withheld bonus to the bundle's output instead would be
 * wrong whenever that output had been clamped to accuracyMin.)
 */
function asUnanchored(target) {
  return {
    ...target,
    unit: { ...target.unit, isAnchored: false },
  };
}

/**
 * Fire control is newer than the bundle, so the bundle cannot possibly agree
 * with it. Zeroing the two accuracy terms makes accuracy() reduce exactly to
 * the original formula (plus the one intentional DEFEND change, handled
 * below), which is what this file exists to check: that no coefficient of the
 * underlying gunnery has drifted. The new term is then asserted directly, on
 * its own terms, at the end — a property check rather than a comparison
 * against a build that predates it.
 */
const REAL_PAINT = { ...SCOUTING };
SCOUTING.paintedBonus = 0;
SCOUTING.unpaintedPenalty = 0;

let checks = 0;
let fails = 0;
let divergences = 0;
const near = (a, b) => Math.abs(a - b) < 1e-12;

const report = (label, a, b, note) => {
  checks++;
  if (near(a, b)) return true;
  fails++;
  if (fails <= 5) console.log(`  FAIL ${label}: mine=${a} bundle=${b}${note ? `  ${note}` : ''}`);
  return false;
};

for (let i = 0; i < 4000; i++) {
  const A = ALL[armed[Math.floor(rand() * armed.length)]];
  const B = ALL[ids[Math.floor(rand() * ids.length)]];
  const shooter = craftOf(A, {
    speed: rand() * 150, anchored: rand() < 0.3, siege: rand() < 0.2,
  });
  const target = craftOf(B, {
    speed: rand() * 150, anchored: rand() < 0.3, siege: false, hp: rand(),
  });

  // --- the one intentional divergence -------------------------------------
  const mineAcc = accuracy(shooter, target);
  const theirsAcc = orig.acc(shooter, target);
  const exempted = !A.weapon.ignoresEvasion && target.unit.isAnchored;

  if (!exempted) {
    // No exemption was in play, so the two must agree exactly.
    report(`accuracy(${A.id} vs ${B.id})`, mineAcc, theirsAcc);
  } else {
    // The exemption applied: the reconstruction must match the original run
    // against an identical, non-anchored target.
    const expected = orig.acc(shooter, asUnanchored(target));
    if (report(`accuracy-divergence(${A.id} vs ${B.id})`, mineAcc, expected,
      '(expected the removed DEFEND exemption)')) {
      // Only count cases where the change actually moved the number, so the
      // coverage warning below cannot be satisfied by no-op comparisons.
      if (mineAcc > theirsAcc + 1e-12) divergences++;
    }
  }

  // --- everything else must be untouched ----------------------------------
  report('motionFire', motionFireFactor(shooter), orig.motion(shooter));
  report('armorFactor', armorFactor(A, target, 0.8), orig.armor(A, target, 0.8));
  report('armorFactor(noAF)',
    armorFactor(A, target, 0.2, false), orig.armor(A, target, 0.2, false));

  // shotDamage multiplies accuracy in via nothing, but it does read
  // motionFireFactor — so it must still match the bundle exactly.
  report('shotDamage', shotDamage(shooter, target), orig.dmg(shooter, target));
}

console.log(`\n  ${checks - fails}/${checks} combat-maths checks match the original bundle`);
console.log(`  ${divergences} of them were the intentional DEFEND-exemption change,`
  + ' verified to be exactly the withheld bonus');
if (!divergences) {
  console.log('  WARNING: the intentional divergence never triggered — this test'
    + ' is no longer covering it');
  process.exitCode = 1;
}
process.exitCode = fails ? 1 : (process.exitCode || 0);

// ---------------------------------------------------------------------------
// Fire control, checked on its own terms.
//
// Nothing to compare against — the mechanic postdates the reference bundle —
// so this asserts the property instead: a painted target and an unpainted one
// differ by exactly the two configured terms, wherever the result is not
// sitting on a clamp. Checking away from the clamps matters, because that is
// where an offset test can silently pass while doing nothing.
// ---------------------------------------------------------------------------
Object.assign(SCOUTING, REAL_PAINT);
const gap = REAL_PAINT.paintedBonus + REAL_PAINT.unpaintedPenalty;
let paintChecks = 0;
let paintFails = 0;
let paintClamped = 0;

for (let i = 0; i < 4000; i++) {
  const A = ALL[armed[Math.floor(rand() * armed.length)]];
  const B = ALL[ids[Math.floor(rand() * ids.length)]];
  const opts = { speed: rand() * 150, anchored: false, siege: false };
  const shooter = craftOf(A, opts);
  const hi = accuracy(shooter, craftOf(B, { ...opts, hp: 1, painted: true }));
  const lo = accuracy(shooter, craftOf(B, { ...opts, hp: 1, painted: false }));
  if (hi >= COMBAT.accuracyMax - 1e-9 || lo <= COMBAT.accuracyMin + 1e-9) {
    paintClamped++;
    continue;
  }
  paintChecks++;
  if (Math.abs((hi - lo) - gap) > 1e-12) {
    paintFails++;
    if (paintFails <= 3) {
      console.log(`  FAIL paint(${A.id} vs ${B.id}): painted=${hi} unpainted=${lo}`
        + ` gap=${hi - lo} expected=${gap}`);
    }
  }
}

console.log(`  ${paintChecks - paintFails}/${paintChecks} fire-control offsets exact`
  + ` (${paintClamped} skipped at an accuracy clamp)`);
if (!paintChecks) {
  console.log('  WARNING: every fire-control case was clamped — this proved nothing');
}
if (paintFails) process.exitCode = 1;
