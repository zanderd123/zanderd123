// Top-down drawing of the active airport. The airfield is drawn as a floor
// plan: terminal roofs are left off so you can see the crowds inside.

import { WORLD, AIRCRAFT, CONNECTORS } from './config.js';
import {
  RW, TWY_A, TWY_B, LANE2, RUNWAY_HALF, EXITS, LONG_RUNWAY_X1, HOLD_POINT, IAF,
  TAXILANES, PLOTS, SLOTS, SLOT_ORDER, MAIN_BLDG, MID_BLDG, SERVICE_Y, CURB_Y,
  HIGHWAY_Y, RAMP_IN_X, RAMP_OUT_X, MAIN_STAND_Y, MID_STAND_Y, TERMINAL_CODES,
  slotBuilding, gateStand, lanesFor, connectorRoute,
} from './layout.js';
import { mulberry32, pointAlong, pathLength, clamp, money } from './util.js';
import { FLIGHT } from './config.js';
import { isOpen, terminalBySlot } from './sim.js';

const C = {
  grass: '#7f9f63', grassB: '#86a76a', farmA: '#b5a46b', farmB: '#a7ad6c', farmEdge: '#8a8455',
  asphalt: '#3a3e44', asphaltB: '#43474e', concrete: '#bdbdb5', concreteB: '#b3b3ab',
  paint: '#f3f1ea', yellow: '#f2c230', floor: '#ebe7de', wall: '#2c3037', glass: '#9fc7dc',
  seat: '#c3bdb0', road: '#4b4f56', curb: '#d8d4ca', parkLine: '#e8e6df',
  depart: '#1f6fd1', arrive: '#e0861c', shadow: 'rgba(15,25,10,0.28)',
};

// ------------------------------------------------------------------ camera

export function makeCamera() {
  return { x: WORLD.w / 2, y: WORLD.h / 2 + 40, zoom: 0.5, minZoom: 0.25, maxZoom: 3 };
}

// Open on the working part of the field; zoom out to see the land for sale.
export function fitCamera(cam, w, h) {
  const whole = Math.min(w / (WORLD.w * 0.92), h / (WORLD.h * 0.92));
  cam.minZoom = whole * 0.8;
  cam.zoom = Math.min(w / 1250, h / 820);
  cam.x = 1000;
  cam.y = 500;
}

export function screenToWorld(cam, w, h, sx, sy) {
  return { x: (sx - w / 2) / cam.zoom + cam.x, y: (sy - h / 2) / cam.zoom + cam.y };
}

// ------------------------------------------------------------------ static

let staticCanvas = null, staticKey = '';

function layoutKey(ap, res) {
  return JSON.stringify([ap.siteIndex, ap.plots, ap.terminals.map((T) => [T.slot, T.gates, T.heavy, T.retail, T.buildLeft > 0, T.connector && [T.connector.type, T.connector.level, T.connector.buildLeft > 0]]), ap.securityLanes, ap.upgrades, res]);
}

