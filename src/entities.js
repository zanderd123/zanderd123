/**
 * Squadrons and the individual craft inside them, plus the flight model.
 *
 * A Unit is the thing you select and order; a Craft is one hull. Orders,
 * stance, shields and abilities live on the Unit, while position, health and
 * gunnery live on each Craft. The Unit's `pos` is the centroid of its living
 * craft, recomputed every tick — it is what the camera frames, what the AI
 * reasons about, and what order markers attach to.
 */
import * as THREE from 'three';
import { derive, WORLD, GFX, SHIELDS, SIEGE, TRANSIT } from './config.js';
import { makeRng, clamp, steerTowards } from './util.js';

// ---------------------------------------------------------------------------
// Callsigns
// ---------------------------------------------------------------------------
let nextId = 1;
/**
 * Callsigns, one pool per side.
 *
 * Both fleets used to draw from the same NATO list, and both counters started
 * at zero — so a battle had two squadrons called Alpha, two called Bravo, and
 * a HUD that cheerfully reported "Alpha -> target: Alpha". A session report
 * showed three of the player's wardens all listing `target: Golf` while the
 * player also had a Golf. The attacker keeps NATO; the defence gets its own
 * list, so a name is never ambiguous about whose it is.
 */
const CALLSIGNS = {
  attack: [
    'Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel',
    'India', 'Juliet', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa',
    'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey',
    'X-ray', 'Yankee', 'Zulu',
  ],
  defense: [
    'Anvil', 'Bulwark', 'Citadel', 'Dagger', 'Ember', 'Fortress', 'Gatehouse',
    'Hearth', 'Ironside', 'Keystone', 'Lantern', 'Mainstay', 'Nemesis',
    'Outpost', 'Palisade', 'Quarry', 'Rampart', 'Sentinel', 'Tower', 'Upland',
    'Vigil', 'Warden-9', 'Watchtower', 'Yardarm', 'Zenith', 'Bastille',
  ],
};
const callsignCounts = new Map();

export function resetCallsigns() { callsignCounts.clear(); }

function nextCallsign(faction) {
  const pool = CALLSIGNS[faction] || CALLSIGNS.attack;
  const n = callsignCounts.get(faction) || 0;
  callsignCounts.set(faction, n + 1);
  const name = pool[n % pool.length];
  const lap = Math.floor(n / pool.length);
  return lap ? `${name}-${lap + 1}` : name;
}

const _v = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _siege = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _side = new THREE.Vector3();
const _slot = new THREE.Vector3();

// ---------------------------------------------------------------------------
export class Craft {
  constructor(unit, index, rng) {
    this.unit = unit;
    this.index = index;
    this.id = nextId++;
    this.obj = new THREE.Object3D();
    this.pos = this.obj.position;
    this.vel = new THREE.Vector3();
    this.speed = 0;
    this.hp = unit.stats.maxHealth;
    this.alive = true;
    this.target = null;
    // Stagger the opening volley so a squadron doesn't fire as one block.
    this.fireTimer = rng() * 0.7;
    // Bombardment runs on its own clock so it does not compete with the
    // squadron's self-defence fire — see SIEGE.selfDefense.
    this.siegeTimer = 0;
    // How far this hull's guns reach against whatever it is currently aiming
    // at — full rated range on a painted target, less on an unresolved one.
    // The flight model reads it so a hull with no firing solution closes to
    // the distance it can actually shoot from. See SCOUTING.
    this.fireRange = unit.stats.range;
    this.mode = 'move';           // dogfighters flip to 'breakaway'
    this.modeTimer = 0;
    this.bank = 0;
    this.shield = 0;              // ability-granted absorb pool
    this.damageReduction = 0;
    this.jammedUntil = 0;
    this.revealUntil = 0;
    this.seenBy = { attack: false, defense: false };
    // Held by a close enough friendly to give the whole fleet a real firing
    // solution, rather than merely being visible. See SCOUTING.
    this.paintedBy = { attack: false, defense: false };
    this.visible = true;
    this.hitFlash = 0;
    this.wallPress = 0;                  // 0..1 proximity to the arena shell
    // Only meaningful for ground units; seatOnPlanet() sets the real values.
    this.groundOffset = 0;
    this.groundFacing = new THREE.Vector3(0, 0, -1);
    // Formation slot inside the squadron: a loose 3D wedge. Unit's constructor
    // re-centres these so they average to exactly zero — see the note there.
    this.slotIndex = index;
    this.slot = new THREE.Vector3();
    this.layOutSlot();
  }

