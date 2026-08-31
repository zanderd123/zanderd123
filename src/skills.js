/**
 * Unit abilities.
 *
 * Each entry is `{ duration, apply(game, unit), should(game, unit) }`.
 * `apply` does the thing; `should` is the autocast heuristic, and is what the
 * AI and an autocasting player squadron both consult. Keeping the two next to
 * each other means an ability and the judgement about when to use it can
 * never drift apart.
 *
 * Timed effects are written as `<thing>Until` stamps rather than counters, so
 * tickBuffs() can expire them all in one pass without every ability needing
 * its own bookkeeping.
 */
import * as THREE from 'three';
import { COMBAT } from './config.js';
import {
  enemiesWithin, alliesWithin, damagedFraction, armorFactor,
} from './combat.js';
import { pushOutOfPlanet } from './entities.js';

const _v = new THREE.Vector3();

export const SKILLS = {
  // --- Wasp ---------------------------------------------------------------
  blink: {
    duration: 0,
    apply(game, unit) {
      for (const c of unit.craft) {
        if (!c.alive) continue;
        _v.set(0, 0, -1).applyQuaternion(c.obj.quaternion).multiplyScalar(320);
        game.fx.explode(c.pos, 0.5, 0x8fd4ff);
        c.pos.add(_v);
        pushOutOfPlanet(c.pos);
        c.speed = unit.stats.maxSpeed;
        // Everything currently shooting at this hull loses the lock — that is
        // the actual point of the ability, not the distance covered.
        game.breakLocksOn(c);
        game.fx.explode(c.pos, 0.5, 0x8fd4ff);
      }
      unit.abilityActive = 0.4;
    },
    should(game, unit) {
      // Getting hurt is reason enough to leave.
      if (damagedFraction(game, unit) > 0.4) return true;
      // Otherwise use it to close a gap that is too far to fly but worth
      // crossing — not to chase something already out of the fight.
      const c = unit.craft.find((k) => k.alive && k.target);
      if (!c) return false;
      const d = c.pos.distanceTo(c.target.pos);
      return d > unit.stats.range * 1.8 && d < 900;
    },
  },

  // --- Falcon -------------------------------------------------------------
  volley: {
    duration: 0,
    apply(game, unit) {
      const total = unit.stats.dps * 2.6;
      for (const c of unit.craft) {
        if (!c.alive || !c.target || !c.target.alive) continue;
        const dmg = total * armorFactor(unit.type, c.target, 0.8);
        // Two missiles rather than one: a single round that misses wastes the
        // whole cooldown.
        for (let i = 0; i < 2; i++) game.projectiles.fireMissile(c, c.target, dmg / 2);
      }
      unit.abilityActive = 0.5;
    },
    should(game, unit) {
      const firing = unit.craft.filter((c) => c.alive && c.target && c.target.alive);
      if (firing.length < Math.max(1, unit.count * 0.5)) return false;
      // Worth spending on something that will actually survive to be hit.
      return firing.some((c) => c.target.hp > unit.stats.dps * 1.5
        && c.pos.distanceTo(c.target.pos) < 460);
    },
  },

  // --- Warden -------------------------------------------------------------
  bubble: {
    duration: 8,
    apply(game, unit) {
      const amount = unit.type.skill * 9;
      for (const c of alliesWithin(game, unit, 300)) {
        c.shield = Math.max(c.shield, amount);
        c.shieldUntil = game.now + 8;
      }
      unit.abilityActive = 8;
      game.fx.bubble(unit.pos.clone(), 300, unit.faction);
    },
    should(game, unit) {
      if (enemiesWithin(game, unit, 420).length < 2) return false;
      return damagedFraction(game, unit) > 0.25
        || alliesWithin(game, unit, 300, { damagedOnly: true }).length >= 3;
    },
  },

  // --- Bastion ------------------------------------------------------------
  overcharge: {
    duration: 6,
    apply(game, unit) {
      for (const c of unit.craft) {
        if (!c.alive) continue;
        c.damageReduction = 0.5;
        c.drUntil = game.now + 6;
      }
      // Taunt: pull fire onto the hull best equipped to eat it.
      const anchor = unit.craft.find((c) => c.alive);
      for (const e of enemiesWithin(game, unit, 480)) {
        e.tauntedBy = anchor;
        e.tauntUntil = game.now + 6;
        e.target = anchor;
      }
      unit.abilityActive = 6;
      game.fx.bubble(unit.pos.clone(), 480, unit.faction, 0xffaa44);
    },
    should(game, unit) {
      return damagedFraction(game, unit) > 0.3
        && enemiesWithin(game, unit, 480).length >= 3;
    },
  },

  // --- Aegis --------------------------------------------------------------
  repair: {
    duration: 7,
    apply(game, unit) {
      unit.repairUntil = game.now + 7;
      unit.repairRate = unit.type.skill * 1.5;
      unit.abilityActive = 7;
      game.fx.bubble(unit.pos.clone(), 460, unit.faction, 0x7effc0);
    },
    should(game, unit) {
      return alliesWithin(game, unit, 460, { damagedOnly: true }).length >= 2;
    },
  },

  // --- Specter ------------------------------------------------------------
  jam: {
    duration: 5,
    apply(game, unit) {
      for (const e of enemiesWithin(game, unit, 560)) {
        e.jammedUntil = game.now + 5;
        e.target = null;
      }
      unit.abilityActive = 5;
      game.fx.bubble(unit.pos.clone(), 560, unit.faction, 0xc79bff);
    },
    should(game, unit) {
      // Only worth it against ships that are actually shooting at something.
      return enemiesWithin(game, unit, 560).filter((e) => e.target).length >= 4;
    },
  },

  // --- Sentry Turret ------------------------------------------------------
  overcharge_burst: {
    duration: 5,
    apply(game, unit) {
      unit.fireRateBonus = 2;
      unit.fireRateUntil = game.now + 5;
      unit.abilityActive = 5;
      game.fx.bubble(unit.pos.clone(), 120, unit.faction, 0xff8844);
    },
    should(game, unit) {
      return unit.craft.some((c) => c.alive && c.target && c.target.alive);
    },
  },

  // --- Spawner ------------------------------------------------------------
  launch_wasp: {
    duration: 0,
    apply(game, unit) {
      if (game.releaseBroodHull(unit)) {
        unit.abilityActive = 0.6;
        game.fx.bubble(unit.pos.clone(), 190, unit.faction, 0xd8c07a);
      }
    },
    should(game, unit) {
      const spec = unit.type.spawns;
      if (!spec || !unit.brood) return false;
      return unit.brood.count < spec.cap;
    },
  },

  // --- Repair Rig ---------------------------------------------------------
  field_repair: {
    duration: 8,
    apply(game, unit) {
      unit.repairUntil = game.now + 8;
      unit.repairRate = unit.type.skill * 1.1;
      unit.abilityActive = 8;
      game.fx.bubble(unit.pos.clone(), 340, unit.faction, 0x7effc0);
    },
    should(game, unit) {
      return alliesWithin(game, unit, 340, { damagedOnly: true }).length >= 1;
    },
  },

  // --- Flak Walker --------------------------------------------------------
  flak_screen: {
    duration: 0,
    apply(game, unit) {
      const dmg = unit.stats.dps * 2.2;
      for (const e of enemiesWithin(game, unit, 400)) {
        if (e.unit.type.agility < COMBAT.flakAgilityThreshold) continue;
        // `false` suppresses the anti-fighter multiplier — this ability is
        // already anti-fighter by its own filter, applying it twice was
        // roughly doubling the damage.
        game.damage(e, dmg * armorFactor(unit.type, e, 0.2, false), unit);
        game.fx.impact(e.pos, 0xffcc66);
      }
      unit.abilityActive = 0.6;
      game.fx.bubble(unit.pos.clone(), 400, unit.faction, 0xffcc66);
    },
    should(game, unit) {
      return enemiesWithin(game, unit, 400)
        .filter((e) => e.unit.type.agility >= COMBAT.flakAgilityThreshold).length >= 3;
    },
  },
};

