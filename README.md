# Siege of Kepler-9

A 3D real-time space-battle RTS played in the browser: command a fleet to
besiege, or defend, an orbiting planet.

## Repository state

The ES-module source tree was lost when the development sandbox was recycled
mid-session: every push had been failing with a GitHub authorization error, so
nothing had reached this remote and the container's disk was the only copy.

It has since been **fully reconstructed** from the one artefact that survived —
the built, minified bundle that had been published as a hosted artifact. The
bundle is minified, but esbuild does not mangle object property names, so all
balance data (`SHIPS`, `COMBAT`, `SIEGE`, `SHIELDS`, `BUDGET`, `WORLD`) was
readable in it and served as the reference.

    src/                                        reconstructed, and what builds
    recovered/siege-of-kepler-9-artifact.html    the surviving build, kept as
                                                 the reference for verification
    dist/siege-of-kepler-9.html                  current build, standalone

`dist/` opens by double-clicking it (file://) with no server and no external
requests.

`recovered/` is deliberately retained: `tools/verify-combat.mjs` evaluates the
combat functions straight out of it and compares them against `src/`, which is
a non-circular check that no coefficient has drifted.

### Verifying

    node build.mjs                 build dist/
    node tools/smoke.mjs           play a battle in headless Chromium
    node tools/verify-combat.mjs   combat maths vs the original bundle
    node tools/selfplay.mjs        whole matches, AI vs AI, no renderer
    node tools/balance.mjs         balance sweeps (see below)
    node tools/duel.mjs            ship-vs-ship matchup matrices
    node tools/analyse.mjs         100 matches, per-hull performance
    node tools/damage.mjs          the damage model, computed from src/
    node tools/siege-probe.mjs     does bombardment actually function
    node tools/strategy.mjs        does the attacker's PLAN matter
    node tools/scouting.mjs        fire control: does scouting pay
    node tools/salvo.mjs           salvos, and the counterforce threshold
    node tools/salvo-gate.mjs      why a loaded capital is not firing
    node tools/overkill.mjs        how much of a volley is wasted
    node tools/invariants.mjs      bug hunt: assert what must never be true
    node tools/audit.mjs           bug hunt: legal-but-wrong behaviour

Two warnings about `analyse.mjs`, both learned the hard way. Damage-per-point
scores every support hull at zero by construction, so it credits healing too —
on damage alone the Aegis reads as worthless (0.5/pt) when it is mid-pack
(7.3/pt). And a Spawner's output is counted as *Wasps*, so its own line reads
0.1/pt while it is in fact producing ~4.5 hulls a match. Attribution, not
balance, in both cases.

The simulation is deterministic: same seed, same match, every time. That is
load-bearing for all of the above, and it is enforced by `src/util.js`'s seeded
generator — `Math.random()` must never appear in simulation code. (It did, in
the hit roll and projectile scatter, which silently made every balance
measurement unreproducible until it was fixed.)

## Balance

The defence used to win near-universally in human play. It was fixed by
measurement, not by guesswork — every number below is reproducible with
`node tools/balance.mjs`, on a simulation that is deterministic per seed.

### Measuring it

Self-play (`tools/selfplay.mjs`) reported a tidy 50/50 and was **misleading**:
a Commander never parks. It reissues move orders every tick, so its squadrons
are always moving and never sit on DEFEND. A person does the opposite — select
everything, press G, leave it — and that is the case that kept winning.

`tools/balance.mjs` therefore reports three columns, and they must be read
together:

    vs parked defence   AI attacks a human defence left on standing orders
    as attacker         human attacks on standing orders, AI defends
    AI v AI             both sides actively commanded

### Result

Attacker win rate, 40 deterministic matches a cell, 1000pts, medium:

| | vs parked defence | as attacker | AI v AI |
|---|---|---|---|
| before | 4% | 8% | 42% |
| after  | **28%** | 3% | 57% |

Parking the whole fleet on DEFEND and walking away used to win 96% of the
time; it now wins 72%. The defence is still the easier chair — which is fine,
and arguably correct for a siege — but it is no longer a dominant strategy.

The middle column is deliberately not chased to 50%. It measures a player who
issues one order and never touches the controls again for ten minutes, which
is a complete strategy on defence but not on attack. It stays low because the
attacker's second win condition does not work; see the known issue below.

### What was actually wrong

Ranked by measured effect, which is **not** the order they look like on paper:

1. **Arrival stagger — the dominant cause.** `speed` is a combat stat, but it
   was also governing the approach march. Over the ~3,000 units between the
   staging areas a Wasp arrives at 27s and a Bastion at 81s, so an attacking
   fleet reached a concentrated defence strung out over a 79-second window and
   was destroyed in detail. Fixed with `TRANSIT` (see `src/config.js`): a long
   move is flown at a cruise floor, so the fleet arrives together. Inside
   `engageDistance`, and in any fight, the hull's own speed governs exactly as
   before. This adds no combat power and applies to both sides.

2. **DEFEND kept full evasion while parked.** `isAnchored` exempted DEFEND
   squadrons from the "a stationary target is easier to hit" rule that every
   other stance obeys — up to +0.162 accuracy denied to attackers. Removed;
   standing still is a real trade now. Worth less than it looks (~7 points of
   win rate), but it was a genuine dominant-strategy incentive.

3. **The simulation was not deterministic.** The hit roll and projectile
   scatter called `Math.random()`, so the same seed produced different matches
   and every A/B comparison was noise. Fixed first, because nothing else could
   be measured until it was.

### Levers that were tested and rejected

| lever | range tested | effect |
|---|---|---|
| `SIEGE.hpPerAttackPoint` | 6 → 1.5 | none |
| `SIEGE.regenPerSecond` | 0.6%/s → 0 | none |
| `TIME_LIMIT` | 600 → 900s | none |
| `BUDGET.attackerMultiplier` | 1 → 1.45 | works, but see below |

`attackerMultiplier` is deliberately left at **1**. It does move the win rate,
but in a symmetric fleet fight combat power scales superlinearly with numbers,
so +30% points took AI-v-AI from 42% to 96% — it fixes the broken case by
wrecking the balanced one. A points handicap is the wrong shape of tool here.

### The siege route

The planet used to be scenery. Over 100 matches it was destroyed once, and
`tools/siege-probe.mjs` showed why: attackers did lock on and did fire, but
managed ~40 hull-seconds inside weapon range against a crust needing several
hundred, and a siege-locked hull stopped defending itself entirely, so it was
a free kill. Worse, `clearToSiege` required no enemy within your own weapon
range — so bombardment only unlocked *after* the defence was cleared, by which
point the fleet fight was already won. It was a victory lap, not a strategy.

Three changes, in order of how much they mattered:

1. **A bombarding squadron splits its fire instead of going blind.**
   `SIEGE.selfDefense` of its rate of fire stays pointed at ships; the rest
   goes into the crust. The commitment is real — you give up 80% of your
   anti-ship output — but it is survivable, so the defence has to come and
   break the siege rather than wait for it to die on its own.

2. **The lock gate is advisory, not a wall.** `clearToSiege` now checks a
   tight `lockGuard` radius and only advises the AI and the auto-siege rule.
   A player who orders a bombardment always gets one; doing it under fire is
   a legitimate choice.

3. **The numbers were nowhere near the right scale.** Crust HP came down
   (`hpPerAttackPoint` 6 -> 2.5, `baseMultiplier` 2 -> 1.2) and siege rounds
   got their own `damageMultiplier`, kept separate from ship-to-ship damage so
   the two can be tuned without disturbing each other. The firing standoff was
   pushed out (0.75 -> 0.95 of weapon range) so a siege line sits clear of a
   defence parked on the objective — buying survivability from geometry rather
   than by handing the squadron its guns back, which would have made it better
   in a straight fight and undone the trade.

Measured against a parked defence, 16 matches:

| | before | after |
|---|---|---|
| crust took any damage | 0/12 | **15/16** |
| match won by destroying the planet | ~1/100 | **3/16** |
| mean crust low-water | 100% | **51%** |
| attacker win rate | 28% | **50%** |

Bombarding is now a real second win condition — about a fifth of matches — and
the crust is under genuine threat in nearly all of them, so the defence cannot
simply ignore it. Parking the whole fleet on DEFEND is a coin flip.

Two warnings for anyone tuning this further. `selfDefense` and `standoff`
interact strongly and not monotonically: at the old short standoff the sieging
hulls died, so a lower `selfDefense` (more guns on the crust) made the attacker
*weaker*; at the longer standoff they survive to use it, so the same change
makes the attacker *stronger*. And measure in the parked scenario, not AI v AI
— see below.

### The defending AI holds its ground

The defence used to follow the fight. Ordered straight onto whatever it was
shooting at with no limit, the whole fleet drifted after the battle and left the
objective open — measured at **70% of the match with no defender within 1,000
units of the planet**. Harmless while bombardment was broken; fatal once it
worked.

It is now leashed, via `DEFENCE` in `src/config.js`:

- a `guardShare` of the fleet is the **close guard** on a tight `guardLeash`,
  right over the world, and never follows the battle;
- everyone else gets `screenLeash`, long enough to contest an approach forward
  of the picket line;
- guard duty is **sticky** — once assigned, a squadron holds it for life, and a
  slot is refilled only when its holder dies.

The leash is enforced in the flight model (`applyLeash` in `entities.js`),
shaped like the existing arena-wall avoidance: it bends the desired heading
rather than clamping the position, so a pursuing squadron peels off at the
boundary instead of stopping dead.

Two attempts failed first, both instructive:

1. Clamping the order *destination* did nothing at all. ATTACK stance pursues
   its target in the flight model and ignores `movePos` entirely, so defenders
   still ended up 2,400 units out.
2. Forcing the squadron onto MOVE stance so it would hold station did work
   geographically — and gutted the defence, because it then never pursued
   anything. Its AI-vs-AI win rate fell to 9%. Station-keeping has to be a
   movement constraint, not a behaviour change.

| | before | after |
|---|---|---|
| match with the planet uncovered | 70% | **0%** |
| furthest a defender strays | 2,417u | 1,808u (leash 1,800) |
| attacker win, AI v AI | 75% | **63%** |
| attacker win, passive human attacking | 0% | **22%** |

`guardShare` 0.35 with a long `screenLeash` measured better than a smaller
guard: cutting the guard to 0.25 pushed the attacker back up to 79%, because
the screen roams and the world ends up thinly held anyway.

### Found from a real session report

Three defects came out of one player's exported session (`REPORT` in the HUD),
which is worth knowing as a technique — the snapshot stream shows things no
aggregate does.

1. **Bombarding hulls paid the split-fire cost while still flying to their
   firing position.** `tryFire` charged `SIEGE.selfDefense` whenever
   `siegeLock` was set, but `trySiegeFire` returns early when the crust is out
   of range — so a hull crossing the last 1,100 units to its standoff gave up
   80% of its guns and got nothing back. In the report a Bastion committed at
   91% health and was dead sixteen seconds later; a second went the same way.
   The cost is now charged only on ticks where the crust is actually in reach.

2. **Auto-siege committed far too early** — at 3.5x weapon range from the
   planet, when a hull can only fire at 1x. That is fine on its own (the
   commitment is positional: you stop manoeuvring and head for your standoff)
   and only became lethal in combination with (1). Tightening it to 1.4x
   instead *also* fixed the symptom, but cut the siege's reach with it (crust
   low-water 44% -> 62%), so the fix belongs in (1), not here. `SIEGE.lockRange`
   exists so the two cannot drift apart again.

