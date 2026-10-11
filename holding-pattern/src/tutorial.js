// First-play walkthrough: a short sequence of steps, each pointing at one
// part of the screen. Some wait for the player to do the thing; the rest
// have a Next button. It can be skipped and replayed from Help.

import { activeAirport } from './game.js';

const STEPS = [
  {
    target: null,
    text: '<b>Welcome to Pinewood Regional.</b> You run the airport: airlines bring the planes and passengers, and you make sure there is room for them. This takes a minute.',
  },
  {
    target: '#field',
    text: 'Planes land on the runway, follow the one-way taxiways (yellow arrows) to a gate, turn around and take off again. <b>Blue dots</b> are departing passengers, <b>orange</b> are arriving. Drag to pan; scroll or pinch to zoom.',
  },
  {
    target: '#tabs [data-tab="contracts"]',
    tab: 'contracts',
    text: 'Airlines offer <b>routes</b> here. Signing one brings more flights, and more money. <b>Sign one now.</b>',
    count: (g) => activeAirport(g).contracts.length,
    waitFor: (g, base) => activeAirport(g).contracts.length > base,
    waitLabel: 'Waiting for you to sign a route…',
  },
  {
    target: '#panelBody',
    tab: 'contracts',
    text: 'Every offer shows how it would load your runway, gates, security and connectors. <b>Green</b> is fine, <b>orange</b> is tight, <b>red</b> is over capacity. Signing into the red makes every flight late and passengers miss them.',
  },
  {
    target: '#ops',
    text: 'The <b>ops board</b> is your airport at a glance. A red dot means something is over capacity. Tap any row for the details.',
  },
  {
    target: '#tabs [data-tab="advisor"]',
    tab: 'advisor',
    text: 'Not sure what to fix? The <b>Advisor</b> finds the real bottleneck, explains it, and puts the cheapest fix one click away. Its <b>Best next step</b> is always a safe buy.',
  },
  {
    target: '.stats',
    text: 'Money runs <b>per second</b>. Every terminal, security lane and controller costs money every second, flights or not. If your net goes red, the Advisor shows why.',
  },
  {
    target: '#tabs [data-tab="help"]',
    text: 'When gates fill up, click a dashed <b>+ Build terminal</b> site on the map. <b>Help</b> explains how everything connects. Good luck!',
    last: true,
  },
];

export function makeTutorial(game, hooks) {
  const box = document.getElementById('tut');
  const ring = document.getElementById('tutRing');
  const state = { step: -1 };

  function show(i) {
    state.step = i;
    const s = STEPS[i];
    if (!s) { stop(true); return; }
    if (s.tab) hooks.openTab(s.tab);
    state.base = s.count ? s.count(game) : 0;
    box.innerHTML = `<div class="tut-count">${i + 1} / ${STEPS.length}</div><p>${s.text}</p>
      <div class="btns">${s.waitFor ? `<span class="tut-wait">${s.waitLabel}</span>` : `<button type="button" class="btn go" data-tut="next">${s.last ? 'Start playing' : 'Next'}</button>`}
      <button type="button" class="btn" data-tut="skip">${s.last ? 'Close' : 'Skip tutorial'}</button></div>`;
    box.hidden = false;
    place();
  }

  function place() {
    const s = STEPS[state.step];
    if (!s) return;
    const el = s.target && document.querySelector(s.target);
    const vw = window.innerWidth, vh = window.innerHeight;
    if (!el || s.target === '#field') {
      ring.hidden = true;
      box.style.left = `${Math.max(16, (vw - box.offsetWidth) / 2 - (vw > 860 ? 200 : 0))}px`;
      box.style.top = `${Math.max(80, vh * 0.32)}px`;
      return;
    }
    const r = el.getBoundingClientRect();
    ring.hidden = false;
    Object.assign(ring.style, { left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` });
    // Put the bubble beside the target, on whichever side has room.
    const bw = box.offsetWidth, bh = box.offsetHeight;
    let x = r.left - bw - 16, y = r.top;
    if (x < 16) x = Math.min(vw - bw - 16, r.right + 16);
    if (x + bw > vw - 16 || (r.width > vw * 0.6)) { x = Math.max(16, Math.min(vw - bw - 16, r.left)); y = r.bottom + 12; }
    if (y + bh > vh - 16) y = Math.max(16, r.top - bh - 12);
    box.style.left = `${Math.max(16, x)}px`;
    box.style.top = `${Math.max(16, y)}px`;
  }

  function stop(finished) {
    state.step = -1;
    box.hidden = true;
    ring.hidden = true;
    game.tutorialDone = true;
    if (finished) hooks.onDone();
  }

  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tut]');
    if (!b) return;
    if (b.dataset.tut === 'next') show(state.step + 1);
    else stop(false);
  });

  return {
    start() { game.tutorialDone = false; show(0); },
    active() { return state.step >= 0; },
    tick() {
      const s = STEPS[state.step];
      if (!s) return;
      if (s.waitFor && s.waitFor(game, state.base)) { show(state.step + 1); return; }
      place();
    },
    setGame(g) { game = g; },
  };
}
