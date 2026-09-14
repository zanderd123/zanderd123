/**
 * Central balance + tuning data.
 *
 * The design sheet uses abstract 0-100 stats. Everything here converts those
 * into world units so the numbers on the card actually drive the simulation:
 *
 *   speed    -> world units / second
 *   health   -> hit points                  (x12)
 *   dps      -> raw damage / second         (x0.5)   -- before accuracy
 *   agility  -> turn rate AND evasion       (see combat.js)
 *   skill    -> ability power/duration AND weapon tracking
 *
 * The key interaction is accuracy: a weapon's tracking is derived from the
 * firing ship's agility+skill, and it is checked against the target's agility.
 * That is what makes the Wasp "almost never gets caught" rather than merely
 * fast, and it is why the slow Bastion cannot meaningfully shoot fighters.
 *
 * Two mechanics exist on top of the raw sheet because the sheet alone breaks:
 *
 *  1. armor / penetration. Without it a Wasp squadron out-damages a Bastion's
 *     own guns and melts the tank in ~6s. Heavy hulls now shrug off
 *     small-calibre fire, so light craft genuinely cannot crack armour alone
 *     and you need Falcons or Bastions to kill capitals.
 *  2. `ignoresEvasion` on flak. The Flak Walker's tracking (30) vs a Wasp's
 *     agility (95) lands on the accuracy floor, which would make the
 *     designated anti-fighter unit unable to hit fighters. Flak is
 *     proximity-fused, so it skips the tracking check entirely and instead
 *     leans on its damage bonus vs agile targets / penalty vs armour.
 */

export const HEALTH_SCALE = 12;
// Lowered from 0.9 to stretch battles out. Because this scales every ship's
// damage by the same factor, effective HP rises by exactly the same factor
// that damage falls: all the matchup ratios and the derived point costs are
// completely unaffected. Fights simply take longer to resolve.
export const DPS_SCALE = 0.5;

/**
 * Speed is deliberately NOT a flat multiple of the sheet stat.
 *
 * On a small map a Wasp beat a Bastion to the fight by about thirty seconds,
 * which is not enough time to do anything with — you could not send scouts
 * ahead and still have orders left to give, because the heavies were right
 * behind them. The curve below widens the *absolute* gap rather than the
 * ratio, so a scouting element arrives a full minute before the line does.
 * That minute is the window the whole "move some ships while others are still
 * in transit" idea lives in.
 */
export const SPEED_BASE = 16;
export const SPEED_SPAN = 108;
export const SPEED_EXP = 1.35;
/** Surface crawlers are held back so walkers don't outrun cruisers. */
export const GROUND_SPEED_SCALE = 0.6;

export function speedFor(stat, ground = false) {
  if (stat <= 0) return 0;
  const v = SPEED_BASE + (Math.min(stat, 100) / 100) ** SPEED_EXP * SPEED_SPAN;
  return ground ? v * GROUND_SPEED_SCALE : v;
}

export const FACTION = { ATTACK: 'attack', DEFENSE: 'defense' };

// ---------------------------------------------------------------------------
// World layout
// ---------------------------------------------------------------------------
/**
 * The arena is a hard-walled cylinder, not a soft leash.
 *
 * Two reasons it is drawn and enforced rather than merely implied. First, the
 * distance between the staging areas is where the strategy lives — if ships
 * can wander off in any direction there is no "between", just open space.
 * Second, a boundary you cannot see is one you only discover by bouncing off
 * it, which reads as a bug. The shell is rendered and lights up where a hull
 * gets close.
 */