3. **Both fleets drew callsigns from the same pool**, starting at the same
   index — so a battle had two squadrons called Alpha and a HUD that reported
   `Alpha -> target: Alpha`. The report showed three of the player's wardens
   all listing `target: Golf` while the player also had a Golf. The attacker
   keeps the NATO alphabet; the defence now has its own list.

### "I sent everything at the planet and won"

A second session report raised a different complaint: the player drag-selected
the whole fleet, clicked once near the planet, never touched the mouse again,
and won at 1:27 with the enemy fleet at 11 of 13 hulls and 89% health. Two
kills each. The planet did all the work, and no decision had been made.

`tools/strategy.mjs` measures that directly — it plays the attacker by hand
with a fixed plan and never intervenes, so the only variable is the plan:

| plan | what the player does | win rate | by planet |
|---|---|---|---|
| `staged` | fast movers first, heavies on contact | 53% | 53% |
| `escort` | capitals bombard, the rest cover them | 48% | 48% |
| `blob` | select all, attack-move at the planet, walk away | 35% | 35% |
| `ontarget` | the same click, landing on a defender | 23% | 20% |
| `nosiege` | the blob with bombardment suppressed | 15% | 0% |
| `siegerush` | capitals alone, escorts held back | 13% | 13% |
| `passive` | nothing | 0% | 0% |