function drawStatic(ap, res) {
  const cv = staticCanvas || (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas'));
  staticCanvas = cv;
  cv.width = Math.round(WORLD.w * res);
  cv.height = Math.round(WORLD.h * res);
  const g = cv.getContext('2d');
  g.setTransform(res, 0, 0, res, 0, 0);
  const R = mulberry32(7 + ap.siteIndex * 101);

  // grass with mowing stripes
  g.fillStyle = C.grass;
  g.fillRect(0, 0, WORLD.w, WORLD.h);
  g.fillStyle = C.grassB;
  for (let x = -WORLD.h; x < WORLD.w; x += 56) {
    g.beginPath();
    g.moveTo(x, 0); g.lineTo(x + 28, 0); g.lineTo(x + 28 + WORLD.h * 0.5, WORLD.h); g.lineTo(x + WORLD.h * 0.5, WORLD.h);
    g.fill();
  }

  // land we do not own yet is farmland
  for (const [id, P] of Object.entries(PLOTS)) {
    if (ap.plots[id]) continue;
    for (const r of P.rects) {
      g.save();
      g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
      const horizontal = (r.w > r.h);
      g.fillStyle = id.length % 2 ? C.farmA : C.farmB;
      g.fillRect(r.x, r.y, r.w, r.h);
      g.strokeStyle = 'rgba(80,70,30,0.22)';
      g.lineWidth = 3;
      for (let k = 0; k < (horizontal ? r.h : r.w); k += 9) {
        g.beginPath();
        if (horizontal) { g.moveTo(r.x, r.y + k); g.lineTo(r.x + r.w, r.y + k); } else { g.moveTo(r.x + k, r.y); g.lineTo(r.x + k, r.y + r.h); }
        g.stroke();
      }
      g.restore();
      g.strokeStyle = C.farmEdge; g.lineWidth = 2; g.setLineDash([6, 5]);
      g.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      g.setLineDash([]);
    }
  }

  // a few trees on the edges of the map
  for (let i = 0; i < 90; i++) {
    const x = R() * WORLD.w, y = R() < 0.5 ? R() * 22 : 935 + R() * 30;
    if (y > 935 && x > 420 && x < 1580) continue;
    tree(g, x, y, 6 + R() * 6);
  }
  for (let i = 0; i < 40; i++) {
    const x = R() < 0.5 ? R() * 70 : WORLD.w - R() * 70, y = 320 + R() * 600;
    tree(g, x, y, 6 + R() * 6);
  }

  // highway, ramps, curb, service road
  g.fillStyle = C.road;
  g.fillRect(0, HIGHWAY_Y - 13, WORLD.w, 26);
  g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1.5; g.setLineDash([14, 12]);
  g.beginPath(); g.moveTo(0, HIGHWAY_Y); g.lineTo(WORLD.w, HIGHWAY_Y); g.stroke(); g.setLineDash([]);
  g.fillStyle = C.road;
  g.fillRect(RAMP_IN_X - 8, CURB_Y, 16, HIGHWAY_Y - CURB_Y);
  g.fillRect(RAMP_OUT_X - 8, CURB_Y, 16, HIGHWAY_Y - CURB_Y);
  const landX0 = ownedX(ap, 'main', 860), landX1 = ownedX(ap, 'main', 1140, true);
  g.fillStyle = C.curb;
  g.fillRect(landX0, MAIN_BLDG.y1, landX1 - landX0, 6);
  g.fillStyle = '#5b6068';
  g.fillRect(landX0, SERVICE_Y - 6, landX1 - landX0, 11);
  g.fillStyle = C.road;
  g.fillRect(RAMP_IN_X - 8, CURB_Y - 9, RAMP_OUT_X - RAMP_IN_X + 16, 18);
  g.fillStyle = C.curb;
  g.fillRect(RAMP_IN_X + 8, CURB_Y - 13, RAMP_OUT_X - RAMP_IN_X - 16, 3);

  // car park
  parkingLot(g, 878, 778, 244, 150, R);
  if (ap.upgrades.garage1) garage(g, 600, 960, 220, 105, 'P2');
  if (ap.upgrades.garage2) garage(g, 1180, 960, 220, 105, 'P3');
  if (ap.upgrades.rail) railStation(g);
  tower(g, 1166, 905);

  // aprons
  const owned = (x0, x1) => ownedSpan(ap, x0, x1);
  for (const [x0, x1] of owned(100, 1900)) {
    g.fillStyle = C.concrete;
    g.fillRect(x0, LANE2 - 26, x1 - x0, MAIN_BLDG.y0 - (LANE2 - 26));
    g.fillRect(x0, TWY_B - 14, x1 - x0, MID_BLDG.y0 - (TWY_B - 14));
  }
  // taxilanes connecting the two rows
  for (const L of lanesFor(ap.plots)) {
    g.fillStyle = C.concrete;
    g.fillRect(L - 20, TWY_B, 40, LANE2 - TWY_B);
  }
  // concrete joints
  g.strokeStyle = 'rgba(0,0,0,0.06)'; g.lineWidth = 1;
  for (const [x0, x1] of owned(100, 1900)) {
    for (let x = x0; x < x1; x += 24) { g.beginPath(); g.moveTo(x, LANE2 - 26); g.lineTo(x, MAIN_BLDG.y0); g.stroke(); }
  }

  // taxiways A & B and runway exits
  g.fillStyle = C.asphalt;
  g.fillRect(200, TWY_A - 12, 1620, 12 + (TWY_B - TWY_A) + 12);
  g.fillRect(HOLD_POINT.x - 14, RW[0].y, 28, TWY_B - RW[0].y);
  for (const ex of EXITS) {
    g.beginPath();
    g.moveTo(ex - 80, RW[0].y + RUNWAY_HALF); g.lineTo(ex - 30, RW[0].y + RUNWAY_HALF);
    g.lineTo(ex + 14, TWY_A - 12); g.lineTo(ex - 22, TWY_A - 12); g.closePath(); g.fill();
  }
  // north runway taxiway and crossings
  if (ap.upgrades.runway2) {
    g.fillRect(200, RW[1].exitY - 12, 1620, 24);
    for (const ex of EXITS) {
      g.fillRect(ex - 12, RW[1].exitY, 24, TWY_A - RW[1].exitY);
      g.beginPath();
      g.moveTo(ex - 80, RW[1].y + RUNWAY_HALF); g.lineTo(ex - 30, RW[1].y + RUNWAY_HALF);
      g.lineTo(ex + 14, RW[1].exitY - 12); g.lineTo(ex - 22, RW[1].exitY - 12); g.closePath(); g.fill();
    }
  }

  // runways
  runway(g, RW[0], ap.upgrades.longRunway ? LONG_RUNWAY_X1 : RW[0].x1, ap.upgrades.runway2 ? ['09R', '27L'] : ['09', '27']);
  if (ap.upgrades.runway2) runway(g, RW[1], RW[1].x1, ['09L', '27R']);

  // yellow centrelines
  g.strokeStyle = C.yellow; g.lineWidth = 1.6;
  line(g, [[200, TWY_A], [1820, TWY_A]]);
  line(g, [[HOLD_POINT.x, TWY_B], [1820, TWY_B]]);
  line(g, [[HOLD_POINT.x, TWY_B], [HOLD_POINT.x, RW[0].y + 30], [RW[0].x0 + 10, RW[0].y]]);
  for (const ex of EXITS) curveLine(g, ex - 60, RW[0].y, ex, TWY_A);
  if (ap.upgrades.runway2) {
    line(g, [[200, RW[1].exitY], [1820, RW[1].exitY]]);
    for (const ex of EXITS) { curveLine(g, ex - 60, RW[1].y, ex, RW[1].exitY); line(g, [[ex, RW[1].exitY], [ex, RW[0].y - RUNWAY_HALF - 6]]); line(g, [[ex, RW[0].y + RUNWAY_HALF + 6], [ex, TWY_A]]); }
  }
  for (const L of lanesFor(ap.plots)) line(g, [[L, TWY_B], [L, LANE2]]);
  for (const [x0, x1] of owned(100, 1900)) line(g, [[x0, LANE2], [x1, LANE2]]);
  // hold-short bars
  g.strokeStyle = C.yellow; g.lineWidth = 2;
  for (const dy of [0, 4]) line(g, [[HOLD_POINT.x - 14, RW[0].y + RUNWAY_HALF + 10 + dy], [HOLD_POINT.x + 14, RW[0].y + RUNWAY_HALF + 10 + dy]]);

  // terminals and connectors
  for (const T of ap.terminals) {
    if (T.connector && T.connector.buildLeft <= 0) staticConnector(g, T);
  }
  for (const T of ap.terminals) terminal(g, ap, T);
  for (const T of ap.terminals) {
    if (T.connector && T.connector.buildLeft <= 0 && T.connector.type === 'walkway') walkway(g, T);
  }
}

function ownedX(ap, _slot, def, right = false) {
  let v = def;
  for (const id of ['west', 'farwest', 'east', 'fareast']) {
    if (!ap.plots[id]) continue;
    for (const r of PLOTS[id].rects) v = right ? Math.max(v, r.x + r.w - 10) : Math.min(v, r.x + 10);
  }
  return v;
}

function ownedSpan(ap, x0, x1) {
  const spans = [];
  const core = [800, 1200];
  const pieces = [core];
  if (ap.plots.west) pieces.push([430, 800]);
  if (ap.plots.east) pieces.push([1200, 1570]);
  if (ap.plots.farwest) pieces.push([80, 430]);
  if (ap.plots.fareast) pieces.push([1570, 1920]);
  pieces.sort((a, b) => a[0] - b[0]);
  for (const p of pieces) {
    const last = spans[spans.length - 1];
    if (last && Math.abs(last[1] - p[0]) < 1) last[1] = p[1]; else spans.push([p[0], p[1]]);
  }
  return spans.map(([a, b]) => [Math.max(a, x0) + 8, Math.min(b, x1) - 8]);
}

function line(g, pts) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.stroke();
}

function curveLine(g, x0, y0, x1, y1) {
  g.beginPath();
  g.moveTo(x0 - 20, y0);
  g.quadraticCurveTo(x0 + 35, y0, x1, y1);
  g.stroke();
}