export const WORLD = {
  planetRadius: 300,
  planetCenter: [0, -60, 0],
  // Attackers arrive from deep space along -Z; the defenders hold a picket
  // line in FRONT of the world they are defending, so the planet is behind
  // them and an assault has to come through. (An earlier layout put the
  // defence in high orbit on the far side, which meant the attacker reached
  // the objective before it reached the enemy fleet — the siege became a
  // straight race to the crust that fighting could never win.)
  //
  // ~3,000 units of no-man's-land. At an earlier 2,100 the first shots landed
  // around 0:28, which is not enough time to actually plan an approach: the
  // fleets were in contact before you had finished giving your first orders.
  // At 3,000 the fast movers need ~26s to make contact and a Bastion ~76s, so
  // the opening minute is a manoeuvring phase — push scouts wide, lift the
  // line over the plane, hold the heavies back — before anything is decided.
  defenseAnchor: [0, 60, -900],
  attackAnchor: [0, 100, -3900],
  // The wall has to sit clear of the attacker's back rank: a big fleet lays
  // out ~600 units deep behind its anchor, so the shell needs that plus room
  // to withdraw into, or the rear of the formation spawns against the wall.
  arenaRadius: 4700,   // hard wall, horizontal
  arenaHeight: 1400,   // hard ceiling / floor, measured from y = 0
  // How far inside the wall the pushback starts to bite.
  wallSoftness: 260,
  // Vertical scatter: how much height the spawn layout and the AI's orders
  // use. Scaled down in FLAT mode rather than zeroed, because hulls stacked on
  // one exact plane intersect each other.
  spread: 1,
  flat: false,
};

/**
 * VOLUME or FLAT — how much of the third axis the game actually plays in.
 *
 * Measured over 36 instrumented matches, VOLUME spends its vertical budget
 * badly: fleets occupy 13.7% of the available height, so in absolute terms the
 * battle already happens in a slab about 700 units thick inside a 9,400-wide
 * disc. But weapon ranges are short relative to even that slab, so the median
 * engagement still sits 22 degrees off the horizontal and 42% of the
 * separation between two firing ships is vertical.
 *
 * The catch is that nothing in the combat model rewards it. Range is a sphere,
 * accuracy is tracking against agility, and there is no line of sight to break
 * except the planet's own body — so all that vertical is jostle from the
 * flight model, not anybody's plan.
 *
 * FLAT keeps the 3D rendering — hulls still bank through a real scene — and
 * thins the playable slab to a plate. Orders become a single click on a plane
 * you can read, the camera defaults to near-overhead, and the planet (radius
 * 300) now punches clean through the plate, so it is a genuine obstacle to go
 * around rather than a ball to fly over.
 */
export const PLAY = {
  volume: { arenaHeight: 1400, spread: 1, flat: false, camPhi: 1.15, camRadius: 2600, camLead: 0.25, spacing: 1 },
  // 110 is derived, not chosen. Hulls are held ORBIT_FLOOR (planetRadius + 45
  // = 345) from the planet's centre, which sits at y = -60. A ceiling of H
  // lets a hull come within sqrt(345^2 - (H + 60)^2) of the vertical axis, and
  // that reach only exceeds the planet's 300-unit radius once H <= 110. Below
  // that the planet's silhouette is fully sealed: there is no legal position
  // anywhere over the world, so it stops being a ball you fly across and
  // becomes a wall you go around.
  flat: { arenaHeight: 110, spread: 0.22, flat: true, camPhi: 0.30, camRadius: 2400, camLead: 0.12, spacing: 1.6 },
};

/**
 * Switch mode. Mutates WORLD in place rather than re-exporting, because half
 * the codebase holds a reference to it — and everything that reads
 * `arenaHeight` reads it per-use for exactly this reason.
 */
export function setPlayMode(mode) {
  const m = PLAY[mode] || PLAY.volume;
  WORLD.arenaHeight = m.arenaHeight;
  WORLD.spread = m.spread;
  WORLD.flat = m.flat;
  WORLD.mode = m === PLAY.flat ? 'flat' : 'volume';
  WORLD.camPhi = m.camPhi;
  WORLD.camRadius = m.camRadius;
  WORLD.camLead = m.camLead;
  WORLD.spacing = m.spacing;
  return WORLD.mode;
}
setPlayMode('volume');

