// Boot, the frame loop, input and the action dispatcher.

import { newGame, activeAirport, stepGame, save, load, wipe, exportCode, importCode, offlineEarnings, buySite, serialize, deserialize, loadFailed } from './game.js';
import * as S from './sim.js';
import { makeCamera, fitCamera, screenToWorld, render, attach, pick, dayPhase, worldSize } from './render.js';
import { ui, renderTop, renderOps, renderPanel, toast, showDialog } from './ui.js';
import { makeTutorial } from './tutorial.js';
import { acceptAlliance, declineAlliance } from './network.js';
import { checkMilestones } from './milestones.js';
import { renderMapSide, drawMap, siteAt } from './mapview.js';
import { money, duration, clamp } from './util.js';
import { SITES } from './config.js';
import { ISLAND_FOCUS } from './island.js';

const $ = (id) => document.getElementById(id);
const canvas = $('field');
const ctx = canvas.getContext('2d');
const cam = makeCamera();
const view = { hover: null, selected: null, dt: 0 };
let game;
let tut = null;
let W = 0, H = 0, DPR = 1;

// ------------------------------------------------------------------ boot

// The web fonts load without holding up the first paint (see index.html).
for (const l of document.querySelectorAll('link[data-font]')) l.media = 'all';

function start(hotData) {
  let restored = null;
  if (hotData && hotData.save) {
    try { restored = deserialize(hotData.save); } catch { restored = null; }
  }
  const fromStorage = restored ? null : load();
  game = restored || fromStorage || newGame();
  ui.game = game;
  attach(activeAirport(game));
  resize();
  fitView();
  setSpeed(game.speed || 1);

  if (fromStorage && fromStorage.savedAt) {
    const away = (Date.now() - fromStorage.savedAt) / 1000;
    if (away > 60) {
      const off = offlineEarnings(game, away);
      if (off.total > 0) {
        game.cash += off.total;
        showDialog(`<h2>Welcome back</h2><p>You were away ${duration(away)}. Your ${game.airports.length > 1 ? `${game.airports.length} airports` : 'airport'} kept flying and earned <b class="pos">${money(off.total)}</b>${away > off.seconds ? ` (counted up to ${duration(off.seconds)})` : ''}.</p><div class="btns"><button type="button" class="btn go" data-close="dialog">Back to work</button></div>`);
      }
    }
  } else if (!restored) {
    showIntro(loadFailed());
  }
  tut = makeTutorial(game, {
    openTab(tab) { ui.tab = tab; ui.detail = null; openPanel(); renderPanel(true); },
    onDone() { toast('Tutorial done. Help has the rest.', 'good'); },
  });
  checkMilestones(game); // what an existing save has already earned, quietly
  renderPanel(true);
  if (game.cashRecovered) {
    delete game.cashRecovered;
    toast(`A bug wiped your balance. It has been restored to ${money(game.cash)}.`, 'good');
  }
  last = performance.now();
  requestAnimationFrame(frame);
  setInterval(saveNow, 5000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
  window.addEventListener('pagehide', saveNow);
  window.__hp = { game: () => game, cam, sim: S, switchTo: (i) => switchTo(i), mapRect: () => worldSize(activeAirport(game)), freeRect: () => freeRect(), clampCam: () => clampCam() };
  if (window.claude && window.claude.hot && window.claude.hot.snapshot) {
    window.claude.hot.snapshot(() => ({ save: serialize(game) }));
  }
}

// Saves while the tab is hidden keep the time it was hidden, so closing a
// hidden tab still pays for the time away. Warns once if nothing can be saved.
let saveWarned = false;
function saveNow() {
  if (save(game, hidden ? hiddenAt : 0) || saveWarned) return;
  saveWarned = true;
  toast('This browser is not letting the game save: progress will be lost when the page closes.', 'bad');
}

// How much of the screen's width the panel covers: all of a desktop's
// side panel or a landscape phone's, none of a portrait phone's (it sits
// along the bottom there).
function panelWidth() {
  if (window.innerWidth > 860) return 400;
  const r = $('panel').getBoundingClientRect();
  return r.left > window.innerWidth * 0.3 ? r.width : 0;
}
function topHeight() { return $('topbar').offsetHeight; }

let lastShape = '';
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = canvas.clientWidth; H = canvas.clientHeight;
  // a phone turned on its side, or a window crossing the phone/desktop
  // layout: frame the field again for the new shape
  const shape = `${W > H}${window.innerWidth <= 860}`;
  if (lastShape && shape !== lastShape && game) fitView();
  // on a small screen the open ops board would cover much of the field
  if (shape !== lastShape && window.innerWidth > 860) $('ops').classList.toggle('collapsed', window.innerHeight < 900 || window.innerWidth < 1160);
  lastShape = shape;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  document.documentElement.style.setProperty('--top', `${topHeight()}px`);
}
window.addEventListener('resize', resize);