function tree(g, x, y, r) {
  g.fillStyle = 'rgba(20,40,15,0.25)';
  g.beginPath(); g.arc(x + r * 0.35, y + r * 0.35, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#4f7a3c';
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#62904a';
  g.beginPath(); g.arc(x - r * 0.3, y - r * 0.3, r * 0.55, 0, Math.PI * 2); g.fill();
}

function runway(g, rw, x1, labels) {
  const y = rw.y, h = RUNWAY_HALF;
  g.fillStyle = 'rgba(0,0,0,0.08)';
  g.fillRect(rw.x0 - 30, y - h - 8, x1 - rw.x0 + 60, 2 * h + 16);
  g.fillStyle = C.asphalt;
  g.fillRect(rw.x0 - 20, y - h, x1 - rw.x0 + 40, 2 * h);
  g.fillStyle = C.asphaltB;
  for (let x = rw.x0; x < x1; x += 140) g.fillRect(x + 40, y - h + 6, 60, 2 * h - 12);
  g.fillStyle = C.paint;
  g.fillRect(rw.x0 - 20, y - h, x1 - rw.x0 + 40, 1.2);
  g.fillRect(rw.x0 - 20, y + h - 1.2, x1 - rw.x0 + 40, 1.2);
  for (let x = rw.x0 + 70; x < x1 - 70; x += 36) g.fillRect(x, y - 0.8, 20, 1.6);
  for (const [tx, dir] of [[rw.x0, 1], [x1, -1]]) {
    for (let k = -3; k <= 3; k++) {
      if (k === 0) continue;
      g.fillRect(tx + (dir > 0 ? 2 : -24), y + k * 4.4 - 1.2, 22, 2.4);
    }
    g.fillRect(tx + dir * 110 - 15, y - 9, 30, 3);
    g.fillRect(tx + dir * 110 - 15, y + 6, 30, 3);
  }
  g.save();
  g.font = '700 13px "Barlow Condensed", "Arial Narrow", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.translate(rw.x0 + 48, y); g.rotate(Math.PI / 2); g.fillText(labels[0], 0, 0); g.restore();
  g.save();
  g.font = '700 13px "Barlow Condensed", "Arial Narrow", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.translate(x1 - 48, y); g.rotate(-Math.PI / 2); g.fillText(labels[1], 0, 0); g.restore();
}

function parkingLot(g, x, y, w, h, R) {
  g.fillStyle = '#585c63';
  g.fillRect(x, y, w, h);
  g.strokeStyle = C.parkLine; g.lineWidth = 0.8;
  const colors = ['#c9473a', '#e8e8e8', '#2b5f9e', '#262626', '#9aa0a6', '#d9b44a', '#3d7a4f'];
  for (let row = 0; row < 4; row++) {
    const ry = y + 8 + row * 36;
    for (let cx = x + 6; cx < x + w - 10; cx += 11) {
      g.beginPath(); g.moveTo(cx, ry); g.lineTo(cx, ry + 14); g.stroke();
      if (R() < 0.62) {
        g.fillStyle = colors[Math.floor(R() * colors.length)];
        g.fillRect(cx + 2, ry + 2, 7, 11);
      }
    }
  }
}

function garage(g, x, y, w, h, label) {
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + 6, y + 6, w, h);
  g.fillStyle = '#9da1a6'; g.fillRect(x, y, w, h);
  g.strokeStyle = '#6c7076'; g.lineWidth = 1;
  for (let k = 8; k < h; k += 12) { g.beginPath(); g.moveTo(x + 6, y + k); g.lineTo(x + w - 6, y + k); g.stroke(); }
  g.fillStyle = '#1f4aa8'; g.fillRect(x + w / 2 - 14, y + h / 2 - 14, 28, 28);
  g.fillStyle = '#fff'; g.font = '700 18px "Barlow Condensed", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, x + w / 2, y + h / 2 + 1);
}

function railStation(g) {
  g.fillStyle = '#6b5a4a'; g.fillRect(0, 1118, WORLD.w, 4);
  g.fillStyle = '#8a7a66'; for (let x = 0; x < WORLD.w; x += 8) g.fillRect(x, 1115, 2, 10);
  g.fillStyle = '#d8d3c8'; g.fillRect(920, 1104, 160, 10);
  g.fillStyle = '#2c3037'; g.fillRect(940, 1106, 120, 6);
}