/** Fire a squadron's ability now, if it is off cooldown. */
export function castAbility(game, unit) {
  if (!unit.abilityReady) return false;
  const skill = SKILLS[unit.type.ability.id];
  if (!skill) return false;
  skill.apply(game, unit);
  unit.abilityCooldown = unit.type.ability.cooldown;
  return true;
}

/** Cast if autocast is on and the ability's own heuristic says it is worth it. */
export function autocast(game, unit) {
  if (!unit.autocast || !unit.abilityReady) return;
  const skill = SKILLS[unit.type.ability.id];
  if (skill && skill.should(game, unit)) castAbility(game, unit);
}

/** Expire every timed effect in one pass. */
export function tickBuffs(unit, now) {
  if (unit.repairUntil && now > unit.repairUntil) unit.repairUntil = 0;
  if (unit.fireRateUntil && now > unit.fireRateUntil) {
    unit.fireRateUntil = 0;
    unit.fireRateBonus = 1;
  }
  for (const c of unit.craft) {
    if (!c.alive) continue;
    if (c.drUntil && now > c.drUntil) { c.damageReduction = 0; c.drUntil = 0; }
    if (c.shieldUntil && now > c.shieldUntil) { c.shield = 0; c.shieldUntil = 0; }
    if (c.tauntUntil && now > c.tauntUntil) { c.tauntedBy = null; c.tauntUntil = 0; }
  }
}