// ---------------------------------------------------------------------------
// Fleet roster
// ---------------------------------------------------------------------------
export const SHIPS = {
  wasp: {
    id: 'wasp',
    name: 'Wasp',
    className: 'Light Interceptor',
    speed: 90, health: 24, skill: 55, dps: 44, agility: 95,
    role: 'Knife-fighter. Has to get right on top of a target, and dies if it is caught doing it.',
    count: 6,
    costEach: 22,
    range: 130,
    sensor: 520,
    scale: 1.0,
    armor: 0.00,
    color: 0x8fd4ff,
    weapon: { type: 'bolt', rof: 5.5, speed: 620, spread: 0.05, penetration: 0.15 },
    ability: {
      id: 'blink',
      name: 'Blink Dash',
      desc: 'Instantly displaces 180u along the current heading, breaking any lock.',
      cooldown: 12, key: 'Q',
    },
  },
  falcon: {
    id: 'falcon',
    name: 'Falcon',
    className: 'Strike Fighter',
    speed: 75, health: 35, skill: 70, dps: 75, agility: 80,
    role: 'Glass-cannon all-rounder. High burst damage at medium reach, still fragile.',
    // Bought in threes rather than fives. Per-craft value is unchanged, but a
    // 340-point squadron was the least divisible thing on the board: at a
    // 600-point budget you could not field one without spending 57% of the
    // fleet on it, so "heavy Falcon investment" really meant "no room for
    // anything else". Controlling for budget, heavy Falcon share cost the
    // attacker 8 points of win rate and the defender 23.
    count: 3,
    costEach: 68,
    range: 210,
    sensor: 640,
    scale: 1.15,
    armor: 0.05,
    color: 0xffc46b,
    weapon: { type: 'bolt', rof: 4, speed: 700, spread: 0.035, penetration: 0.50 },
    ability: {
      id: 'volley',
      name: 'Missile Volley',
      desc: 'Fires a lock-on salvo dealing heavy burst damage at extended range.',
      cooldown: 15, key: 'Q',
    },
  },
  warden: {
    id: 'warden',
    name: 'Warden',
    className: 'Medium Escort',
    speed: 55, health: 55, skill: 55, dps: 55, agility: 55,
    role: 'Balanced baseline. Everything it does, something else does better.',
    count: 1,
    costEach: 62,
    range: 300,
    sensor: 780,
    scale: 2.6,
    armor: 0.20,
    color: 0xa9c2d9,
    weapon: { type: 'bolt', rof: 2.4, speed: 560, spread: 0.02, penetration: 0.60 },
    ability: {
      id: 'bubble',
      name: 'Shield Bubble',
      desc: 'Projects a damage-absorbing bubble over itself and nearby allies.',
      cooldown: 20, key: 'Q',
    },
  },
  bastion: {
    id: 'bastion',
    name: 'Bastion',
    className: 'Heavy Cruiser',
    speed: 30, health: 95, skill: 35, dps: 75, agility: 15,
    role: 'Siege line. Crawls, soaks punishment, and out-ranges everything except a Specter. The only hull that can meaningfully bombard the planet.',
    count: 1,
    costEach: 82,
    range: 460,
    sensor: 720,
    scale: 4.4,
    armor: 0.55,
    color: 0x9aa4ae,
    weapon: { type: 'shell', rof: 1.1, speed: 620, spread: 0.012, penetration: 1.00 },
    ability: {
      id: 'overcharge',
      name: 'Armor Overcharge',
      desc: 'Hardens plating for heavy damage reduction and taunts nearby enemies onto itself.',
      cooldown: 24, key: 'Q',
    },
  },
  aegis: {
    id: 'aegis',
    name: 'Aegis',
    className: 'Support Carrier',
    speed: 55, health: 88, skill: 90, dps: 15, agility: 30,
    role: 'Barely armed, and it will still decide the battle. Repairs on a scale that outpaces most incoming fire — which makes it the first thing a competent enemy shoots at.',
    count: 1,
    costEach: 128,
    range: 230,
    sensor: 1000,
    passiveRepair: 7,   // hp/sec to nearby damaged allies, always on
    scale: 4.0,
    armor: 0.35,
    color: 0xbfe3c9,
    weapon: { type: 'bolt', rof: 1.6, speed: 480, spread: 0.05, penetration: 0.40 },
    ability: {
      id: 'repair',
      name: 'Repair Drones',
      desc: 'Launches drones that continuously repair damaged allies in a wide radius.',
      cooldown: 18, key: 'Q',
    },
  },
  spawner: {
    id: 'spawner',
    name: 'Spawner',
    className: 'Fleet Carrier',
    speed: 20, health: 80, skill: 45, dps: 12, agility: 12,
    role: 'Crawls, barely shoots, and never stops producing. Launches a Wasp every 30 seconds up to a standing screen of six. Park it behind your line and make the enemy come and dig it out.',
    count: 1,
    // Re-priced from 130 when production went from a hull every 6s to one
    // every 30s. Measured over 225 matches, that five-fold output cut dropped
    // the Spawner from 11.65 value-per-point to 6.86 — second-worst on the
    // board against a 12.00 top — so the hull was simply overpriced for what
    // it now does. Cost is the honest lever here: the cadence is a design
    // decision, the price is derived from measurement.
    costEach: 84,
    range: 200,
    sensor: 700,
    scale: 4.6,
    armor: 0.40,
    color: 0xc2a86a,
    /**
     * Brood. One hull per ability cast, up to `cap` alive at once.
     *
     * The cap is what stops this being an infinite supply of free ships: over
     * a ten-minute match an uncapped carrier would put out well over a hundred
     * Wasps for a one-off cost, which is not a unit, it is a win button.
     *
     * Production IS the ability — there is no passive interval, so there is
     * one rule and it is the one shown on the ability panel with its cooldown,
     * instead of a hidden timer the player has to infer from watching.
     */
    spawns: { typeId: 'wasp', cap: 6 },
    weapon: { type: 'bolt', rof: 1.4, speed: 500, spread: 0.04, penetration: 0.35 },
    ability: {
      id: 'launch_wasp',
      name: 'Launch Wasp',
      desc: 'Releases one Wasp from the hangar. On autocast that is a new hull '
        + 'every 30 seconds, up to a standing screen of 6.',
      cooldown: 30, key: 'Q',
    },
  },
  specter: {
    id: 'specter',
    name: 'Specter',
    className: 'Cloak Scout',
    speed: 85, health: 18, skill: 85, dps: 20, agility: 70,
    role: 'Eyes and a rifle. Sees further and shoots further than anything else in the fleet, holds station behind your line, and folds the moment anything reaches it.',
    count: 3,
    costEach: 40,
    range: 560,
    sensor: 1600,
    scale: 1.2,
    armor: 0.00,
    color: 0xc79bff,
    cloak: true,
    sniper: true,
    weapon: { type: 'bolt', rof: 0.9, speed: 900, spread: 0.02, penetration: 0.70 },
    ability: {
      id: 'jam',
      name: 'Sensor Jam',
      desc: 'Blinds enemy targeting in a wide radius — jammed ships cannot acquire new targets.',
      cooldown: 22, key: 'Q',
    },
  },
};

