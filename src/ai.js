/**
 * The enemy commander, and the fleet generator that gives it something to
 * command.
 *
 * The commander re-plans on a fixed tick (0.65s on HARD, 3.2s on EASY) rather
 * than every frame. That interval is most of what separates the difficulties:
 * the same logic given less time to react produces a visibly slower, sloppier
 * opponent without needing a second, dumber implementation.
 *
 * Everything it can see is filtered through `seenBy`, so the AI respects fog
 * and cloak exactly as the player does. It is not allowed to cheat.
 */
import * as THREE from 'three';
import {
  SHIPS, GROUND, WORLD, FACTION, SIEGE, DIFFICULTY, DEFAULT_DIFFICULTY, unitCost,
} from './config.js';
import { makeRng } from './util.js';

/**
 * What the AI buys, by weight. These are shares of the budget, not counts —
 * the same table produces a sensible 400-point skirmish force and a sensible
 * 4,000-point armada.
 *
 * `min` guarantees at least one of a role that the fleet stops working without
 * (something to bombard with, something to screen with). `max` caps the ones
 * that stop scaling: four Aegis do not repair four times as well, they just
 * make a fleet that cannot kill anything.
 */
const TEMPLATES = {
  attack: [
    { id: 'falcon', weight: 0.28, min: 1 },
    { id: 'wasp', weight: 0.20, min: 1 },
    { id: 'warden', weight: 0.15, min: 0 },
    { id: 'bastion', weight: 0.15, min: 1 },
    { id: 'spawner', weight: 0.09, min: 0, max: 2 },
    { id: 'aegis', weight: 0.09, min: 0, max: 2 },
    { id: 'specter', weight: 0.05, min: 1, max: 2 },
  ],
  defense: [
    { id: 'bastion', weight: 0.20, min: 1 },
    { id: 'warden', weight: 0.16, min: 1 },
    { id: 'falcon', weight: 0.15, min: 1 },
    { id: 'aegis', weight: 0.11, min: 1, max: 2 },
    { id: 'wasp', weight: 0.09, min: 0 },
    { id: 'sentry', weight: 0.09, min: 1, max: 5 },
    { id: 'spawner', weight: 0.08, min: 0, max: 2 },
    { id: 'flak', weight: 0.08, min: 1, max: 4 },
    { id: 'rig', weight: 0.04, min: 0, max: 2 },
  ],
};

/** Support hulls with diminishing returns — capped at 2 unless told otherwise. */
const SUPPORT = new Set(['aegis', 'rig', 'specter', 'spawner']);

/**
 * Spend `budget` points against a template.
 *
 * Three passes: guarantee the minimums, distribute by weight, then top up with
 * whatever combat hulls still fit. The last pass matters — integer squadron
 * costs leave 50-150 points on the table otherwise, which at a 400-point
 * budget is a quarter of the fleet.
 */
export function generateFleet(budget, side, seed = 99) {
  const rnd = makeRng(seed);
  const table = TEMPLATES[side];
  const picked = new Map();
  let spent = 0;

  const cost = (id) => unitCost(SHIPS[id] || GROUND[id]);
  const capOf = (e) => e.max ?? (SUPPORT.has(e.id) ? 2 : Infinity);
  const fits = (e, n = 1) => (picked.get(e.id) || 0) + n <= capOf(e)
    && spent + cost(e.id) * n <= budget;
  const take = (id, n = 1) => {
    picked.set(id, (picked.get(id) || 0) + n);
    spent += cost(id) * n;
  };

  for (const e of table) if (e.min && fits(e, e.min)) take(e.id, e.min);

  // Jitter the weights so two matches at the same budget are not the same
  // fleet, without letting the composition drift out of shape.
  const weighted = table.map((e) => ({ ...e, w: e.weight * (0.75 + rnd() * 0.5) }));
  const total = weighted.reduce((s, e) => s + e.w, 0);
  const remaining = budget - spent;
  for (const e of weighted) {
    const want = (remaining * (e.w / total)) / cost(e.id);
    let n = Math.floor(want);
    // Round the fraction stochastically, or a 0.9-squadron share is always 0.
    if (rnd() < want - n) n += 1;
    n = Math.min(n, capOf(e) - (picked.get(e.id) || 0));
    if (n > 0 && fits(e, n)) take(e.id, n);
  }

  // Top-up: combat hulls only, so leftover points never become a third Aegis.
  const fillers = table.filter((e) => !SUPPORT.has(e.id));
  let guard = 0;
  while (guard++ < 400) {
    const options = fillers.filter((e) => fits(e));
    if (!options.length) break;
    let roll = rnd() * options.reduce((s, e) => s + e.weight, 0);
    let choice = options[options.length - 1];
    for (const e of options) {
      roll -= e.weight;
      if (roll <= 0) { choice = e; break; }
    }
    take(choice.id, 1);
  }

  return [...picked.entries()].map(([typeId, qty]) => ({ typeId, qty }));
}

