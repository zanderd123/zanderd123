// Checks House Keeper: map shapes, door links, that every puzzle room can be
// solved, and that the page runs without errors. Saves a screenshot of every
// room so the art can be eyeballed.
//
//   node house-keeper/tools/check.mjs [screenshot-dir]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const page_url = pathToFileURL(resolve(here, '..', 'index.html')).href;
const shots = process.argv[2];
let failures = 0;
const fail = m => { failures++; console.log('FAIL  ' + m); };
const ok = m => console.log('ok    ' + m);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
await page.goto(page_url);
await page.waitForTimeout(800);

const { DEFS, MW, MH, WALK } = await page.evaluate(() => ({
  DEFS: window.__SK.DEFS.map(d => ({ id: d.id, gx: d.gx, gy: d.gy, doors: d.doors, map: d.map })),
  MW: window.__SK.MW, MH: window.__SK.MH, WALK: [...window.__SK.WALK].join(''),
}));

// --- shapes and doors ---------------------------------------------------------
const at = {};
for (const d of DEFS) at[d.gx + ',' + d.gy] = d;
const STEP = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] }, OPP = { N: 'S', S: 'N', W: 'E', E: 'W' };
const ARR = { N: [8, 0], S: [8, 10], W: [0, 5], E: [16, 5] };   // interior coords
for (const d of DEFS) {
  if (d.map.length !== 11 || d.map.some(r => r.length !== 17)) fail(`${d.id}: map is not 17x11 (${d.map.map(r => r.length).join(',')})`);
  for (const door of d.doors) {
    const n = at[(d.gx + STEP[door][0]) + ',' + (d.gy + STEP[door][1])];
    if (!n) fail(`${d.id}: door ${door} leads nowhere`);
    else if (!n.doors.includes(OPP[door])) fail(`${d.id}: door ${door} has no matching door in ${n.id}`);
    const [x, y] = ARR[door], c = d.map[y][x];
    if (!WALK.includes(c) || c === '^') fail(`${d.id}: arrival cell for door ${door} is '${c}'`);
  }
}
{ // every room reachable from the hall
  const seen = new Set(['hall']), q = ['hall'];
  while (q.length) { const id = q.shift(), d = DEFS.find(x => x.id === id); for (const door of d.doors) { const n = at[(d.gx + STEP[door][0]) + ',' + (d.gy + STEP[door][1])]; if (n && !seen.has(n.id)) { seen.add(n.id); q.push(n.id); } } }
  seen.size === DEFS.length ? ok(`all ${DEFS.length} rooms connected`) : fail(`only ${seen.size} of ${DEFS.length} rooms reachable`);
}

// --- puzzle solvers (interior coordinates) ----------------------------------------
const room = id => DEFS.find(d => d.id === id).map;
const cell = (m, x, y) => (x < 0 || y < 0 || x > 16 || y > 10) ? '#' : m[y][x];
const find = (m, ch) => { for (let y = 0; y < 11; y++) { const x = m[y].indexOf(ch); if (x >= 0) return [x, y]; } };
const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function bfs(start, isGoal, next) {
  const seen = new Map([[start.join('|'), 0]]), q = [start];
  while (q.length) {
    const s = q.shift(), d = seen.get(s.join('|'));
    if (isGoal(s)) return d;
    for (const n of next(s)) { const k = n.join('|'); if (!seen.has(k)) { seen.set(k, d + 1); q.push(n); } }
  }
  return -1;
}
const walk = c => WALK.includes(c);