Two real defects were behind the report, and they compounded:

1. **A player's attack order was discarded within a tick.**
   `updateAttackStance` rewrites `attackTarget` several times a second so an
   attack-*move* still finds something to shoot, and it did that
   unconditionally — including to squadrons the player had explicitly aimed at
   a named hull. The report shows the whole fleet on `Hearth` at 0:00, `Dagger`
   at 0:15, `Ember` at 0:30 and `Bulwark` at 0:45 with no input in between. So
   focus fire — kill the Rig, kill the Aegis, break the thing that is holding
   the defence together — was not a move that existed. `orderedTarget` now
   holds what the player clicked until it dies or a new order replaces it, and
   the panel names it (`HUNTING IRONSIDE`) so the difference is visible.

   Measured on the same 40 seeds: before the fix, clicking a defender produced
   *byte-identical* results to clicking empty sky (35%, 183s mean, crust
   low-water 38%) — proof the order was reaching nothing at all.

2. **The auto-siege overrode the order it should have deferred to.** It exists
   so an aimless advance on the planet doesn't stall with nothing in sensor
   range. It fired regardless of what the squadron had been told to do, so a
   fleet sent to kill a ship quietly stopped fighting and levelled the crust
   instead. That is why the one plan needing no decisions was also the only one
   that ever destroyed a planet. It is now gated on `!orderedTarget`:
   bombarding is something you ask for — click the planet itself, the order
   gizmo turns amber — or something an advance with no target of its own falls
   into.

