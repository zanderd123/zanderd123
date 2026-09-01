/**
 * Gunnery: who can see whom, who shoots at what, and how hard it lands.
 *
 * The chain for one shot is accuracy x damage, and the two are deliberately
 * separate. Accuracy asks "can this gun track that hull" (the firing ship's
 * tracking against the target's agility); damage asks "does the round get
 * through" (the weapon's penetration against the target's armour). Keeping
 * them apart is what lets a Wasp be almost impossible to hit yet unable to
 * hurt a Bastion, and a Bastion be trivially hittable yet nearly immune to
 * the things hitting it.
 */
import * as THREE from 'three';
import { COMBAT, WORLD } from './config.js';
import { clamp, leadPoint, angleToTarget } from './util.js';

const _lead = new THREE.Vector3();
const _steer = new THREE.Vector3();
const _tmp = new THREE.Vector3();

/**
 * Chance for one shot to land, before damage is applied.
 *
 * A hull that is barely moving is easier to hit, and that rule applies to
 * every stance without exception. DEFEND used to be exempt — a parked
 * defending squadron kept full evasion while everything else lost it — which
 * made "select everything, press G, do nothing" the strongest way to play the
 * defence by a wide margin. Standing still is a real trade now: you hold your
 * ground and your firing line, and you are easier to shoot.
 */
export function accuracy(craft, target) {
  const weapon = craft.unit.type.weapon;
  // Proximity-fused flak does not track at all; it just needs to be near.
  // Without this the designated anti-fighter unit could not hit fighters,
  // because its tracking against a Wasp's agility lands on the floor.
  if (weapon.ignoresEvasion) return weapon.flatAccuracy ?? 0.75;

  let acc = 0.5
    + (craft.unit.stats.tracking - target.unit.type.agility) / COMBAT.accuracySpread;

  const motion = clamp(target.speed / Math.max(1, target.unit.stats.maxSpeed), 0, 1);
  if (motion < COMBAT.evasionMotionFloor) {
    acc += (COMBAT.evasionMotionFloor - motion) * 0.9;
  }
  return clamp(acc, COMBAT.accuracyMin, COMBAT.accuracyMax);
}

/**
 * Firing while parked costs output — but only when there is nothing already
 * inside weapon range. Holding a firing line and actually shooting at
 * something is full strength; drifting to a stop in empty space is not.
 *
 * Ground emplacements, ships locked into a bombardment, and squadrons on
 * DEFEND are all exempt: standing still is the entire job in each case.
 */
export function motionFireFactor(craft) {
  const unit = craft.unit;
  if (unit.isGround || unit.siegeLock || unit.isAnchored) return 1;
  const t = craft.target;
  if (t && t.alive && craft.pos.distanceToSquared(t.pos) <= unit.stats.range ** 2) return 1;
  const { floor, fullAt } = COMBAT.motionFire;
  const maxSpeed = unit.stats.maxSpeed;
  if (maxSpeed <= 0) return 1;
  const k = clamp(craft.speed / maxSpeed / Math.max(0.001, fullAt), 0, 1);
  return floor + (1 - floor) * k;
}

/**
 * How much armour lets through. Penetration 1.0 ignores armour entirely;
 * penetration 0 means armour applies at full value.
 */
export function armorFactor(type, target, penetration, applyAntiFighter = true) {
  const pen = penetration ?? type.weapon?.penetration ?? 0.5;
  let mul = 1 - target.unit.stats.armor * (1 - pen);
  if (type.antiFighter && applyAntiFighter) {
    const tt = target.unit.type;
    if (tt.agility >= COMBAT.flakAgilityThreshold) mul *= COMBAT.flakAgilityBonus;
    if (tt.health >= COMBAT.flakArmorThreshold) mul *= COMBAT.flakArmorPenalty;
  }
  return Math.max(0, mul);
}

/** Damage for a single round that lands. */
export function shotDamage(craft, target) {
  const type = craft.unit.type;
  const weapon = type.weapon;
  const perShot = craft.unit.stats.dps / weapon.rof;
  let mul = 1 - target.unit.stats.armor * (1 - (weapon.penetration ?? 0.5));
  if (type.antiFighter) {
    if (target.unit.type.agility >= COMBAT.flakAgilityThreshold) mul *= COMBAT.flakAgilityBonus;
    if (target.unit.type.health >= COMBAT.flakArmorThreshold) mul *= COMBAT.flakArmorPenalty;
  }
  // `gunnery` is the difficulty handicap — only ever set on AI-run units.
  return perShot * mul * motionFireFactor(craft) * (craft.unit.gunnery ?? 1);
}