// ------------------------------------------------------------------ loop

let last = 0, uiAcc = 0, hidden = false;
let frameFailed = false;
// A device that can't simulate a big network at full speed (a phone at 4x
// with every airport grown) runs the game a little slower instead: a slow
// frame would only bring a longer step next time, and the next frame
// would be slower still. It catches back up when there is room.
let simScale = 1, simAvg = 1;
function keepUp(ms) {
  if (ms > 11) simScale = Math.max(0.15, simScale * 0.85);
  else if (ms < 6) simScale = Math.min(1, simScale * 1.04 + 0.005);
  // the amber light follows the average, so it doesn't flicker
  simAvg += (simScale - simAvg) * 0.03;
  const sp = document.querySelector('.speed');
  const was = !!(sp && sp.classList.contains('slowed'));
  const slow = was ? simAvg < 0.95 : simAvg < 0.8;
  if (sp && was !== slow) {
    sp.classList.toggle('slowed', slow);
    sp.title = slow ? 'Running a little slower so this device can keep up' : '';
  }
}
function frame(now) {
  try { frameBody(now); } catch (e) {
    if (!frameFailed) { frameFailed = true; console.error(e); toast('Something went wrong; the game carries on. Reloading the page may help.', 'bad'); }
    last = now;
  }
  requestAnimationFrame(frame);
}
function frameBody(now) {
  let dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (hidden) dt = 0;
  const simDt = dt * game.speed * simScale;
  // fixed-ish substeps keep fast speeds stable
  const n = Math.ceil(simDt / 0.05);
  const ap = activeAirport(game);
  const s0 = performance.now();
  for (let i = 0; i < n; i++) stepGame(game, simDt / n, ap);
  keepUp(performance.now() - s0);

  view.dt = simDt;
  watchGrowth();
  render(ctx, W, H, DPR, cam, ap, view);

  if (!$('mapModal').hidden) drawMap(game, dt);

  uiAcc += dt;
  if (uiAcc > 0.5) {
    uiAcc = 0;
    renderTop(game);
    const ph = dayPhase(ap.t).ph;
    const mins = Math.floor(((ph * 24 + 6) % 24) * 60); // darkest at midnight
    if (!pressIn('ops')) renderOps(game, `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`);
    renderPanel();
    if (tut && tut.active()) tut.tick();
    for (const m of checkMilestones(game)) toast(`Milestone: ${m.name}`, 'good');
    if (game.allianceNews) {
      toast(`${game.allianceNews.name} offers routes at ${game.allianceNews.legs.length} of your airports: see the All tab`, 'good');
      game.allianceNews = null;
    }
    if (!$('mapModal').hidden && !pressIn('mapSide')) renderMapSide(game);
    drainEvents();
  }
}

// Catch up when the tab comes back: simulate the first half minute so the
// field picks up where it was, and pay the rest at the offline rate.
// Simulating the whole gap froze the page for seconds on big networks.
const CATCH_UP = 30;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hidden = true; hiddenAt = Date.now(); return; }
  hidden = false;
  const away = (Date.now() - hiddenAt) / 1000;
  const sim = Math.min(CATCH_UP, away * game.speed);
  // No animations for the skipped time: they would play out for aircraft
  // that have already left.
  const ap = activeAirport(game), fx = ap.fx;
  ap.fx = null;
  for (let t = 0; t < sim; t += 0.05) stepGame(game, 0.05);
  ap.fx = fx;
  if (away > CATCH_UP + 30) {
    const off = offlineEarnings(game, away - sim / game.speed);
    if (off.total > 0) { game.cash += off.total; toast(`While you were away: +${money(off.total)}`, 'good'); }
  }
  last = performance.now();
});
let hiddenAt = Date.now();