  /**
   * Slot geometry is quoted in hull widths, so it has to be redone whenever
   * the look preset changes the hull scale — otherwise CINEMATIC's larger
   * hulls fly CLASSIC's spacing and a squadron intersects itself.
   */
  layOutSlot() {
    const unit = this.unit;
    const index = this.slotIndex;
    const cols = Math.min(3, Math.max(1, unit.type.count));
    const row = Math.floor(index / cols);
    const col = index % cols;
    const spread = unit.type.scale * GFX.hullScale * 7 + 10;
    this.slot.set(col * spread, (index % 2) * spread * 0.5, row * spread * 1.1);
  }

  get maxHealth() { return this.unit.stats.maxHealth; }

  applyDamage(amount, now) {
    if (!this.alive) return 0;
    let dmg = amount * (1 - this.damageReduction);
    // Focused shields are a squadron-wide state, so read it from the unit.
    if (this.unit.shieldOn) dmg *= SHIELDS.damageTaken;
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, dmg);
      this.shield -= absorbed;
      dmg -= absorbed;
    }
    if (dmg <= 0) return 0;
    this.hp -= dmg;
    this.hitFlash = 0.12;
    this.unit.damageInAccum += dmg;
    this.unit.lastHitAt = now;
    if (this.hp <= 0) { this.hp = 0; this.alive = false; }
    return dmg;
  }

  /** Bring a dormant brood hull back into play at `pos`. */
  revive(pos) {
    this.alive = true;
    this.hp = this.maxHealth;
    this.shield = 0;
    this.damageReduction = 0;
    this.target = null;
    this.tauntedBy = null;
    this.jammedUntil = 0;
    this.hitFlash = 0;
    this.speed = 0;
    this.mode = 'move';
    this.vel.set(0, 0, 0);
    this.pos.copy(pos);
    this.obj.quaternion.copy(this.unit.formationQuat);
    this.obj.updateMatrix();
  }

  heal(amount) {
    if (!this.alive) return;
    this.hp = Math.min(this.maxHealth, this.hp + amount);
  }
}

// ---------------------------------------------------------------------------
export class Unit {
  constructor(type, faction, spawnPos, seed = 1) {
    this.id = nextId++;
    this.type = type;
    this.faction = faction;
    this.stats = derive(type);
    this.isGround = !!type.ground;
    this.rng = makeRng(seed);
    this.pos = spawnPos.clone();
    this.movePos = spawnPos.clone();
    this.heading = new THREE.Vector3(...WORLD.planetCenter).sub(spawnPos);
    if (this.heading.lengthSq() < 1e-6) this.heading.set(0, 0, -1);
    this.heading.normalize();
    this.craft = [];
    for (let i = 0; i < type.count; i++) {
      this.craft.push(new Craft(this, i, this.rng));
    }
    // Re-centre the formation so the slots average to exactly zero. This is
    // load-bearing, not tidiness: if the slots are off centre the squadron
    // centroid parks away from the commanded destination, so `movePos - pos`
    // never reaches zero, the heading keeps being re-derived, that rotates the
    // slots, the craft chase the moved slots, and the centroid shifts again —
    // a feedback loop that spins parked units on the spot forever.
    this.centreFormation();

    this.formationQuat = new THREE.Quaternion();
    _mat.lookAt(ZERO, this.heading, UP);
    this.formationQuat.setFromRotationMatrix(_mat);

    // Place every craft exactly on its station, already bearing on the planet.
    // Spawning them scattered meant the battle opened with each fleet visibly
    // scrambling into formation before anyone had given an order.
    for (const c of this.craft) {
      _tmp.copy(c.slot).applyQuaternion(this.formationQuat);
      c.pos.copy(spawnPos).add(_tmp);
      // Copy the formation quaternion rather than calling obj.lookAt():
      // Object3D.lookAt() swaps its arguments for non-camera objects, so it
      // aims +Z at the target — and these hulls are modelled nose-down -Z.
      c.obj.quaternion.copy(this.formationQuat);
      c.speed = 0;
    }
    this.updateCentroid();

    this.callsign = nextCallsign(faction);
    this.selected = false;
    this.attackTarget = null;
    /**
     * The squadron the player actually clicked on, as opposed to whatever the
     * ATTACK stance has drifted onto.
     *
     * These have to be separate. `attackTarget` is rewritten several times a
     * second by updateAttackStance so that an attack-MOVE (a click on empty
     * space) still finds something to shoot — but that same rewrite used to
     * discard an order aimed at a named hull within a tick of it being given.
     * A session report showed a fleet ordered onto "Hearth" shooting at
     * Dagger by 0:15, Ember by 0:30 and Bulwark by 0:45 without the player
     * touching anything, which means focus fire — kill the Rig, kill the Aegis
     * — was not a move you could make.
     */
    this.orderedTarget = null;
    /**
     * How many orders this squadron has ever been given, by anyone. Its only
     * job is to tell "nobody has ever told this unit anything" apart from "it
     * is doing what it was told" — which is what a carrier's brood has to know
     * before it adopts its parent's orders.
     */
    this.orderCount = 0;
    /**
     * Station-keeping radius from the planet, 0 for unleashed. The defending
     * Commander sets this so its fleet fights over the world instead of
     * following the battle away from it; see applyLeash().
     */
    this.leashRadius = 0;

    /**
     * Stance. The single most-asked question in a battle is "what is this
     * squadron actually doing right now", and before this there was no answer.
     *
     *   move    hold formation, shoot what comes inside weapon range,
     *           do NOT break off to chase. This is the default.
     *   attack  seek and destroy: close on targets and pursue them.
     *   defend  escort `guardTarget` — a friendly squadron or the planet —
     *           staying with it and switching fire onto whatever attacks it.
     *   hold    do not move at all, fire at will.
     */
    this.stance = 'move';
    this.guardTarget = null;

    this.damageInAccum = 0;
    this.damageOutAccum = 0;
    this.dpsIn = 0;
    this.dpsOut = 0;
    this.lastHitAt = -1e9;
    this.brood = null;
    this.broodOf = null;
    this.spawnTimer = 0;
    this.siegeLock = false;
    this.autocast = true;
    this.abilityCooldown = 0;
    this.abilityActive = 0;
    this.destroyed = false;
    this.orderMarker = null;
    this.shieldOn = false;
    this.shieldPower = SHIELDS.max;
    this.shieldCooldown = 0;
  }