A third, cosmetic but real: at 8x speed a decided battle kept simulating for
the rest of the frame and re-fired `onEnd` each step, so the report carried
**seven** identical `battle-end` events. The step loop now breaks on a result
and `checkVictory` announces once.

Raising crust HP was tested as an alternative and rejected. It does lower the
blob, but it lowers everything else further and **compresses** the gradient —
at `hpPerAttackPoint` 4.5 the three main plans land within four points of each
other (23/27/23), which is less skill expression, not more. 2.5 keeps the
widest spread and stays.

### Invariants

`tools/invariants.mjs` runs matches and asserts things that must never be true
— NaN state, hulls inside the planet or outside the arena, overhealing,
scoreboard drift, projectile sanity, and the defending AI's own leash contract.
It currently passes clean over ~173,000 ticks.

Three of its first four "findings" were bugs in the test, not the game, and all
three are worth knowing about before writing another one:

- A carrier's brood is created with `alive = false` and revived on launch, so
  unreleased hangar hulls are not deaths.
- `releaseBroodHull` revives *any* dead slot, so one craft object can
  legitimately die more than once — death events have to be counted, not ids.
- A leashed hull has a turning circle. It keeps opening for a second or so
  after the leash bends its heading, which is the flight model working. Only a
  sustained opening is a fault.

### Found from a session that lost badly

A defeat is a better bug report than a win. One 7:13 loss — 4 kills for 28,
planet untouched — turned out to contain three defects, none of which the
player could have seen.

1. **A carrier's brood never joined the battle.** A brood squadron is created
   docked, at the carrier's *spawn* position, and its `movePos` stayed there.
   Its hulls, though, are revived beside the carrier wherever that has since
   flown to — so every fighter launched mid-battle turned around and flew back
   to the staging area. Select-all does not pick up a docked brood either, so
   nothing ever gave them an order. Measured over 12 matches: broods sat a mean
   **3,792 units** from the planet while their carriers fought at 1,143, and
   **2 of 12** had a target. Two Spawners is a fifth of a 1,000-point fleet,
   contributing nothing. A brood with no orders of its own now follows its
   carrier (`Unit.adoptOrdersFrom`) and stops the moment the player gives it
   one: after the fix, 1,543 units out and 11 of 22 in the fight.

2. **A beaten attacker was unreachable, so the match idled for minutes.** The
   defence's screen leash reaches 3,200 units from the planet; the attacker's
   staging area is at 3,900. The reported session spent its last three minutes
   with the player flying surviving squadrons in one at a time to be shot,
   because nothing would come to them. The defence now sweeps the staging area
   once it has been in contact and nothing has come near the world for 45
   seconds (150 if it has never been in contact at all, so it cannot be lured
   out during the opening). Sticky, so spotting something mid-sweep does not
   flip the leash back on and send it home unfired; dropped instantly if
   anything reaches the objective. A do-nothing attacker went from *untouched
   for the full ten minutes* to hunted down at a mean of 367s.

   Two things had to be fixed before that worked at all, and both are worth
   knowing about:

   - `PATIENCE` could never elapse. `searchWaypoint()` resets `searchTimer` to
     zero whenever it passes 34, so the 55-second timeout built on it was dead
     code.
   - **Anything accumulated below the commander's early return counts plans,
     not seconds.** `update()` runs every frame but only *thinks* every
     `interval`; a counter incremented by `dt` after that return reached 10
     after 400 seconds. Use the `elapsed` local, which is real time.

