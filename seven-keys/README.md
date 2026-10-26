# The Seven Keys

A top-down pixel-art exploration game in the style of the classic Game Boy
Advance Pokémon games. You wake up inside a strange old building with a giant
chest that has seven keyholes. Explore 20 rooms, get past seven obstacles,
collect all seven keys and open the chest to escape.

Open `index.html` in a browser to play. It is one self-contained file with no
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

## The explorers

- **Boy**: red bandana, backpack, wooden staff. He vaults over gaps with the staff.
- **Girl**: long blond hair, backpack, leather whip. She swings over gaps with the whip.

## Map

```
            x=0           x=1           x=2           x=3            x=4
 y=0     Attic ─────── Gallery                    Observatory
                          │                            │
 y=1    LIBRARY ─────── Study                     MUSIC ROOM      ICE ROOM
                          │                            │              │
 y=2                  West Hall ──── GREAT HALL ── East Hall ────── Chapel
                          │              │             │              │
 y=3   DARK MAZE ──── Storage ────── South Foyer ─── Kitchen ──── Greenhouse
                                         │             │              │
 y=4                 SPIKE HALL ──── Courtyard    BOULDER ROOM     THE CHASM
```

The Great Hall is the starting room. The chest sits against its front wall and
it has three doorways (west, east, south). Capitals are the seven key rooms.

## The seven obstacles

| Key | Room | Obstacle |
| --- | --- | --- |
| Riddle Key | Library | Professor Quill asks 3 riddles. Get one wrong and he runs off to a random room; find him and try again. |
| Spike Key | Spike Hall | A maze of spikes, some popping up and down on a timer. One touch sends you back to the Great Hall. |
| Frost Key | Ice Room | Sliding-ice puzzle: you slide until you hit a rock (8 moves to solve). |
| Stone Key | Boulder Room | Push two boulders onto two pressure plates to open an iron gate. Leave and re-enter to reset. |
| Shadow Key | Dark Maze | A pitch-black maze. You need the lantern from the Storage room first. |
| Melody Key | Music Room | The organ plays a 5-note tune on coloured floor tiles; repeat it by stepping on them. |
| Sky Key | The Chasm | Cross gaps with your staff or whip; cracked tiles crumble a moment after you step on them. |

Pip the cat in the Great Hall gives hints, including which room Professor Quill
ran off to.

## Checks

```
node seven-keys/tools/check.mjs [screenshot-dir]   # map shapes, doors, puzzle solvers, screenshots
node seven-keys/tools/playtest.mjs                 # plays every obstacle with real key presses
```

Both use the Playwright that is already installed in the dev environment.
