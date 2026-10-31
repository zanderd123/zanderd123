# Adulting Quest

A GBA-style top-down RPG about ages 20–32. Pick a path with Dr. Street, walk
eight towns, fight everyday issues in the tall grass with life skills, and beat
the eight Life Leaders to win at the game of life.

Play: open `dist/adulting-quest.html` in any browser (double-click works, no
server needed). Phones get an on-screen D-pad, A/B and MENU.

## Controls

| | Keyboard | Phone |
|---|---|---|
| Move | Arrows / WASD | D-pad |
| A (talk, confirm) | Space, Z, Enter | A |
| B (back; hold to run) | Shift, X | B |
| Menu | Esc | MENU |
| Music on/off | M | (in the menu) |

The look follows House Keeper: a dark cabinet, Press Start 2P text, cream
dialog panels, 20x24 outlined characters and full-screen 19x14 rooms.

## What's in v1

- **Dr. Street and the path choice.** College, Trade School or Get a Job. Each
  path has different stats, starting skills, money, debt and a skill type it's
  best at. College and Trade School debt takes 10% of everything you earn until
  it's paid off.
- **8 towns, 8 biomes, 8 routes.** Maple Grove (suburb), Dusty Gulch (desert),
  Sunnyside Beach, Frostpeak (snow), Pinewood (forest), Boggy Bayou (swamp),
  Harvest Hollow (farm), Metro Heights (city). Every town has a hospital,
  store, chapel, houses and a Leader Hall.
- **Battles.** Skills come in 5 types (SOCIAL, GRIT, BRAINS, CHILL, SHADY);
  issues come in 5 types (PEOPLE, PAPERWORK, MONEY, CHORE, STRESS). See the
  TYPE CHART in the menu. Skills cost Energy. Sanity is your HP. SHADY skills
  (Gaslight, Per My Last Email, Ghosting) are strong but cost Karma.
- **Start.** Pick a boy or a girl, then meet Dr. Street. The first time you
  walk into his lab he comes over, explains the basics, and walks you to the
  table to choose College, Trade School or a Job.
- **Crew.** People from your life join as you beat leaders: CHAD (your high
  school best friend) runs into you after Car Trouble, and your significant
  other (SOPHIE or MARCUS, the opposite gender of your character) after Dating.
  In battle, CREW swaps who's fighting (uses your turn); when someone runs out
  of Sanity the next person tags in, and you lose only when everyone is out.
- **Call Mom.** The phone in your bag calls Mom: she sends money 90% of the
  time, once per 5 minutes of play.
- **Difficulty.** Tuned with tools/leaderlab.mjs so a player arriving at each
  leader without extra grinding wins roughly 60-75% of the time; later routes
  ramp up more gently than the leaders.
- **Hints.** In battle the best skill for the current issue is boxed in green
  (BEST PICK in its info), and the orange ? on the issue's box explains what
  works on it. Leaders offer "Get a hint" before the fight, the hall guide says
  which of your crew's skills answer each issue type, and the QUIK STOP tags
  books that fill a gap for the next leader with TIP.
- **Music.** Every town has its own theme for its biome: desert twang, beach
  calypso, snowy bells, forest folk, swamp blues, farm hoedown, city funk.
- **Ending.** Beat PARENTS: "Congratulations! You have survived young adult
  life." with your stats, then keep exploring.
- **Saving.** MENU > SAVE GAME saves anywhere outside a battle into one of
  three slots (chapels offer the same). The game also autosaves into its own
  AUTO slot when you enter buildings, so it never overwrites your slots.
  CONTINUE on the title screen lists every save. Saves stay in this browser on
  this device; to move to another device, use SAVE GAME > GET SAVE CODE and
  paste the code into ENTER SAVE CODE on the other device's title screen.
  On the claude.ai link, saves also back up to the player's Claude account
  (`src/cloud.js`) and come down on any device they sign in from; the newest
  save wins. A website build can add its own backend in `Cloud.connect()`.
- **Money.** $1 and $5 bills appear in the tall grass and respawn. Spend it on
  items, skill books, outfits, scratch-offs, hospital copays, chapel donations
  and street musicians.
- **Karma.** Low Karma raises store prices; high Karma gets you discounts and
  chapel blessings.
- **All 8 leaders**, each opening the next road, aging you almost two years,
  teaching a skill and giving a reward:

  | Leader | Town | Reward |
  |---|---|---|
  | CAR TROUBLE (Rusty) | Dusty Gulch | Car keys: drive to any visited town |
  | FITNESS (Coach Max) | Sunnyside Beach | Gym card: +10% crew Sanity, run faster |
  | TAXES (The Auditor) | Frostpeak | $300 refund, $800 off your debt |
  | DATING (Valentina) | Pinewood | Your significant other joins |
  | STUDENT LOANS (Gator Greenback) | Boggy Bayou | Debt wiped (or $500 if you had none) |
  | MASTERS DEGREE (Dean Gourdsworth) | Harvest Hollow | +20% XP |
  | CAREER (Director Deadline) | Metro Heights | A salary: money as you walk |
  | PARENTS (Mom & Dad) | Maple Grove | Their approval (needs 7 milestones) |

## Changing things

All content is data in `src/data.js`: skills, issues, items, paths, towns,
routes, leaders (their `town`, team and lines) and townsfolk dialogue. To move
a leader to another town, change its `town` and swap the `leader` key on the
two towns.

## Building and checks

```bash
node build.mjs              # dist/adulting-quest.html
node build.mjs --artifact   # dist/adulting-quest-artifact.html (for claude.ai)
node tools/sim.mjs          # leader win rates by path and level
node tools/reach.mjs        # every door and town reachable on foot
node tools/smoke.mjs        # headless run: intro, path choice, town
node tools/battle.mjs       # headless run: wild battles + Car Trouble
node tools/menus.mjs        # phone layout, menus, save and continue
```

Source files are plain browser scripts loaded in the order `index.html` lists
them (`index.html` also runs the game unbuilt from a local server).