3. **The report could not show that a siege had worked.** The crust regenerates
   0.3% a second after twelve seconds without a hit, so a bombardment that took
   a world to 17% and was then broken reads as `planet 100%` five minutes later
   — which is what the reported session looked like. Snapshots now carry the
   crust reading, and the result carries `planetLow`, sampled every frame
   rather than every snapshot.

## Fire control — scouting that pays

Wayne Hughes' claim about naval tactics is that scouting effectiveness
multiplies everything else, and none of it was true here. Vision was already
shared fleet-wide, so a scout revealed things — and revealing them bought
nothing, because accuracy only ever asked about tracking and evasion. There was
no reason to push anything forward and no penalty for fighting blind.

A target now has a targeting quality, per side. **PAINTED** means one of your
squadrons is close enough to hold a real firing solution on it; **TRACKED**
means the fleet can see it but nobody has resolved it. Against an unresolved
contact your guns reach `SCOUTING.unpaintedRangeFactor` (60%) of their rated
range, hit slightly less often, and a focus-fire order stops overriding target
selection.

Paint radius is a fraction of the **observer's** sensor, so the split falls out
of the existing stat sheet rather than a new role flag — and it lands where it
should:

| hull | sensor | paint radius | weapon range | resolves its own targets? |
|---|---|---|---|---|
| Specter | 1600 | 720 | 560 | yes — the dedicated scout |
| Wasp | 520 | 234 | 130 | yes |
| Falcon | 640 | 288 | 210 | yes |
| Warden | 780 | 351 | 300 | yes |
| **Bastion** | 720 | **324** | **460** | **no** |

So the long guns cannot see well enough to use their own reach. Measured, a
Bastion fighting with a forward element holds **91%** of its rated range; one
fighting alone is dragged in to **60%**.

### What it actually did, measured

Ground emplacements are exempt. A gun bolted to the planet it defends fires off
that planet's own sensor grid, and unlike a ship it cannot close to fix a poor
picture — the first version taxed it anyway, and the rule was then not a
scouting mechanic at all but a one-sided nerf to the defence, whose long guns
are the static ones.

100 matches, AI against AI, the same seeds with the rule switched off and on
(`NOSCOUT=1` neutralises it in place, which is how both arms were run):

| | attacker wins |
|---|---|
| rule off | 37% |
| rule on | **48%** |

**This corrects an earlier claim in this file's history: AI-v-AI was reported
at 50/50, measured over 30 matches. At 100 matches the real figure was 37/63.**
Thirty deterministic matches sounds precise and is not — a win-rate difference
under about 15 points at that sample is three coin-flip matches changing sides,
and several tuning decisions were made on exactly that kind of gap.

The plan gradient survives, and the combined-arms plan is now the best one
(60 matches each): escort 55%, staged 48%, blob 38%, siegerush 13%.

### What it does not do

It does not change what you *buy*. A points-equal A/B — a fleet with two Wasps
and a Specter against one that spends those points on line hulls — still favours
the line, 92% to 63%, and lowering the paint radius to 0.36 or 0.30 does not
move it. Wardens cost 62 points and Wasps 132, and no fire-control bonus is
worth that much raw combat mass. Scouting is now a real tactic; it is not yet a
real purchase, and closing that gap is a pricing question, not a mechanics one.

`tools/scouting.mjs` reports paint rates, who is doing the painting, and the
standoff each hull actually achieves; `tools/scouting.mjs ab` runs the
composition A/B.


## Two harness holes worth knowing about

Fifty matches were run looking for bugs. The assertions all passed, and that
turned out to be the least interesting part of the result — both real findings
came from asking whether the checks had run at all.

**A check that never evaluates passes silently.** `tools/invariants.mjs` now
counts how many times each assertion is reached and prints it, so "clean" reads
as "clean over N evaluations". The first run exposed the reason that matters:

**The harness never executed the player code path.** With a Commander on both
sides nothing ever consults `isPlayerControlled`, so `updateAttackStance`, the
auto-siege gate, standing attack orders and carrier-brood adoption were all
untested — the brood assertion evaluated exactly **zero** times over 50 matches,
because the AI reissues its broods' orders every tick and they are therefore
never unordered. Every defect found in that path this month came from a
player's session report rather than from here. Half the matches are now played
by hand on the attacking side: one order at the start, no intervention.