const seenEvents = new WeakMap();
function drainEvents() {
  for (const ap of game.airports) {
    const from = seenEvents.get(ap) || 0;
    const evs = ap.events;
    const active = ap === activeAirport(game);
    for (const e of evs) {
      if (e.t <= from) continue;
      if (active) {
        const kind = e.kind === 'level' || e.kind === 'built' ? 'good' : ['left', 'unhappy', 'storm', 'breakdown', 'missed'].includes(e.kind) ? 'bad' : '';
        if (e.kind !== 'offer' || !(ui.tab === 'contracts' && !ui.detail)) toast(e.text, kind);
      } else if (e.kind === 'level' || e.kind === 'left') {
        toast(`${ap.id}: ${e.text}`, e.kind === 'left' ? 'bad' : 'good');
      }
    }
    if (evs.length) seenEvents.set(ap, evs[evs.length - 1].t);
  }
}

// ------------------------------------------------------------------ input

const pointers = new Map();
let drag = null, pinch = null;

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false };
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: cam.zoom };
    drag = null;
  }
});

canvas.addEventListener('pointermove', (e) => {
  const rect = canvas.getBoundingClientRect();
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    zoomAt((a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top, pinch.zoom * d / pinch.d / cam.zoom);
    return;
  }
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
    if (drag.moved) {
      cam.x = drag.cx - dx / cam.zoom;
      cam.y = drag.cy - dy / cam.zoom;
      clampCam();
      canvas.classList.add('dragging');
    }
    return;
  }
  const w = screenToWorld(cam, W, H, e.clientX - rect.left, e.clientY - rect.top);
  const hit = pick(activeAirport(game), w.x, w.y);
  view.hover = hit && (hit.kind === 'slot' || hit.kind === 'plot' || hit.kind === 'parking' || hit.kind === 'runway') ? hit : null;
  canvas.classList.toggle('pointing', !!hit);
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  canvas.classList.remove('dragging');
  if (pointers.size < 2) pinch = null;
  if (drag && !drag.moved && e.type === 'pointerup') {
    const rect = canvas.getBoundingClientRect();
    const w = screenToWorld(cam, W, H, e.clientX - rect.left, e.clientY - rect.top);
    select(pick(activeAirport(game), w.x, w.y));
  }
  drag = null;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });

function zoomAt(sx, sy, factor) {
  const before = screenToWorld(cam, W, H, sx, sy);
  cam.zoom = clamp(cam.zoom * factor, cam.minZoom, cam.maxZoom);
  const after = screenToWorld(cam, W, H, sx, sy);
  cam.x += before.x - after.x;
  cam.y += before.y - after.y;
  clampCam();
}

function clampCam() {
  const M = worldSize(activeAirport(game)), F = freeRect();
  // The camera centres the screen, the map sits in the part the panels leave
  // free: clamp that part's centre. A map smaller than the view stays centred
  // in it; a bigger one drags until its edge (and a strip of sea) meets the
  // view's edge, so it can never be pushed off screen.
  const ox = (W / 2 - (F.x0 + F.x1) / 2) / cam.zoom, oy = (H / 2 - (F.y0 + F.y1) / 2) / cam.zoom;
  const hw = (F.x1 - F.x0) / 2 / cam.zoom, hh = (F.y1 - F.y0) / 2 / cam.zoom, pad = 80;
  const fit = (c, lo, len, half) => len + 2 * pad <= 2 * half ? lo + len / 2 : clamp(c, lo - pad + half, lo + len + pad - half);
  cam.x = fit(cam.x - ox, M.x0, M.w, hw) + ox;
  cam.y = fit(cam.y - oy, M.y0, M.h, hh) + oy;
}

function select(hit) {
  view.selected = null;
  if (!hit) { return; }
  if (hit.kind === 'plane') { view.selected = hit.plane; ui.detail = { kind: 'plane', plane: hit.plane }; }
  else ui.detail = { kind: hit.kind, id: hit.id };
  openPanel();
  renderPanel(true);
}

function openPanel() { $('panel').classList.remove('min'); }

// ------------------------------------------------------------------ panel actions

$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  if (window.innerWidth <= 860 && ui.tab === b.dataset.tab && !ui.detail) {
    $('panel').classList.toggle('min');
  } else openPanel();
  ui.tab = b.dataset.tab;
  ui.detail = null;
  view.selected = null;
  $('panelBody').scrollTop = 0;
  renderPanel(true);
});

