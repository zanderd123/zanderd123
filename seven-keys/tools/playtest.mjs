// Plays through every obstacle in The Seven Keys with real key presses and
// checks the game reacts the right way.   node seven-keys/tools/playtest.mjs
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const url = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'index.html')).href;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(url);
await page.waitForTimeout(600);

let failures = 0;
const check = (cond, msg) => { console.log((cond ? 'ok    ' : 'FAIL  ') + msg); if (!cond) failures++; };
const sk = fn => page.evaluate(fn);
const tap = async (k, ms = 60) => { await page.keyboard.down(k); await page.waitForTimeout(ms); await page.keyboard.up(k); };
async function settle(answer) {          // click through dialogs until the game is idle
  for (let i = 0; i < 300; i++) {
    const s = await sk(() => ({ d: __SK.dlg.active, l: __SK.locks, m: __SK.P.moving, c: __SK.dlg.active && !!__SK.dlg.boxes[__SK.dlg.i].choices }));
    if (!s.d && !s.l && !s.m) return;
    if (s.d) { if (s.c && answer) { await answer(); } else await tap('Space', 30); }
    await page.waitForTimeout(40);
  }
  throw new Error('game never settled');
}
const put = (x, y, dir) => page.evaluate(([x, y, dir]) => Object.assign(__SK.P, { x, y, fx: x, fy: y, dir, moving: false }), [x, y, dir]);
const go = (id, x, y, dir) => page.evaluate(([id, x, y, dir]) => __SK.enterRoom(id, x, y, dir), [id, x, y, dir]);
const room = () => sk(() => __SK.S.room.id);
const pos = () => sk(() => [__SK.P.x, __SK.P.y]);
async function move(key) { await tap(key, 150); await page.waitForTimeout(80); await settle(); }

// start
await tap('Space'); await page.waitForTimeout(150); await tap('Space'); await page.waitForTimeout(300);
await settle();
check(await room() === 'hall', 'game starts in the Great Hall');

// walk out of the west door
await put(9, 7, 'left');
await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(2600); await page.keyboard.up('ArrowLeft'); await settle();
check(await room() === 'westhall', 'walking through the west doorway reaches the West Hall');

// Pip the cat
await go('hall', 14, 6, 'up'); await settle();
await tap('Space'); await settle();
check(await sk(() => __SK.S.flags.metCat), 'talking to Pip the cat works');

// Professor Quill: answer wrong, he runs off
const answerer = wantRight => async () => {
  const st = await sk(() => { const b = __SK.dlg.boxes[__SK.dlg.i], q = b.lines.join(' '); const Q = __SK.QUESTIONS.find(q2 => q.replace(/\s+/g, ' ').includes(q2[0].split(' ').slice(0, 4).join(' '))); return { choices: b.choices, right: Q ? Q[1] : null }; });
  let pick = 0;
  if (st.right) { const r = st.choices.indexOf(st.right); pick = wantRight ? r : (r + 1) % st.choices.length; }
  for (let i = 0; i < pick; i++) await tap('ArrowDown', 30);
  await tap('Space', 30);
};
await go('library', 9, 8, 'up'); await settle();
await tap('Space'); await settle(answerer(false));
const fled = await sk(() => __SK.prof.room);
check(fled !== 'library', 'a wrong answer makes the professor run off (now in ' + fled + ')');
// find him and answer everything right
const spot = await sk(() => { const p = __SK.prof, r = __SK.ROOM[p.room]; for (const [dx, dy, dir] of [[0, 1, 'up'], [0, -1, 'down'], [1, 0, 'left'], [-1, 0, 'right']]) { const c = r.base[p.y + dy][p.x + dx]; if (__SK.WALK.has(c)) return [p.room, p.x + dx, p.y + dy, dir]; } });
await go(...spot); await settle();
await tap('Space'); await settle(answerer(true));
check(await sk(() => __SK.S.keys.has('quiz')), 'three right answers earn the RIDDLE KEY');

// spikes send you back to the Great Hall
await go('spikes', 17, 7, 'left'); await settle();
await move('ArrowLeft'); await move('ArrowUp');
check(await room() === 'hall', 'stepping on a spike sends you back to the Great Hall');