  get alive() { return this.craft.some((c) => c.alive); }
  get aliveCraft() { return this.craft.filter((c) => c.alive); }
  get count() { return this.craft.reduce((n, c) => n + (c.alive ? 1 : 0), 0); }

  get healthFraction() {
    const full = this.stats.maxHealth * this.type.count;
    return this.craft.reduce((s, c) => s + (c.alive ? c.hp : 0), 0) / full;
  }

  get abilityReady() { return this.abilityCooldown <= 0 && this.alive; }

  // --- focused shields -----------------------------------------------------
  get shieldFraction() { return this.shieldPower / SHIELDS.max; }
  get canRaiseShield() { return this.shieldPower >= SHIELDS.minToRaise; }

  toggleShield(on) {
    const want = on === undefined ? !this.shieldOn : !!on;
    if (want && !this.canRaiseShield) return this.shieldOn;
    this.shieldOn = want;
    if (!want) this.shieldCooldown = SHIELDS.rechargeDelay;
    return this.shieldOn;
  }

  updateShield(dt) {
    if (this.shieldOn) {
      this.shieldPower -= SHIELDS.drain * dt;
      if (this.shieldPower <= 0) {
        this.shieldPower = 0;
        this.shieldOn = false;
        this.shieldCooldown = SHIELDS.rechargeDelay;
      }
      return;
    }
    if (this.shieldCooldown > 0) { this.shieldCooldown -= dt; return; }
    if (this.shieldPower < SHIELDS.max) {
      this.shieldPower = Math.min(SHIELDS.max, this.shieldPower + SHIELDS.recharge * dt);
    }
  }

  // --- formation -----------------------------------------------------------
  /** Shift every slot so they average to exactly zero. See the constructor. */
  centreFormation() {
    _tmp.set(0, 0, 0);
    for (const c of this.craft) _tmp.add(c.slot);
    _tmp.divideScalar(this.craft.length);
    for (const c of this.craft) c.slot.sub(_tmp);
  }

  /** Re-derive the formation after a look preset changed the hull scale. */
  relayoutFormation() {
    for (const c of this.craft) c.layOutSlot();
    this.centreFormation();
  }

  /** Centroid of living craft, refreshed each tick. */
  updateCentroid() {
    const alive = this.aliveCraft;
    if (!alive.length) return;
    _tmp.set(0, 0, 0);
    for (const c of alive) _tmp.add(c.pos);
    this.pos.copy(_tmp.divideScalar(alive.length));
  }

  // --- naming and status ---------------------------------------------------
  get label() { return this.customName || this.callsign; }
  get fullLabel() { return `${this.label} · ${this.type.name}`; }

  rename(name) {
    const clean = String(name || '').trim().slice(0, 18);
    this.customName = clean || null;
  }

  get holdPosition() { return this.stance === 'hold'; }

  /**
   * A squadron that is deliberately stationary. Drives two exemptions in
   * combat.js: it keeps full firepower while parked, and it does NOT hand
   * attackers the usual bonus for shooting at something motionless.
   */
  get isAnchored() { return this.stance === 'defend'; }

  /**
   * Is this squadron painted for `faction` — does that side have close enough
   * eyes on it to concentrate fire? True if any one of its hulls is, because
   * a squadron flies as a block and resolving one of them resolves the group.
   */
  paintedFor(faction) {
    for (const c of this.craft) if (c.alive && c.paintedBy[faction]) return true;
    return false;
  }