/**
 * How attractive a target is. Expected damage, discounted by range, with two
 * deliberate biases: support hulls are worth killing first, and something
 * already hurt is worth finishing.
 */
function targetScore(craft, target, dist) {
  const tt = target.unit.type;
  let score = shotDamage(craft, target) * accuracy(craft, target) / (1 + dist / 260);
  if (tt.id === 'aegis' || tt.id === 'rig') score *= 1.7;
  score *= 1 + (1 - target.hp / target.maxHealth) * 0.6;
  return score;
}

/**
 * Pick what this craft shoots at.
 *
 * The search radius is the unit's sensor, floored so that even short-sighted
 * hulls will engage something they are standing next to, and the candidate
 * list is filtered by a few reach rules so ground emplacements do not chase
 * things they can never hit.
 */
export function acquireTarget(craft, candidates, now) {
  // Jammed: hold whatever was already locked, acquire nothing new.
  if (craft.jammedUntil > now) {
    return craft.target && craft.target.alive ? craft.target : null;
  }
  const unit = craft.unit;
  if (!unit.type.weapon || unit.siegeLock) return null;
  // A taunt overrides target selection entirely for its duration.
  if (craft.tauntedBy && craft.tauntedBy.alive && craft.tauntUntil > now) {
    return craft.tauntedBy;
  }

  const ordered = unit.attackTarget;
  const radius = Math.min(unit.stats.sensor, Math.max(240, unit.stats.range * 1.6));
  let best = null;
  let bestScore = -1;
  const side = unit.faction;

  for (const cand of candidates) {
    if (!cand.alive || !cand.seenBy[side]) continue;
    const dist = craft.pos.distanceTo(cand.pos);
    if (dist > radius * 1.4) continue;
    if (unit.isGround && dist > unit.stats.range * 1.6) continue;
    if (cand.unit.isGround && !unit.isGround && dist > unit.stats.range * 1.2) continue;
    let score = targetScore(craft, cand, dist);
    // A player-issued attack order dominates, without being absolute — if the
    // ordered target is genuinely unreachable something else still gets shot.
    if (ordered && cand.unit === ordered) score *= 6;
    if (score > bestScore) { bestScore = score; best = cand; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Projectiles. One flat list, stepped as a whole.
// ---------------------------------------------------------------------------
export class Projectiles {
  /**
   * `rng` is the owning Game's seeded generator. Miss scatter perturbs the
   * flight path, which decides proximity hits, so it is part of the
   * simulation and must not reach for `Math.random`.
   */
  constructor(rng = Math.random) {
    this.list = [];
    this.rng = rng;
  }

  /**
   * `guided` rounds keep a target reference and are checked for a proximity
   * hit; unguided ones are fired at a lead point with scatter and simply
   * expire. Both are drawn the same way.
   */
  fire(craft, target, guided, damage) {
    const weapon = craft.unit.type.weapon;
    const origin = craft.pos.clone();
    leadPoint(craft.pos, target.pos, target.vel, weapon.speed, _steer);
    if (!guided) {
      _steer.x += (this.rng() - 0.5) * 34;
      _steer.y += (this.rng() - 0.5) * 34;
      _steer.z += (this.rng() - 0.5) * 34;
    }
    const dir = _steer.clone().sub(origin).normalize();
    this.list.push({
      pos: origin, dir, speed: weapon.speed, life: 3.2,
      target: guided ? target : null,
      damage, faction: craft.unit.faction, kind: weapon.type, shooter: craft,
    });
  }

  /** Ability ordnance: slow off the rail, accelerating, and homing. */
  fireMissile(craft, target, damage) {
    this.list.push({
      pos: craft.pos.clone(),
      dir: new THREE.Vector3(0, 0, -1).applyQuaternion(craft.obj.quaternion),
      speed: 150, accel: 260, maxSpeed: 520, life: 5,
      target, damage, faction: craft.unit.faction,
      kind: 'missile', homing: true, shooter: craft,
    });
  }

  update(dt, now, onHit, onExpire) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.target && !p.target.alive) p.target = null;

      if (p.homing) {
        if (p.target && p.target.alive) {
          _tmp.copy(p.target.pos).sub(p.pos).normalize();
          p.dir.lerp(_tmp, Math.min(1, dt * 3.2)).normalize();
        }
        p.speed = Math.min(p.maxSpeed, p.speed + p.accel * dt);
      }

      const step = p.speed * dt;
      p.prev = p.prev || p.pos.clone();
      p.prev.copy(p.pos);
      p.pos.addScaledVector(p.dir, step);

      if (p.target && p.target.alive) {
        // Hit radius grows with the step so a fast round cannot tunnel
        // straight through a small hull between two frames.
        const reach = Math.max(p.target.hitRadius ?? 14, step * 0.75);
        if (p.pos.distanceTo(p.target.pos) < reach) {
          onHit(p);
          this.list.splice(i, 1);
          continue;
        }
      }
      if (p.life <= 0) {
        if (onExpire) onExpire(p);
        this.list.splice(i, 1);
      }
    }
  }

  clear() { this.list.length = 0; }
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------
/**
 * How far `observer` can see `target`. A cloaked hull is invisible at sensor
 * range and only shows up close — except to the two classes built to find it.
 */
function detectRange(observer, target) {
  if (!target.type.cloak) return observer.stats.sensor;
  const id = observer.type.id;
  return COMBAT.cloakDetectRange * (id === 'aegis' || id === 'specter' ? 2.2 : 1);
}

/**
 * Recompute who can see whom.
 *
 * Symmetric by construction — the same pass fills in both sides — so an
 * enemy Specter is just as invisible to the AI commander as yours is to you.
 *
 * Run at a few Hz rather than every frame: with hundreds of craft this is the
 * most expensive thing in the simulation.
 */
export function resolveVisibility(units, playerFaction, now, fogEnabled = true) {
  const sides = { attack: [], defense: [] };
  for (const u of units) {
    if (u.alive) sides[u.faction].push(u);
  }

  for (const u of units) {
    for (const c of u.craft) {
      // You always see your own ships; enemies start unseen each pass.
      c.seenBy.attack = u.faction === 'attack';
      c.seenBy.defense = u.faction === 'defense';
      if (!c.alive) continue;
      if (!fogEnabled) { c.seenBy.attack = c.seenBy.defense = true; continue; }
      // A cloaked ship that just fired has given its position away.
      if (u.type.cloak && c.revealUntil > now) {
        c.seenBy.attack = c.seenBy.defense = true;
      }
    }
  }

  if (fogEnabled) {
    for (const a of sides.attack) {
      for (const d of sides.defense) {
        // Unit-level rejection first: skip the craft loop entirely when the
        // squadrons are far enough apart that nothing could see anything.
        const maxReach = Math.max(detectRange(a, d), detectRange(d, a)) + 260;
        if (a.pos.distanceToSquared(d.pos) > maxReach * maxReach) continue;

        const aSees = detectRange(a, d) ** 2;
        const dSees = detectRange(d, a) ** 2;
        for (const ac of a.craft) {
          if (!ac.alive) continue;
          for (const dc of d.craft) {
            if (!dc.alive) continue;
            const dist2 = ac.pos.distanceToSquared(dc.pos);
            if (dist2 <= aSees) dc.seenBy.attack = true;
            if (dist2 <= dSees) ac.seenBy.defense = true;
          }
        }
      }
    }
  }

  // `visible` is the player's view, used for rendering and selection.
  for (const u of units) {
    for (const c of u.craft) c.visible = c.alive && c.seenBy[playerFaction];
  }
}

// ---------------------------------------------------------------------------
// Neighbourhood queries, used by the abilities.
// ---------------------------------------------------------------------------
export function enemiesWithin(game, unit, radius) {
  const out = [];
  const r2 = radius * radius;
  for (const u of game.units) {
    if (u.faction === unit.faction || !u.alive) continue;
    for (const c of u.craft) {
      if (c.alive && c.seenBy[unit.faction] && c.pos.distanceToSquared(unit.pos) <= r2) {
        out.push(c);
      }
    }
  }
  return out;
}

export function alliesWithin(game, unit, radius, { damagedOnly = false } = {}) {
  const out = [];
  const r2 = radius * radius;
  for (const u of game.units) {
    if (u.faction !== unit.faction || !u.alive) continue;
    for (const c of u.craft) {
      if (!c.alive) continue;
      if (damagedOnly && c.hp >= c.maxHealth * 0.98) continue;
      if (c.pos.distanceToSquared(unit.pos) <= r2) out.push(c);
    }
  }
  return out;
}

/** Fraction of a squadron's living hulls that have taken meaningful damage. */
export function damagedFraction(game, unit) {
  let hurt = 0;
  let alive = 0;
  for (const c of unit.craft) {
    if (!c.alive) continue;
    alive++;
    if (c.hp < c.maxHealth * 0.92) hurt++;
  }
  return alive ? hurt / alive : 0;
}

export { angleToTarget };
