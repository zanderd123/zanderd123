# House Keeper

A top-down pixel-art exploration game in the style of the classic Game Boy
Advance Pokémon games. You wake up inside a strange old building with a giant
chest that has seven keyholes. Explore 22 rooms (and one secret one), get past seven obstacles,
collect all seven keys and open the chest to escape.

**Play online:** https://zanderd123.github.io/zanderd123/house-keeper/
(served by GitHub Pages, see below), or open `index.html` in a browser. It is one self-contained file with no
build step. All the art is drawn in code, and all sound comes from a tiny
built-in synthesizer.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | Arrow keys or WASD | D-pad |
| Talk, look, use your staff or whip | Space, Enter or Z | A |
| Run | Hold Shift | Hold B |
| Key list | Esc | MENU |
| Music on/off | M | |

Progress saves automatically in the browser, and **Continue** appears on the
title screen.

## Clock and best times

A clock in the top-right corner starts when the intro story ends and stops the
moment you walk out of the front door. **Best Times** on the title screen (and after the
ending) shows the fastest runs:

- Played as the published claude.ai page, it is one shared board: each
  player's personal best, with their claude.ai name. Players need to be
  shared on the page as Contributor or higher to post a time.
- Opened as a plain file, it keeps the top 10 runs on that device.

## The explorers

- **Boy**: a tough adventurer with a red bandana and a backpack, and a sturdy staff in hand. He vaults over gaps with the staff.
- **Girl**: a brave adventurer with an amulet and a backpack, and a fearless whip at her side. She swings over gaps with the whip.

## Map

```
            x=0           x=1           x=2              x=3            x=4
 y=0     Attic ─────── Gallery ──── HALL OF MIRRORS   Observatory
                          │                               │
 y=1    LIBRARY ─────── Study                          MUSIC ROOM      ICE ROOM
                          │                               │               │
 y=2    Archives ──── West Hall ──── GREAT HALL ──── East Hall ─────── Chapel
                          │              │                │               │
 y=3   DARK MAZE ──── Storage ────── South Foyer ───── Kitchen ──── Greenhouse
                                         │                │               │
 y=4                 SPIKE HALL ──── Courtyard      Boulder Room      THE CHASM
```

The Great Hall is the starting room. The chest sits against its front wall,
with the padlocked FRONT DOOR to its right, and the hall has three doorways
(west, east, south). Capitals are the seven key rooms.

The ending: the seven keys open the chest, the chest holds a golden key, the
golden key opens the front door, and walking out of it ends the run.

## The seven obstacles

| Key | Room | Obstacle |
| --- | --- | --- |
| Riddle Key | Library | Professor Quill asks 3 riddles. Get one wrong and he runs off to a random room; find him and try again. |
| Spike Key | Spike Hall | A maze of spikes, some popping up and down on a timer. One touch sends you back to the Great Hall. |
| Frost Key | Ice Room | Sliding-ice puzzle: you slide until you hit a rock (8 moves to solve). |
| Prism Key | Hall of Mirrors | A sunbeam bounces off standing mirrors. Turn mirrors (press A beside one) to steer the light into a crystal; the glass case opens and the key drops out. |
| Shadow Key | Dark Maze | A pitch-black maze. You need the lantern first, and it is locked behind the iron gate in the Boulder Room: push two boulders onto two plates to open it (leave and re-enter to reset). A note in the Storage room points the way. |
| Melody Key | Music Room | The organ plays a 5-note tune on coloured floor tiles; repeat it by stepping on them. |
| Sky Key | The Chasm | Cross gaps with your staff or whip; cracked tiles crumble a moment after you step on them. |

Pip the cat in the Great Hall gives hints, including which room Professor Quill
ran off to.

## Secrets

The Archives (west of the West Hall) are where Professor Quill likes to hide
between the shelves. On the right-most shelf of the top wall, one gold book
sticks out a little. Pull it and the left-most shelf on that wall swings open
into a doorway to the **Secret Room**: a fighter jet (an F/A-18 Super Hornet)
on the left, a giant ringed model planet and a cozy bed under a wooden cross
on the right, and **Mamaw**, a calico cat, curled up on the rug in the middle.
Talk to her and she follows you for the rest of the game (and out of the
front door). She is just company: she does not block anything or change the
game.

## Hosting on GitHub Pages

The repository root has a `.nojekyll` file so GitHub Pages serves the files
exactly as they are. To turn hosting on (once): repository **Settings →
Pages**, under *Build and deployment* pick **Deploy from a branch**, choose
the branch that holds this folder and `/ (root)`, and save. After a minute
the game is at `https://zanderd123.github.io/zanderd123/house-keeper/`.

## Online leaderboard for GitHub Pages

The claude.ai page has its own shared board, but only people in the owner's
claude.ai organization can post to it. For everyone else, the GitHub Pages
copy can use a free [Supabase](https://supabase.com) project as its board.
Players type 3-letter initials after a run, and the board shows each set of
initials' best time.

1. Sign up at supabase.com (free) and create a new project. Any name and
   region; save the database password somewhere, though the game doesn't need it.
2. In the project, open **SQL Editor -> New query**, paste all of
   `leaderboard.sql`, and click **Run**.
3. Open **Project Settings -> API Keys** (or **Settings -> API**) and copy
   the **Project URL** and the **publishable** key (older projects call it
   the **anon public** key). Both are safe to put in a public web page. Never
   use the **secret** / **service_role** key.
4. Put them in `index.html`, in `const ONLINE = { url:'', key:'' };`.

Until those are filled in, the GitHub Pages copy keeps best times on each
player's own device. Anyone can post a run (there is no sign-in), so a
determined player could post a fake time; you can delete rows in the Supabase
**Table Editor**. Free Supabase projects pause after a week with no visitors;
press **Restore** in the dashboard to wake it.

## Checks

```
node house-keeper/tools/check.mjs [screenshot-dir]   # map shapes, doors, puzzle solvers, screenshots
node house-keeper/tools/playtest.mjs                 # plays every obstacle with real key presses
```

Both use the Playwright that is already installed in the dev environment.