  guardPos(planetPos) {
    if (this.stance !== 'defend' || !this.guardTarget) return null;
    if (this.guardTarget === 'planet') return planetPos;
    return this.guardTarget.alive ? this.guardTarget.pos : null;
  }

  get statusLabel() {
    if (this.siegeLock) return 'BOMBARDING';
    if (this.stance === 'hold') return 'HOLDING';
    const firing = this.craft.some((c) => c.alive && c.target && c.target.alive);
    if (this.stance === 'defend') {
      if (!this.guardTarget) return 'DEFENDING';
      const who = this.guardTarget === 'planet'
        ? 'PLANET' : this.guardTarget.label.toUpperCase();
      return firing ? `DEFENDING ${who}` : `GUARDING ${who}`;
    }
    if (this.stance === 'attack') {
      // Naming the hull is the only way the player can tell a standing order
      // apart from the stance picking its own fight.
      if (this.orderedTarget && this.orderedTarget.alive) {
        return `${firing ? 'ENGAGING' : 'HUNTING'} ${this.orderedTarget.label.toUpperCase()}`;
      }
      return firing ? 'ENGAGING' : 'ADVANCING';
    }
    if (firing) return 'FIRING';
    return this.pos.distanceToSquared(this.movePos) > 40 * 40 ? 'MOVING' : 'STANDING BY';
  }

  /** Same idea, in the future tense, for the preparation phase. */
  get plannedLabel() {
    if (this.siegeLock) return 'WILL BOMBARD';
    if (this.stance === 'hold') return 'HOLDING';
    if (this.stance === 'defend') {
      return this.guardTarget
        ? `WILL GUARD ${this.guardTarget === 'planet' ? 'PLANET' : this.guardTarget.label.toUpperCase()}`
        : 'AWAITING A CHARGE';
    }
    const moving = this.pos.distanceToSquared(this.movePos) > 40 * 40;
    if (this.stance === 'attack') {
      if (this.orderedTarget && this.orderedTarget.alive) {
        return `WILL HUNT ${this.orderedTarget.label.toUpperCase()}`;
      }
      return moving ? 'WILL ADVANCE' : 'WILL ATTACK';
    }
    return moving ? 'ORDERS SET' : 'AWAITING ORDERS';
  }

  /**
   * How close this squadron is to dying, 0..1 — used by the AI to decide what
   * to pull out and what to finish. Expressed as time-to-live under the
   * damage it is currently taking, so a hull nobody is shooting is never
   * "threatened" however hurt it already is.
   */
  get threat() {
    if (!this.alive || this.dpsIn <= 0) return 0;
    const hp = this.craft.reduce((s, c) => s + (c.alive ? c.hp : 0), 0);
    if (hp <= 0) return 1;
    const ttl = hp / this.dpsIn;
    return ttl > 30 ? 0 : clamp(1 - (ttl - 6) / 24, 0, 1);
  }

  // --- orders --------------------------------------------------------------
  defend(target) {
    if (!target || target === this) return false;
    this.stance = 'defend';
    this.guardTarget = target;
    this.attackTarget = null;
    this.orderedTarget = null;
    this.siegeLock = false;
    this.orderCount++;
    return true;
  }

  /**
   * Take the carrier's standing orders, for a brood nobody has ordered yet.
   *
   * A brood squadron is created docked, at the carrier's *spawn* position, and
   * its movePos stays there. Its hulls, though, are revived next to the carrier
   * wherever that has since flown to — so every fighter launched mid-battle
   * immediately turned around and flew back to the staging area. A session
   * report showed two Spawners' entire output, seven hulls of a 1,000-point
   * fleet, loitering 3,000 units behind the battle for seven minutes while
   * their parents fought and died.
   *
   * Deliberately not an order: it does not touch orderCount, so the brood keeps
   * following its carrier until the player actually tells it something, and
   * stops adopting the moment they do.
   */
  adoptOrdersFrom(parent) {
    // A bombarding carrier is parked on its standoff; the brood screens it
    // there rather than trying to bombard with fighter guns.
    this.stance = parent.siegeLock ? 'attack' : parent.stance;
    this.guardTarget = parent.stance === 'defend' ? parent.guardTarget : null;
    this.orderedTarget = parent.orderedTarget;
    this.attackTarget = parent.orderedTarget;
    this.movePos.copy(parent.siegeLock ? parent.pos : parent.movePos);
    if (!this.isGround) pushOutOfPlanet(this.movePos, 60);
  }

