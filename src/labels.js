/**
 * Floating squadron tags.
 *
 * DOM elements rather than sprites: text drawn into the WebGL scene has to be
 * a texture atlas or a canvas per label, and both look worse and cost more
 * than letting the browser lay out 64 absolutely-positioned divs.
 *
 * The pool is fixed and reused. Labels are sorted near-to-far and the nearest
 * 64 win, so heavy fights stay legible where you are looking instead of
 * dropping tags at random.
 */
import * as THREE from 'three';

const MAX_LABELS = 64;
const _v = new THREE.Vector3();

/** What the L key reports when it cycles. */
export const LABEL_MODE_NAMES = {
  own: 'your fleet',
  all: 'both fleets',
  off: 'off',
};

export class UnitLabels {
  constructor(parent, app) {
    this.app = app;
    this.root = document.createElement('div');
    this.root.className = 'unit-labels';
    parent.appendChild(this.root);
    this.pool = [];
    for (let i = 0; i < MAX_LABELS; i++) {
      const el = document.createElement('div');
      el.className = 'unit-label';
      el.style.display = 'none';
      this.root.appendChild(el);
      this.pool.push(el);
    }
    this.mode = 'own';
  }

  cycleMode() {
    this.mode = this.mode === 'own' ? 'all' : this.mode === 'all' ? 'off' : 'own';
    return this.mode;
  }

  update(game) {
    const cam = this.app.scene.camera;
    const mine = game.playerFaction;
    let used = 0;

    if (this.mode !== 'off' && game.live) {
      const candidates = [];
      for (const u of game.units) {
        if (!u.alive) continue;
        const own = u.faction === mine;
        if (this.mode === 'own' && !own) continue;
        if (u.craft.some((c) => c.alive && c.visible)) candidates.push(u);
      }
      candidates.sort((a, b) =>
        a.pos.distanceToSquared(cam.position) - b.pos.distanceToSquared(cam.position));

      const placed = [];
      const rowHeight = 15;
      for (const u of candidates) {
        if (used >= MAX_LABELS) break;
        _v.copy(u.pos);
        _v.y += u.type.scale * 9 + 26;
        _v.project(cam);
        // A little past the edge so a label does not pop as it leaves frame.
        if (_v.z > 1 || _v.x < -1.05 || _v.x > 1.05 || _v.y < -1.05 || _v.y > 1.05) continue;

        const own = u.faction === mine;
        const count = u.type.count > 1 ? ` ${u.count}` : '';
        const status = game.state === 'prep' ? u.plannedLabel : u.statusLabel;
        const text = own ? `${u.label}${count}  ${status}` : `${u.label}${count}`;

        const sx = (_v.x * 0.5 + 0.5) * innerWidth;
        let sy = (-_v.y * 0.5 + 0.5) * innerHeight;
        // Crude declutter: nudge upward off anything already placed, but give
        // up after five tries rather than sending a tag to the ceiling.
        const halfW = text.length * 3 + 8;
        for (let i = 0; i < 5 && placed.some((p) =>
          Math.abs(p.sx - sx) < p.halfW + halfW && Math.abs(p.sy - sy) < rowHeight); i++) {
          sy -= rowHeight;
        }
        placed.push({ sx, sy, halfW });

        const el = this.pool[used++];
        el.style.display = 'block';
        el.style.left = `${sx}px`;
        el.style.top = `${sy}px`;
        el.className = 'unit-label'
          + (own ? ' own' : ' enemy')
          + (u.selected ? ' selected' : '')
          + (u.siegeLock ? ' sieging' : '');
        el.textContent = text;
        if (own && u.threat > 0.45) el.className += ' hurt';
      }
    }

    for (let i = used; i < this.pool.length; i++) {
      if (this.pool[i].style.display !== 'none') this.pool[i].style.display = 'none';
    }
  }

  clear() {
    for (const el of this.pool) el.style.display = 'none';
  }
}
