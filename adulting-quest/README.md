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
- **Crew.** Five allies join you: CORBIN (best friend, meets you outside the lab), SAM
  (roommate, Dusty Gulch, $50 deposit), PAT (mentor, Sunnyside Beach, after 1
  milestone), DR. KIM (therapist, Frostpeak, $40, after 2) and MOM (talk to
  her at home after 1). Each levels with you and is best with one skill type.
  In battle, CREW swaps who's fighting (uses your turn); when someone runs
  out of Sanity the next person tags in, and you lose only when everyone is
  out. MENU > CREW picks who fights first. Pep Talks revive a crew member.
- **Money.** $1 and $5 bills appear in the tall grass and respawn. Spend it on
  items, skill books, outfits, scratch-offs, hospital copays, chapel donations
  and street musicians.
- **Karma.** Low Karma raises store prices; high Karma gets you discounts and
  chapel blessings.
- **Leaders 1–3 are playable:** CAR TROUBLE (Dusty Gulch), FITNESS (Sunnyside
  Beach), TAXES (Frostpeak). Beating each one opens the next road, ages you
  1.5 years and teaches a skill. DATING, STUDENT LOANS, MASTERS DEGREE, CAREER
  and PARENTS have halls with "coming soon" signs.
- **Saving.** Save at any chapel or from the menu. The game also autosaves
  whenever you enter a building. Saves live in the browser's local storage.

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
