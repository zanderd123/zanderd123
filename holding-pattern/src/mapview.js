// The network map: every site, the airports you own, and the routes between
// them. Owned airports are linked by arcs with traffic moving along them.

import { SITES, UNLOCKS } from './config.js';
import { siteStatus } from './game.js';
import { money, num, mulberry32 } from './util.js';

const $ = (id) => document.getElementById(id);

export function renderMapSide(game) {
  let h = '';
  SITES.forEach((s, i) => {
    const st = siteStatus(game, i);
    const ap = st.state === 'owned' ? game.airports[st.index] : null;
    const cur = ap && st.index === game.active;
    let body = '';
    if (ap) {
      body = `<div class="stats-line">L${ap.level} · ${ap.terminals.length} terminals · ${ap.contracts.length} routes · ${money(ap.perMin.net || 0)}/min</div>
      <div class="btns">${cur ? '<span class="tag">You are here</span>' : `<button type="button" class="btn go" data-map-go="${st.index}">Fly there</button>`}${ap.offers.length ? `<span class="tag red">${ap.offers.length} offers</span>` : ''}</div>`;
    } else if (st.state === 'available') {
      body = `<div class="stats-line">Grows ×${s.rev.toFixed(1)} revenue · costs ×${s.cost.toFixed(1)}</div><div class="btns"><button type="button" class="btn go" data-map-buy="${i}" ${game.cash >= st.price ? '' : 'disabled'}>Buy airport <span class="price">${money(st.price)}</span></button></div>`;
    } else if (st.state === 'needsLevel') {
      body = `<div class="stats-line">Unlocks when ${st.from} reaches level ${st.need} · ${money(s.price)}</div>`;
    } else {
      body = `<div class="stats-line">Unlocks after the previous site · ×${s.rev.toFixed(1)} revenue</div>`;
    }
    h += `<div class="site ${cur ? 'cur' : ''}"><div class="row"><span class="code">${s.id}</span><span>${s.name}</span></div>${body}</div>`;
  });
  $('mapSide').innerHTML = h;
}

let mapT = 0;
export function drawMap(game, dt) {
  const cv = $('mapCanvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  mapT += dt;

  // sea and land
  g.fillStyle = '#1b3a4f';
  g.fillRect(0, 0, w, h);
  const R = mulberry32(42);
  g.fillStyle = '#2d4a3a';
  const blobs = [[0.25, 0.45, 0.32], [0.5, 0.25, 0.25], [0.15, 0.75, 0.2], [0.6, 0.55, 0.22], [0.82, 0.3, 0.2], [0.8, 0.72, 0.16], [0.42, 0.62, 0.18]];
  for (const [bx, by, br] of blobs) {
    for (let k = 0; k < 9; k++) {
      const a = R() * Math.PI * 2, d = R() * br * 0.5;
      g.beginPath();
      g.ellipse((bx + Math.cos(a) * d) * w, (by + Math.sin(a) * d) * h, br * w * (0.35 + R() * 0.3), br * h * (0.3 + R() * 0.3), R() * 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  // graticule
  g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 1;
  for (let x = 0; x < w; x += 60) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  for (let y = 0; y < h; y += 60) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }

  const pos = (i) => ({ x: SITES[i].x * w, y: SITES[i].y * h });
  const owned = game.airports.map((a) => a.siteIndex);

  // routes between owned airports
  for (let a = 0; a < owned.length; a++) {
    for (let b = a + 1; b < owned.length; b++) {
      const p = pos(owned[a]), q = pos(owned[b]);
      const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2 - Math.hypot(q.x - p.x, q.y - p.y) * 0.2;
      g.strokeStyle = 'rgba(255,194,14,0.55)'; g.lineWidth = 1.6; g.setLineDash([6, 5]);
      g.beginPath(); g.moveTo(p.x, p.y); g.quadraticCurveTo(mx, my, q.x, q.y); g.stroke(); g.setLineDash([]);
      for (let k = 0; k < 2; k++) {
        let s = ((mapT / 9 + k * 0.5 + a * 0.13 + b * 0.07) % 1);
        if (k) s = 1 - s;
        const x = (1 - s) * (1 - s) * p.x + 2 * (1 - s) * s * mx + s * s * q.x;
        const y = (1 - s) * (1 - s) * p.y + 2 * (1 - s) * s * my + s * s * q.y;
        const dx = 2 * (1 - s) * (mx - p.x) + 2 * s * (q.x - mx), dy = 2 * (1 - s) * (my - p.y) + 2 * s * (q.y - my);
        g.save(); g.translate(x, y); g.rotate(Math.atan2(dy, dx) + (k ? Math.PI : 0));
        g.fillStyle = '#fff';
        g.beginPath(); g.moveTo(6, 0); g.lineTo(-4, -4); g.lineTo(-2, 0); g.lineTo(-4, 4); g.closePath(); g.fill();
        g.restore();
      }
    }
  }

  // sites
  SITES.forEach((s, i) => {
    const p = pos(i);
    const st = siteStatus(game, i);
    const isOwned = st.state === 'owned';
    const cur = isOwned && st.index === game.active;
    g.fillStyle = isOwned ? '#ffc20e' : st.state === 'available' ? '#ece8dc' : 'rgba(236,232,220,0.35)';
    g.beginPath(); g.arc(p.x, p.y, isOwned ? 8 : 6, 0, Math.PI * 2); g.fill();
    if (cur) { g.strokeStyle = '#ffc20e'; g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y, 13 + Math.sin(mapT * 3) * 2, 0, Math.PI * 2); g.stroke(); }
    g.font = '700 14px "Barlow Condensed", "Arial Narrow", sans-serif';
    const label = s.id;
    const tw = g.measureText(label).width + 10;
    g.fillStyle = isOwned ? '#111316' : 'rgba(17,19,22,0.7)';
    g.fillRect(p.x + 12, p.y - 10, tw, 20);
    g.fillStyle = isOwned ? '#ffc20e' : '#9a9d96';
    g.textBaseline = 'middle';
    g.fillText(label, p.x + 17, p.y + 0.5);
    if (isOwned) {
      const ap = game.airports[st.index];
      g.font = '500 11px "IBM Plex Mono", monospace';
      g.fillStyle = '#ece8dc';
      g.fillText(`L${ap.level} · ${num(ap.paxServed)} pax`, p.x + 12, p.y + 20);
    } else if (st.state === 'available') {
      g.font = '500 11px "IBM Plex Mono", monospace';
      g.fillStyle = '#ffc20e';
      g.fillText(`for sale ${money(s.price)}`, p.x + 12, p.y + 20);
    }
  });
}

export function siteAt(game, mx, my) {
  const cv = $('mapCanvas');
  const w = cv.clientWidth, h = cv.clientHeight;
  for (let i = 0; i < SITES.length; i++) {
    if (Math.hypot(SITES[i].x * w - mx, SITES[i].y * h - my) < 18) return i;
  }
  return -1;
}

export { UNLOCKS };