function tower(g, x, y) {
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.arc(x + 9, y + 9, 15, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#d6d2c8'; g.fillRect(x - 12, y - 12, 24, 24);
  g.fillStyle = '#2b3a46'; g.beginPath(); g.arc(x, y, 13, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#9fc7dc'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 11, -2.4, -0.6); g.stroke();
  g.fillStyle = '#e8e4da'; g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
}

function terminal(g, ap, T) {
  const b = slotBuilding(T.slot);
  const S = SLOTS[T.slot];
  const R = mulberry32(T.slot.length * 977 + b.x);
  if (T.buildLeft > 0) {
    g.fillStyle = '#c9b48a'; g.fillRect(b.x, b.y, b.w, b.h);
    g.strokeStyle = '#7d6a45'; g.lineWidth = 2; g.setLineDash([8, 6]); g.strokeRect(b.x, b.y, b.w, b.h); g.setLineDash([]);
    g.fillStyle = '#9b8862';
    for (let i = 0; i < 6; i++) g.fillRect(b.x + 12 + R() * (b.w - 40), b.y + 10 + R() * (b.h - 30), 18, 12);
    return;
  }
  // shadow and outline
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(b.x + 5, b.y + 5, b.w, b.h);
  g.fillStyle = C.floor; g.fillRect(b.x, b.y, b.w, b.h);
  // floor tiles
  g.strokeStyle = 'rgba(0,0,0,0.035)'; g.lineWidth = 1;
  for (let x = b.x + 10; x < b.x + b.w; x += 10) { g.beginPath(); g.moveTo(x, b.y); g.lineTo(x, b.y + b.h); g.stroke(); }
  // gate lounges with seat rows along the airside face
  for (let i = 0; i < T.gates; i++) {
    const s = gateStand(T.slot, i, T.gates);
    g.fillStyle = C.seat;
    for (let r = 0; r < 3; r++) g.fillRect(s.x - 20, b.y + 8 + r * 6, 40, 2.4);
    // jet bridge
    g.fillStyle = '#7d848c';
    g.fillRect(s.x + 12, b.y - 15, 6, 16);
    g.fillStyle = '#5b6168'; g.fillRect(s.x + 10, b.y - 18, 10, 5);
    // gate number
    g.fillStyle = '#1b1d21'; g.fillRect(s.x - 9, b.y + 2, 18, 9);
    g.fillStyle = '#ffc20e'; g.font = '700 8px "Barlow Condensed", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(`${TERMINAL_CODES[T.slot]}${i + 1}`, s.x, b.y + 6.8);
    // stand markings
    g.strokeStyle = C.yellow; g.lineWidth = 1;
    const sy = S.row === 'main' ? MAIN_STAND_Y : MID_STAND_Y;
    line(g, [[s.x, s.laneY + 6], [s.x, b.y - 2]]);
    line(g, [[s.x - 6, sy + 22], [s.x + 6, sy + 22]]);
    if (T.heavy) { g.strokeStyle = '#d0473a'; line(g, [[s.x - 9, sy + 26], [s.x + 9, sy + 26]]); }
  }
  // shops: more and brighter with retail level
  const shopColors = ['#d9a441', '#c8553d', '#4a8c6f', '#5a6fb5', '#b45a9a', '#e07b39'];
  const nShops = 2 + T.retail * 2;
  const shopY = b.y + b.h * (S.row === 'main' ? 0.42 : 0.55);
  for (let i = 0; i < nShops; i++) {
    const x = b.x + 14 + (i + 0.5) * ((b.w - 28) / nShops) - 9;
    g.fillStyle = shopColors[i % shopColors.length];
    g.fillRect(x, shopY, 18, 10);
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(x + 2, shopY + 2, 14, 2);
  }
  if (T.slot === 'main') {
    // security checkpoint
    const lanes = ap.securityLanes;
    const y = MAIN_BLDG.y1 - 34;
    g.fillStyle = '#d7d1c4'; g.fillRect(b.x + 6, y - 3, b.w - 12, 14);
    const span = Math.min(b.w - 30, lanes * 18);
    for (let i = 0; i < lanes; i++) {
      const x = 1000 - span / 2 + (i + 0.5) * (span / lanes);
      g.fillStyle = '#3d4450'; g.fillRect(x - 5, y - 2, 3, 12); g.fillRect(x + 2, y - 2, 3, 12);
      g.fillStyle = '#4f86c6'; g.fillRect(x - 3, y + 1, 5, 5);
    }
    // check-in counters along the landside wall
    g.fillStyle = '#5a5f68';
    for (let x = b.x + 18; x < b.x + b.w - 18; x += 22) g.fillRect(x, MAIN_BLDG.y1 - 9, 14, 4);
  }
  // walls: thick landside, glass airside
  g.strokeStyle = C.wall; g.lineWidth = 3; g.strokeRect(b.x, b.y, b.w, b.h);
  g.strokeStyle = C.glass; g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(b.x + 3, b.y); g.lineTo(b.x + b.w - 3, b.y); g.stroke();
  // name painted on the floor
  g.fillStyle = 'rgba(40,44,52,0.16)';
  g.font = '700 30px "Barlow Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(TERMINAL_CODES[T.slot], b.x + b.w / 2, b.y + b.h * 0.72);
}

function staticConnector(g, T) {
  const Cn = T.connector;
  const r = Cn.route;
  if (Cn.type === 'tunnel') {
    // Underground: two faint walls, drawn as if seen through the surface.
    const a = r[0], b = r[r.length - 1];
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const nx = -Math.sin(ang) * 5, ny = Math.cos(ang) * 5;
    g.strokeStyle = 'rgba(40,34,30,0.35)'; g.lineWidth = 1.5; g.setLineDash([8, 6]);
    line(g, [[a.x + nx, a.y + ny], [b.x + nx, b.y + ny]]);
    line(g, [[a.x - nx, a.y - ny], [b.x - nx, b.y - ny]]);
    g.setLineDash([]);
    for (const p of [r[0], r[r.length - 1]]) {
      g.fillStyle = '#3a3330'; g.beginPath(); g.arc(p.x, p.y, 8, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffc20e'; g.beginPath(); g.arc(p.x, p.y, 3, 0, Math.PI * 2); g.fill();
    }
  } else if (Cn.type === 'shuttle') {
    g.strokeStyle = '#5b6068'; g.lineWidth = 11;
    line(g, r.map((p) => [p.x, p.y]));
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1; g.setLineDash([6, 6]);
    line(g, r.map((p) => [p.x, p.y])); g.setLineDash([]);
    // zebra where buses cross the apron lane
    for (let i = 1; i < r.length; i++) {
      const a = r[i - 1], b = r[i];
      if (Math.abs(a.x - b.x) < 1 && Math.min(a.y, b.y) < LANE2 && Math.max(a.y, b.y) > LANE2) {
        g.fillStyle = '#f3f1ea';
        for (let k = -2; k <= 2; k++) g.fillRect(a.x - 7, LANE2 + k * 5 - 1.5, 14, 3);
      }
    }
  }
}

function walkway(g, T) {
  const r = T.connector.route;
  const a = r[1], b = r[2];
  const x0 = Math.min(a.x, b.x) - 2, x1 = Math.max(a.x, b.x) + 2;
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x0 + 4, a.y - 9 + 4, x1 - x0, 18);
  g.fillStyle = '#dfe9ee'; g.fillRect(x0, a.y - 9, x1 - x0, 18);
  g.strokeStyle = C.wall; g.lineWidth = 2; g.strokeRect(x0, a.y - 9, x1 - x0, 18);
  if (T.connector.level) {
    g.fillStyle = '#9aa7b1'; g.fillRect(x0 + 2, a.y - 5, x1 - x0 - 4, 3); g.fillRect(x0 + 2, a.y + 2, x1 - x0 - 4, 3);
  }
}

// ------------------------------------------------------------------ planes

export function drawPlaneShape(g, cls, livery, shadow) {
  const A = AIRCRAFT[cls];
  const L = 60 * A.scale;
  const W = L * (cls === 'regional' ? 0.88 : 1.0);
  const fw = L * (cls === 'jumbo' ? 0.15 : cls === 'wide' ? 0.13 : 0.11);
  const body = shadow ? C.shadow : '#f7f8fa';
  const wing = shadow ? C.shadow : '#d9dee4';
  const liv = shadow ? C.shadow : livery;
  // wings
  g.fillStyle = wing;
  g.beginPath();
  g.moveTo(L * 0.16, -fw * 0.4); g.lineTo(-L * 0.1, -W / 2); g.lineTo(-L * 0.2, -W / 2); g.lineTo(-L * 0.12, -fw * 0.4);
  g.lineTo(-L * 0.12, fw * 0.4); g.lineTo(-L * 0.2, W / 2); g.lineTo(-L * 0.1, W / 2); g.lineTo(L * 0.16, fw * 0.4);
  g.closePath(); g.fill();
  // engines
  if (!shadow) {
    g.fillStyle = '#8d949c';
    const eng = (x, y) => g.fillRect(x - L * 0.06, y - L * 0.022, L * 0.12, L * 0.044);
    if (cls === 'regional') { eng(-L * 0.3, -fw * 0.95); eng(-L * 0.3, fw * 0.95); } else {
      eng(L * 0.06, -W * 0.2); eng(L * 0.06, W * 0.2);
      if (cls === 'jumbo') { eng(-L * 0.02, -W * 0.34); eng(-L * 0.02, W * 0.34); }
    }
  }
  // tailplane
  g.fillStyle = liv;
  g.beginPath();
  g.moveTo(-L * 0.36, -fw * 0.3); g.lineTo(-L * 0.47, -L * 0.18); g.lineTo(-L * 0.51, -L * 0.18); g.lineTo(-L * 0.49, 0);
  g.lineTo(-L * 0.51, L * 0.18); g.lineTo(-L * 0.47, L * 0.18); g.lineTo(-L * 0.36, fw * 0.3); g.closePath(); g.fill();
  // fuselage
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(L * 0.5, 0);
  g.quadraticCurveTo(L * 0.48, -fw / 2, L * 0.38, -fw / 2);
  g.lineTo(-L * 0.42, -fw / 2);
  g.quadraticCurveTo(-L * 0.5, -fw * 0.3, -L * 0.52, 0);
  g.quadraticCurveTo(-L * 0.5, fw * 0.3, -L * 0.42, fw / 2);
  g.lineTo(L * 0.38, fw / 2);
  g.quadraticCurveTo(L * 0.48, fw / 2, L * 0.5, 0);
  g.closePath(); g.fill();
  if (!shadow) {
    g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 0.6; g.stroke();
    // livery: rear of the fuselage and the fin
    g.fillStyle = livery;
    g.fillRect(-L * 0.42, -fw / 2 + 0.3, L * 0.16, fw - 0.6);
    g.fillRect(-L * 0.5, -0.9, L * 0.2, 1.8);
    g.fillStyle = '#26303a';
    g.fillRect(L * 0.42, -fw * 0.28, L * 0.035, fw * 0.56);
  }
}

function drawPlane(g, p, t, night, selected) {
  const alt = p.alt || 0;
  const k = 1 + alt / 500;
  // shadow on the ground
  g.save();
  g.translate(p.x + alt * 0.32 + 2, p.y + alt * 0.42 + 2);
  g.rotate(p.ang);
  g.scale(Math.max(0.7, 1 - alt / 900), Math.max(0.7, 1 - alt / 900));
  g.globalAlpha = Math.max(0.25, 1 - alt / 260);
  drawPlaneShape(g, p.cls, p.color, true);
  g.restore();
  g.save();
  g.translate(p.x, p.y);
  g.rotate(p.ang);
  g.scale(k, k);
  drawPlaneShape(g, p.cls, p.color, false);
  // beacon and nav lights
  const L = 60 * AIRCRAFT[p.cls].scale;
  if (Math.floor(t * 1.4 + p.id * 0.37) % 2 === 0) {
    g.fillStyle = night ? 'rgba(255,60,50,0.95)' : 'rgba(255,60,50,0.7)';
    g.beginPath(); g.arc(-L * 0.05, 0, night ? 2.2 : 1.3, 0, Math.PI * 2); g.fill();
  }
  if (night) {
    g.fillStyle = 'rgba(255,40,40,0.9)'; g.beginPath(); g.arc(-L * 0.15, -L * 0.5, 1.6, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(40,255,90,0.9)'; g.beginPath(); g.arc(-L * 0.15, L * 0.5, 1.6, 0, Math.PI * 2); g.fill();
    if (p.state === 'final' || p.state === 'takeoff' || p.state === 'rollout') {
      const grd = g.createRadialGradient(L * 0.9, 0, 0, L * 0.9, 0, L * 1.1);
      grd.addColorStop(0, 'rgba(255,250,220,0.55)'); grd.addColorStop(1, 'rgba(255,250,220,0)');
      g.fillStyle = grd; g.beginPath(); g.moveTo(L * 0.5, 0); g.lineTo(L * 2, -L * 0.45); g.lineTo(L * 2, L * 0.45); g.closePath(); g.fill();
    }
  }
  g.restore();
  if (selected) {
    g.strokeStyle = '#ffc20e'; g.lineWidth = 2; g.setLineDash([4, 3]);
    g.beginPath(); g.arc(p.x, p.y, 34 * AIRCRAFT[p.cls].scale + 8, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
  }
}

// ------------------------------------------------------------------ people

const particles = [];
const floaters = [];
let dotAcc = {};
let ppd = 3; // passengers per dot

function spawnDots(key, n, make) {
  dotAcc[key] = (dotAcc[key] || 0) + n / ppd;
  while (dotAcc[key] >= 1) {
    dotAcc[key] -= 1;
    if (particles.length < 900) particles.push(make());
  }
}

function walker(pts, speed, color, delay = 0) {
  return { pts, d: -delay * speed, len: pathLength(pts), speed, color };
}

function jitter(v, a) { return v + (Math.random() - 0.5) * a; }

function loungePoint(slot, gateIndex = null, gates = 3) {
  const b = slotBuilding(slot);
  if (gateIndex != null) {
    const s = gateStand(slot, gateIndex, gates);
    return { x: jitter(s.x, 34), y: b.y + 8 + Math.random() * 14 };
  }
  return { x: b.x + 10 + Math.random() * (b.w - 20), y: b.y + 8 + Math.random() * (b.h * 0.3) };
}

export function attach(ap) {
  particles.length = 0;
  floaters.length = 0;
  dotAcc = {};
  ap.fx = (type, e) => {
    if (type === 'money') { floaters.push({ x: e.x, y: e.y, text: '+' + money(e.v), life: 1.6 }); return; }
    if (type === 'curb') {
      spawnDots('curb', e.n, () => {
        const x = jitter(1000, 220);
        return walker([{ x, y: CURB_Y - 12 }, { x: jitter(1000, 160), y: MAIN_BLDG.y1 - 2 }], 22, C.depart);
      });
      return;
    }
    if (type === 'secOut') {
      const T = terminalBySlot(ap, e.slot);
      spawnDots('sec', e.n, () => {
        const from = { x: jitter(1000, 80), y: MAIN_BLDG.y1 - 38 };
        const to = e.slot === 'main' ? loungePoint('main') : { x: jitter(T.connector.route[0].x, 10), y: jitter(T.connector.route[0].y, 10) };
        return walker([from, { x: from.x, y: MAIN_BLDG.y0 + 34 }, to], 26, C.depart);
      });
      return;
    }
    if (type === 'conn') {
      const T = terminalBySlot(ap, e.slot);
      const Cn = T && T.connector;
      if (!Cn || (Cn.type !== 'walkway' && Cn.type !== 'tunnel')) return;
      spawnDots('conn' + e.slot + e.dir, e.n, () => {
        const pts = e.dir === 'out' ? Cn.route : [...Cn.route].reverse();
        const len = pathLength(pts);
        const w = walker(pts.map((p) => ({ x: jitter(p.x, 6), y: jitter(p.y, 6) })), len / Math.max(1, e.travel), e.dir === 'out' ? C.depart : C.arrive);
        w.under = Cn.type === 'tunnel';
        return w;
      });
      return;
    }
    if (type === 'deplane') {
      const p = e.p;
      const T = terminalBySlot(ap, e.slot);
      spawnDots('dep' + p.id, e.n, () => {
        const b = slotBuilding(e.slot);
        const door = { x: p.x + 14, y: b.y - 10 };
        const inside = { x: jitter(p.x, 20), y: b.y + 10 };
        if (e.slot === 'main') {
          const exit = { x: jitter(1000, 120), y: MAIN_BLDG.y1 - 4 };
          return walker([door, inside, { x: inside.x, y: MAIN_BLDG.y0 + 30 }, exit, { x: exit.x, y: CURB_Y - 10 }], 30, C.arrive);
        }
        const st = T.connector.route[T.connector.route.length - 1];
        return walker([door, inside, { x: jitter(st.x, 10), y: jitter(st.y, 10) }], 30, C.arrive);
      });
      return;
    }
    if (type === 'board') {
      const p = e.p;
      spawnDots('brd' + p.id, e.n, () => {
        const b = slotBuilding(e.slot);
        return walker([{ x: jitter(p.x, 30), y: b.y + 14 }, { x: p.x + 14, y: b.y + 2 }, { x: p.x + 14, y: b.y - 12 }], 30, C.depart);
      });
    }
  };
}

function crowd(g, n, x0, y0, w, h, color, seed, t) {
  const R = mulberry32(seed);
  g.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const x = x0 + R() * w, y = y0 + R() * h;
    const wob = Math.sin(t * 1.3 + i) * 0.5;
    g.fillRect(x + wob - 1.1, y - 1.1, 2.2, 2.2);
  }
}

function queueSnake(g, n, x0, x1, y0, rows, color, t) {
  g.fillStyle = color;
  const per = Math.floor((x1 - x0) / 3.4);
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / per);
    const k = i % per;
    const x = row % 2 ? x1 - k * 3.4 : x0 + k * 3.4;
    const y = y0 + row * 4.2;
    g.fillRect(x - 1.1 + Math.sin(t * 2 + i) * 0.3, y - 1.1, 2.2, 2.2);
  }
}

// ------------------------------------------------------------------ frame

export function render(g, w, h, dpr, cam, ap, view) {
  const t = ap.t;
  const res = clamp(Math.round(cam.zoom * dpr * 2) / 2, 0.5, 2.5);
  const key = layoutKey(ap, res);
  if (key !== staticKey) { drawStatic(ap, res); staticKey = key; }

  // passengers per dot: keep the crowd readable at any size
  ppd = Math.max(3, Math.round(ap.rolling.landsidePerMin / 110));

  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#5f7a4a';
  g.fillRect(0, 0, w, h);
  g.setTransform(cam.zoom * dpr, 0, 0, cam.zoom * dpr, (w / 2 - cam.x * cam.zoom) * dpr, (h / 2 - cam.y * cam.zoom) * dpr);
  g.imageSmoothingEnabled = true;
  g.drawImage(staticCanvas, 0, 0, WORLD.w, WORLD.h);

  const day = dayPhase(t);
  const night = day.dark > 0.25;

  // construction
  for (const T of ap.terminals) {
    const b = slotBuilding(T.slot);
    if (T.buildLeft > 0) crane(g, b, t, 1 - T.buildLeft / 35);
    const Cn = T.pendingConnector || (T.connector && T.connector.buildLeft > 0 ? T.connector : null);
    if (Cn) {
      const r = connectorRoute(Cn.type, T.slot);
      g.strokeStyle = 'rgba(230,160,40,0.85)'; g.lineWidth = 4; g.setLineDash([3, 6]);
      line(g, r.map((p) => [p.x, p.y])); g.setLineDash([]);
      const full = CONNECTORS[Cn.type].buildTime;
      const m = pointAlong(r, pathLength(r) / 2);
      progressTag(g, m.x, m.y - 14, 1 - Cn.buildLeft / full, CONNECTORS[Cn.type].name);
    }
  }

  // empty sites on land you own
  for (const id of SLOT_ORDER) {
    if (terminalBySlot(ap, id)) continue;
    if (!ap.plots[SLOTS[id].plot]) continue;
    const b = slotBuilding(id);
    const hot = view.hover && view.hover.kind === 'slot' && view.hover.id === id;
    g.fillStyle = hot ? 'rgba(255,194,14,0.22)' : 'rgba(255,255,255,0.12)';
    g.fillRect(b.x, b.y, b.w, b.h);
    g.strokeStyle = '#ffc20e'; g.lineWidth = 2; g.setLineDash([7, 5]);
    g.strokeRect(b.x, b.y, b.w, b.h); g.setLineDash([]);
    signLabel(g, b.x + b.w / 2, b.y + b.h / 2, '+ BUILD TERMINAL', 'yellow', cam.zoom);
  }

  // crowds: security line, lounges, connector platforms
  const secN = Math.min(420, Math.round((ap.secQueue || 0) / ppd));
  const inside = Math.min(secN, 160);
  queueSnake(g, inside, 880, 1120, MAIN_BLDG.y1 - 18, 4, C.depart, t);
  if (secN > inside) crowd(g, secN - inside, 900, MAIN_BLDG.y1 + 6, 200, 18 + (secN - inside) / 12, C.depart, 99, t);
  for (const T of ap.terminals) {
    if (T.buildLeft > 0) continue;
    const b = slotBuilding(T.slot);
    let wait = 0;
    for (const n of T.waiting.values()) wait += n;
    const nd = Math.min(400, Math.round(wait / ppd));
    const comfortDots = T.gates * 140 / ppd;
    const fill = Math.min(1, nd / Math.max(1, comfortDots));
    crowd(g, nd, b.x + 6, b.y + 6, b.w - 12, Math.max(16, (b.h - 12) * (0.35 + 0.6 * fill)), C.depart, T.slot.length * 31, t);
    const Cn = T.connector;
    if (Cn) {
      const s0 = Cn.route[0], s1 = Cn.route[Cn.route.length - 1];
      const outN = Math.min(160, Math.round((Cn.outSize || 0) / ppd));
      const inN = Math.min(160, Math.round((Cn.inSize || 0) / ppd));
      crowd(g, outN, s0.x - 14 - outN / 8, s0.y - 7, 28 + outN / 4, 14, C.depart, 7 + T.slot.length, t);
      crowd(g, inN, s1.x - 14 - inN / 8, s1.y - 7, 28 + inN / 4, 14, C.arrive, 13 + T.slot.length, t);
      if (Cn.brokenUntil > t) signLabel(g, (s0.x + s1.x) / 2, (s0.y + s1.y) / 2, 'MONORAIL DOWN', 'red', cam.zoom);
    }
  }

  // moving passengers
  const dt = view.dt;
  for (let i = particles.length - 1; i >= 0; i--) {
    const q = particles[i];
    q.d += q.speed * dt;
    if (q.d >= q.len) { particles.splice(i, 1); continue; }
    if (q.d < 0) continue;
    const pt = pointAlong(q.pts, q.d);
    g.fillStyle = q.color;
    g.globalAlpha = q.under ? 0.45 : 1;
    g.fillRect(pt.x - 1.1, pt.y - 1.1, 2.2, 2.2);
  }
  g.globalAlpha = 1;

  // ground aircraft first, then vehicles, then anything airborne
  const ground = ap.planes.filter((p) => (p.alt || 0) <= 0.5);
  const air = ap.planes.filter((p) => (p.alt || 0) > 0.5).sort((a, b) => a.alt - b.alt);
  for (const p of ground) drawPlane(g, p, t, night, view.selected === p);

  // cars on the landside loop
  drawCars(g, ap, dt);

  // shuttle buses
  for (const b of ap.buses) {
    g.save(); g.translate(b.x, b.y); g.rotate(b.ang);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(-7 + 1.5, -3.2 + 1.5, 14, 6.4);
    g.fillStyle = '#ffc20e'; g.fillRect(-7, -3.2, 14, 6.4);
    g.fillStyle = '#2a3440'; g.fillRect(-5, -2.2, 10, 1.2); g.fillRect(-5, 1, 10, 1.2); g.fillRect(4.5, -2.4, 1.6, 4.8);
    g.restore();
  }

  // monorail beams and trains ride above the apron
  for (const T of ap.terminals) {
    const Cn = T.connector;
    if (!Cn || Cn.type !== 'monorail' || Cn.buildLeft > 0) continue;
    const r = Cn.route;
    g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 7; g.save(); g.translate(6, 8); line(g, r.map((p) => [p.x, p.y])); g.restore();
    g.strokeStyle = '#d9dcdf'; g.lineWidth = 6; line(g, r.map((p) => [p.x, p.y]));
    g.strokeStyle = '#8f969d'; g.lineWidth = 1; line(g, r.map((p) => [p.x, p.y]));
    const L = pathLength(r);
    for (let d = 0; d <= L; d += 50) { const q = pointAlong(r, d); g.fillStyle = '#7d848b'; g.fillRect(q.x - 3, q.y - 3, 6, 6); }
    const broken = Cn.brokenUntil > t;
    const travel = L / 175;
    const ph = broken ? 0.5 : ((t / (travel * 2 + 6)) % 1);
    const s = ph < 0.5 ? Math.min(1, ph * 2 * (travel * 2 + 6) / (travel + 3)) : Math.max(0, 1 - (ph - 0.5) * 2 * (travel * 2 + 6) / (travel + 3));
    const q = pointAlong(r, clamp(s, 0, 1) * L);
    g.save(); g.translate(q.x, q.y); g.rotate(q.ang);
    g.fillStyle = broken ? '#c22f45' : '#f4f6f8'; g.fillRect(-15, -3.6, 30, 7.2);
    g.fillStyle = '#2b5f9e'; g.fillRect(-13, -1, 26, 2);
    g.fillStyle = '#26303a'; g.fillRect(12, -2.5, 2.5, 5); g.fillRect(-14.5, -2.5, 2.5, 5);
    g.restore();
  }

  // holding stack ring
  const holders = ap.holdQueue.length;
  const arrRw = RW[ap.upgrades.runway2 ? 1 : 0];
  if (holders) {
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1.5; g.setLineDash([5, 6]);
    g.beginPath(); g.arc(IAF.x, arrRw.y + FLIGHT.holdRadius, FLIGHT.holdRadius, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    signLabel(g, IAF.x, arrRw.y + FLIGHT.holdRadius, `HOLDING ${holders}`, holders > 2 ? 'red' : 'yellow', cam.zoom);
  }

  for (const p of air) drawPlane(g, p, t, night, view.selected === p);

  // money floaters
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.life -= dt; f.y -= 14 * dt;
    if (f.life <= 0) { floaters.splice(i, 1); continue; }
    g.globalAlpha = Math.min(1, f.life);
    g.font = '700 12px "IBM Plex Mono", monospace'; g.textAlign = 'center';
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillText(f.text, f.x + 1, f.y + 1);
    g.fillStyle = '#ffe58a'; g.fillText(f.text, f.x, f.y);
  }
  g.globalAlpha = 1;

  // land for sale
  for (const [id, P] of Object.entries(PLOTS)) {
    if (ap.plots[id]) continue;
    const r = P.rects[0];
    const hot = view.hover && view.hover.kind === 'plot' && view.hover.id === id;
    signLabel(g, r.x + r.w / 2, r.y + r.h / 2, `${hot ? '▸ ' : ''}FOR SALE · ${P.name.toUpperCase()}`, hot ? 'yellow' : 'black', cam.zoom);
  }

  // night and weather
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const storm = ap.weather.stormUntil > t;
  if (day.dark > 0 || storm) {
    g.fillStyle = `rgba(12,18,44,${Math.min(0.66, day.dark * 0.62 + (storm ? 0.18 : 0))})`;
    g.fillRect(0, 0, w, h);
  }
  if (storm) rain(g, w, h, t);
  if (day.dark > 0.15) {
    g.setTransform(cam.zoom * dpr, 0, 0, cam.zoom * dpr, (w / 2 - cam.x * cam.zoom) * dpr, (h / 2 - cam.y * cam.zoom) * dpr);
    lights(g, ap, day.dark);
    for (const p of ap.planes) if (Math.floor(t * 1.4 + p.id * 0.37) % 2 === 0) {
      g.fillStyle = 'rgba(255,70,60,0.9)'; g.beginPath(); g.arc(p.x, p.y, 2, 0, Math.PI * 2); g.fill();
    }
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { dark: day.dark, storm };
}

export function dayPhase(t) {
  // A day lasts six minutes. Night is short and never pitch black.
  const ph = (t / 360 + 0.3) % 1;
  const dark = clamp(-Math.sin(ph * Math.PI * 2) * 1.8 - 0.9, 0, 1);
  return { ph, dark };
}

function lights(g, ap, dark) {
  g.globalAlpha = Math.min(1, dark * 1.4);
  const edge = (rw, x1) => {
    for (let x = rw.x0; x <= x1; x += 40) {
      g.fillStyle = '#fff8dc';
      g.fillRect(x - 1, rw.y - RUNWAY_HALF - 2, 2, 2); g.fillRect(x - 1, rw.y + RUNWAY_HALF, 2, 2);
    }
    g.fillStyle = '#4cff7a'; for (let y = -RUNWAY_HALF; y <= RUNWAY_HALF; y += 5) g.fillRect(rw.x0 - 22, rw.y + y - 1, 2, 2);
    g.fillStyle = '#ff4a3c'; for (let y = -RUNWAY_HALF; y <= RUNWAY_HALF; y += 5) g.fillRect(x1 + 20, rw.y + y - 1, 2, 2);
    // approach lights
    g.fillStyle = '#fff3b0';
    for (let x = rw.x0 - 40; x > rw.x0 - 210; x -= 18) g.fillRect(x - 1, rw.y - 1, 3, 3);
  };
  edge(RW[0], ap.upgrades.longRunway ? LONG_RUNWAY_X1 : RW[0].x1);
  if (ap.upgrades.runway2) edge(RW[1], RW[1].x1);
  g.fillStyle = '#5aa0ff';
  for (let x = 200; x < 1820; x += 30) { g.fillRect(x, TWY_A - 13, 2, 2); g.fillRect(x, TWY_B + 12, 2, 2); }
  g.fillStyle = '#4cff7a';
  for (let x = 210; x < 1820; x += 15) { g.fillRect(x, TWY_A - 0.5, 1.5, 1.5); }
  // terminal glow
  for (const T of ap.terminals) {
    if (T.buildLeft > 0) continue;
    const b = slotBuilding(T.slot);
    g.fillStyle = 'rgba(255,220,150,0.18)'; g.fillRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
  }
  g.globalAlpha = 1;
}

function rain(g, w, h, t) {
  g.strokeStyle = 'rgba(200,215,240,0.35)'; g.lineWidth = 1;
  const R = mulberry32(Math.floor(t * 12));
  g.beginPath();
  for (let i = 0; i < 140; i++) {
    const x = R() * w, y = R() * h;
    g.moveTo(x, y); g.lineTo(x - 5, y + 14);
  }
  g.stroke();
}

function crane(g, b, t, prog) {
  const cx = b.x + b.w * 0.7, cy = b.y + b.h * 0.5;
  g.strokeStyle = '#f2b51e'; g.lineWidth = 3;
  const a = Math.sin(t * 0.4) * 0.8;
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * 70, cy + Math.sin(a) * 70); g.stroke();
  g.fillStyle = '#d9a10f'; g.fillRect(cx - 5, cy - 5, 10, 10);
  progressTag(g, b.x + b.w / 2, b.y + b.h / 2, prog, 'UNDER CONSTRUCTION');
}

function progressTag(g, x, y, prog, label) {
  g.save();
  const w = 120;
  g.fillStyle = '#16181b'; g.fillRect(x - w / 2, y - 12, w, 22);
  g.fillStyle = '#ffc20e'; g.fillRect(x - w / 2 + 3, y + 5, (w - 6) * clamp(prog, 0, 1), 3);
  g.font = '700 9px "Barlow Condensed", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label.toUpperCase(), x, y - 3);
  g.restore();
}

// Airfield-style signs that stay the same size on screen.
function signLabel(g, x, y, text, style, zoom) {
  g.save();
  const s = 1 / Math.max(0.45, zoom);
  g.translate(x, y); g.scale(s, s);
  g.font = '700 12px "Barlow Condensed", "Arial Narrow", sans-serif';
  const w = g.measureText(text).width + 14;
  const bg = style === 'yellow' ? '#ffc20e' : style === 'red' ? '#c8102e' : '#141518';
  const fg = style === 'yellow' ? '#141518' : style === 'red' ? '#ffffff' : '#ffc20e';
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(-w / 2 + 2, -9 + 2, w, 18);
  g.fillStyle = bg; g.fillRect(-w / 2, -9, w, 18);
  if (style === 'black') { g.strokeStyle = '#ffc20e'; g.lineWidth = 1.2; g.strokeRect(-w / 2 + 2, -7, w - 4, 14); }
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 0, 0.5);
  g.restore();
}