const body = $('panelBody');
// While a finger or button is down on a panel, it isn't redrawn under it
// (a redraw mid-press loses the click). A touch scroll ends in
// pointercancel, not pointerup.
let pressed = null;
const pressIn = (id) => !!(pressed && pressed.closest('#' + id));
body.addEventListener('pointerdown', () => { ui.holding = true; });
window.addEventListener('pointerdown', (e) => { pressed = e.target instanceof Element ? e.target : null; }, true);
for (const ev of ['pointerup', 'pointercancel']) window.addEventListener(ev, () => { setTimeout(() => { ui.holding = false; pressed = null; }, 50); });

body.addEventListener('change', (e) => {
  const ap = activeAirport(game);
  const el = e.target;
  // only the drop-downs act on change; a text box keeps what was typed
  if (el.tagName !== 'SELECT') return;
  if (el.dataset.offerSlot) { ui.offerSlot = ui.offerSlot || {}; ui.offerSlot[el.dataset.offerSlot] = el.value; }
  if (el.dataset.contractSlot) {
    const err = S.reassignContract(ap, el.dataset.contractSlot, el.value);
    if (err) toast(err, 'bad'); else toast('Route moved', 'good');
  }
  el.blur();
  renderPanel(true);
});

body.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  if (b.tagName === 'A') e.preventDefault();
  const d = b.dataset;
  // buttons on the network tab act on their own airport
  const ap = d.ap != null && game.airports[Number(d.ap)] ? game.airports[Number(d.ap)] : activeAirport(game);
  let err = null, ok = null;
  // a fix that opens a tab or a detail view is about that airport: go there
  if (d.ap != null && ap !== activeAirport(game) && (d.act === 'tab' || d.act === 'detail')) switchTo(Number(d.ap));
  switch (d.act) {
    case 'goto': ui.tab = 'advisor'; switchTo(Number(d.ap)); return;
    case 'alliance-accept': err = acceptAlliance(game, d.id); ui.armed = null; ok = 'Alliance signed: routes added at every airport in the package'; break;
    case 'alliance-decline': declineAlliance(game, d.id); break;
    case 'manager': S.setManager(ap, d.on === '1'); ok = d.on === '1' ? `Station manager hired at ${ap.id}` : `Station manager let go at ${ap.id}`; break;
    case 'accept': err = S.acceptOffer(game, ap, d.id, d.slot); ok = 'Contract signed'; break;
    case 'decline': S.declineOffer(ap, d.id); break;
    case 'arm': ui.armed = d.key; ui.armedUntil = performance.now() + 4000; break;
    case 'cancel': S.cancelContract(game, ap, d.id); ui.armed = null; ok = 'Contract ended'; break;
    case 'detail': ui.detail = { kind: d.kind, id: d.id }; body.scrollTop = 0; break;
    case 'tab': ui.tab = d.tab; ui.detail = null; body.scrollTop = 0; break;
    case 'tutorial': tut.start(); break;
    case 'back': ui.detail = null; view.selected = null; break;
    case 'plot': err = S.buyPlot(game, ap, d.id); ok = 'Land bought'; break;
    case 'upgrade': err = S.buyUpgrade(game, ap, d.id); ok = 'Built'; break;
    case 'parking': err = S.buildParking(game, ap, d.id); ok = 'Car park open'; break;
    case 'landside': err = S.buildLandside(game, ap, d.id, d.use); ok = 'Built'; break;
    case 'demolish-site': err = S.demolishLandside(game, ap, d.id); ui.armed = null; ok = 'Torn down'; break;
    case 'hangar': err = S.buildHangar(game, ap, d.slot); ok = 'Hangar built'; if (!err) ui.detail = { kind: 'slot', id: d.slot }; break;
    case 'demolish-hangar': err = S.demolishHangar(game, ap, d.slot); ui.armed = null; ok = 'Hangar torn down'; break;
    case 'demolish': err = S.demolishTerminal(game, ap, d.slot); ui.armed = null; ok = 'Closing: routes moved to your other terminals'; break;
    case 'pick-conn': ui.buildChoice[d.slot] = d.type; break;
    case 'pick-reconn': ui.buildChoice['re-' + d.slot] = d.type; break;
    case 'build': err = S.buildTerminal(game, ap, d.slot, d.type); ok = 'Construction started'; if (!err) ui.detail = { kind: 'terminal', id: d.slot }; break;
    case 'reconn': err = S.replaceConnector(game, ap, d.slot, d.type); ok = 'Replacement under way'; break;
    case 'connup': err = S.upgradeConnector(game, ap, d.slot); ok = 'Upgraded'; break;
    case 'bus+': err = S.setBuses(game, ap, d.slot, 1); break;
    case 'bus-': err = S.setBuses(game, ap, d.slot, -1); break;
    case 'gate': err = S.addGate(game, ap, d.slot); ok = 'Gate added'; break;
    case 'heavy': err = S.buyHeavy(game, ap, d.slot); ok = 'Heavy gates ready'; break;
    case 'retail': err = S.buyRetail(game, ap, d.slot); ok = 'New shops open'; break;
    case 'lane+': err = S.addLane(game, ap); ok = 'Lane opened'; break;
    case 'lane-': err = S.removeLane(ap); break;
    case 'staff': S.setStaffing(ap, d.dept, d.level); break;
    case 'export': {
      ui.exported = exportCode(game);
      if (navigator.clipboard) navigator.clipboard.writeText(ui.exported).then(() => toast('Save code copied', 'good')).catch(() => {});
      break;
    }
    case 'import-open': ui.importOpen = !ui.importOpen; break;
    case 'import': {
      try {
        const g = importCode($('importBox').value);
        replaceGame(g);
        ok = 'Save loaded';
      } catch { err = 'That save code could not be read'; }
      break;
    }
    case 'wipe': wipe(); replaceGame(newGame()); ui.armed = null; ui.tab = 'advisor'; ok = 'New game started'; showIntro(); break;
  }
  if (err) toast(err, 'bad'); else if (ok) toast(ok, 'good');
  renderTop(game);
  renderPanel(true);
});

