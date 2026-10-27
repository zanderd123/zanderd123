// Renders mockups of five proposed rooms with the real game engine, so they can
// be judged in the game's own art style before they are built for real.
// Nothing here changes the game: the rooms, art and overlays are injected into
// a running page and screenshotted.
//
//   node seven-keys/tools/mockups.mjs <out-dir>     -> <id>.png per room
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const out = process.argv[2];
if (!out) { console.error('usage: node mockups.mjs <out-dir>'); process.exit(1); }
mkdirSync(out, { recursive: true });
const url = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'index.html')).href;

// Runs inside the page.
function setupMocks() {
  const SK = window.__SK, { rr, blob, THEMES, FLOORS, DECOR, PROPDRAW, PROPS } = SK;
  const TS = 16;

  // ---- themes, floors, wall decorations
  FLOORS.mirrorfloor = (x, y, tx, ty) => { rr(x, y, 16, 16, (tx + ty) % 2 ? '#cfcfe4' : '#b4b4d0'); rr(x, y, 16, 1, '#9a9abc'); rr(x, y, 1, 16, '#9a9abc'); if ((tx * 3 + ty) % 5 === 0) rr(x + 3, y + 3, 4, 1, '#f4f4ff'); };
  FLOORS.cryptstone = (x, y, tx, ty) => FLOORS.stone(x, y, tx, ty, ['#262e28', '#38443c', '#46544a', '#2e3830']);
  FLOORS.vaultfloor = (x, y, tx, ty) => { FLOORS.stone(x, y, tx, ty, ['#3a3024', '#5a4c38', '#6a5a44', '#4a3e2e']); if ((tx + ty) % 4 === 0) rr(x + 7, y + 7, 2, 2, '#d8b048'); };
  THEMES.mirror  = { floor:'mirrorfloor', top:'#2a2440', lip:'#463e66', wall:'paper', c1:'#5a5486', c2:'#4e4878', trim:'#d8d8f0', base:'#2a2440' };
  THEMES.crypt   = { floor:'cryptstone', top:'#121814', lip:'#24302a', wall:'brick', c1:'#46524c', c2:'#38443e', trim:'#6a7a70', base:'#1a201c' };
  THEMES.vault   = { floor:'vaultfloor', top:'#1e1610', lip:'#3a2c1a', wall:'brick', c1:'#6a5a40', c2:'#584a34', trim:'#d8b048', base:'#2a2016' };
  THEMES.tower   = { floor:'wood', top:'#2a2030', lip:'#463a50', wall:'plank', c1:'#8a6a48', c2:'#7a5a3a', trim:'#5a4028', base:'#3a2818' };
  THEMES.archive = { floor:'darkwood', top:'#22161a', lip:'#3a2a2e', wall:'paper', c1:'#5a3a3a', c2:'#4e3232', trim:'#c8a24a', base:'#2a1a12' };
  DECOR.tallmirror = (x, y) => { rr(x + 3, y + 1, 10, 12, '#d8d8f0'); rr(x + 4, y + 2, 8, 10, '#a8c8e8'); rr(x + 5, y + 3, 2, 6, '#eef8ff'); };
  DECOR.sunwindow = (x, y) => { rr(x + 2, y + 1, 12, 13, '#6a5a3a'); rr(x + 3, y + 2, 10, 12, '#fff0a0'); rr(x + 3, y + 2, 10, 3, '#fffad8'); rr(x + 7, y + 2, 2, 12, '#6a5a3a'); };
  DECOR.niche = (x, y) => { rr(x + 3, y + 2, 10, 10, '#0c100e'); rr(x + 5, y + 5, 6, 5, '#e8e0c8'); rr(x + 6, y + 7, 1, 1, '#0c100e'); rr(x + 9, y + 7, 1, 1, '#0c100e'); rr(x + 7, y + 9, 2, 1, '#0c100e'); };
  DECOR.skywindow = (x, y) => { rr(x + 2, y + 1, 12, 13, '#5a4028'); rr(x + 3, y + 2, 10, 11, '#9ad0f8'); rr(x + 4, y + 8, 5, 2, '#ffffff'); rr(x + 9, y + 4, 3, 1, '#ffffff'); };
  DECOR.goldbanner = (x, y) => { rr(x + 4, y + 1, 8, 11, '#3a2a6a'); rr(x + 4, y + 1, 8, 1, '#d8b048'); rr(x + 5, y + 12, 2, 2, '#3a2a6a'); rr(x + 9, y + 12, 2, 2, '#3a2a6a'); rr(x + 6, y + 4, 4, 4, '#d8b048'); };

  // ---- props
  const mirror = (x, y, flip) => {
    rr(x + 3, y + 12, 10, 3, '#4a4258');
    for (let i = 0; i < 11; i++) { const px = flip ? x + 12 - i : x + 2 + i; rr(px, y + 1 + i, 3, 2, '#f0f4fc'); rr(px + (flip ? 0 : 2), y + 2 + i, 1, 1, '#7a80a0'); }
    rr(x + 7, y + 10, 2, 4, '#3a3444');
  };
  const add = (ch, f) => { PROPDRAW[ch] = f; PROPS.add(ch); };
  add('q', (x, y) => mirror(x, y, false));
  add('d', (x, y) => mirror(x, y, true));
  add('y', (x, y) => { blob([[x + 4, y + 9, 8, 6]], '#8a8296'); blob([[x + 5, y + 1, 6, 8], [x + 6, y - 1, 4, 2]], window.__mock.crystalLit ? '#fff6a0' : '#7ad8e8'); rr(x + 6, y + 2, 2, 4, '#e8fcff'); });
  add('Y', (x, y, tx, ty, r, t) => {
    blob([[x + 2, y + 9, 12, 6]], '#6a4a2a'); rr(x + 2, y + 9, 12, 2, '#8a6a40');
    blob([[x + 5, y + 2, 4, 4], [x + 9, y + 3, 4, 2], [x + 11, y + 5, 1, 2]], '#d0b8ff');
    rr(x + 6, y + 3, 1, 1, '#ff8ad8'); rr(x + 7, y + 4, 1, 1, '#8ad8ff');
    rr(x + 3, y - 4, 10, 13, 'rgba(210,235,255,.35)');
    rr(x + 3, y - 5, 10, 1, '#e8f4ff'); rr(x + 3, y - 4, 1, 13, '#e8f4ff'); rr(x + 12, y - 4, 1, 13, '#c8dcf0'); rr(x + 4, y - 3, 1, 5, '#ffffff');
  });
  add('V', (x, y) => { blob([[x + 2, y + 1, 12, 14]], '#5a3e28'); rr(x + 3, y + 2, 10, 12, '#6e4e34'); rr(x + 7, y + 4, 2, 8, '#c8b080'); rr(x + 5, y + 6, 6, 2, '#c8b080'); });
  add('U', (x, y) => { blob([[x + 4, y + 3, 8, 11], [x + 5, y + 1, 6, 2]], '#7a6a5a'); rr(x + 4, y + 6, 8, 1, '#a89060'); rr(x + 5, y + 4, 1, 8, '#9a8a78'); });
  add('j', (x, y, tx, ty, r, t) => { rr(x + 5, y + 13, 6, 2, '#4a4252'); rr(x + 6, y + 6, 4, 7, '#e8e0c8'); const f = Math.floor(t * 8 + tx) % 2; rr(x + 7, y + 2 + f, 2, 4 - f, '#ffa030'); rr(x + 7, y + 3 + f, 2, 2, '#fff0a0'); });
  add('=', (x, y) => { rr(x, y, 16, 16, '#5a4c38'); rr(x, y, 16, 2, '#8a7a5a'); rr(x, y + 2, 16, 1, '#d8b048'); rr(x, y + 14, 16, 2, '#2a2016'); });
  add('J', (x, y) => {
    rr(x + 7, y - 16, 2, 7, '#5a4028');
    blob([[x + 3, y - 9, 10, 10], [x + 1, y + 1, 14, 3], [x + 5, y - 11, 6, 2]], '#c89a3a');
    rr(x + 4, y - 8, 2, 8, '#f0d070'); rr(x + 7, y + 4, 2, 2, '#5a4028');
  });
  add('l', (x, y) => { rr(x + 7, y - 4, 2, 14, '#c8a878'); rr(x + 8, y - 4, 1, 14, '#a88858'); blob([[x + 6, y + 10, 4, 4]], '#c83a2a'); });
  add('h', (x, y) => {
    blob([[x + 1, y + 1, 14, 14]], '#3a2818'); rr(x + 2, y + 2, 12, 12, '#0c0806');
    rr(x + 4, y + 2, 1, 12, '#a07040'); rr(x + 11, y + 2, 1, 12, '#a07040'); for (let i = 0; i < 4; i++) rr(x + 4, y + 3 + i * 3, 8, 1, '#c08a50');
  });
  add('z', (x, y) => {
    rr(x, y - 8, 16, 24, '#0a0610'); rr(x + 2, y - 6, 9, 22, '#140e1c'); rr(x + 3, y + 10, 7, 6, '#24202e');
    blob([[x + 11, y - 8, 5, 24]], '#7a4a26'); for (let s = 0; s < 3; s++) { rr(x + 12, y - 7 + s * 7, 4, 6, '#3a2414'); rr(x + 12, y - 5 + s * 7, 1, 4, '#b83a3a'); rr(x + 14, y - 4 + s * 7, 1, 3, '#3a6ab8'); }
  });

  // ---- rooms (17 x 11 interiors; doors as they would connect)
  const ROOMS = {
    mirrors: { id:'mirrors', name:'Hall of Mirrors', gx:2, gy:0, theme:'mirror', doors:'WES',
      decor:{ 3:'sunwindow', 6:'tallmirror', 9:'tallmirror', 12:'tallmirror', 15:'tallmirror' },
      map:[ 'H...............H', '.................', '..q.......q....Y.', '.................', '.................',
            '..........d...y..', '.................', '.....d.....q.....', '.................', '.................', 'H...............H' ] },
    crypt: { id:'crypt', name:'The Crypt', gx:0, gy:4, theme:'crypt', doors:'NE',
      decor:{ 2:'niche', 5:'niche', 8:'niche', 11:'niche', 14:'niche', 17:'niche' },
      map:[ 'U.V.V.V...V.V.V.U', '.................', '.j.............j.', '....VV.....VV....', '.................',
            '.................', '....VV.....VV....', '.................', '.j.............j.', '.................', 'U.V.V.V...V.V.V.U' ] },
    vault: { id:'vault', name:"Guardian's Vault", gx:2, gy:1, theme:'vault', doors:'S',
      decor:{ 3:'goldbanner', 6:'torch', 12:'torch', 15:'goldbanner' },
      map:[ 'H.......=.......H', '......=====......', '.................', '.1.............2.', '..aaaa.....bbbb..',
            '.................', '..bbbb.....aaaa..', '.3......p......4.', '........o........', '.................', 'H...............H' ] },
    belltower: { id:'belltower', name:'Bell Tower', gx:4, gy:0, theme:'tower', doors:'W',
      decor:{ 2:'skywindow', 6:'skywindow', 12:'skywindow', 16:'skywindow' },
      map:[ 'C...............C', '....J...J...J....', '....l...l...l....', '.................', '.................',
            '........h........', '.................', '.P.............P.', '.................', '..s..............', 'C...............C' ] },
    archives: { id:'archives', name:'Archives', gx:0, gy:2, theme:'archive', doors:'E',
      decor:{},
      map:[ 'BBBBBzBBBBBBBBBBB', '.................', '.B.B.B.B.B.......', '.B.B.B.B.B...D...', '.B.B.B.B.B.......',
            '.................', '.B.B.B.B.B.......', '.B.B.B.B.B.......', '.B.B.B.B.B.......', '...........TT.c..', 'P...........s...P' ] },
  };
  for (const id in ROOMS) SK.ROOM[id] = SK.buildRoom(ROOMS[id]);

  // ---- per-room overlays drawn through the game's DEV.after hook
  const sparkle = (x, y, t, k = 0) => { if (Math.sin(t * 5 + k) > 0.3) { rr(x, y - 2, 1, 5, '#ffffff'); rr(x - 2, y, 5, 1, '#ffffff'); } };
  const ghost = (c, x, y, t) => {
    const b = Math.round(Math.sin(t * 3) * 2);
    c.globalAlpha = 0.85;
    blob([[x + 3, y - 5 + b, 10, 12], [x + 2, y + 1 + b, 12, 7]], '#d8e8ff', '#3a4a6a');
    for (let i = 0; i < 4; i++) rr(x + 2 + i * 3, y + 8 + b, 2, 2 + (i % 2), '#d8e8ff');
    rr(x + 5, y - 1 + b, 2, 3, '#1a1a3a'); rr(x + 9, y - 1 + b, 2, 3, '#1a1a3a'); rr(x + 7, y + 4 + b, 2, 2, '#1a1a3a');
    c.globalAlpha = 1;
  };
  const trail = cells => { for (const [x, y] of cells) rr(x * TS + 7, y * TS + 7, 2, 2, 'rgba(200,220,255,.45)'); };
  const boneBit = (x, y, t) => { blob([[x + 4, y + 7, 7, 3], [x + 3, y + 5, 3, 3], [x + 3, y + 9, 3, 3]], '#f0e8d0', '#5a5040'); sparkle(x + 13, y + 3, t); };
  const guardian = (cx, top, t) => {
    const eye = Math.sin(t * 4) > 0 ? '#ff5a3a' : '#ffb040';
    blob([[cx - 14, top + 14, 28, 22], [cx - 10, top, 20, 16], [cx - 21, top + 16, 8, 17], [cx + 13, top + 16, 8, 17],
          [cx - 12, top + 36, 9, 8], [cx + 3, top + 36, 9, 8], [cx - 2, top - 6, 4, 6]], '#9a9aa8', '#221c28');
    rr(cx - 14, top + 14, 28, 3, '#b8b8c4'); rr(cx - 10, top, 20, 3, '#b8b8c4'); rr(cx - 21, top + 16, 8, 2, '#b8b8c4'); rr(cx + 13, top + 16, 8, 2, '#b8b8c4');
    rr(cx - 6, top + 20, 1, 9, '#6a6a78'); rr(cx + 4, top + 25, 7, 1, '#6a6a78'); rr(cx - 10, top + 30, 5, 1, '#6a6a78');
    rr(cx - 6, top + 6, 4, 3, eye); rr(cx + 2, top + 6, 4, 3, eye); rr(cx - 3, top + 11, 6, 1, '#5a5a68');
    blob([[cx + 17, top + 31, 5, 5], [cx + 21, top + 33, 8, 2], [cx + 26, top + 35, 1, 2]], '#f8d040', '#5a3a10');
    sparkle(cx + 30, top + 30, t);
  };
  const beamPath = r => {   // follow the sunbeam from the window through the mirrors
    let x = 3, y = 2, dx = 0, dy = 1; const pts = [[x * TS + 8, y * TS - 2]]; let hit = null;
    for (let n = 0; n < 80; n++) {
      const ch = r.grid[y][x];
      if (ch === 'q') { pts.push([x * TS + 8, y * TS + 8]); [dx, dy] = [dy, dx]; }
      else if (ch === 'd') { pts.push([x * TS + 8, y * TS + 8]); [dx, dy] = [-dy, -dx]; }
      else if (ch === 'y') { hit = 'crystal'; pts.push([x * TS + 8, y * TS + 6]); break; }
      else if (ch === '@' || ch === '>' || ch === 'H' || ch === 'Y') { pts.push([x * TS + 8 - dx * 8, y * TS + 8 - dy * 8]); break; }
      x += dx; y += dy;
    }
    return { pts, hit };
  };
  window.__mock = { ROOMS };
  SK.DEV.after = (t, c) => {
    const id = SK.S.room.id;
    if (id === 'mirrors') {
      const { pts } = beamPath(SK.S.room);
      for (const [w, col] of [[5, 'rgba(255,230,120,.35)'], [2, '#fff4b0']]) {
        c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) c.lineTo(p[0], p[1]); c.stroke();
      }
      // the mirror that needs turning
      const mx = 11 * TS, my = 7 * TS;
      if (Math.floor(t * 3) % 2) { rr(mx + 1, my - 6, 3, 1, '#ffe070'); rr(mx + 12, my - 6, 3, 1, '#ffe070'); rr(mx + 1, my - 6, 1, 3, '#ffe070'); rr(mx + 14, my - 6, 1, 3, '#ffe070'); }
      sparkle(16 * TS + 12, 4 * TS - 2, t, 1);
    } else if (id === 'crypt') {
      trail([[3, 7], [5, 7], [7, 7], [9, 7], [11, 7], [13, 7], [15, 7]]);
      trail([[9, 3], [9, 5], [9, 9], [9, 11]]);
      ghost(c, 5 * TS, 7 * TS, t); ghost(c, 9 * TS, 10 * TS, t + 1.3);
      boneBit(14 * TS, 8 * TS, t);
      sparkle(7 * TS + 12, 2 * TS + 3, t, 2); sparkle(14 * TS + 4, 5 * TS + 3, t, 4);
    } else if (id === 'vault') {
      guardian(9 * TS + 8, 2 * TS - 12, t);
    } else if (id === 'belltower') {
      for (const [bx, by, f] of [[3, 3, 0], [15, 5, 1], [11, 11, 0]]) {
        const x = bx * TS, y = by * TS, up = Math.floor(t * 4 + f) % 2;
        blob([[x + 4, y + 7, 8, 5], [x + 10, y + 5, 4, 4]], '#a8a8b8'); rr(x + 12, y + 6, 1, 1, '#1a1a2a'); rr(x + 14, y + 7, 2, 1, '#e8a040');
        rr(x + 5, y + (up ? 4 : 7), 5, 2, '#888898');
      }
      const ring = (t * 1.5) % 1; c.strokeStyle = 'rgba(255,240,180,' + (0.6 - ring * 0.6).toFixed(2) + ')'; c.lineWidth = 1;
      c.beginPath(); c.arc(9 * TS + 8, 3 * TS - 2, 8 + ring * 22, 0, Math.PI * 2); c.stroke();
    }
  };
  // on-screen labels for the new key types, drawn in the HUD layer
  SK.DEV.ui = () => {
    const id = SK.S.room.id;
    if (id === 'crypt') {
      SK.srr(4, 24, 116, 15, '#120e1cdd');
      SK.txt('BONE KEY', 10, 28, '#f0e8d0', 8, 'left', null);
      for (let i = 0; i < 3; i++) { SK.srr(80 + i * 12, 27, 9, 9, '#221c2a'); SK.srr(81 + i * 12, 28, 7, 7, i === 0 ? '#f0e8d0' : '#3a3348'); }
    } else if (id === 'vault') {
      SK.srr(4, 24, 116, 15, '#120e1cdd');
      SK.txt('GUARDIAN', 10, 28, '#d8d0e8', 8, 'left', null);
      for (let i = 0; i < 3; i++) { SK.srr(78 + i * 13, 27, 11, 9, '#221c2a'); SK.srr(79 + i * 13, 28, 9, 7, '#b8b8c4'); }
    }
  };
  window.__mock.show = (id, px, py, dir, kind, say) => {
    SK.S.kind = kind; SK.S.mode = 'play'; SK.S.fade = 0; SK.S.clock = true; SK.S.playTime = 754;
    SK.dlg.active = false;
    SK.prof.room = id === 'archives' ? 'archives' : 'library';
    Object.assign(SK.prof, { x:5, y:8, fx:5, fy:8, dir:'right', gone:false, path:null });
    SK.enterRoom(id, px, py, dir);
    if (say) { SK.openDialog([say], () => {}); SK.dlg.shown = 9999; }
  };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 700, height: 560 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(url);
