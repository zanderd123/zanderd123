/**
 * Order lines and the reference grid.
 *
 * Everything here answers the same question: where is that ship actually
 * going? Depth is nearly impossible to read in an empty scene, so a line from
 * hull to destination is the primary readout, and the optional grid adds
 * vertical stalks dropping to a fixed plane so a height difference becomes a
 * length you can compare.
 *
 * All of it is one LineSegments with a preallocated buffer and a draw range,
 * rebuilt each frame. Order lines change every frame anyway, so there is
 * nothing to be gained by keeping objects around per squadron.
 */
import * as THREE from 'three';
import { WORLD } from './config.js';

/** The plane stalks drop to. Not the arena floor — the middle of the fight. */
const PLANE_Y = 0;
const GRID_STEP = 400;
/** Half-length of the little cross drawn where a stalk meets the plane. */
const TICK = 26;

const STANCE_COLOUR = {
  move: 0x7fffd0,
  attack: 0xff6b5a,
  defend: 0x8fd0ff,
  hold: 0xffd27f,
};
const SIEGE_COLOUR = 0xffb01e;

const MAX_VERTS = 6144;

const _dest = new THREE.Vector3();
const _c = new THREE.Color();

export class OrderOverlay {
  constructor(scene) {
    this.scene = scene;
    this.buildGrid();
    this.buildDynamic();
    this.gridOn = false;
    this.grid.visible = false;
  }

  /** A disc of grid lines clipped to the arena, plus its rim. */
  buildGrid() {
    const R = WORLD.arenaRadius;
    const pts = [];
    const n = Math.floor(R / GRID_STEP);
    for (let i = -n; i <= n; i++) {
      const t = i * GRID_STEP;
      // Chord half-length at this offset — this is what clips the square grid
      // to a circle without a stencil.
      const half = Math.sqrt(Math.max(0, R * R - t * t));
      if (half < 1) continue;
      pts.push(new THREE.Vector3(t, PLANE_Y, -half), new THREE.Vector3(t, PLANE_Y, half));
      pts.push(new THREE.Vector3(-half, PLANE_Y, t), new THREE.Vector3(half, PLANE_Y, t));
    }
    for (let i = 0; i < 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      const b = ((i + 1) / 128) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * R, PLANE_Y, Math.sin(a) * R),
        new THREE.Vector3(Math.cos(b) * R, PLANE_Y, Math.sin(b) * R));
    }
    this.grid = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({
        color: 0x3f7fa8, transparent: true, opacity: 0.13, depthWrite: false,
      }),
    );
    this.grid.renderOrder = -1;
    this.scene.add(this.grid);
  }

  buildDynamic() {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX_VERTS * 3);
    this.col = new Float32Array(MAX_VERTS * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setDrawRange(0, 0);
    this.max = MAX_VERTS;
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false,
    }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 3;
    this.scene.add(this.lines);
  }

  setGrid(on) {
    this.gridOn = !!on;
    this.grid.visible = this.gridOn;
    return this.gridOn;
  }

  toggleGrid() { return this.setGrid(!this.gridOn); }

  /** Append one segment. Colours are per-endpoint, which is how lines fade. */
  seg(x0, y0, z0, x1, y1, z1, c0, c1) {
    const i = this.n;
    if (i + 2 > this.max) return;
    const p = this.pos;
    const o = i * 3;
    p[o] = x0; p[o + 1] = y0; p[o + 2] = z0;
    p[o + 3] = x1; p[o + 4] = y1; p[o + 5] = z1;
    const c = this.col;
    c[o] = c0.r; c[o + 1] = c0.g; c[o + 2] = c0.b;
    c[o + 3] = c1.r; c[o + 4] = c1.g; c[o + 5] = c1.b;
    this.n = i + 2;
  }

  /** Vertical drop to the plane, with a cross at the foot. */
  stalk(at, colour, dim) {
    _c.set(colour);
    const top = _c.clone().multiplyScalar(dim ? 0.16 : 0.30);
    const foot = _c.clone().multiplyScalar(dim ? 0.40 : 0.85);
    this.seg(at.x, at.y, at.z, at.x, PLANE_Y, at.z, top, foot);
    this.seg(at.x - TICK, PLANE_Y, at.z, at.x + TICK, PLANE_Y, at.z, foot, foot);
    this.seg(at.x, PLANE_Y, at.z - TICK, at.x, PLANE_Y, at.z + TICK, foot, foot);
  }

  /** Where a squadron is actually headed, given everything it has been told. */
  destinationOf(u, planet) {
    if (u.siegeLock && planet) return _dest.copy(planet.pos);
    if (u.stance === 'hold') return null;
    if (u.stance === 'defend') {
      if (u.guardTarget === 'planet') return planet ? _dest.copy(planet.pos) : null;
      if (u.guardTarget && u.guardTarget.alive) return _dest.copy(u.guardTarget.pos);
    }
    if (u.stance === 'attack' && u.attackTarget && u.attackTarget.alive) {
      return _dest.copy(u.attackTarget.pos);
    }
    return u.movePos ? _dest.copy(u.movePos) : null;
  }

  colourOf(u) {
    return u.siegeLock ? SIEGE_COLOUR : (STANCE_COLOUR[u.stance] ?? STANCE_COLOUR.move);
  }

  update(game, selection, { showAllOrders = false } = {}) {
    this.n = 0;
    const mine = game.playerFaction;
    const selected = new Set(selection);
    const planet = game.planet && game.planet.alive ? game.planet : null;

    for (const u of game.units) {
      if (!u.alive || u.faction !== mine) continue;
      const isSel = selected.has(u);

      if (this.gridOn && !u.isGround) this.stalk(u.pos, this.colourOf(u), !isSel);
      // Ground units cannot go anywhere interesting; their order line is noise.
      if ((!isSel && !showAllOrders) || u.isGround) continue;

      const dest = this.destinationOf(u, planet);
      // Suppress the line once it is basically there, or every idle squadron
      // grows a permanent 20-pixel stub.
      if (!dest || dest.distanceToSquared(u.pos) < 60 * 60) continue;

      const colour = this.colourOf(u);
      _c.set(colour);
      const near = _c.clone().multiplyScalar(isSel ? 0.28 : 0.16);
      const far = _c.clone().multiplyScalar(isSel ? 1 : 0.55);
      this.seg(u.pos.x, u.pos.y, u.pos.z, dest.x, dest.y, dest.z, near, far);
      if (this.gridOn) this.stalk(dest, colour, !isSel);
    }

    const geo = this.lines.geometry;
    geo.setDrawRange(0, this.n);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    this.lines.visible = this.n > 0;
  }

  clear() {
    this.n = 0;
    this.lines.geometry.setDrawRange(0, 0);
    this.lines.visible = false;
  }
}