// Cars: one per few departing passengers, cycling the curb loop.
const cars = [];
let carAcc = 0;
function drawCars(g, ap, dt) {
  const rate = ap.rolling.landsidePerMin / 60 * 0.12; // cars per second
  carAcc += rate * dt;
  if (carAcc > 1 && cars.length < 40) {
    carAcc = 0;
    const colors = ['#c9473a', '#e8e8e8', '#2b5f9e', '#262626', '#9aa0a6', '#d9b44a'];
    const fromWest = Math.random() < 0.5;
    const stopX = jitter(1000, 180);
    const pts = [
      { x: fromWest ? -20 : WORLD.w + 20, y: HIGHWAY_Y + (fromWest ? 6 : -6) },
      { x: RAMP_IN_X, y: HIGHWAY_Y + (fromWest ? 6 : -6) },
      { x: RAMP_IN_X, y: CURB_Y }, { x: stopX, y: CURB_Y - 4 }, { x: RAMP_OUT_X, y: CURB_Y },
      { x: RAMP_OUT_X, y: HIGHWAY_Y - 6 }, { x: fromWest ? WORLD.w + 20 : -20, y: HIGHWAY_Y - 6 },
    ];
    cars.push({ pts, d: 0, len: pathLength(pts), color: colors[Math.floor(Math.random() * colors.length)], stopAt: pathLength(pts.slice(0, 4)), stopped: 0 });
  }
  for (let i = cars.length - 1; i >= 0; i--) {
    const c = cars[i];
    if (c.d >= c.stopAt && c.stopped < 1.5) c.stopped += dt; else c.d += 120 * dt;
    if (c.d >= c.len) { cars.splice(i, 1); continue; }
    const q = pointAlong(c.pts, c.d);
    g.save(); g.translate(q.x, q.y); g.rotate(q.ang);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(-4 + 1, -2.2 + 1, 8, 4.4);
    g.fillStyle = c.color; g.fillRect(-4, -2.2, 8, 4.4);
    g.fillStyle = 'rgba(30,40,55,0.7)'; g.fillRect(0.5, -1.7, 2, 3.4);
    g.restore();
  }
}