// ice: the 8-move solution
await go('ice', 9, 12, 'up'); await settle();
for (const k of ['ArrowLeft', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowUp', 'ArrowRight', 'ArrowUp', 'ArrowRight']) { await move(k); }
check(await sk(() => __SK.S.keys.has('ice')), 'sliding the ice puzzle reaches the FROST KEY');

// boulders onto both plates
await go('boulder', 9, 2, 'down'); await settle();
const push = async (x, y, dir, key, n) => { await put(x, y, dir); for (let i = 0; i < n; i++) { await tap(key, 40); await page.waitForTimeout(320); } };
await push(4, 3, 'down', 'ArrowDown', 3); await push(5, 7, 'left', 'ArrowLeft', 1);
await push(12, 3, 'down', 'ArrowDown', 3); await push(11, 7, 'right', 'ArrowRight', 3);
await settle();
check(await sk(() => __SK.S.flags.gate), 'two boulders on the plates open the gate');
await put(9, 8, 'down'); for (let i = 0; i < 3; i++) await move('ArrowDown');
check(await sk(() => __SK.S.keys.has('boulder')), 'walking through the gate reaches the STONE KEY');

// chasm: vault a gap, then fall through a crumbling tile
await go('chasm', 9, 2, 'down'); await settle();
await move('ArrowDown'); await move('ArrowDown');          // second press bumps the pit -> hint
await tap('Space'); await page.waitForTimeout(700); await settle();
check(String(await pos()) === '9,5', 'the staff vaults across the gap');
await move('ArrowLeft'); await page.waitForTimeout(1300); await settle();
check(await room() === 'chasm' && String(await pos()) === '9,2' && await sk(() => __SK.S.stats.falls) === 1, 'standing still on cracked floor drops you back to the entrance');

// music: play the organ, repeat the tune
await go('music', 5, 3, 'up'); await settle();
await tap('Space'); await settle(async () => tap('Space', 30));
const seq = await sk(() => __SK.music.seq);
const PADKEY = { 1: ['ArrowUp', 'ArrowDown'], 2: ['ArrowRight', 'ArrowLeft'], 3: ['ArrowDown', 'ArrowUp'], 4: ['ArrowLeft', 'ArrowRight'] };
await put(9, 7, 'up');
for (const n of seq) { await move(PADKEY[n][0]); await move(PADKEY[n][1]); }
await settle();
check(await sk(() => __SK.S.flags.music), 'repeating the organ tune (' + seq.join('') + ') solves the Music Room');
await put(13, 8, 'down'); await move('ArrowDown');
check(await sk(() => __SK.S.keys.has('music')), 'the MELODY KEY appears and can be picked up');

// dark maze needs the lantern
await go('storage', 1, 7, 'left'); await settle();
await move('ArrowLeft');
check(await room() === 'storage', 'the Dark Maze is blocked without a light');
await go('attic', 15, 10, 'up'); await settle();
await tap('Space'); await settle();
check(await sk(() => __SK.S.lantern), 'searching the right crate in the Attic finds the lantern');
await go('storage', 1, 7, 'left'); await settle(); await move('ArrowLeft'); await page.waitForTimeout(500); await settle();
check(await room() === 'darkmaze', 'with the lantern you can enter the Dark Maze');

// open the chest
await sk(() => { for (const k of __SK.KEYS) __SK.S.keys.add(k.id); });
await go('hall', 9, 3, 'up'); await settle();
await tap('Space'); await settle();
check(await sk(() => __SK.S.flags.opened && __SK.S.mode === 'play'), 'seven keys open the chest');
await put(15, 2, 'up'); await move('ArrowUp');
check(await sk(() => __SK.S.mode === 'play'), 'the front door stays shut until it is unlocked');
await tap('Space'); await settle();
check(await sk(() => __SK.S.flags.doorOpen), 'the golden key opens the front door');
await move('ArrowUp'); await page.waitForTimeout(2500);
check(await sk(() => __SK.S.mode) === 'ending', 'walking out the front door finishes the game');

const finish = await sk(() => [__SK.S.finalTime, __SK.S.playTime]);
check(finish[0] > 5 && finish[0] === finish[1], 'the clock ran during play and stopped at the front door (' + finish[0].toFixed(1) + 's)');
await page.waitForTimeout(1500); await tap('Space'); await page.waitForTimeout(500);
const b = await sk(() => ({ mode: __SK.S.mode, rows: __SK.board.rows.length, scope: __SK.board.scope }));
check(b.mode === 'board' && b.rows === 1 && b.scope === 'device', 'the finished run shows on the best-times board (' + b.scope + ')');
await page.locator('#screen').screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + '/board.png' : '/dev/null' }).catch(() => {});

check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
console.log(failures ? `\n${failures} failure(s)` : '\nplaythrough passed');
process.exit(failures ? 1 : 0);