await page.waitForTimeout(800);
await page.evaluate(setupMocks);

const SHOTS = [
  ['mirrors', 12, 7, 'left', 'girl', 'This mirror points the wrong way! Turn it to bounce the sunbeam into the crystal.'],
  ['crypt', 12, 3, 'down', 'boy', null],
  ['vault', 9, 11, 'up', 'girl', 'STONE GUARDIAN: You took the keys from my chest... Prove you passed ALL SEVEN trials!'],
  ['belltower', 9, 4, 'up', 'boy', 'BONG! Far below, someone yelps "Yikes!"... It came from the KITCHEN. That must be Professor Quill!'],
  ['archives', 6, 3, 'up', 'girl', 'One bookcase has slid aside... a secret passage straight into the Library!'],
];
for (const [id, x, y, dir, kind, say] of SHOTS) {
  await page.evaluate(([id, x, y, dir, kind, say]) => window.__mock.show(id, x, y, dir, kind, say), [id, x, y, dir, kind, say]);
  await page.waitForTimeout(500);
  await page.locator('#screen').screenshot({ path: join(out, id + '.png') });
  console.log('wrote', join(out, id + '.png'));
}
if (errors.length) { console.log('page errors:', errors.join(' | ')); process.exitCode = 1; }
await browser.close();