// ---------------------------------------------------------------------------
// Ground support (defense only)
// ---------------------------------------------------------------------------
export const GROUND = {
  sentry: {
    id: 'sentry',
    name: 'Sentry Turret',
    className: 'Static Emplacement',
    speed: 0, health: 78, skill: 40, dps: 80, agility: 0,
    role: 'Static area denial. Brutal at a chokepoint, useless once the fight moves.',
    count: 1,
    costEach: 52,
    range: 500,
    sensor: 700,
    scale: 3.0,
    armor: 0.30,
    color: 0xd08b6a,
    ground: true,
    weapon: { type: 'shell', rof: 1.6, speed: 520, spread: 0.015, penetration: 0.95 },
    ability: {
      id: 'overcharge_burst',
      name: 'Overcharge Burst',
      desc: 'Doubles rate of fire and widens the firing arc for a short window.',
      cooldown: 20, key: 'Q',
    },
  },
  rig: {
    id: 'rig',
    name: 'Repair Rig',
    className: 'Mobile Support',
    speed: 20, health: 40, skill: 95, dps: 0, agility: 20,
    role: 'Mobile heal and resupply. Zero offense — it needs somebody to protect it.',
    count: 1,
    costEach: 54,
    range: 0,
    sensor: 460,
    passiveRepair: 5,
    scale: 2.4,
    armor: 0.10,
    color: 0x86d3b8,
    ground: true,
    weapon: null,
    ability: {
      id: 'field_repair',
      name: 'Field Repair',
      desc: 'Repairs friendly ground units and any friendly ship in low orbit above it.',
      cooldown: 14, key: 'Q',
    },
  },
  flak: {
    id: 'flak',
    name: 'Flak Walker',
    className: 'Anti-Fighter Walker',
    speed: 40, health: 75, skill: 40, dps: 60, agility: 20,
    role: 'Slow anti-fighter platform. Shreds fast movers, bounces off heavy armor.',
    count: 1,
    costEach: 84,
    range: 330,
    sensor: 560,
    scale: 2.8,
    armor: 0.40,
    color: 0xb9a06a,
    ground: true,
    antiFighter: true, // bonus vs high agility, penalty vs heavy armor
    weapon: {
      type: 'flak', rof: 2.2, speed: 460, spread: 0.05, penetration: 0.20,
      ignoresEvasion: true, flatAccuracy: 0.75,
    },
    ability: {
      id: 'flak_screen',
      name: 'Flak Screen',
      desc: 'Saturates the sky with proximity bursts, damaging every fast mover nearby.',
      cooldown: 18, key: 'Q',
    },
  },
};