{ // ice: slide until blocked or onto non-ice
  const m = room('ice'), key = find(m, 'K');
  const moves = bfs(ARR.S, ([x, y]) => x === key[0] && y === key[1], ([x, y]) => D4.map(([dx, dy]) => {
    let nx = x + dx, ny = y + dy;
    if (!walk(cell(m, nx, ny))) return [x, y];
    while (cell(m, nx, ny) === 'i' && walk(cell(m, nx + dx, ny + dy))) { nx += dx; ny += dy; }
    return [nx, ny];
  }));
  moves > 0 ? ok(`ice room solvable in ${moves} moves`) : fail('ice room has no solution');
  if (moves > 0 && moves < 5) fail(`ice room too easy (${moves} moves)`);
}
{ // spikes: static spikes are walls, timed spikes passable
  const m = room('spikes'), key = find(m, 'K');
  const d = bfs(ARR.E, ([x, y]) => x === key[0] && y === key[1], ([x, y]) => D4.map(([dx, dy]) => [x + dx, y + dy]).filter(([a, b]) => { const c = cell(m, a, b); return walk(c) && c !== '^'; }));
  d > 0 ? ok(`spike hall path is ${d} steps`) : fail('spike hall has no path');
}
{ // dark maze
  const m = room('darkmaze'), key = find(m, 'K');
  const d = bfs(ARR.E, ([x, y]) => x === key[0] && y === key[1], ([x, y]) => D4.map(([dx, dy]) => [x + dx, y + dy]).filter(([a, b]) => walk(cell(m, a, b))));
  d > 0 ? ok(`dark maze path is ${d} steps`) : fail('dark maze has no path');
}
{ // boulders: state = player + both boulders, goal = both plates covered
  const m = room('boulder'), bs = [], plates = [];
  m.forEach((r, y) => [...r].forEach((c, x) => { if (c === 'o') bs.push([x, y]); if (c === 'p') plates.push([x, y]); }));
  const floor = (x, y) => '.op'.includes(cell(m, x, y));
  const d = bfs([...ARR.N, ...bs[0], ...bs[1]], s => plates.every(([px, py]) => (s[2] === px && s[3] === py) || (s[4] === px && s[5] === py)), s => {
    const out = [];
    for (const [dx, dy] of D4) {
      const nx = s[0] + dx, ny = s[1] + dy;
      const hit = [0, 1].find(i => s[2 + i * 2] === nx && s[3 + i * 2] === ny);
      if (hit === undefined) { if (floor(nx, ny)) out.push([nx, ny, s[2], s[3], s[4], s[5]]); continue; }
      const bx = nx + dx, by = ny + dy, other = 1 - hit;
      if (floor(bx, by) && !(s[2 + other * 2] === bx && s[3 + other * 2] === by)) { const t = s.slice(); t[2 + hit * 2] = bx; t[3 + hit * 2] = by; out.push(t); }
    }
    return out;
  });
  d > 0 ? ok(`boulder room solvable in ${d} steps`) : fail('boulder room has no solution');
}
{ // chasm: walk on solid/crumbling ground, or cross a 1-2 tile gap with the tool
  const m = room('chasm'), key = find(m, 'K');
  const ground = (x, y) => '.%K'.includes(cell(m, x, y));
  const nexts = ([x, y]) => {
    const out = [];
    for (const [dx, dy] of D4) {
      if (ground(x + dx, y + dy)) out.push([x + dx, y + dy]);
      else if (cell(m, x + dx, y + dy) === '~') for (let gap = 1; gap <= 2; gap++) {
        if (cell(m, x + dx * gap, y + dy * gap) !== '~') break;
        if (ground(x + dx * (gap + 1), y + dy * (gap + 1))) { out.push([x + dx * (gap + 1), y + dy * (gap + 1)]); break; }
      }
    }
    return out;
  };
  const d = bfs(ARR.N, ([x, y]) => x === key[0] && y === key[1], nexts);
  d > 0 ? ok(`chasm reachable in ${d} moves`) : fail('chasm key unreachable');
  const back = bfs(key, ([x, y]) => x === ARR.N[0] && y === ARR.N[1], nexts);
  back > 0 ? ok(`chasm way back in ${back} moves (after the bridge)`) : fail('no way back from the chasm key');
}

{ // mirrors: every mirror can be flipped between \ and /; find the fewest flips that light the crystal
  const m = room('mirrors').map(r => [...r]);
  const cells = []; m.forEach((r, y) => r.forEach((c, x) => { if (c === 'q' || c === 'd') cells.push([x, y]); }));
  const lit = grid => {
    let x = 2, y = 0, dx = 0, dy = 1;
    for (let n = 0; n < 200; n++) {
      const c = cell(grid, x, y);
      if (c === 'q') [dx, dy] = [dy, dx]; else if (c === 'd') [dx, dy] = [-dy, -dx];
      else if (c === 'y') return true; else if (!walk(c)) return false;
      x += dx; y += dy;
    }
    return false;
  };
  let best = -1;
  for (let mask = 0; mask < 1 << cells.length; mask++) {
    const grid = m.map(r => r.slice()); let flips = 0;
    cells.forEach(([x, y], i) => { if (mask >> i & 1) { grid[y][x] = grid[y][x] === 'q' ? 'd' : 'q'; flips++; } });
    if (lit(grid.map(r => r.join(''))) && (best < 0 || flips < best)) best = flips;
  }
  if (best === 0) fail('mirror room starts already solved');
  else best > 0 ? ok(`mirror room solvable in ${best} mirror turns`) : fail('mirror room has no solution');
}

// --- run the real game a little ---------------------------------------------------
await page.keyboard.press('Space');            // title -> select
await page.waitForTimeout(200);
await page.keyboard.press('Space');            // pick the boy
await page.waitForTimeout(400);
const mode = await page.evaluate(() => window.__SK.S.mode);
mode === 'play' ? ok('new game starts') : fail('new game did not start, mode=' + mode);

if (shots) {
  mkdirSync(shots, { recursive: true });
  // skip the intro and look at each room
  await page.evaluate(() => { const sk = window.__SK; sk.S.fade = 0; });
  for (let i = 0; i < 40; i++) { await page.keyboard.press('Space'); await page.waitForTimeout(60); }
  for (const d of DEFS) {
    await page.evaluate(id => { const sk = window.__SK; sk.S.lantern = true; sk.enterRoom(id, 9, id === 'chasm' || id === 'boulder' || id === 'observatory' || id === 'ice' ? (id === 'ice' ? 12 : 2) : 7, 'down'); if (id === 'spikes' || id === 'darkmaze') { sk.P.x = sk.P.fx = 17; } }, d.id);
    await page.waitForTimeout(350);
    await page.locator('#screen').screenshot({ path: join(shots, d.id + '.png') });
  }
  await page.evaluate(() => { window.__SK.S.mode = 'select'; });
  await page.waitForTimeout(200);
  await page.locator('#screen').screenshot({ path: join(shots, '_select.png') });
}

errors.length ? fail('page errors: ' + errors.join(' | ')) : ok('no page errors');
await browser.close();
console.log(failures ? `\n${failures} problem(s)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