That immediately found a real bug, and it was mine. Broods re-synced to their
carrier on **every tick**, which overwrote the destination `updateAttackStance`
had just set onto their target — so a launched fighter was welded to its
carrier's parking spot and could never pursue anything. A Spawner is a standoff
hull that holds 700 units back, so its entire air wing held 700 units back too.
`tools/audit.mjs` caught it as behaviour rather than as an assertion: in three
of fifty matches a carrier *and* its brood spent the whole battle without
engaging, ~1,200 units from the nearest enemy. A brood now follows its carrier
only while it has nothing to fight.

The refined invariant then fired on the fix — and that one was the test being
wrong, the fourth time that has happened here. A wing that is fighting is
*supposed* to leave its carrier. The contract is "far away with nothing to do",
not "far away".

### What 50 matches look like now

    attacker wins       24  48%        fleets that never made contact: 0
    defender wins       26  52%        dead air over 25s: 0 stretches
    decided on time      2   4%        bombardment set up: 50  100%
    mean length        234s            mean crust low-water: 45%

The only squadrons that still finish a battle without firing are Spawners, 4 of
27. Those matches ended around 70 seconds — a standoff carrier parked 700 units
back never reaches its own 200-unit gun before a short battle is over. That is
the hull working as designed, not a fault.


## Salvos

Everything else here is Lanchester — continuous attrition, damage flowing
smoothly, force scaling with the square of numbers. Hughes' observation about
missile-age naval combat is that it is **pulsed**: a ship builds a volley,
throws it, and the whole thing lands at once. Three numbers then decide the
exchange — striking power, staying power, and counterforce — and the result is
`(striking - counterforce) / staying`.

Two properties fall out of that which continuous fire does not have. Attacking
effectively first **compounds**, because a salvo that kills a hull removes
every round that hull would ever have fired. And counterforce **subtracts**
rather than scaling: a thin screen against a big volley is nearly worthless
since the leakers still arrive, while enough of it zeroes the volley outright.

It is a layer on top of the existing model, not a replacement. A **Warden** (4
rounds) or **Bastion** (6) holds back `SALVO.chargeCost` of its rate of fire to
build a volley over 18 seconds — so a salvo is the same damage delivered lumpy,
not extra damage. **Wasps, Aegis and Flak Walkers** shoot rounds down off the
top. Everything else fights exactly as before.

### Three things measurement changed

**The salvo was on the wrong hull.** It went to the Sentry Turret first, as the
defence's capital. A Sentry is immobile, defence-only and permanently in
contact, so it charged continuously and threw **776 volleys to the attacker's
5** over 24 matches — the attacker's only salvo hull was the Bastion, which
spends most of a match bombarding and cannot charge while it does. It belongs
on a hull both sides field and neither side parks. The Warden, whose own role
text reads *"everything it does, something else does better"*, now has a reason
to exist. (The attacker template also guaranteed no Warden where the defence
guaranteed one, which was harmless until the hull carried a mechanic.)

**The designated point-defence hull could not do point defence.** Counterforce
used the interceptor's weapon range, and a Flak Walker is an emplacement seated
on the planet with 330-unit guns, while the fleet it is meant to cover fights
at the picket line 900+ units out. Interception measured **0% at every Flak
count from zero to four**. Screen radius is its own stat now — an umbrella is a
different thing from a gun. The attacker also could not buy point defence at
all, Flak being ground and therefore defence-only, so Wasps intercept too.

**Extended reach measured as nothing.** A salvo was given 1.4x range against a
resolved target and shorter range against an unresolved one, and mean throw
distance came out at **0.83x** — a hull closes to 0.8x its gun range to fight,
so it is never out at the longer distance anyway. The painted requirement is
now a **gate**: no firing solution, no launch. That is the one place scouting
is worth more than position.

### A screen denies a salvo; it does not eat one

This took three attempts and the first two were wrong in the same way.

At full screen strength the model worked exactly as written — 64% of rounds
shot down, 36% of volleys stopped dead — and that **inverted the trade**. A
side throwing into a screened fleet converts a third of its rate of fire into
nothing, so the mechanic became a tax on whoever used it most; the defence,
which throws four times as many volleys as the attacker, lost ground by having
the better capitals. Halving the screens removed the tax and the threshold with
it: 2% of volleys stopped dead is not a mechanic.