export const ALL_TYPES = { ...SHIPS, ...GROUND };

// ---------------------------------------------------------------------------
// Combat tuning
// ---------------------------------------------------------------------------
/**
 * Scouting, and why a fleet that brings eyes shoots better than one that
 * doesn't.
 *
 * Wayne Hughes' observation about naval tactics is that scouting effectiveness
 * multiplies everything else: the fleet with the better picture attacks
 * effectively first, and no amount of gunnery compensates for not knowing
 * where to point it. None of that was true here. Vision is already shared
 * fleet-wide, so a scout revealed things — and revealing them bought nothing
 * at all, because accuracy only ever asked about tracking and evasion. There
 * was no reason to push anything forward and no penalty for fighting blind.
 *
 * So a target now has a targeting quality, per side:
 *
 *   PAINTED  someone of yours is close enough to hold a real firing solution
 *            on it, and the whole fleet shoots on that picture
 *   TRACKED  the fleet can see it, but nobody is near enough to resolve it
 *
 * The split falls out of the existing stat sheet rather than a new role flag,
 * and it lands where it should. Paint radius is a fraction of the OBSERVER's
 * sensor, so at 0.45 a Specter paints from 720 units (well beyond its own 560
 * guns) and a Wasp from 234 — while a Bastion's paint radius is 324 against a
 * weapon range of 460, and a Sentry's 315 against 500. The long guns cannot
 * see well enough to use their own reach. They need somebody in front.
 */
export const SCOUTING = {
  /** Paint radius as a share of the observing squadron's sensor range. */
  paintFraction: 0.45,
  /**
   * What your guns can reach against a contact nobody has resolved, as a
   * share of their rated range. This, not the accuracy nudge, is the tooth in
   * the rule: measured over 14 matches with accuracy alone, 95% of all fire
   * was already painted, because every fight collapses into one scrum where
   * everything paints everything. Range is where scouting actually decides
   * something — a Bastion that cannot resolve its own target has to close to
   * 276 units instead of holding 460, which is the difference between using
   * its advantage and giving it away.
   *
   * The hulls this binds are exactly the ones it should: Bastion (paint 324 /
   * range 460), Sentry (315 / 500) and Flak (252 / 330). Everything lighter
   * paints well beyond its own guns and never notices the rule.
   */
  unpaintedRangeFactor: 0.6,
  /** Accuracy added when the target is painted... */
  paintedBonus: 0.10,
  /** ...and taken away when the fleet is shooting on a distant contact. */
  unpaintedPenalty: 0.10,
  /**
   * How hard a focus-fire order pulls, painted and unpainted.
   *
   * Concentrating a fleet's fire needs a shared picture — everyone has to be
   * shooting the same hull at the same moment for it to matter. Unpainted, an
   * order still biases target selection but no longer overrides it, which is
   * what stops "click the thing across the map" from being a free alpha.
   */
  focusPainted: 6,
  focusUnpainted: 1.8,
  /**
   * Whether the AI's own focus fire is gated on having a firing solution.
   * Exists so a measurement can turn the whole rule off cleanly — without it
   * the "scouting off" arm of an A/B still had the commander concentrating
   * less, which is the rule, and the comparison silently measured something
   * other than what it claimed to.
   */
  gateFocusOnPaint: true,
};