  order(pos, { attack = null, hold = false, siege = false, stance = null } = {}) {
    if (stance) this.stance = stance;
    if (hold) this.stance = 'hold';
    if (this.stance !== 'defend') this.guardTarget = null;
    this.movePos.copy(pos);
    if (!this.isGround) pushOutOfPlanet(this.movePos, 60);
    this.attackTarget = attack;
    // Every order replaces the standing one, including a click on empty space,
    // which clears it. An order aimed at nothing is still a decision.
    this.orderedTarget = attack || null;
    if (!siege) this.siegeLock = false;
    this.orderCount++;
  }

  /** True when nothing hostile is inside weapon range of any of our hulls. */
  /**
   * Advisory only: is this a sensible moment to commit to a bombardment?
   *
   * Consulted by the AI and by the ATTACK-stance auto-siege, which should not
   * lock on with something sitting on top of them. A player who explicitly
   * orders a bombardment always gets one — doing it under fire is a real
   * choice now that a sieging squadron can still defend itself.
   *
   * The radius is a tight guard rather than full weapon range. At weapon range
   * this could effectively never be true against a defence parked on the
   * objective, which is what made bombardment unreachable.
   */
  clearToSiege(enemyCraft) {
    const r2 = SIEGE.lockGuard ** 2;
    for (const c of this.craft) {
      if (!c.alive) continue;
      for (const e of enemyCraft) {
        if (e.alive && e.pos.distanceToSquared(c.pos) <= r2) return false;
      }
    }
    return true;
  }

  // --- siege ---------------------------------------------------------------
  /** Any armed hull that isn't bolted to the ground can bombard. */
  get canSiege() { return !this.isGround && !!this.type.weapon; }

  /** Damage per second this squadron does to the crust. */
  get siegeDps() {
    if (!this.canSiege) return 0;
    const w = this.type.weapon;
    const pen = Math.max(SIEGE.minPenetration, w.penetration ?? 0.5);
    // Must match trySiegeFire exactly: only (1 - selfDefense) of the rate of
    // fire goes into the crust, and each of those rounds is multiplied. This
    // number is shown to the player as a time-to-break estimate, so a
    // convenient approximation here is just a lie on the HUD.
    return this.stats.dps * pen * SIEGE.damageMultiplier
      * (1 - SIEGE.selfDefense) * this.count;
  }

  /**
   * Narrower than canSiege: hulls actually worth committing to a bombardment.
   * Snipers are excluded because their whole value is standoff, and anything
   * light either can't hurt the crust or dies before it finishes.
   */
  get siegeCapital() {
    const t = this.type;
    return this.canSiege && !t.sniper
      && (t.weapon.penetration ?? 0) >= 0.5 && t.scale >= 2.5;
  }

  beginSiege() {
    if (!this.canSiege) return false;
    _tmp.copy(this.pos).sub(PLANET);
    if (_tmp.lengthSq() < 1e-6) _tmp.set(0, 0, -1);
    _tmp.normalize();
    const standoff = WORLD.planetRadius
      + Math.max(60, this.stats.range * SIEGE.standoff);
    _siege.copy(PLANET).addScaledVector(_tmp, standoff);
    this.order(_siege, { attack: null, siege: true });
    this.siegeLock = true;
    // The squadron keeps shooting back — the commitment is that most of its
    // rate of fire now goes into the crust instead (SIEGE.selfDefense), and
    // that it is holding a fixed standoff rather than manoeuvring.
    return true;
  }

