// Boot, the frame loop, input and the action dispatcher.

import { newGame, activeAirport, stepGame, save, load, wipe, exportCode, importCode, offlineEarnings, buySite, serialize, deserialize } from './game.js';
import * as S from './sim.js';
import { makeCamera, fitCamera, screenToWorld, render, attach, pick, dayPhase } from './render.js';
import { ui, renderTop, renderOps, renderPanel, toast, showDialog } from './ui.js';
import { makeTutorial } from './tutorial.js';
import { renderMapSide, drawMap, siteAt } from './mapview.js';
import { money, duration, clamp } from './util.js';
import { SITES } from './config.js';

const $ = (id) => document.getElementById(id);
const canvas = $('field');
const ctx = canvas.getContext('2d');
const cam = makeCamera();
const view = { hover: null, selected: null, dt: 0 };
let game;
let tut = null;
let W = 0, H = 0, DPR = 1;

// ------------------------------------------------------------------ boot

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
  const narrow = window.innerWidth <= 860;
  fitCamera(cam, W, H, { x0: 0, x1: W - panelWidth(), y0: topHeight(), y1: narrow ? H * 0.54 : H });
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
    showDialog(`<h2>Holding Pattern</h2>
      <p>You run Pinewood Regional: one runway, one small terminal, one airline. Sign airline routes to grow, and keep planes and passengers moving.</p>
      <ul>
        <li>Planes and passengers arrive on their own. Every terminal, lane and controller costs money every second.</li>
        <li>Overbook the airport and planes circle, passengers miss flights, and airlines walk away.</li>
        <li>There is no restart: grow big enough and the network map opens your next airport.</li>
      </ul>
      <div class="legend"><span><i style="background:#1f6fd1"></i>departing passengers</span><span><i style="background:#e0861c"></i>arriving passengers</span></div>
      <div class="btns"><button type="button" class="btn go" data-close="dialog" data-start-tut>Show me how (1 minute)</button><button type="button" class="btn" data-close="dialog">I'll figure it out</button></div>`);
  }
  tut = makeTutorial(game, {
    openTab(tab) { ui.tab = tab; ui.detail = null; openPanel(); renderPanel(true); },
    onDone() { toast('Tutorial done. Help has the rest.', 'good'); },
  });
  renderPanel(true);
  last = performance.now();
  requestAnimationFrame(frame);
  setInterval(() => save(game), 5000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(game); });
  window.addEventListener('pagehide', () => save(game));
  window.__hp = { game: () => game, cam, sim: S };
  if (window.claude && window.claude.hot && window.claude.hot.snapshot) {
    window.claude.hot.snapshot(() => ({ save: serialize(game) }));
  }
}

function panelWidth() { return window.innerWidth > 860 ? 400 : 0; }
function topHeight() { return $('topbar').offsetHeight; }

function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = canvas.clientWidth; H = canvas.clientHeight;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  document.documentElement.style.setProperty('--top', `${topHeight()}px`);
}
window.addEventListener('resize', resize);

// ------------------------------------------------------------------ loop

let last = 0, uiAcc = 0, hidden = false;
function frame(now) {
  let dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (hidden) dt = 0;
  const simDt = dt * game.speed;
  // fixed-ish substeps keep fast speeds stable
  const n = Math.max(1, Math.ceil(simDt / 0.05));
  const ap = activeAirport(game);
  for (let i = 0; i < n; i++) stepGame(game, simDt / n, ap);

  view.dt = simDt;
  render(ctx, W, H, DPR, cam, ap, view);

  if (!$('mapModal').hidden) drawMap(game, dt);

  uiAcc += dt;
  if (uiAcc > 0.5) {
    uiAcc = 0;
    renderTop(game);
    const ph = dayPhase(ap.t).ph;
    const mins = Math.floor(((ph * 24 + 6) % 24) * 60); // darkest at midnight
    renderOps(game, `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`);
    renderPanel();
    if (tut && tut.active()) tut.tick();
    if (!$('mapModal').hidden) renderMapSide(game);
    drainEvents();
  }
  requestAnimationFrame(frame);
}

// Catch up when the tab comes back: simulate the first half minute so the
// field picks up where it was, and pay the rest at the offline rate.
// Simulating the whole gap froze the page for seconds on big networks.
const CATCH_UP = 30;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hidden = true; hiddenAt = Date.now(); return; }
  hidden = false;
  const away = (Date.now() - hiddenAt) / 1000 * game.speed;
  const sim = Math.min(CATCH_UP, away);
  for (let t = 0; t < sim; t += 0.05) stepGame(game, 0.05);
  if (away > CATCH_UP + 30) {
    const off = offlineEarnings(game, away - sim);
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
  view.hover = hit && (hit.kind === 'slot' || hit.kind === 'plot') ? hit : null;
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
  cam.x = clamp(cam.x, -100, 2100);
  cam.y = clamp(cam.y, -100, 1250);
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
body.addEventListener('pointerdown', () => { ui.holding = true; });
window.addEventListener('pointerup', () => { setTimeout(() => { ui.holding = false; }, 50); });

body.addEventListener('change', (e) => {
  const ap = activeAirport(game);
  const el = e.target;
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
  const ap = activeAirport(game);
  const d = b.dataset;
  let err = null, ok = null;
  switch (d.act) {
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
    case 'wipe': wipe(); replaceGame(newGame()); ui.armed = null; ok = 'New game'; break;
  }
  if (err) toast(err, 'bad'); else if (ok) toast(ok, 'good');
  renderTop(game);
  renderPanel(true);
});

function replaceGame(g) {
  game = g;
  if (tut) tut.setGame(g);
  ui.game = g;
  ui.detail = null;
  ui.importOpen = false;
  ui.exported = null;
  view.selected = null;
  attach(activeAirport(game));
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
    else { toast(`${SITES[i].name} is yours`, 'good'); switchTo(game.airports.length - 1); }
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