// ---------------------------------------------------------------------------

const _v = new THREE.Vector3();
const _dest = new THREE.Vector3();
const PLANET = new THREE.Vector3(...WORLD.planetCenter);
/** How close an attacker has to get before the defence treats it as a threat. */
const THREAT_RANGE = 1500;
/** Seconds with nothing visible before a defender stops holding and sweeps. */
const PATIENCE = 55;
/** Seconds a damaged squadron is allowed to spend withdrawing to a repairer. */
const WITHDRAW_TIME = 30;
/** ...and how long before it is allowed to try that again. */
const WITHDRAW_COOLDOWN = 45;

export class Commander {
  constructor(game, faction, difficulty = DEFAULT_DIFFICULTY) {
    this.game = game;
    this.faction = faction;
    this.diff = DIFFICULTY[difficulty] || DIFFICULTY[DEFAULT_DIFFICULTY];
    this.timer = 0;
    this.interval = this.diff.interval;
    this.rng = makeRng(777);
    this.searchIndex = 0;
    this.searchTimer = 0;
    this.searchPath = this.buildSearchPath();
    this.siegeTimer = 0;

    game.aiFactions = game.aiFactions || new Set();
    game.aiFactions.add(faction);

    for (const u of this.myUnits) {
      // A Spawner that never autocasts never spawns, which is the entire hull.
      u.autocast = this.diff.abilities || !!u.type.spawns;
      u.gunnery = this.diff.gunnery;
    }
  }

  get myUnits() {
    return this.game.units.filter((u) => u.faction === this.faction && u.alive);
  }

  visibleEnemies() {
    const out = [];
    for (const u of this.game.units) {
      if (u.faction === this.faction || !u.alive) continue;
      if (u.craft.some((c) => c.alive && c.seenBy[this.faction])) out.push(u);
    }
    return out;
  }

  /** Raise shields on anything hurt that is currently in a fight. */
  manageShields(units) {
    if (!this.diff.abilities) return;
    const threshold = this.diff.regroup ? 0.75 : 0.5;
    for (const u of units) {
      const want = u.healthFraction < threshold
        && u.craft.some((c) => c.alive && c.target && c.target.alive);
      if (want && !u.shieldOn && u.canRaiseShield) u.toggleShield(true);
      else if (!want && u.shieldOn) u.toggleShield(false);
    }
  }

  /**
   * Pull the worst-hurt half back to a repairer. Returns the set that is
   * withdrawing, so the main loop leaves them alone.
   *
   * The time limit is what keeps this from being a death spiral: a squadron
   * that spends thirty seconds running and is still not healed has lost more
   * by being out of the fight than the repair was worth, so it goes back in.
   */
  regroup(units) {
    if (!this.diff.regroup) return new Set();
    const now = this.game.now;
    const menders = this.myUnits.filter(
      (u) => (u.type.id === 'aegis' || u.type.id === 'rig') && u.alive);
    if (!menders.length) return new Set();

    const withdrawing = new Set();
    const limit = Math.max(1, Math.floor(units.length * 0.5));
    const hurt = units.filter((u) => u.healthFraction <= 0.35)
      .sort((a, b) => a.healthFraction - b.healthFraction)
      .slice(0, limit);

    for (const u of hurt) {
      if (now < (u.withdrawCooldownUntil || 0)) continue;
      if (!u.withdrawStarted || now - u.withdrawStarted > WITHDRAW_TIME + 1) {
        u.withdrawStarted = now;
      }
      if (now - u.withdrawStarted > WITHDRAW_TIME) {
        u.withdrawCooldownUntil = now + WITHDRAW_COOLDOWN;
        continue;
      }
      withdrawing.add(u);
      const mender = menders.reduce((best, m) =>
        (m.pos.distanceToSquared(u.pos) < best.pos.distanceToSquared(u.pos) ? m : best));
      _v.copy(mender.pos);
      _v.x += (this.rng() - 0.5) * 160;
      _v.y += (this.rng() - 0.5) * 120 * WORLD.spread;
      u.order(_v, { attack: null, stance: 'move' });
    }
    return withdrawing;
  }