export const COMBAT = {
  // Accuracy: 0.5 + (tracking - targetAgility) / spread, clamped.
  accuracySpread: 140,
  accuracyMin: 0.10,
  accuracyMax: 0.95,
  // A stationary or barely-moving target is somewhat easier to hit.
  evasionMotionFloor: 0.18,
  // Firing while parked costs you output — but only when nothing is already
  // inside your weapon range, so holding a firing line is not punished.
  motionFire: { floor: 0.55, fullAt: 0.5 },
  flakAgilityBonus: 1.9,
  flakArmorPenalty: 0.45,
  flakAgilityThreshold: 60,
  flakArmorThreshold: 75,
  groundTrackingBias: 40,
  cloakDetectRange: 130,
  cloakRevealTime: 4,
  groundOrbitCeiling: 900,
};

/**
 * Bombarding the planet.
 *
 * Any hull can do it, but damage scales with the gun's penetration, so a
 * Bastion is worth a great many Wasps at it. A besieging squadron locks onto
 * the crust and stops defending itself, which is the commitment that makes
 * the decision interesting rather than free.
 */
export const SIEGE = {
  /**
   * Crust HP is max(baseMultiplier x biggest hull in the battle,
   * hpPerAttackPoint x the attacker's points). The floor stops a tiny
   * attacking force from one-shotting a world; the per-point term is what
   * makes the objective scale with the fleet sent at it.
   *
   * Both were far too high to matter. A committed bombardment lands roughly
   * 1,000-2,500 damage over a match, against a planet that used to have 6,000
   * HP at a 1,000-point budget — so the crust was never in danger and the
   * whole siege route was decorative. These are set so that a real
   * commitment is a real race, and a token one still gets nowhere.
   */
  baseMultiplier: 1.2,
  hpPerAttackPoint: 2.5,
  minPenetration: 0.05,
  /**
   * How much harder a gun hits a planet than a warship.
   *
   * A capital shell against a manoeuvring hull is mostly a tracking problem;
   * against a continent it is not. Siege rounds are never rolled for accuracy
   * — they always land — but at 1x the per-shot damage a whole match's
   * bombardment came to roughly a fifth of the crust, which is why nobody
   * ever bothered. This is the knob for how threatening a siege is, and it is
   * deliberately separate from ship-to-ship damage so tuning one cannot
   * disturb the other.
   */
  damageMultiplier: 2,
  // Where a bombarding hull parks, as a fraction of its weapon range above
  // the surface. Pushed out from 0.75 so a siege line sits clear of a defence
  // sitting on the objective — it buys survivability from geometry rather
  // than from handing the sieging squadron its guns back, which would make it
  // better in a straight fight and undo the whole trade.
  standoff: 0.95,
  regenPerSecond: 0.003,
  regenDelay: 12,
  /**
   * How much of a bombarding squadron's rate of fire stays pointed at ships
   * rather than at the crust.
   *
   * This is what makes a siege a strategy instead of a victory lap. It used to
   * be 0 in all but name: locking on cleared every target, so a bombarding
   * hull could not shoot back at all and was a free kill for anything parked
   * over the planet. Since you also could not lock while an enemy was within
   * weapon range, bombardment only unlocked after you had already cleared the
   * defence — by which point you had won on hulls anyway. Measured over 100
   * matches, the planet was destroyed once.
   *
   * Now the squadron splits its output: (1 - selfDefense) of its rate of fire
   * goes into the crust and the rest stays available to answer whatever is
   * shooting at it. The commitment is real — you give up most of your
   * anti-ship output — but it is survivable, so the defence has to come and
   * break the siege rather than wait for it to die on its own.
   */
  selfDefense: 0.2,
  /**
   * How close an enemy has to be before the AI and the auto-siege rule judge
   * a lock unwise. A player who explicitly orders a bombardment always gets
   * one — under fire is a legitimate choice now, not a bug.
   */
  lockGuard: 240,
  /**
   * How close to the crust a hull must be before committing, as a multiple of
   * its weapon range on top of the planet's radius. For a Bastion, 3.5 means
   * locking on about 1,900 units out and walking the rest of the way in.
   *
   * That is deliberately generous, and it is only safe because the split-fire
   * cost is charged per tick and only while the crust is actually in range
   * (see tryFire). Committing early therefore costs POSITION — the hull stops
   * manoeuvring and beelines for its standoff — but not firepower. When the
   * two were conflated, a Bastion that locked on here arrived at 16% health or
   * not at all; tightening this to 1.4 instead fixed the symptom and cut the
   * siege's reach with it (crust low-water 44% -> 62%).
   */
  lockRange: 3.5,
};