// Fit the camera to the airport on show, in the part of the screen the
// panels leave free (each airport has its own size and zoom limit).
// The island opens on its "Thanks for playing" sign and the fireworks.
// The part of the screen the panels leave free.
function freeRect() {
  const pw = panelWidth(), below = window.innerWidth <= 860 && pw === 0; // panel along the bottom
  // (on a phone the panel along the bottom may be folded down to its tabs)
  return { x0: 0, x1: W - pw, y0: topHeight(), y1: below ? Math.min(H, Math.max(H * 0.5, $('panel').getBoundingClientRect().top)) : H };
}
function fitView() {
  const island = SITES[activeAirport(game).siteIndex].island;
  const F = freeRect(), M = worldSize(activeAirport(game));
  fitCamera(cam, W, H, F, island ? ISLAND_FOCUS : undefined);
  // the zoom-out limit shows the whole map, a grown one included
  cam.minZoom = Math.min((F.x1 - F.x0) / (M.w * 1.05), (F.y1 - F.y0) / (M.h * 1.05));
  cam.zoom = Math.max(cam.zoom, cam.minZoom);
  clampCam();
  lastMap = mapKey();
}
// When the airport on show grows, zoom out over the whole new map.
let lastMap = '';
const mapKey = () => { const M = worldSize(activeAirport(game)); return `${game.active}:${M.x0},${M.y0},${M.w},${M.h}`; };
function watchGrowth() {
  const k = mapKey();
  if (k === lastMap) return;
  const grew = lastMap.split(':')[0] === String(game.active);
  lastMap = k;
  const M = worldSize(activeAirport(game)), F = freeRect();
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0;
  cam.minZoom = Math.min(fw / (M.w * 1.05), fh / (M.h * 1.05));
  if (!grew) return;
  cam.zoom = cam.minZoom;
  cam.x = M.x0 + M.w / 2 + (W / 2 - (F.x0 + F.x1) / 2) / cam.zoom;
  cam.y = M.y0 + M.h / 2 + (H / 2 - (F.y0 + F.y1) / 2) / cam.zoom;
}

// The welcome card, for a first visit and after a reset.
function showIntro(failed = false) {
  showDialog(`<h2>Holding Pattern</h2>${failed ? `
    <p><b>Your saved game could not be read</b>, so a new one has started. A copy of the old save was kept in this browser.</p>` : ''}
    <p>You run Pinewood Regional: one runway, one small terminal, one airline. Sign airline routes to grow, and keep planes and passengers moving.</p>
    <ul>
      <li>Planes and passengers arrive on their own. Every terminal, lane and controller costs money every second.</li>
      <li>Overbook the airport and planes circle, passengers miss flights, and airlines walk away.</li>
      <li>There is no game over: grow big enough and the network map opens your next airport.</li>
    </ul>
    <div class="legend"><span><i style="background:#1f6fd1"></i>departing passengers</span><span><i style="background:#e0861c"></i>arriving passengers</span></div>
    <div class="btns"><button type="button" class="btn go" data-close="dialog" data-start-tut>Show me how (1 minute)</button><button type="button" class="btn" data-close="dialog">I'll figure it out</button></div>`);
}

