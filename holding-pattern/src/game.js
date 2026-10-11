// The company: one wallet, every airport you own, and the world map that
// links them. There is no restart. Progress means opening the next airport.

import { SITES, START, UNLOCKS, OFFLINE } from './config.js';
import { createAirport, step, serializeAirport, restoreAirport } from './sim.js';

const SAVE_KEY = 'holding-pattern-save-v1';

export function newGame() {
  const game = {
    cash: START.cash,
    airports: [createAirport(0)],
    active: 0,
    speed: 1,
    started: Date.now(),
    tutorial: 0,
  };
  return game;
}

export function activeAirport(game) { return game.airports[game.active]; }

// The airport on screen steps every frame so it animates smoothly; the
// others step in fixed 0.05s chunks, which is all their numbers need.
const BG_STEP = 0.05;
export function stepGame(game, dt, onScreen = null) {
  for (const ap of game.airports) {
    if (!onScreen || ap === onScreen) { step(game, ap, dt); continue; }
    ap.lag = (ap.lag || 0) + dt;
    while (ap.lag >= BG_STEP) { step(game, ap, BG_STEP); ap.lag -= BG_STEP; }
  }
  // Safety net: if a bug ever turns the balance into NaN, nothing could be
  // bought again and the broken number would be saved. Put back the last
  // good balance instead.
  if (Number.isFinite(game.cash)) game.goodCash = game.cash;
  else {
    console.warn('cash became', game.cash, '- restoring', game.goodCash);
    game.cash = Number.isFinite(game.goodCash) ? game.goodCash : START.cash;
  }
}

// Saves written while the balance was NaN stored it as null. Give back a
// fair estimate: a tenth of everything the airports have earned, and never
// less than a new game starts with.
function recoverCash(data) {
  if (Number.isFinite(data.cash)) return data.cash;
  const earned = data.airports.reduce((s, a) => s + ((a.lifetime && a.lifetime.revenue) || 0), 0);
  return Math.max(START.cash, Math.round(earned * 0.1));
}

// ---------------------------------------------------------------- the map

export function nextSite(game) {
  const owned = new Set(game.airports.map((a) => a.siteIndex));
  for (let i = 0; i < SITES.length; i++) if (!owned.has(i)) return i;
  return -1;
}

export function siteStatus(game, i) {
  const owned = game.airports.findIndex((a) => a.siteIndex === i);
  if (owned >= 0) return { state: 'owned', index: owned };
  const next = nextSite(game);
  if (i !== next) return { state: 'locked' };
  const newest = game.airports[game.airports.length - 1];
  if (newest.level < UNLOCKS.nextAirport) {
    return { state: 'needsLevel', need: UNLOCKS.nextAirport, from: newest.name };
  }
  return { state: 'available', price: SITES[i].price };
}

export function buySite(game, i) {
  const st = siteStatus(game, i);
  if (st.state !== 'available') return 'Not available yet';
  if (game.cash < st.price) return 'Not enough cash';
  game.cash -= st.price;
  game.airports.push(createAirport(i));
  game.active = game.airports.length - 1;
  return null;
}

// ---------------------------------------------------------------- saving

export function serialize(game) {
  return {
    v: 1,
    cash: game.cash,
    active: game.active,
    speed: game.speed,
    started: game.started,
    tutorial: game.tutorial,
    tutorialDone: !!game.tutorialDone,
    savedAt: Date.now(),
    airports: game.airports.map(serializeAirport),
  };
}

export function deserialize(data) {
  return {
    cash: recoverCash(data),
    cashRecovered: !Number.isFinite(data.cash),
    active: Math.min(data.active || 0, data.airports.length - 1),
    speed: data.speed || 1,
    started: data.started || Date.now(),
    tutorial: data.tutorial || 0,
    tutorialDone: !!data.tutorialDone,
    airports: data.airports.map(restoreAirport),
    savedAt: data.savedAt,
  };
}

export function save(game) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(serialize(game)));
    return true;
  } catch { return false; }
}

export function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return deserialize(JSON.parse(raw));
  } catch { return null; }
}

export function wipe() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* storage unavailable */ }
}

export function exportCode(game) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(serialize(game)))));
}

export function importCode(code) {
  return deserialize(JSON.parse(decodeURIComponent(escape(atob(code.trim())))));
}

// Idle earnings while the page was closed: each airport's net rate over its
// last minute, at reduced efficiency, capped. Losses are not carried over.
export function offlineEarnings(game, seconds) {
  const s = Math.min(seconds, OFFLINE.maxSeconds);
  let total = 0;
  for (const ap of game.airports) {
    // Bonuses are one-off, so they don't keep paying while you're away.
    const net = (ap.perMin && (ap.perMin.operating ?? ap.perMin.net)) || 0;
    total += Math.max(0, net) / 60 * s * OFFLINE.efficiency;
  }
  return { seconds: s, total };
}