  /**
   * A sweep route for when nothing is visible: enemy anchor, a ring around the
   * planet, then home. Covers the places a fleet can actually be hiding.
   */
  /**
   * Where to look when nothing is visible. The two sides want opposite things
   * from this, so they get different routes.
   *
   * The attacker hunts: start where the enemy ought to be, sweep the planet,
   * fall back home. The defender patrols, and never leaves the world it is
   * holding — an earlier version sent it to the ATTACKER'S staging area,
   * ~3,000 units out, which threw away the position, the ground support and
   * the objective in one move and handed the attacker an open lane to a planet
   * nobody was standing in front of.
   */
  buildSearchPath() {
    const ring = [];
    const r = WORLD.planetRadius + 900;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ring.push(new THREE.Vector3(
        PLANET.x + Math.cos(a) * r,
        PLANET.y + (i % 2 ? 260 : -260) * WORLD.spread,
        PLANET.z + Math.sin(a) * r,
      ));
    }
    if (this.faction === FACTION.ATTACK) {
      return [
        new THREE.Vector3(...WORLD.defenseAnchor),
        ...ring,
        new THREE.Vector3(...WORLD.attackAnchor),
      ];
    }
    return [new THREE.Vector3(...WORLD.defenseAnchor), ...ring];
  }

  get pickets() {
    if (!this._pickets) {
      this._pickets = { line: new THREE.Vector3(...WORLD.defenseAnchor) };
    }
    return this._pickets;
  }

  /** Sit on the line with a bit of spread, rather than bunching on one point. */
  holdPicket(units) {
    const anchor = this.faction === FACTION.DEFENSE
      ? this.pickets.line : new THREE.Vector3(...WORLD.attackAnchor);
    for (const u of units) {
      _v.copy(anchor);
      _v.x += (this.rng() - 0.5) * 700;
      _v.y += (this.rng() - 0.5) * 340 * WORLD.spread;
      _v.z += (this.rng() - 0.5) * 380;
      u.order(_v, { attack: null, stance: 'move' });
    }
  }

  fleetCentroid() {
    const ships = this.myUnits.filter((u) => !u.isGround);
    if (!ships.length) return null;
    const c = new THREE.Vector3();
    for (const u of ships) c.add(u.pos);
    return c.divideScalar(ships.length);
  }

  searchWaypoint() {
    const wp = this.searchPath[this.searchIndex % this.searchPath.length];
    const c = this.fleetCentroid();
    // Advance on arrival, or on a timeout — a waypoint inside the planet, or
    // one the fleet cannot reach, must not stall the sweep forever.
    if (!c || c.distanceTo(wp) < 520 || this.searchTimer > 34) {
      this.searchIndex++;
      this.searchTimer = 0;
    }
    return this.searchPath[this.searchIndex % this.searchPath.length];
  }

  /** How much bombardment a squadron is worth, in effective damage to crust. */
  siegeValue(u) {
    if (!u.siegeCapital) return 0;
    const w = u.type.weapon;
    return u.stats.dps * Math.max(SIEGE.minPenetration, w.penetration ?? 0.5);
  }

  /**
   * Commit hulls to bombardment. Half the fleet's siege power by default,
   * rising to 85% in the last third of the clock — a timeout is a loss for the
   * attacker, so late in a match the objective outranks the fight.
   */
  manageSiege(units, enemyCraft) {
    if (!this.diff.siege) return new Set();
    if (this.faction !== FACTION.ATTACK) return new Set();
    const planet = this.game.planet;
    if (!planet || !planet.alive) return new Set();

    const locked = new Set(units.filter((u) => u.siegeLock));
    const candidates = units
      .filter((u) => !u.siegeLock && this.siegeValue(u) > 0)
      .sort((a, b) => this.siegeValue(b) - this.siegeValue(a));

    const total = units.reduce((s, u) => s + this.siegeValue(u), 0);
    let committed = [...locked].reduce((s, u) => s + this.siegeValue(u), 0);
    const late = this.game.timeRemaining < this.game.timeLimit * 0.35;
    const want = late ? total * 0.85 : total * 0.5;

    for (const u of candidates) {
      if (committed >= want) break;
      if (!u.clearToSiege(enemyCraft)) continue;
      // Far from the planet there is nothing to be clear of yet — walk it in
      // and re-check next tick rather than locking it from across the map.
      if (u.pos.distanceTo(PLANET) > WORLD.planetRadius + u.stats.range * 3.5) continue;
      if (u.beginSiege()) {
        locked.add(u);
        committed += this.siegeValue(u);
      }
    }
    return locked;
  }

  update(dt) {
    this.searchTimer += dt;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.interval;

    const ships = this.myUnits.filter((u) => !u.isGround);
    const seen = this.visibleEnemies();

    const enemyCraft = [];
    for (const u of this.game.units) {
      if (u.faction === this.faction || !u.alive) continue;
      for (const c of u.craft) if (c.alive) enemyCraft.push(c);
    }

    const sieging = this.manageSiege(ships, enemyCraft);
    const free = ships.filter((u) => !sieging.has(u));

    // The defence does not chase. Anything far from the planet and far from
    // the line is not its problem — leaving the picket to run down a scout is
    // how a defensive fleet loses the objective.
    let threats = seen;
    if (this.faction === FACTION.DEFENSE) {
      const reach = WORLD.planetRadius + THREAT_RANGE;
      threats = seen.filter((u) => u.siegeLock
        || u.pos.distanceTo(PLANET) < reach
        || u.pos.distanceTo(this.pickets.line) < THREAT_RANGE);
    }

    if (!threats.length) {
      const impatient = this.searchTimer > PATIENCE;
      if (this.faction === FACTION.DEFENSE && !impatient) this.holdPicket(free);
      else this.advance(free);
      return;
    }
    this.searchTimer = 0;

    this.manageShields(free);
    const withdrawing = this.regroup(free);

    // Focus fire: pick one squadron's best target and have the rest pile on,
    // subject to `concentrate`. This is the single biggest difference between
    // MEDIUM and HARD.
    let focus = null;
    if (this.diff.concentrate > 0) {
      const active = free.filter((u) => !withdrawing.has(u));
      if (active.length) focus = this.pickTarget(active[0], threats);
    }

    for (const u of free) {
      if (withdrawing.has(u)) continue;
      let target = this.pickTarget(u, threats);
      if (focus && focus.alive && this.rng() < this.diff.concentrate
        && this.canHurt(u, focus)) target = focus;

      if (!target) {
        if (this.faction === FACTION.DEFENSE) this.holdPicket([u]);
        else this.advance([u]);
        continue;
      }

      // Snipers and carriers fight from a standoff. Ordered onto the target
      // they would fly into knife range and die for nothing.
      if (u.type.sniper || u.type.spawns) {
        _v.copy(u.pos).sub(target.pos);
        if (_v.lengthSq() < 1e-6) _v.set(0, 0, -1);
        const standoff = u.type.spawns
          ? Math.max(700, u.stats.range * 2.2)
          : u.stats.range * 0.85;
        _v.normalize().multiplyScalar(standoff).add(target.pos);
        u.order(_v, { attack: target, stance: 'move' });
        continue;
      }

      // A siege hull already in position holds its ground and shoots from
      // there rather than closing.
      if (this.faction === FACTION.ATTACK && u.siegeCapital
        && u.pos.distanceTo(PLANET) <= WORLD.planetRadius + u.stats.range * 3.5) {
        _v.copy(u.pos).sub(target.pos);
        if (_v.lengthSq() < 1e-6) _v.set(0, 0, -1);
        _v.normalize().multiplyScalar(u.stats.range * 0.85).add(target.pos);
        u.order(_v, { attack: target, stance: 'move' });
        continue;
      }

      const dest = target.pos.clone();
      const s = this.diff.scatter;
      dest.x += (this.rng() - 0.5) * 120 * s;
      dest.y += (this.rng() - 0.5) * 90 * s * WORLD.spread;
      u.order(dest, { attack: target, stance: 'attack' });
    }

    // Mobile ground units have one job: get to whatever is hurt.
    for (const u of this.myUnits.filter((g) => g.isGround && g.stats.maxSpeed > 0)) {
      const patient = this.myUnits
        .filter((g) => g.isGround && g !== u && g.healthFraction < 0.9)
        .sort((a, b) => a.healthFraction - b.healthFraction)[0];
      if (patient) u.order(patient.pos);
    }
  }

  /**
   * Score every visible enemy and take the best. The weights encode the
   * counter table: fighters avoid armor they cannot scratch, Bastions do not
   * waste shells on interceptors, and everybody wants the medic dead.
   */
  pickTarget(u, candidates) {
    let best = null;
    let bestScore = -Infinity;
    for (const t of candidates) {
      // Closer is better, but gently — 1200/(200+d) is nearly flat past ~600u,
      // so priority beats proximity at any realistic engagement range.
      let score = 1200 / (200 + u.pos.distanceTo(t.pos));
      const fast = t.type.agility >= 60;

      if (u.type.antiFighter) score *= fast ? 3 : 0.4;
      else if (u.type.agility >= 60 && t.type.health >= 75) score *= 0.55;
      else if (u.type.id === 'bastion' && fast) score *= 0.35;
      else if (u.type.id === 'falcon' && t.type.health >= 75) score *= 1.7;

      if (t.type.id === 'aegis' || t.type.id === 'rig') score *= 1 + 1.0 * this.diff.focus;
      if (t.type.sniper && u.type.agility >= 75) score *= 1 + 1.4 * this.diff.focus;
      if (t.type.spawns) score *= 1 + 1.2 * this.diff.focus;

      // Finish what is already hurt.
      score *= 1 + (1 - t.healthFraction) * 0.8 * this.diff.focus;
      if (this.diff.targetNoise) {
        score *= 1 + (this.rng() - 0.5) * 2 * this.diff.targetNoise;
      }

      if (t.isGround) {
        const adjacent = t.pos.distanceTo(u.pos) < u.stats.range * 1.4;
        // Emplacements are only worth attention once the sky is dealt with,
        // or if one is shooting at you right now.
        score *= this.skyClear(candidates) ? 1.6 : (adjacent ? 0.9 : 0.3);
      }
      // Anything bombarding the planet is the priority, full stop.
      if (t.siegeLock) score *= 5;

      if (score > bestScore) { bestScore = score; best = t; }
    }
    return best;
  }

  /** Can `u` meaningfully damage `t` at all? Gates focus-fire. */
  canHurt(u, t) {
    if (u.type.antiFighter) return t.type.agility >= 60;
    if (u.type.agility >= 60 && t.type.health >= 75) {
      return (u.type.weapon?.penetration ?? 0) >= 0.4;
    }
    return true;
  }

  skyClear(candidates) {
    return candidates.filter((t) => !t.isGround).length
      <= Math.max(1, candidates.length * 0.25);
  }

  /** Move toward the objective, or sweep if the opening push found nothing. */
  advance(units) {
    const grace = this.faction === FACTION.ATTACK ? 8 : 20;
    let dest;
    if (this.searchTimer < grace && this.searchIndex === 0) {
      dest = _dest.copy(PLANET);
      if (this.faction === FACTION.ATTACK) dest.z -= WORLD.planetRadius + 420;
      else dest.set(...WORLD.defenseAnchor);
    } else {
      dest = _dest.copy(this.searchWaypoint());
    }
    for (const u of units) {
      _v.copy(dest);
      const s = this.diff.scatter;
      _v.x += (this.rng() - 0.5) * 520 * s;
      _v.y += (this.rng() - 0.5) * 300 * s * WORLD.spread;
      _v.z += (this.rng() - 0.5) * 520 * s;
      u.order(_v, {
        attack: null,
        stance: this.faction === FACTION.ATTACK ? 'attack' : 'move',
      });
    }
  }
}