function replaceGame(g) {
  game = g;
  if (tut) tut.setGame(g);
  ui.game = g;
  ui.detail = null;
  if (g.airports.length < 2 && ui.tab === 'network') ui.tab = 'advisor';
  ui.importOpen = false;
  ui.exported = null;
  view.selected = null;
  attach(activeAirport(game));
  fitView();
  checkMilestones(game);
  setSpeed(g.speed || 1);
  save(game);
}

// ops board rows jump to the relevant place
// the ops board and the "why" button both open the advisor
function openAdvisor() {
  ui.tab = 'advisor';
  ui.detail = null;
  view.selected = null;
  openPanel();
  renderPanel(true);
}
$('opsList').addEventListener('click', (e) => { if (e.target.closest('li[data-ops]')) openAdvisor(); });
$('whyBtn').addEventListener('click', openAdvisor);
$('opsToggle').addEventListener('click', () => {
  if (window.innerWidth <= 860) $('ops').classList.toggle('open');
  else $('ops').classList.toggle('collapsed');
});

// speed
for (const b of document.querySelectorAll('.speed button')) b.addEventListener('click', () => setSpeed(Number(b.dataset.speed)));
function setSpeed(s) {
  game.speed = s;
  for (const b of document.querySelectorAll('.speed button')) b.classList.toggle('on', Number(b.dataset.speed) === s);
}

// hint & dialogs
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-close]');
  if (c) $(c.dataset.close).hidden = true;
  if (e.target.closest('[data-start-tut]')) tut.start();
});
$('dialog').addEventListener('click', (e) => { if (e.target === $('dialog')) $('dialog').hidden = true; });

// ------------------------------------------------------------------ map

function openMap() {
  $('mapModal').hidden = false;
  renderMapSide(game);
}
$('mapBtn').addEventListener('click', openMap);
$('airportBtn').addEventListener('click', openMap);
$('mapModal').addEventListener('click', (e) => {
  if (e.target === $('mapModal')) { $('mapModal').hidden = true; return; }
  const go = e.target.closest('[data-map-go]');
  if (go) { switchTo(Number(go.dataset.mapGo)); return; }
  const buy = e.target.closest('[data-map-buy]');
  if (buy) {
    const i = Number(buy.dataset.mapBuy);
    const err = buySite(game, i);
    if (err) toast(err, 'bad');
    else {
      toast(`${SITES[i].name} is yours`, 'good');
      switchTo(game.airports.length - 1);
      if (SITES[i].island) showDialog(`<h2>You made it</h2><p>Nine airports, from one small regional field to the busiest hub on the map, and now a little island strip of your own. Sunset Cay takes small planes only, has one terminal and one car park, and is here just to enjoy.</p><p>Thanks for playing <b>Holding Pattern</b>! Everything keeps running: there are milestones still to reach, alliances to sign and a hub to fill.</p><div class="btns"><button type="button" class="btn go" data-close="dialog">Keep flying</button></div>`);
    }
  }
});
$('mapCanvas').addEventListener('click', (e) => {
  const r = $('mapCanvas').getBoundingClientRect();
  const i = siteAt(game, e.clientX - r.left, e.clientY - r.top);
  if (i < 0) return;
  const idx = game.airports.findIndex((a) => a.siteIndex === i);
  if (idx >= 0) switchTo(idx);
});

function switchTo(i) {
  if (game.airports[game.active]) game.airports[game.active].fx = null;
  game.active = i;
  attach(activeAirport(game));
  fitView();
  ui.detail = null;
  view.selected = null;
  $('mapModal').hidden = true;
  renderTop(game);
  renderPanel(true);
  save(game);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { $('mapModal').hidden = true; $('dialog').hidden = true; if (ui.detail) { ui.detail = null; view.selected = null; renderPanel(true); } }
});

// ------------------------------------------------------------------ go

const hot = window.claude && window.claude.hot;
if (hot && hot.ready) hot.ready(start); else start(hot && hot.data ? hot.data : {});
