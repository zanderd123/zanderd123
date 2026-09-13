/**
 * The battle itself: spawning, the fixed-step simulation, gunnery resolution,
 * and the win check.
 *
 * The sim runs on a fixed timestep and the speed control multiplies how many
 * steps are taken per frame, not the step size. Scaling dt directly would make
 * 8x speed behave differently from 1x (fighters overshooting, projectiles
 * tunnelling); stepping more often keeps the battle identical at every speed.
 */
import * as THREE from 'three';
import { SHIPS, GROUND, WORLD, FACTION, unitCost, TIME_LIMIT, SHIELDS, SIEGE } from './config.js';
import {
  Unit, updateCraftMovement, updateUnit, seatOnPlanet, resetCallsigns,
  clampPointToArena,
} from './entities.js';
import {
  Projectiles, acquireTarget, accuracy, shotDamage, resolveVisibility, angleToTarget,
} from './combat.js';
import { autocast, tickBuffs, castAbility } from './skills.js';
import { makeRng } from './util.js';

const STEP = 1 / 30;          // fixed simulation step
const MAX_STEPS_PER_FRAME = 40;
const RETARGET_INTERVAL = 0.5;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _planetCentre = new THREE.Vector3(...WORLD.planetCenter);
/** How far an escort may drift from its charge before it re-stations. */
const ESCORT_SLACK = 150;
/** Seconds an escort keeps hunting whoever last attacked its charge. */
const ESCORT_MEMORY = 5;

/**
 * The planet, as something you can shoot.
 *
 * It deliberately quacks like a Craft — `pos`, `vel`, `alive`, `applyDamage`
 * — so projectiles, tracers and the hit test need no special cases. The one
 * addition is `hitRadius`: a shell has arrived when it reaches the surface,
 * not when it reaches the core three hundred units further in.
 */
class PlanetTarget {
  constructor(maxHealth) {
    this.isPlanet = true;
    this.maxHealth = maxHealth;
    this.hp = maxHealth;
    this.alive = true;
    this.pos = new THREE.Vector3(...WORLD.planetCenter);
    this.vel = new THREE.Vector3();
    this.hitRadius = WORLD.planetRadius;
    this.lastHitAt = -1e9;
    this.hitFlash = 0;
  }

  get fraction() { return Math.max(0, this.hp / this.maxHealth); }

  applyDamage(amount, now) {
    if (!this.alive) return 0;
    this.hp -= amount;
    this.lastHitAt = now;
    this.hitFlash = 0.25;
    if (this.hp <= 0) { this.hp = 0; this.alive = false; }
    return amount;
  }

  /** Crust knits back together if left alone long enough to matter. */
  update(dt, now) {
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (!this.alive || this.hp >= this.maxHealth) return;
    if (now - this.lastHitAt < SIEGE.regenDelay) return;
    this.hp = Math.min(this.maxHealth,
      this.hp + this.maxHealth * SIEGE.regenPerSecond * dt);
  }
}

export class Game {
  constructor(fleetRenderer, opts = {}) {
    this.fx = fleetRenderer;
    this.units = [];
    this.projectiles = null;   // needs this.rng, built once the seed is set
    this.now = 0;
    this.accumulator = 0;
    this.speed = 1;
    this.paused = false;
    this.state = 'playing';       // playing | victory | defeat | draw
    this.playerFaction = FACTION.ATTACK;
    this.rng = makeRng(opts.seed || 12345);
    this.projectiles = new Projectiles(this.rng);
    // Fog is off by default now: both fleets are plotted the whole match, so
    // the strategy is about distance and commitment rather than about not
    // knowing where the enemy is.
    this.fogEnabled = opts.fog === true;
    this.planet = null;
    this.retargetTimer = 0;
    this.visTimer = 0;
    this.kills = { attack: 0, defense: 0 };
    this.timeLimit = opts.timeLimit ?? TIME_LIMIT;
    this.onEnd = null;
  }