export const BUDGET = {
  min: 400,
  max: 4000,
  step: 50,
  default: 1000,
  // Compensation for the attacker's strictly harder job: they must cross
  // no-man's-land, destroy the defending fleet, AND grind down the planet,
  // all before the clock runs out — while the defender wins by not losing.
  attackerMultiplier: 1,
};

/** Points this side actually gets to spend. */
export function budgetFor(faction, budget) {
  return faction === FACTION.ATTACK
    ? Math.round(budget * BUDGET.attackerMultiplier)
    : budget;
}

/**
 * Transit cruise.
 *
 * `speed` is a COMBAT stat: how a hull manoeuvres in a fight. Using it for the
 * approach march as well is what made attacking unwinnable. Over the ~3,000
 * units between the staging areas a Wasp arrives at 27s and a Bastion at 81s,
 * so an attacking fleet reaches a concentrated defence strung out over a
 * 79-second window and is destroyed in detail — measured at a 4% attacker win
 * rate against a defence that simply parks on the objective.
 *
 * So a long move is flown at a cruise floor instead: anything slower than
 * `speed` makes way at `speed` while it is more than `engageDistance` from
 * where it is going and not in contact. Inside that radius, and in any fight,
 * the hull's own speed governs exactly as before — a Bastion still wallows
 * where it matters. This adds no combat power to either side and applies to
 * both; it only stops the fleet from arriving piecemeal.
 */
export const TRANSIT = {
  cruiseSpeed: 85,
  engageDistance: 600,
};

/**
 * How the defending AI holds its ground.
 *
 * A defence that chases is a defence that loses its planet. These bound how
 * far it will ever go, and are enforced in the flight model (see applyLeash in
 * entities.js) rather than by changing stance — an earlier attempt forced the
 * squadron onto MOVE instead, which stopped it pursuing at all and dropped its
 * win rate to 9%.
 *
 *   guardShare   fraction of the fleet held on the tight leash, right over the
 *                world. These never follow the battle, so a bombardment can
 *                never be set up behind the fleet's back.
 *   guardLeash   that tight radius, measured from the planet's centre.
 *   screenLeash  everyone else. Long enough to fight forward of the picket
 *                line and contest an approach, short enough to get home.
 */
export const DEFENCE = {
  guardShare: 0.35,
  guardLeash: 620,      // + planetRadius
  screenLeash: 2900,    // + planetRadius
};

/** Seconds. On expiry the defender wins. */
export const TIME_LIMIT = 600;

export const DIFFICULTY = {
  easy: {
    id: 'easy',
    label: 'Easy',
    blurb: 'Slow to react, poor target choice, no abilities, and its gunners hit noticeably softer than yours.',
    interval: 3.2, targetNoise: 0.65, focus: 0.35, abilities: false,
    regroup: false, scatter: 1.5, gunnery: 0.75, concentrate: 0, siege: true,
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    blurb: 'Reacts steadily, targets sensibly, uses abilities, and will go for the planet if you leave it open.',
    interval: 1.4, targetNoise: 0.2, focus: 1, abilities: true,
    regroup: false, scatter: 1, gunnery: 1, concentrate: 0.35, siege: true,
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    blurb: 'Concentrates its whole fleet on one target at a time, hunts your support ships, pulls damaged hulls out to be repaired, and will commit to bombarding the planet the moment you leave a lane open.',
    interval: 0.65, targetNoise: 0, focus: 1.7, abilities: true,
    regroup: true, scatter: 0.55, gunnery: 1, concentrate: 0.85, siege: true,
  },
};
export const DEFAULT_DIFFICULTY = 'medium';

/**
 * Focused shields. A squadron-wide toggle: heavy damage reduction bought with
 * most of your rate of fire, drawn from a reserve that recharges when dropped.
 */
