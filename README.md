# Siege of Kepler-9

A 3D real-time space-battle RTS played in the browser: command a fleet to
besiege, or defend, an orbiting planet.

## Repository state — please read

The original ES-module source tree (`src/`, `vendor/`, `build.mjs`,
`index.html`, `styles.css`) was **lost** when the development sandbox was
recycled. Every push during that session failed with a GitHub authorization
error, so nothing had reached this remote and the container's disk was the
only copy.

What survives, and is committed here, is the **built, minified bundle** that
had been published as a hosted artifact — the complete, working game, but as
one self-contained file rather than editable source:

    recovered/siege-of-kepler-9-artifact.html   as published (no outer wrapper)
    dist/siege-of-kepler-9.html                 same build, standalone document

Both are playable. `dist/` opens by double-clicking it (file://) with no
server and no external requests.

Source reconstruction is the outstanding task. The bundle is minified but
esbuild does not mangle object property names, so all balance data
(`SHIPS`, `COMBAT`, `SIEGE`, `SHIELDS`, `BUDGET`, `WORLD`) is still readable
in it and is the reference for rebuilding `src/config.js`.

## Known balance problem

Defence beats attack near-universally. Diagnosed from the bundle:

1. `isAnchored` is defined as `stance === "defend"`, and the accuracy rule
   skips the "stationary targets are easier to hit" bonus (up to +0.162
   accuracy) for anchored units. A squadron on DEFEND therefore sits
   perfectly still while keeping full evasion — no other stance can. This
   makes "select whole fleet, press DEFEND" a dominant strategy.
2. `BUDGET.attackerMultiplier` is `1` — the hook meant to compensate the
   attacker for a harder win condition is neutral.
3. On timeout the defender wins outright
   (`state = playerFaction === DEFENSE ? "victory" : "defeat"`).
4. The attacker must additionally destroy the planet:
   `max(2 x biggestHullHP, attackerPoints x 6)` extra HP, and ships that
   lock into bombardment stop defending themselves.
5. The attacker crosses ~3,000 units of no-man's-land and arrives piecemeal.

Fix (1) first; (2)-(4) need paired self-play A/B runs to tune rather than
guess.