  /** Seconds left on the battle clock, floored at zero. */
  get timeRemaining() { return Math.max(0, this.timeLimit - this.now); }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------
  /**
   * `roster` is [{ typeId, qty }]. Ships spawn in a loose block around the
   * faction anchor; ground units are seated on the planet's contested face.
   */
  spawn(roster, faction) {
    const anchor = new THREE.Vector3(
      ...(faction === FACTION.ATTACK ? WORLD.attackAnchor : WORLD.defenseAnchor),
    );
    // The staging anchors sit 60-100 above the plane, which is most of FLAT's
    // whole slab — so the anchor's own height scales with the mode too, or
    // both fleets start pressed against the ceiling.
    anchor.y *= WORLD.spread;
    const ships = [];
    const ground = [];
    for (const entry of roster) {
      const type = SHIPS[entry.typeId] || GROUND[entry.typeId];
      if (!type) continue;
      for (let i = 0; i < entry.qty; i++) (type.ground ? ground : ships).push(type);
    }

    // Lay the fleet out in a wide, shallow block facing the enemy.
    const cols = Math.max(1, Math.ceil(Math.sqrt(ships.length * 1.8)));
    ships.forEach((type, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      // Deliberately NOT scaled by the look preset. Spawn spacing decides where
      // a fleet starts, which decides arrival times and who meets whom — it is
      // simulation, not presentation, and a graphics toggle must not move it.
      const spacing = 210 * WORLD.spacing;
      const pos = anchor.clone().add(new THREE.Vector3(
        (col - (cols - 1) / 2) * spacing,
        ((this.rng() - 0.5) * 240 + (type.id === 'bastion' ? -50 : 0)) * WORLD.spread,
        row * spacing * 0.9 * (faction === FACTION.ATTACK ? -1 : 1),
      ));
      // Spawn positions were never contained. Containment runs after a step,
      // and nothing steps during the preparation phase — so in a thin slab the
      // fleet could sit outside its own arena until the battle started.
      clampPointToArena(pos, 24);
      const u = new Unit(type, faction, pos, Math.floor(this.rng() * 1e9));
      this.units.push(u);
    });

    // Carriers need their brood allocated up front. The fleet renderer builds
    // one InstancedMesh batch per type+faction at match start and never grows
    // it, so hulls that appear later have to already exist — they are created
    // dead and revived on the spawn tick. Doing it this way also means a brood
    // is a normal commandable squadron, selectable and orderable like any
    // other, rather than a special case threaded through the whole game.
    for (const u of [...this.units]) {
      if (u.faction !== faction || !u.type.spawns) continue;
      this.attachBrood(u);
    }

    // Ground units ring the hemisphere that faces the attackers' approach.
    ground.forEach((type, i) => {
      const u = new Unit(type, faction, new THREE.Vector3(), Math.floor(this.rng() * 1e9));
      const spread = ground.length > 1 ? i / (ground.length - 1) : 0.5;
      const az = (spread - 0.5) * 2.1;
      // Emplacements ring the contested face. In FLAT the ring is pulled
      // toward the equator, or half the defence sits over the horizon where
      // an overhead camera cannot see it.
      const el = (this.rng() - 0.5) * 1.0 * WORLD.spread;
      const dir = new THREE.Vector3(
        Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el),
      );
      seatOnPlanet(u, dir);
      this.units.push(u);
    });
  }

  /** Create the dormant hull pool a Spawner releases over the match. */
  attachBrood(spawner) {
    const spec = spawner.type.spawns;
    const base = SHIPS[spec.typeId] || GROUND[spec.typeId];
    if (!base) return;
    const type = { ...base, count: spec.cap };
    const brood = new Unit(type, spawner.faction, spawner.pos.clone(),
      Math.floor(this.rng() * 1e9));
    brood.callsign = `${spawner.callsign} Brood`;
    brood.broodOf = spawner;
    spawner.brood = brood;
    for (const c of brood.craft) { c.alive = false; c.hp = 0; }
    this.units.push(brood);
  }

  /** Production is the ability now, so this only tracks the high-water mark. */
  updateSpawner(unit) {
    const brood = unit.brood;
    if (!unit.type.spawns || !brood || !unit.alive) return;
    unit.broodPeak = Math.max(unit.broodPeak || 0, brood.count);
  }

  releaseBroodHull(unit) {
    const brood = unit.brood;
    if (!brood) return false;
    const spec = unit.type.spawns;
    if (brood.count >= spec.cap) return false;
    const slot = brood.craft.find((c) => !c.alive);
    if (!slot) return false;
    _v.set(
      (this.rng() - 0.5) * 90,
      (this.rng() - 0.5) * 50 * WORLD.spread,
      (this.rng() - 0.5) * 90,
    ).add(unit.pos);
    slot.revive(_v);
    brood.updateCentroid();
    // A fresh hull joins whatever the brood is already doing.
    if (brood.pos.distanceToSquared(brood.movePos) < 1) brood.movePos.copy(unit.pos);
    this.fx.bubble(_v.clone(), 60, unit.faction, 0xd8c07a);
    // The brood is a full squadron in its own right — selectable, orderable,
    // with its own callsign — but nothing said so, and a unit that appears
    // silently mid-battle is a unit the player never uses.
    if (this.onHatch) this.onHatch(unit, brood);
    return true;
  }

  start(playerRoster, enemyRoster, playerFaction) {
    this.playerFaction = playerFaction;
    const enemyFaction = playerFaction === FACTION.ATTACK ? FACTION.DEFENSE : FACTION.ATTACK;
    resetCallsigns();
    this.spawn(playerRoster, playerFaction);
    this.spawn(enemyRoster, enemyFaction);
    this.planet = new PlanetTarget(this.planetHealthFor());
    this.fx.build(this.units);
    resolveVisibility(this.units, this.playerFaction, 0, this.fogEnabled);
    // Give every craft an initial transform so frame one isn't a pile at 0,0,0.
    for (const u of this.units) {
      for (const c of u.craft) c.obj.updateMatrix();
    }
  }

  /**
   * Planet health scales with what the attacker brought, so a bigger assault
   * doesn't trivially outrun the objective — and there is a floor so a tiny
   * raiding force still can't one-shot a world.
   */
  planetHealthFor() {
    let biggestHull = 0;
    let attackPoints = 0;
    for (const u of this.units) {
      biggestHull = Math.max(biggestHull, u.stats.maxHealth);
      if (u.faction === FACTION.ATTACK) attackPoints += unitCost(u.type);
    }
    return Math.max(SIEGE.baseMultiplier * biggestHull,
      attackPoints * SIEGE.hpPerAttackPoint);
  }

  reset() {
    this.units.length = 0;
    this.projectiles.clear();
    this.fx.disposeBatches();
    this.now = 0;
    this.accumulator = 0;
    this.state = 'playing';
    this.timedOut = false;
    this.planetFell = false;
    this.planet = null;
    this.kills = { attack: 0, defense: 0 };
    this.aiFactions = new Set();
    resetCallsigns();
  }

  get live() { return this.state === 'playing' || this.state === 'prep'; }
  get playerUnits() {
    return this.units.filter((u) => u.faction === this.playerFaction && u.alive);
  }
  get enemyUnits() {
    return this.units.filter((u) => u.faction !== this.playerFaction && u.alive);
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------
  update(dt) {
    if (this.paused || this.state !== 'playing') {
      this.fx.update(dt, null);
      return;
    }
    this.accumulator += dt * this.speed;
    let steps = 0;
    while (this.accumulator >= STEP && steps < MAX_STEPS_PER_FRAME) {
      this.step(STEP);
      this.accumulator -= STEP;
      steps++;
      // Each step checks for a result, so a frame that runs several of them
      // has to stop at the one that ends the battle. Without this the rest of
      // the frame's steps kept simulating a decided match and re-firing onEnd:
      // a session report at 8x carried seven identical battle-end events.
      if (this.state !== 'playing') break;
    }
    // Never let the backlog grow without bound after a stall.
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    this.fx.emitTrails(this.units, dt);
    this.fx.update(dt, null);
  }

  step(dt) {
    this.now += dt;

    this.visTimer -= dt;
    if (this.visTimer <= 0) {
      this.visTimer = 0.2;
      resolveVisibility(this.units, this.playerFaction, this.now, this.fogEnabled);
    }

    this.retargetTimer -= dt;
    const retarget = this.retargetTimer <= 0;
    if (retarget) this.retargetTimer = RETARGET_INTERVAL;

    const enemyCraft = {
      attack: this.craftOf(FACTION.DEFENSE),
      defense: this.craftOf(FACTION.ATTACK),
    };

    this.updateEscorts(dt);
    this.updateAttackStance(dt);

    const ctx = this.abilityContext();

    for (const u of this.units) {
      if (u.type.spawns) this.updateSpawner(u);

      // Exponentially-smoothed damage rates, used by the AI and the HUD.
      const decay = Math.exp(-dt / 2.5);
      u.dpsIn = u.dpsIn * decay + u.damageInAccum / 2.5;
      u.dpsOut = u.dpsOut * decay + u.damageOutAccum / 2.5;
      u.damageInAccum = 0;
      u.damageOutAccum = 0;
      if (!u.alive) continue;

      tickBuffs(u, this.now);
      u.updateShield(dt);
      updateUnit(u, dt);

      const candidates = enemyCraft[u.faction];
      for (const c of u.craft) {
        if (!c.alive) continue;
        if (c.hitFlash > 0) c.hitFlash -= dt;
        if (retarget || !c.target || !c.target.alive
            || !c.target.seenBy[u.faction]) {
          // Bombarding hulls acquire too — they keep a reduced share of their
          // rate of fire for self-defence.
          c.target = acquireTarget(c, candidates, this.now);
        }
        updateCraftMovement(c, dt, this.now);
        this.tryFire(c, dt);
      }

      const repair = Math.max(
        (u.repairUntil > this.now && u.repairRate) || 0,
        u.type.passiveRepair || 0,
      );
      if (repair > 0) this.applyRepair(u, dt, repair);

      autocast(ctx, u);
    }

    if (this.planet) this.planet.update(dt, this.now);
    this.projectiles.update(dt, this.now, (p) => this.onProjectileHit(p), null);
    this.checkVictory();
  }

  /**
   * Escorts. A squadron on DEFEND stations itself on its charge and adopts
   * whatever is attacking it — with a short memory, so it does not
   * immediately forget an attacker that ducked out of sight.
   */
  updateEscorts(dt) {
    this.escortTimer = (this.escortTimer || 0) - dt;
    if (this.escortTimer > 0) return;
    this.escortTimer = 0.35;

    const planetPos = this.planet ? this.planet.pos : _planetCentre;
    for (const u of this.units) {
      if (!u.alive || u.stance !== 'defend') continue;

      // The charge died: fall back to holding station rather than flying to
      // a corpse's last position forever.
      if (u.guardTarget && u.guardTarget !== 'planet' && !u.guardTarget.alive) {
        u.stance = 'move';
        u.guardTarget = null;
        u.attackTarget = null;
        continue;
      }

      const post = u.guardPos(planetPos);
      if (!post) continue;

      if (u.guardTarget !== 'planet' || !u.isGround) {
        _v.copy(post);
        // Guarding the planet means orbiting it, not flying into it.
        if (u.guardTarget === 'planet') {
          _v2.copy(u.pos).sub(post);
          if (_v2.lengthSq() < 1e-4) _v2.set(0, 0, -1);
          _v2.normalize();
          _v.addScaledVector(_v2, WORLD.planetRadius + 260);
        }
        if (u.pos.distanceToSquared(_v) > ESCORT_SLACK * ESCORT_SLACK) {
          u.movePos.copy(_v);
          if (!u.isGround) clampPointToArena(u.movePos);
        }
      }

      const threat = this.threatTo(u.guardTarget, u.faction);
      if (threat) {
        u.lastThreat = threat;
        u.lastThreatAt = this.now;
      } else if (u.lastThreat
                 && (!u.lastThreat.alive || this.now - u.lastThreatAt > ESCORT_MEMORY)) {
        u.lastThreat = null;
      }
      u.attackTarget = threat || u.lastThreat || null;
    }
  }

  /** A faction with no Commander attached is being played by a person. */
  isPlayerControlled(faction) {
    return !this.aiFactions || !this.aiFactions.has(faction);
  }

  /**
   * ATTACK, for player-controlled squadrons.
   *
   * Assigning a target is not the same as going there. Combat only engages
   * once a craft has ACQUIRED a live target of its own, and that acquisition
   * is scoped to a search radius built from the unit's own sensor and weapon
   * range — so a squadron ordered to attack something three thousand units
   * away would sit at speed zero forever unless movePos is set too.
   */
  updateAttackStance(dt) {
    this.attackTimer = (this.attackTimer || 0) - dt;
    if (this.attackTimer > 0) return;
    this.attackTimer = 0.4;

    for (const u of this.units) {
      if (!u.alive || u.stance !== 'attack' || u.isGround || u.siegeLock) continue;
      if (!this.isPlayerControlled(u.faction)) continue;

      const enemies = this.craftOf(
        u.faction === FACTION.ATTACK ? FACTION.DEFENSE : FACTION.ATTACK,
      );

      // The player named a hull to kill. That order outranks everything below
      // — including the auto-siege — and it stands until the hull dies or a
      // new order replaces it.
      if (u.orderedTarget && !u.orderedTarget.alive) u.orderedTarget = null;

      // Near the planet with a clear lane: commit to the bombardment.
      //
      // This exists so an attack-move toward the planet doesn't stall out with
      // nothing in sensor range, and it is deliberately limited to that case.
      // It used to fire whatever the squadron had been told to do, which meant
      // a fleet sent at an enemy hull near the world quietly stopped fighting
      // and levelled the crust instead: the game chose the win condition, and
      // the only plan that needed no decisions was also the only one that ever
      // destroyed a planet. Bombarding is now something you ask for — click
      // the planet itself — or something an aimless advance falls into.
      if (u.faction === FACTION.ATTACK && u.siegeCapital && !u.orderedTarget
          && this.planet && this.planet.alive
          && u.pos.distanceTo(this.planet.pos)
             < WORLD.planetRadius + u.stats.range * SIEGE.lockRange
          && u.clearToSiege(enemies) && u.beginSiege()) {
        if (this.onAutoSiege) this.onAutoSiege(u);
        continue;
      }

      const target = u.orderedTarget
        || this.threatTo(u, u.faction) || this.nearestEnemyUnit(u);
      u.attackTarget = target;
      if (!target) continue;

      if (u.type.sniper || u.type.spawns) {
        // Standoff hulls close to their firing position, not onto the target.
        _v.copy(u.pos).sub(target.pos);
        if (_v.lengthSq() < 1e-6) _v.set(0, 0, -1);
        const standoff = u.type.spawns
          ? Math.max(700, u.stats.range * 2.2)
          : u.stats.range * 0.85;
        _v.normalize().multiplyScalar(standoff).add(target.pos);
        u.movePos.copy(_v);
      } else {
        u.movePos.copy(target.pos);
      }
    }
  }

  nearestEnemyUnit(unit) {
    let best = null;
    let bestD = Infinity;
    for (const u of this.units) {
      if (u.faction === unit.faction || !u.alive) continue;
      // Don't march the whole fleet at an emplacement it can't reach.
      if (u.isGround && unit.pos.distanceTo(u.pos) > unit.stats.range * 2.5) continue;
      const d = unit.pos.distanceToSquared(u.pos);
      if (d < bestD) { bestD = d; best = u; }
    }
    return best;
  }

  /** Whoever is putting the most guns on `subject` right now. */
  threatTo(subject, ownFaction) {
    let best = null;
    let bestScore = -1;
    for (const u of this.units) {
      if (u.faction === ownFaction || !u.alive) continue;
      let score = 0;
      if (subject === 'planet') {
        if (u.siegeLock) score = 100;
      } else {
        for (const c of u.craft) {
          if (c.alive && c.target && c.target.alive && c.target.unit === subject) score++;
        }
      }
      if (score > bestScore && score > 0) { bestScore = score; best = u; }
    }
    return best;
  }

  craftOf(faction) {
    const out = [];
    for (const u of this.units) {
      if (u.faction !== faction || !u.alive) continue;
      for (const c of u.craft) if (c.alive) out.push(c);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Gunnery
  // -------------------------------------------------------------------------
  tryFire(craft, dt) {
    const unit = craft.unit;
    const weapon = unit.type.weapon;
    if (!weapon) return;

    // A bombarding squadron splits its output rather than going blind: most of
    // the rate of fire goes into the crust on its own timer, and SIEGE.selfDefense
    // of it stays here, so the hull can still answer whatever is shooting at it.
    //
    // The cost is only paid while the crust is ACTUALLY in range. A hull still
    // flying to its firing position was surrendering 80% of its guns and
    // getting nothing for it — a session report showed a Bastion locking on
    // 1,100 units short of its standoff and dying on the way in, at 91% health
    // when it committed.
    let rateShare = 1;
    if (unit.siegeLock) {
      if (this.trySiegeFire(craft, dt)) rateShare = SIEGE.selfDefense;
      if (rateShare <= 0) return;
    }

    const target = craft.target;
    if (!target || !target.alive) return;
    if (craft.pos.distanceTo(target.pos) > unit.stats.range) return;
    // Small craft have to actually point at what they're shooting; turreted
    // hulls and emplacements do not.
    const turreted = unit.isGround || unit.type.sniper || unit.type.scale >= 2.5;
    if (!turreted && angleToTarget(craft.obj, target.pos) > 0.42) return;

    let rof = weapon.rof * rateShare
      * (unit.fireRateUntil > this.now ? unit.fireRateBonus : 1);
    if (unit.shieldOn) rof *= SHIELDS.fireRate;
    craft.fireTimer -= dt;
    if (craft.fireTimer > 0) return;
    craft.fireTimer += 1 / rof;

    // Accuracy is rolled at the muzzle: a hit is a guided round that will
    // arrive, a miss is an unguided one that visibly goes wide.
    const hit = this.rng() < accuracy(craft, target);
    this.projectiles.fire(craft, target, hit, shotDamage(craft, target));
    if (unit.type.cloak) craft.revealUntil = this.now + 4;
  }

  trySiegeFire(craft, dt) {
    const unit = craft.unit;
    const weapon = unit.type.weapon;
    const planet = this.planet;
    if (!planet || !planet.alive) { unit.siegeLock = false; return false; }
    // Out of reach: still closing, so no bombardment and no split-fire cost.
    if (craft.pos.distanceTo(planet.pos) - WORLD.planetRadius > unit.stats.range) {
      return false;
    }

    // Its own timer, independent of the anti-ship one, so bombardment and
    // self-defence genuinely run in parallel instead of starving each other.
    let rof = weapon.rof * (1 - SIEGE.selfDefense)
      * (unit.fireRateUntil > this.now ? unit.fireRateBonus : 1);
    if (unit.shieldOn) rof *= SHIELDS.fireRate;
    craft.siegeTimer -= dt;
    // In range but between rounds: the split-fire cost still applies.
    if (craft.siegeTimer > 0) return true;
    craft.siegeTimer += 1 / rof;

    // Against the crust it is penetration that matters, not tracking — every
    // hull can bombard, but a heavy gun is worth many light ones.
    const pen = Math.max(SIEGE.minPenetration, weapon.penetration ?? 0.5);
    const dmg = (unit.stats.dps / weapon.rof) * pen * SIEGE.damageMultiplier;
    this.projectiles.fire(craft, planet, true, dmg);
    return true;
  }

  onProjectileHit(p) {
    const target = p.target;
    if (!target || !target.alive) return;
    const dealt = target.applyDamage(p.damage, this.now);
    if (dealt && p.shooter && p.shooter.unit) p.shooter.unit.damageOutAccum += dealt;
    this.fx.impact(target.isPlanet ? p.pos : target.pos,
      p.kind === 'missile' ? 0xffaa55 : 0xffddaa);
    if (target.isPlanet) {
      if (!target.alive) this.onPlanetDestroyed();
      return dealt;
    }
    if (!target.alive) this.onCraftDestroyed(target, p.shooter);
    return dealt;
  }

  onPlanetDestroyed() {
    const at = this.planet.pos;
    for (let i = 0; i < 14; i++) {
      _v.set(this.rng() - 0.5, this.rng() - 0.5, this.rng() - 0.5)
        .normalize()
        .multiplyScalar(WORLD.planetRadius * (0.9 + this.rng() * 0.3))
        .add(at);
      this.fx.explode(_v, 26, 0xffb45a);
    }
    for (const u of this.units) u.siegeLock = false;
  }

  /** Direct damage from an ability, bypassing the projectile system. */
  damage(craft, amount) {
    if (!craft.alive) return;
    craft.applyDamage(amount, this.now);
    if (!craft.alive) this.onCraftDestroyed(craft, null);
  }

  onCraftDestroyed(craft) {
    const scale = craft.unit.type.scale * 1.6;
    this.fx.explode(craft.pos, scale, craft.unit.type.color);
    const killer = craft.unit.faction === FACTION.ATTACK ? 'defense' : 'attack';
    this.kills[killer]++;
    this.breakLocksOn(craft);
  }

  /** Drop every reference to a craft that just stopped existing. */
  breakLocksOn(craft) {
    for (const u of this.units) {
      for (const c of u.craft) {
        if (c.target === craft) c.target = null;
        if (c.tauntedBy === craft) { c.tauntedBy = null; c.tauntUntil = 0; }
      }
    }
    for (const p of this.projectiles.list) {
      if (p.target === craft) p.target = null;
    }
  }

  /**
   * Repair radiates outward to the rest of the fleet. Note `o !== unit`: a
   * support hull does NOT heal itself, which is what makes killing it a real
   * play rather than a war of attrition against its own regeneration.
   */
  applyRepair(unit, dt, rate) {
    const amount = rate * dt;
    const r2 = (unit.isGround ? 340 : 460) ** 2;
    for (const u of this.units) {
      if (u.faction !== unit.faction || !u.alive) continue;
      if (u === unit) continue;
      for (const c of u.craft) {
        if (!c.alive || c.hp >= c.maxHealth) continue;
        if (c.pos.distanceToSquared(unit.pos) <= r2) c.heal(amount);
      }
    }
  }

  /** The slice of the game an ability is allowed to touch. */
  abilityContext() {
    return {
      units: this.units,
      now: this.now,
      fx: this.fx,
      projectiles: this.projectiles,
      damage: (c, amount, src) => this.damage(c, amount, src),
      breakLocksOn: (c) => this.breakLocksOn(c),
      releaseBroodHull: (u) => this.releaseBroodHull(u),
    };
  }

  castFor(unit) { return castAbility(this.abilityContext(), unit); }

  checkVictory() {
    // A result is announced exactly once. The loop above stops on it, but
    // anything else that calls in — a late projectile resolving, a caller
    // stepping the game by hand — must not re-announce a decided battle.
    if (this.state !== 'playing') return;
    if (this.planet && !this.planet.alive) {
      this.planetFell = true;
      this.state = this.playerFaction === FACTION.ATTACK ? 'victory' : 'defeat';
      if (this.onEnd) this.onEnd(this.state);
      return;
    }
    const mine = this.units.some((u) => u.faction === this.playerFaction && u.alive);
    const theirs = this.units.some((u) => u.faction !== this.playerFaction && u.alive);
    if (mine && theirs) {
      // NOTE: on expiry the DEFENDER wins outright. See README.md — this is
      // one of the structural advantages behind defence's win rate.
      if (this.timeLimit > 0 && this.now >= this.timeLimit) {
        this.timedOut = true;
        this.state = this.playerFaction === FACTION.DEFENSE ? 'victory' : 'defeat';
        if (this.onEnd) this.onEnd(this.state);
      }
      return;
    }
    this.state = (!theirs && mine) ? 'victory' : ((!mine && theirs) ? 'defeat' : 'draw');
    if (this.onEnd) this.onEnd(this.state);
  }

  drawTracers() {
    const tracers = this.fx.tracers;
    tracers.begin();
    for (const p of this.projectiles.list) {
      const visible = this.fogEnabled
        ? (p.shooter && (p.shooter.seenBy[this.playerFaction]
            || p.shooter.unit.faction === this.playerFaction))
        : true;
      if (!visible) continue;
      const len = p.kind === 'missile' ? 26 : (p.kind === 'shell' ? 34 : 22);
      _v.copy(p.pos).addScaledVector(p.dir, -len);
      const col = p.faction === FACTION.ATTACK ? 0xff9a4a : 0x7fdcff;
      tracers.push(p.pos, _v, p.kind === 'missile' ? 0xffcc88 : col,
        p.kind === 'shell' ? 1.6 : 1.2);
    }
    tracers.end();
  }
}