The fault was never the numbers. It was that a loaded capital would throw a
volley it could see would be annihilated, which no commander does. A salvo is
now **held** when the screen over the target could stop all of it — the charge
is kept, not spent. So a screen deters rather than consumes, and breaking it is
what unlocks the shot. The HUD says `HELD` with the reason.

Loading and launching are also separate, which they were not at first: a salvo
was released in the same tick it completed, so a loaded-and-waiting capital did
not exist for even one frame and the HUD's `READY` state was unreachable. The
audit caught it by measuring **zero** hull-ticks at full charge across 1,662
volleys. Loading needs the target in reach; launching additionally needs it
resolved and not fully screened. (Charging on merely *having* a target was
tried in between and handed a free tempo advantage to whoever closes the
distance — always the attacker: 46% to 56%.)

### The threshold, measured

Identical fleets, 16 matches a row, varying only how many Flak Walkers stand
with the defence against a 6-round Bastion salvo. The threshold shows up as
**suppression** — volleys that are never thrown at all:

| Flak | **volleys thrown** | rounds intercepted |
|---|---|---|
| 0 | 45 | 0% |
| 1 | 47 | 8% |
| 2 | 46 | 5% |
| 3 | **32** | 5% |
| 4 | **27** | 4% |

Three or four walkers suppress a third of the enemy's salvos outright, and the
volleys that *are* thrown lose only a few percent, because they are thrown
where they will get through. That is the threshold: below it a screen changes
nothing, above it capitals simply stop shooting at what it covers.

### Balance

100 matches, same seeds, `NOSALVO=1` turns the layer off in place:

| | attacker wins |
|---|---|
| salvos off | 46% |
| salvos on | 52% |

Six points at n=100, about one standard error. The parked-defence case is
unchanged. Battles resolve somewhat faster (mean 274s to 256s) because pulses
kill outright where a grind wears down.

A loaded capital waits a mean of **15 seconds** for a window — 4% of holds run
past a minute, which is a capital sitting on a volley because everything it can
reach is covered. That wait is the decision the mechanic exists to create.


## The salvo was a losing trade, and the arithmetic said so

A player's session report showed fifty-three volleys in one match. Nine of them
came from a single Warden on a perfect eighteen-second cadence, and every one
was a mistake the game was making on the player's behalf.

Per-round damage was a flat 1.7x the hull's ordinary shot, set by hand. Against
the fire withheld to build the volley:

| hull | withheld over the charge | full volley | ratio | rounds needed to break even |
|---|---|---|---|---|
| Warden | 173 | 78 | **0.45** | 8.9 of 4 |
| Bastion | 236 | 348 | 1.47 | 4.1 of 6 |

**The Warden's salvo was strictly worse than not having one** — a 55% loss on
every throw with no interception at all, on the very hull the salvo had just
been moved onto, and it could not break even at any round count below 8.9 while
firing 4. The Bastion's needed four of six rounds to land; the report contains
eight volleys under that line, two of them landing a single round.

The hold rule was wrong for the same reason. "Do not throw if the screen stops
*all* of it" is far too low a bar when a six-round volley landing one round
converts 236 damage of gunfire into 58.

Per-round damage is now **derived** (`salvoRoundPower`) so it cannot drift from
the economics again: a fast gun withholds more damage per second, so its rounds
must hit proportionally harder. A hull holds its charge unless enough of the
volley would survive to beat simply firing the guns (`salvoBreakEven`). Round
counts went up — Bastion 10, Warden 7 — so counterforce *reduces* a volley
instead of switching it off, and both hulls now tolerate 2-3 points of screen
while staying above the line.

### What that cost, and the knob

Fixing it made salvos worth using, which moved the balance. The surprise was
which lever matters. `premium` — how much extra damage a volley carries —
barely does anything (1.15 / 1.25 / 1.45 measured 59% / 56% / 56% attacker over
100 matches each), because a salvo's value is not its damage. It is that
concentrated damage kills a hull **outright**, and a dead hull is neither
repaired nor fired again — which defeats the sustained repair the defence leans
on. That is why the layer favours the attacker at all.

How often burst lands is the real lever:

| charge | attacker wins (AI v AI, 100 matches) |
|---|---|
| no salvos | 46% |
| 34s | 49% |
| 30s **(shipped)** | 53% |
| 26s | 52% |
| 18s | 56% |

Thirty keeps the shift modest and leaves a volley as an event rather than a
metronome. The parked-defence case takes it harder — a passive fleet is
punished more by burst — at 77% for the AI attacker against 65% with no
salvos. `SALVO.charge` is the dial if that is too much.

