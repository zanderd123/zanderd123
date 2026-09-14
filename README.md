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
    node tools/invariants.mjs      bug hunt: assert what must never be true

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