  nearestCraft(pos) {
    let best = null;
    let bestD = Infinity;
    for (const c of this.craft) {
      if (!c.alive) continue;
      const d = c.pos.distanceToSquared(pos);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }
}

// ---------------------------------------------------------------------------
// World containment
// ---------------------------------------------------------------------------
const PLANET = new THREE.Vector3(...WORLD.planetCenter);
/** No hull may come closer than this to the planet's centre. */
const ORBIT_FLOOR = WORLD.planetRadius + 45;
const ARRIVE = 14;
const HEADING_EPS = 40;
const ARENA_R = WORLD.arenaRadius;
const WALL = WORLD.wallSoftness;
/** The vertical cushion has to shrink with a thin slab or FLAT has no room. */
const softY = () => Math.min(WALL, WORLD.arenaHeight * 0.5);

const _away = new THREE.Vector3();

/** Bend a desired heading away from the arena shell. Returns 0..1 pressure. */
/**
 * Hold a leashed hull inside its station.
 *
 * Shaped deliberately like avoidWalls: the DESIRED HEADING is bent, not the
 * position clamped, so a pursuing squadron peels off at the boundary instead of
 * stopping dead or snapping back. This is how a defending fleet stays over the
 * world it is defending while still fighting properly — an earlier attempt did
 * it by forcing the squadron onto MOVE stance instead, which stopped it
 * pursuing at all and turned the whole defence into a punching bag (its
 * AI-vs-AI win rate fell to 9%).
 *
 * `leash` is a radius from the planet's centre, or 0 for unleashed.
 */
function applyLeash(pos, dir, leash) {
  if (!leash) return;
  _away.copy(pos).sub(PLANET);
  const d = _away.length();
  // Soft band over the outer 15% so the turn starts before the boundary.
  const soft = leash * 0.85;
  if (d <= soft || d < 1e-4) return;
  const k = clamp((d - soft) / (leash - soft), 0, 1);
  _away.divideScalar(d).negate();
  dir.lerp(_away, k * 0.9).normalize();
}

function avoidWalls(pos, dir) {
  let press = 0;
  const radial = Math.hypot(pos.x, pos.z);
  if (radial > ARENA_R - WALL) {
    const k = clamp((radial - (ARENA_R - WALL)) / WALL, 0, 1);
    if (radial > 1e-4) {
      _away.set(-pos.x / radial, 0, -pos.z / radial);
      dir.lerp(_away, k * 0.9).normalize();
    }
    press = Math.max(press, k);
  }
  const height = Math.abs(pos.y);
  const cushion = softY();
  if (height > WORLD.arenaHeight - cushion) {
    const k = clamp((height - (WORLD.arenaHeight - cushion)) / cushion, 0, 1);
    _away.set(0, pos.y > 0 ? -1 : 1, 0);
    dir.lerp(_away, k * 0.9).normalize();
    press = Math.max(press, k);
  }
  return press;
}

/** Hard clamp a craft back inside the shell, killing outward velocity. */
function containCraft(craft) {
  const p = craft.pos;
  const radial = Math.hypot(p.x, p.z);
  if (radial > ARENA_R && radial > 1e-4) {
    const k = ARENA_R / radial;
    p.x *= k; p.z *= k;
    const nx = p.x / ARENA_R;
    const nz = p.z / ARENA_R;
    const outward = craft.vel.x * nx + craft.vel.z * nz;
    if (outward > 0) { craft.vel.x -= nx * outward; craft.vel.z -= nz * outward; }
  }
  const h = WORLD.arenaHeight;
  if (p.y > h) { p.y = h; if (craft.vel.y > 0) craft.vel.y = 0; }
  else if (p.y < -h) { p.y = -h; if (craft.vel.y < 0) craft.vel.y = 0; }
}

/**
 * Push a point out of the planet, resolving the slab and the sphere TOGETHER.
 *
 * Doing it sequentially — escape radially, then clamp height — is what broke
 * in FLAT: the radial escape lifted a hull, the slab clamp squashed it back
 * down, and it landed inside the planet again. Solving for the horizontal
 * distance at the point's FINAL height instead means one pass always lands
 * outside.
 */
export function pushOutOfPlanet(v, margin = 20) {
  clampPointToArena(v, margin);
  const dy = v.y - PLANET.y;
  const r2 = ORBIT_FLOOR * ORBIT_FLOOR - dy * dy;
  if (r2 <= 0) return v;              // above/below the sphere entirely
  const need = Math.sqrt(r2);
  let dx = v.x - PLANET.x;
  let dz = v.z - PLANET.z;
  let flat = Math.hypot(dx, dz);
  if (flat < 1e-4) { dx = 0; dz = -1; flat = 0; }
  else { dx /= flat; dz /= flat; }
  if (flat < need) {
    v.x = PLANET.x + dx * need;
    v.z = PLANET.z + dz * need;
  }
  return v;
}

/** Clamp an arbitrary point inside the arena, leaving `margin` of slack. */
export function clampPointToArena(v, margin = 60) {
  const limit = ARENA_R - margin;
  const radial = Math.hypot(v.x, v.z);
  if (radial > limit && radial > 1e-4) {
    const k = limit / radial;
    v.x *= k; v.z *= k;
  }
  const hLimit = Math.max(0,
    WORLD.arenaHeight - Math.min(margin, WORLD.arenaHeight * 0.5));
  v.y = clamp(v.y, -hLimit, hLimit);
  return v;
}

// ---------------------------------------------------------------------------
// Flight model
// ---------------------------------------------------------------------------
const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Vector3();
const _mat = new THREE.Matrix4();
const IDENTITY = new THREE.Quaternion();
const _dir = new THREE.Vector3();

/**
 * Move one craft for a tick.
 *
 * Two quite different behaviours share this function. With a live target that
 * it is allowed to engage, a craft flies its own combat pattern — agile hulls
 * dogfight (dive in, break away, come round again), heavy hulls hold a
 * standoff at a fraction of their weapon range and strafe rather than close.
 * Otherwise it flies its formation slot relative to the squadron's order.
 */
export function updateCraftMovement(craft, dt) {
  const unit = craft.unit;
  const stats = unit.stats;
  if (unit.isGround) { updateGroundCraft(craft, dt); return; }

  const target = craft.target;
  const dir = _dir;
  let throttle = 1;
  let cruising = false;
  const dist = target && target.alive ? craft.pos.distanceTo(target.pos) : Infinity;
  // Only ATTACK actually pursues. Everything else fights from where it stands,
  // which is the whole point of having stances.
  const pursue = unit.stance === 'attack' && !unit.type.sniper;

  // A bombarding squadron never manoeuvres against ships. It flies to its
  // standoff over the crust and holds there, shooting back at whatever comes
  // inside range — tryFire is independent of this, so it still defends itself.
  //
  // This has to be checked here, not left to `target` being null. Siege hulls
  // used to have their target cleared every tick, which made `engaging` false
  // as a side effect; once they were allowed to keep a target for self-defence,
  // ATTACK-stance pursuit quietly resumed and dragged them off station. They
  // closed to ~1,140 units of a 760-unit firing position, stalled there chasing
  // ships, and fired nothing at the planet for the whole match.
  // Everything below reads the range this hull can actually use against THIS
  // target, not its rated range, so an unresolved contact is closed on rather
  // than parked in front of. See SCOUTING and effectiveRange().
  const reach = target && target.alive ? craft.fireRange : stats.range;

  const engaging = !unit.siegeLock
    && target && target.alive && !unit.holdPosition
    && !(unit.type.sniper && dist > reach)
    && (pursue || dist <= reach * 1.05);

  if (engaging) {
    const range = reach;
    if (unit.type.agility >= 60 && !unit.type.sniper) {
      // Dogfighter: close, then peel off before overshooting.
      if (craft.mode === 'breakaway') {
        craft.modeTimer -= dt;
        dir.copy(craft.pos).sub(target.pos).normalize();
        _side.set(0, 1, 0).cross(dir).normalize();
        dir.addScaledVector(_side, 0.6).normalize();
        if (craft.modeTimer <= 0 || dist > range * 3.2) craft.mode = 'engage';
      } else {
        dir.copy(target.pos).sub(craft.pos).normalize();
        if (dist < range * 0.45) {
          craft.mode = 'breakaway';
          craft.modeTimer = 1.6 + unit.rng() * 1.2;
        }
      }
    } else {
      // Line ship: hold a standoff and strafe rather than close the distance.
      const stand = range * (unit.type.sniper ? 0.92 : 0.8);
      dir.copy(target.pos).sub(craft.pos);
      const d = dir.length();
      dir.normalize();
      if (d < stand * 0.75) { dir.negate(); throttle = 0.5; }
      else if (d < stand) { _side.copy(dir).cross(UP).normalize(); dir.copy(_side); throttle = 0.35; }
    }
  } else {
    // Fly the formation slot around the commanded destination.
    _slot.copy(craft.slot).applyQuaternion(unit.formationQuat || IDENTITY);
    _tmp.copy(unit.movePos).add(_slot);
    dir.copy(_tmp).sub(craft.pos);
    const d = dir.length();
    // A long march, not a local reposition: fly it at the cruise floor so the
    // fleet arrives together instead of in speed order. See TRANSIT in config.
    cruising = d > TRANSIT.engageDistance;
    if (d < ARRIVE) {
      // Parked. Keep the nose on the planet rather than drifting aimlessly —
      // an idle ship that slowly rotates forever reads as a bug.
      throttle = 0;
      dir.copy(PLANET).sub(craft.pos);
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
      dir.normalize();
    } else {
      dir.normalize();
      throttle = clamp(d / 60, 0.25, 1);
    }
  }

  // Never fly into the world.
  const fromPlanet = _tmp.copy(craft.pos).sub(PLANET);
  const pd = fromPlanet.length();
  if (pd < ORBIT_FLOOR) {
    dir.addScaledVector(fromPlanet.normalize(), ((ORBIT_FLOOR - pd) / 45) * 2.5);
    dir.normalize();
  }
  // Station-keeping runs before wall avoidance, so the arena wall still wins
  // if the two ever disagree.
  applyLeash(craft.pos, dir, unit.leashRadius);
  craft.wallPress = avoidWalls(craft.pos, dir);

  // Bank into the turn: how far the desired heading is off our own right axis.
  _fwd.set(0, 0, -1).applyQuaternion(craft.obj.quaternion);
  _side.set(1, 0, 0).applyQuaternion(craft.obj.quaternion);
  const wantBank = -clamp(_side.dot(dir), -1, 1)
    * (0.5 + (unit.type.agility / 100) * 0.9);
  craft.bank += (wantBank - craft.bank) * Math.min(1, dt * 3.5);
  steerTowards(craft.obj, dir, stats.turnRate * dt, craft.bank);

  // Accelerate harder than we decelerate, so ships feel like they have mass.
  const top = cruising ? Math.max(stats.maxSpeed, TRANSIT.cruiseSpeed) : stats.maxSpeed;
  const want = top * throttle;
  craft.speed += clamp(want - craft.speed, -stats.accel * 30 * dt, stats.accel * 22 * dt);
  craft.speed = clamp(craft.speed, 0, top);

  _fwd.set(0, 0, -1).applyQuaternion(craft.obj.quaternion);
  craft.vel.copy(_fwd).multiplyScalar(craft.speed);
  craft.pos.addScaledVector(craft.vel, dt);

  containCraft(craft);

  // Final safety net: if we ended up inside the planet anyway, get out and
  // kill the inward component of velocity so we don't immediately re-enter.
  _tmp.copy(craft.pos).sub(PLANET);
  if (_tmp.lengthSq() < ORBIT_FLOOR * ORBIT_FLOOR) {
    pushOutOfPlanet(craft.pos, 0);
    _tmp.copy(craft.pos).sub(PLANET);
    const d = _tmp.length();
    if (d > 1e-4) {
      _tmp.divideScalar(d);
      const into = craft.vel.dot(_tmp);
      if (into < 0) craft.vel.addScaledVector(_tmp, -into);
    }
  }
}

const _up = new THREE.Vector3();

/** Emplacements crawl across the crust rather than fly. */
function updateGroundCraft(craft, dt) {
  const unit = craft.unit;
  const stats = unit.stats;
  const up = _up.copy(craft.pos).sub(PLANET).normalize();

  if (stats.maxSpeed > 0 && !unit.holdPosition) {
    _dir.copy(unit.movePos).sub(craft.pos);
    // Project the move onto the local tangent plane, then re-seat on the crust.
    _dir.addScaledVector(up, -_dir.dot(up));
    if (_dir.length() > 8) {
      _dir.normalize();
      craft.pos.addScaledVector(_dir, stats.maxSpeed * dt);
      _tmp.copy(craft.pos).sub(PLANET).normalize();
      craft.pos.copy(PLANET)
        .addScaledVector(_tmp, WORLD.planetRadius + craft.groundOffset);
      up.copy(_tmp);
    }
  }

  if (craft.target && craft.target.alive) {
    _dir.copy(craft.target.pos).sub(craft.pos);
    _dir.addScaledVector(up, -_dir.dot(up));
    if (_dir.lengthSq() > 1e-6) craft.groundFacing.copy(_dir.normalize());
  }
  _mat.lookAt(ZERO, _fwd.copy(craft.groundFacing), up);
  craft.obj.quaternion.setFromRotationMatrix(_mat);
  craft.vel.set(0, 0, 0);
}

/** Seat a ground squadron on the crust around a direction from the centre. */
export function seatOnPlanet(unit, dir) {
  const base = dir.clone().normalize();
  for (const c of unit.craft) {
    c.groundOffset = 0;
    c.groundFacing = new THREE.Vector3(0, 0, -1);
    const jitter = new THREE.Vector3(
      (unit.rng() - 0.5) * 0.06,
      (unit.rng() - 0.5) * 0.06,
      (unit.rng() - 0.5) * 0.06,
    );
    const n = base.clone().add(jitter).normalize();
    c.pos.copy(PLANET).addScaledVector(n, WORLD.planetRadius);
    const tangent = new THREE.Vector3(0, 1, 0).cross(n);
    if (tangent.lengthSq() < 1e-6) tangent.set(1, 0, 0);
    c.groundFacing.copy(tangent.normalize());
  }
  unit.updateCentroid();
  unit.movePos.copy(unit.pos);
}

/**
 * Per-squadron bookkeeping: centroid, cooldowns, and the formation's facing.
 *
 * The heading only re-derives while the squadron is actually travelling —
 * see the note in the Unit constructor about parked units spinning forever if
 * the formation keeps chasing sub-pixel centroid noise.
 */
export function updateUnit(unit, dt) {
  unit.updateCentroid();
  if (unit.abilityCooldown > 0) unit.abilityCooldown -= dt;
  if (unit.abilityActive > 0) unit.abilityActive -= dt;
  if (unit.isGround) return;

  _dir.copy(unit.movePos).sub(unit.pos);
  if (_dir.lengthSq() > HEADING_EPS * HEADING_EPS) {
    unit.heading.lerp(_dir.normalize(), Math.min(1, dt * 2));
    if (!unit.formationQuat) unit.formationQuat = new THREE.Quaternion();
    _mat.lookAt(ZERO, _tmp.copy(unit.heading).normalize(), UP);
    unit.formationQuat.setFromRotationMatrix(_mat);
  }
}
