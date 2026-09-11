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

### Known remaining issue: the AI defence abandons the objective

AI-v-AI currently reads 69% for the attacker, against 50% in the parked case
with the same settings. That gap is not a tuning error, it is the AI defence
wandering off its picket to go and find the enemy. That used to be free;
now that the planet is a real target, it means leaving the objective
undefended and losing it. Teaching the defence Commander to hold station over
the world it is defending is the natural next piece of work, and until it is
done, `AI v AI` understates how well the defence can do.