export const SHIELDS = {
  damageTaken: 0.28,   // multiplier on incoming damage while focused
  fireRate: 0.3,       // multiplier on rate of fire while focused
  drain: 26,           // reserve units per second while focused
  recharge: 11,        // per second once dropped
  rechargeDelay: 2.5,  // seconds after dropping before recharge starts
  max: 100,
  minToRaise: 12,      // can't flick them on with a nearly-empty reserve
};

/**
 * Look presets.
 *
 * Hulls have always been drawn larger than their "true" size, because at
 * honest scale a cruiser is a few pixels across from useful command altitude.
 * Measured at the default camera, a Falcon covered 1.3 screen pixels and a
 * Bastion 4.8 — every nacelle, rib and canopy modelled, lit, tonemapped and
 * bloomed, then collapsed into a coloured dot. That was the real reason the
 * game "looked poor", not the shading, which is already physically based.
 *
 * CINEMATIC attacks that on two fronts at once, because neither alone is
 * enough:
 *
 *  - scale + framing. Hulls draw at 6.4x instead of 2.2x and the camera comes
 *    in to two thirds of its old distance.
 *  - light + shadow. Shadow casting was off entirely, so raised plating read
 *    as painted stripes rather than as geometry. Turning it on and hardening
 *    the key light (brighter sun, much darker ambient) is what gives the
 *    forms volume. `detail` drives the triplanar surface shader in models.js.
 *
 * CLASSIC is kept verbatim so the two can be compared side by side rather
 * than argued about; everything here is live-switchable mid-battle.
 */
export const GFX_PRESETS = {
  classic: {
    label: 'CLASSIC',
    hullScale: 2.2,
    camScale: 1,
    shadows: false,
    detail: 0,
    sunIntensity: 2.4,
    bounceIntensity: 0.55,
    ambientIntensity: 0.35,
    exposure: 0.92,
    bloomStrength: 0.55,
    glowScale: 1,
  },
  cinematic: {
    label: 'CINEMATIC',
    hullScale: 6.4,
    // 0.66 is the floor, measured rather than picked: below it the front rank
    // of the opening formation is cut by the bottom of the screen (at 0.50,
    // three hulls sat under the control bar). Seeing less of the map is fine
    // — hulls sliced in half by the viewport edge is not.
    camScale: 0.66,
    shadows: true,
    detail: 1,
    // A hard sun over near-black ambient. The old 2.4/0.35 pair lit the shaded
    // side of a hull almost as brightly as the lit side, which is what made
    // ships read as flat cutouts.
    sunIntensity: 3.3,
    bounceIntensity: 0.42,
    ambientIntensity: 0.13,
    exposure: 0.98,
    bloomStrength: 0.5,
    // Engine bells are geometry, so they grew with the hulls, and emissive
    // that read as a glow at 2.2x reads as a saturated orange disc at 6.4x.
    glowScale: 0.55,
  },
};

/** Live look state. Mutated in place — see setGfxPreset. */
export const GFX = { preset: 'classic', ...GFX_PRESETS.classic };

export function setGfxPreset(name) {
  const p = GFX_PRESETS[name] || GFX_PRESETS.classic;
  Object.assign(GFX, p);
  GFX.preset = GFX_PRESETS[name] ? name : 'classic';
  return GFX.preset;
}

/** Speed-meter stops. Index into this directly; pause is separate. */
export const SPEEDS = [0.5, 1, 2, 4, 8];
export const DEFAULT_SPEED_INDEX = 1; // 1x

export function unitCost(type) {
  return type.costEach * type.count;
}

/** Derived per-craft combat values used by the simulation. */
export function derive(type) {
  return {
    maxSpeed: speedFor(type.speed, !!type.ground),
    maxHealth: type.health * HEALTH_SCALE,
    dps: type.dps * DPS_SCALE,
    // Agility drives turn rate: 15 agility ~ 0.5 rad/s, 95 agility ~ 2.4 rad/s
    turnRate: 0.35 + (type.agility / 100) * 2.2,
    accel: 0.4 + (type.agility / 100) * 2.6,
    tracking: type.agility * 0.5 + type.skill * 0.5 +
      (type.ground ? COMBAT.groundTrackingBias : 0),
    armor: type.armor || 0,
    range: type.range,
    sensor: type.sensor,
  };
}