### A reporting gap in the same report

The planet fell from 100% to 15% with **no event in the timeline** explaining
it. Snapshots carried `siege: true`, but only a player's *explicit* bombardment
order was ever logged, and most bombardments begin at the auto-siege gate,
which merely flashed a message. It records an `auto-siege` event now.


## A hundred matches: one bug, one false alarm, one design question

### The bug: a hull paid for its volley three times over

`rateShare *= 1 - SALVO.chargeCost` was applied on every tick a salvo hull was
alive and not bombarding. Three different states therefore paid the 35%:

- **loading** — correct, that is the trade;
- **sitting on a finished volley** — paying twice for one salvo;
- **nowhere near a target and not loading at all** — paying for nothing.

So every capital ran at 65% gunnery for most of every match in exchange for a
volley it might never throw. The audit had the evidence already and it had not
been read that way: 87% of the time a hull spent loaded was spent *waiting*, and
the capitals that never threw at all died at a mean peak charge of **54%** —
having paid the full tax the whole way up. It is also what made the break-even
hold rule indefensible, since holding was supposed to be the cheap option.

The cost is now charged only while actually loading, and that restored the
layer's neutrality on its own: **45% attacker with salvos on against 46% off**,
over 100 matches on the same seeds, where it had measured 53%.

### The false alarm, recorded because it was nearly reported

A first pass at `tools/overkill.mjs` found that only 38% of salvo rounds ever
hit anything and called it a 59% waste rate. That conflated two things. A round
that fails its accuracy roll is fired unguided and flies wide — **ordinary
gunfire does that just as often**, so it is not salvo-specific and must not be
counted against the volley. The waste that belongs to a salvo is a round that
left the rail with a solution and lost it, because the target died first.

Separated properly: **9%** of aimed rounds, rising to 18% against targets
already below 25% health. Modest, realistic, and no cause for action.

### The design question, which is not mine to settle

`tools/salvo-gate.mjs` attributes every tick a loaded hull fails to fire:

    92.8%  screened below break-even
     3.8%  target not resolved
     2.1%  target outside salvo reach
     1.3%  bombarding — salvo suspended

Two in five salvo-capable squadrons never throw a volley in a match, and the
screen is doing essentially all of the blocking. The structural reason is that
counterforce **stacks additively across squadrons** with generous radii — a
normal fleet fields five to seven points of it — while a single capital throws
alone with 10 rounds and tolerates 3. Hughes' own answer to counterforce is
concentration of *launchers*: several ships firing into one screen together. The
game has no mechanism for that, so a screened force is simply immune, and the
mechanic mostly does not happen.

### Concentration of launchers

Hughes' answer, implemented: capitals loaded on the **same hull** are pooled,
and the screen is subtracted from their combined striking power rather than from
each volley separately. If the pool clears break-even every member fires in the
same tick and the intercepted rounds are shared out across the strike; if it
does not, they all keep their charges. Release is therefore a fleet decision,
taken once per step in `resolveSalvoStrikes()`, not a per-hull one — a single
hull that can beat a screen alone is just a strike group of one, so nothing
needs special-casing.

The hold now means something a player can act on, and the HUD distinguishes the
two cases because they call for opposite responses. `NEEDS 2ND` is a lone
capital that would get through with a partner: aim another at the same target.
`HELD` is a group that cannot clear the screen even combined: kill the point
defence or pick another target.

What it did, over 100 matches each:

| | before | after |
|---|---|---|
| volleys a match | 13.0 | **17.6** |
| capitals that never throw | 42% | **32%** |
| hull-ticks loaded and waiting | 369,416 | **139,058** |
| mean wait when loaded | 16.6s | **5.3s** |
| waits over a minute | 24 | **2** |
| attacker wins (AI v AI) | 53% | **43%**, against 46% with salvos off |

44% of volleys are now part of a combined strike — 38% in pairs, 5% in threes,
1% in fours. And the blocked-launch attribution finally reads like a decision
rather than a wall:

    80.3%  screened, and throwing alone     <- bring a second capital
    11.6%  screened even with partners      <- kill the screen
     5.9%  target not resolved
     2.1%  target outside salvo reach

It also fixed the parked-defence asymmetry as a side effect, from 73% for the AI
attacker to 67% against a 65% no-salvo baseline — because a parked defence
clusters its capitals on the same attackers, which is the ideal shape for
combining.
