/**
 * Top-down 2D map, drawn to a canvas.
 *
 * Used twice with different options: the small corner map (click to jump), and
 * the expanded tactical map (pan, zoom, squadron tags). Same class both times —
 * the differences are all `interactive`.
 *
 * It redraws at 20Hz rather than every frame. Nothing on a strategic map moves
 * fast enough to need 60, and it is a full canvas repaint each time.
 */
import { WORLD } from './config.js';

/** The map's default half-width: the arena plus a margin so the wall is inside. */
const EXTENT = WORLD.arenaRadius + 220;
const CENTER = WORLD.planetCenter;

export class Minimap {
  constructor(canvas, app, opts = {}) {
    this.canvas = canvas;
    this.app = app;
    this.ctx = canvas.getContext('2d');
    this.timer = 0;
    this.zoom = 1;
    this.cx = 0;
    this.cz = 0;
    this.interactive = !!opts.interactive;
    this.onExpand = opts.onExpand || null;

    this.resize();
    addEventListener('resize', () => this.resize());
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    if (this.onExpand) {
      canvas.addEventListener('dblclick', (e) => { e.preventDefault(); this.onExpand(); });
    }

    if (this.interactive) {
      canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        // Zoom about the cursor: note where it points, rescale, then shift the
        // centre so it still points at the same place.
        const r = canvas.getBoundingClientRect();
        const before = this.toWorld(e.clientX - r.left, e.clientY - r.top);
        this.zoom = Math.min(6, Math.max(0.6, this.zoom * (1 - e.deltaY * 0.0012)));
        const after = this.toWorld(e.clientX - r.left, e.clientY - r.top);
        this.cx += before.x - after.x;
        this.cz += before.z - after.z;
      }, { passive: false });
      addEventListener('pointermove', (e) => this.onMove(e));
      addEventListener('pointerup', () => { this.panning = false; });
    }
  }

  reset() {
    this.zoom = 1;
    this.cx = 0;
    this.cz = 0;
  }

  onDown(e) {
    if (this.interactive && e.button === 0) {
      this.panning = true;
      this.panFrom = { x: e.clientX, y: e.clientY, moved: false };
      return;
    }
    this.jumpTo(e);
  }

  onMove(e) {
    if (!this.panning) return;
    const dx = e.clientX - this.panFrom.x;
    const dy = e.clientY - this.panFrom.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) this.panFrom.moved = true;
    this.panFrom.x = e.clientX;
    this.panFrom.y = e.clientY;
    const k = this.extent / (this.w / 2);
    this.cx -= dx * k;
    this.cz -= dy * k;
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    // The rect can be zero before layout settles; fall back to the CSS size.
    const w = r.width || 210;
    const h = r.height || 210;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.w = w;
    this.h = h;
    // Symbols scale with the map, so the big map is not a field of specks.
    this.symbolScale = Math.max(1, Math.min(2.4, w / 210));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  get extent() { return EXTENT / this.zoom; }

  toMap(x, z) {
    const e = this.extent;
    return {
      x: ((x - this.cx) / e) * (this.w / 2) + this.w / 2,
      y: ((z - this.cz) / e) * (this.h / 2) + this.h / 2,
    };
  }

  toWorld(px, py) {
    const e = this.extent;
    return {
      x: ((px - this.w / 2) / (this.w / 2)) * e + this.cx,
      z: ((py - this.h / 2) / (this.h / 2)) * e + this.cz,
    };
  }

  /** Move the camera's focus, leaving its height and angle alone. */
  jumpTo(e) {
    const r = this.canvas.getBoundingClientRect();
    const p = this.toWorld(e.clientX - r.left, e.clientY - r.top);
    const rig = this.app.rig;
    rig.targetFocus.set(p.x, rig.targetFocus.y, p.z);
  }

  /** A click that did not turn into a pan is a jump. */
  endClick(e) {
    if (this.panFrom && !this.panFrom.moved) this.jumpTo(e);
    this.panning = false;
  }

  draw(game) {
    const ctx = this.ctx;
    const { w, h } = this;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(4, 9, 16, 0.82)';
    ctx.fillRect(0, 0, w, h);

    // Range rings around the objective, for judging approach distance.
    const pc = this.toMap(CENTER[0], CENTER[2]);
    ctx.strokeStyle = 'rgba(120, 190, 235, 0.10)';
    ctx.lineWidth = 1;
    for (const r of [800, 1600, 2400]) {
      ctx.beginPath();
      ctx.arc(pc.x, pc.y, (r / this.extent) * (w / 2), 0, Math.PI * 2);
      ctx.stroke();
    }

    const origin = this.toMap(0, 0);
    ctx.strokeStyle = 'rgba(99, 182, 230, 0.34)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, (WORLD.arenaRadius / this.extent) * (w / 2), 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;

    // The planet, reddening as its crust is worn down.
    const pr = (WORLD.planetRadius / this.extent) * (w / 2);
    const hurt = 1 - (game && game.planet ? game.planet.fraction : 1);
    const g = ctx.createRadialGradient(pc.x, pc.y, 0, pc.x, pc.y, pr);
    g.addColorStop(0, `rgba(${60 + hurt * 160}, ${130 - hurt * 70}, ${180 - hurt * 130}, 0.55)`);
    g.addColorStop(1, `rgba(${30 + hurt * 130}, ${80 - hurt * 40}, ${130 - hurt * 90}, 0.30)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(pc.x, pc.y, pr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(95, 220, 255, 0.35)';
    ctx.beginPath();
    ctx.arc(pc.x, pc.y, pr, 0, Math.PI * 2);
    ctx.stroke();

    if (!game || !game.units.length) { this.frame(); return; }

    // Camera indicator: a dashed line from the eye to what it is looking at.
    const cam = this.app.scene.camera;
    const focus = this.app.rig.focus;
    const fp = this.toMap(focus.x, focus.z);
    const ep = this.toMap(cam.position.x, cam.position.z);
    ctx.strokeStyle = 'rgba(230, 245, 255, 0.30)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(ep.x, ep.y);
    ctx.lineTo(fp.x, fp.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(230, 245, 255, 0.55)';
    ctx.beginPath();
    ctx.arc(fp.x, fp.y, 4, 0, Math.PI * 2);
    ctx.stroke();

    const mine = game.playerFaction;
    for (const u of game.units) {
      if (!u.alive) continue;
      const own = u.faction === mine;
      // Fog applies here too — the map shows what you can see, not the truth.
      if (!own && !u.craft.some((c) => c.alive && c.seenBy[mine])) continue;

      const colour = u.siegeLock ? '#ffb01e' : own ? '#5fdcff' : '#ff9a48';
      for (const c of u.craft) {
        if (!c.alive || (!own && !c.seenBy[mine])) continue;
        const p = this.toMap(c.pos.x, c.pos.z);
        if (p.x < -6 || p.x > w + 6 || p.y < -6 || p.y > h + 6) continue;
        const s = Math.max(1.6, u.type.scale * 0.75) * this.symbolScale;
        ctx.fillStyle = colour;
        // Squares are ground, circles are ships.
        if (u.isGround) ctx.fillRect(p.x - s, p.y - s, s * 2, s * 2);
        else { ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, Math.PI * 2); ctx.fill(); }
      }

      if (u.selected) {
        const p = this.toMap(u.pos.x, u.pos.z);
        ctx.strokeStyle = '#8effc9';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(5, u.type.scale * 1.6) * this.symbolScale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
      }

      // Callsigns only on the big map — they would be unreadable on the corner.
      if (this.interactive && own) {
        const p = this.toMap(u.pos.x, u.pos.z);
        if (p.x > -40 && p.x < w + 40 && p.y > -20 && p.y < h + 20) {
          ctx.font = `${10 * Math.min(1.4, this.symbolScale)}px ui-monospace, Menlo, monospace`;
          ctx.textAlign = 'center';
          ctx.fillStyle = u.selected ? '#8effc9' : 'rgba(150, 205, 235, 0.72)';
          ctx.fillText(u.label, p.x, p.y - 8 * this.symbolScale);
        }
      }
    }
    this.frame();
  }

  frame() {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(120, 190, 235, 0.30)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, this.w - 1, this.h - 1);
  }

  update(dt, game) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1 / 20;
    this.draw(game);
  }
}