// ------------------------------------------------------------------ picking

export function pick(ap, wx, wy) {
  let best = null, bd = Infinity;
  for (const p of ap.planes) {
    const d = Math.hypot(p.x - wx, p.y - wy);
    const r = 34 * AIRCRAFT[p.cls].scale + 6;
    if (d < r && d < bd) { bd = d; best = { kind: 'plane', plane: p }; }
  }
  if (best) return best;
  for (const T of ap.terminals) {
    const b = slotBuilding(T.slot);
    if (wx >= b.x && wx <= b.x + b.w && wy >= b.y - 20 && wy <= b.y + b.h) return { kind: 'terminal', id: T.slot };
  }
  for (const id of SLOT_ORDER) {
    const b = slotBuilding(id);
    if (wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) {
      return ap.plots[SLOTS[id].plot] ? { kind: 'slot', id } : { kind: 'plot', id: SLOTS[id].plot };
    }
  }
  for (const [id, P] of Object.entries(PLOTS)) {
    if (ap.plots[id]) continue;
    for (const r of P.rects) if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) return { kind: 'plot', id };
  }
  for (const rw of RW) {
    if (rw.id === 1 && !ap.upgrades.runway2) continue;
    if (wy > rw.y - 24 && wy < rw.y + 24 && wx > rw.x0 - 30 && wx < rw.x1 + 30) return { kind: 'runway' };
  }
  if (Math.hypot(wx - IAF.x, wy - (RW[ap.upgrades.runway2 ? 1 : 0].y + FLIGHT.holdRadius)) < FLIGHT.holdRadius + 10) return { kind: 'runway' };
  return null;
}

export { isOpen };
