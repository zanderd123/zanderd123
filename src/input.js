/**
 * Camera and mouse/keyboard control.
 *
 * Two pieces: `CameraRig` is a smoothed orbit camera around a focus point, and
 * `InputController` turns pointer and key events into selections and orders.
 *
 * The order gesture is the fiddly part. This is a 3D game played on a 2D
 * screen, so a right-click alone is ambiguous in height. Holding and dragging
 * vertically lifts the destination off the reference plane, and a stalk is
 * drawn from the plane up to the marker so the altitude is legible before you
 * commit to it. In FLAT mode the altitude axis is disabled outright.
 */
import * as THREE from 'three';
import { WORLD, FACTION, GFX } from './config.js';
import { clamp } from './util.js';
import { LABEL_MODE_NAMES } from './labels.js';

const MAX_RINGS = 640;

const _m4 = new THREE.Matrix4();
const _scale = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _plane = new THREE.Plane();
const _sphere = new THREE.Sphere();
const _hit = new THREE.Vector3();
const _v = new THREE.Vector3();
const _proj = new THREE.Vector3();

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.focus = new THREE.Vector3(0, 0, -400);
    this.theta = Math.PI;
    this.phi = 1.05;
    this.radius = 1500;
    this.minRadius = 90;
    this.maxRadius = 7200;
    // Both radius and focus are chased rather than set, so every camera
    // movement — wheel, keys, or a frame-on — eases instead of snapping.
    this.targetRadius = this.radius;
    this.targetFocus = this.focus.clone();
    this.apply();
  }

  apply() {
    // Never quite reach the poles: at phi = 0 the up vector is undefined and
    // the view flips.
    this.phi = clamp(this.phi, 0.08, Math.PI - 0.08);
    const s = Math.sin(this.phi);
    this.camera.position.set(
      this.focus.x + this.radius * s * Math.sin(this.theta),
      this.focus.y + this.radius * Math.cos(this.phi),
      this.focus.z + this.radius * s * Math.cos(this.theta),
    );
    this.camera.lookAt(this.focus);
  }

  orbit(dx, dy) {
    this.theta -= dx * 0.005;
    this.phi -= dy * 0.005;
  }

  /** Screen-space drag pan, scaled by distance so it feels the same zoomed in. */
  pan(dx, dy) {
    const k = this.radius * 0.0016;
    this.camera.getWorldDirection(_v);
    const right = _v.clone().cross(this.camera.up).normalize();
    const up = right.clone().cross(_v).normalize();
    this.targetFocus.addScaledVector(right, -dx * k);
    this.targetFocus.addScaledVector(up, dy * k);
  }

  /** WASD pan: forward is the view direction flattened, so it stays level. */
  panAxis(fwd, strafe, dt) {
    const k = this.radius * 1.1 * dt;
    this.camera.getWorldDirection(_v);
    _v.y = 0;
    if (_v.lengthSq() < 1e-6) _v.set(0, 0, -1);
    _v.normalize();
    const right = _v.clone().cross(new THREE.Vector3(0, 1, 0)).normalize().negate();
    this.targetFocus.addScaledVector(_v, fwd * k);
    this.targetFocus.addScaledVector(right, strafe * k);
  }

  zoom(delta) {
    // Multiplicative, so a wheel notch covers the same proportion of the
    // remaining distance at every scale.
    this.targetRadius = clamp(this.targetRadius * (1 + delta * 0.0016),
      this.minRadius, this.maxRadius);
  }

  frameOn(point, radius = 500) {
    this.targetFocus.copy(point);
    this.targetRadius = clamp(radius, this.minRadius, this.maxRadius);
  }

  update(dt) {
    const k = Math.min(1, dt * 9);
    this.radius += (this.targetRadius - this.radius) * k;
    this.focus.lerp(this.targetFocus, k);
    this.apply();
  }
}

// ---------------------------------------------------------------------------

export class InputController {
  constructor(app) {
    this.app = app;
    this.rig = app.rig;
    this.dom = app.renderer.domElement;
    this.keys = new Set();
    this.dragging = null;
    this.start = { x: 0, y: 0 };
    this.cur = { x: 0, y: 0 };
    this.orderBase = new THREE.Vector3();
    this.orderPoint = new THREE.Vector3();
    this.orderAltitude = 0;
    this.orderTargetUnit = null;
    this.orderPlaneY = 0;
    this.orderStartY = 0;
    this.orderDragX = 0;
    this.orderDragY = 0;
    this.moved = false;
    this.lastHoverPick = 0;
    this.selectionBox = document.getElementById('selection-box');
    this.buildGizmos();
    this.bind();
  }

  buildGizmos() {
    const scene = this.app.scene.scene;
    this.gizmo = new THREE.Group();
    this.gizmo.visible = false;
    scene.add(this.gizmo);

    const mat = new THREE.MeshBasicMaterial({
      color: 0x7fffd0, transparent: true, opacity: 0.9,
      depthTest: false, side: THREE.DoubleSide,
    });
    this.gizmoMat = mat;

    this.baseRing = new THREE.Mesh(new THREE.RingGeometry(26, 32, 32), mat);
    this.baseRing.rotation.x = -Math.PI / 2;
    this.gizmo.add(this.baseRing);

    // Unit-length stalk, scaled on Y — so the altitude offset needs no
    // geometry rebuild as it drags.
    const stalkGeo = new THREE.BufferGeometry()
      .setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]);
    this.stalk = new THREE.Line(stalkGeo, new THREE.LineBasicMaterial({
      color: 0x7fffd0, transparent: true, opacity: 0.75, depthTest: false,
    }));
    this.gizmo.add(this.stalk);

    this.marker = new THREE.Mesh(new THREE.TorusGeometry(30, 3.5, 8, 28), mat);
    this.gizmo.add(this.marker);
    this.markerInner = new THREE.Mesh(new THREE.SphereGeometry(6, 10, 8), mat);
    this.gizmo.add(this.markerInner);

    // Always on top: an order marker buried inside a hull is useless.
    this.gizmo.renderOrder = 999;
    this.gizmo.traverse((o) => { o.renderOrder = 999; });

    // Selection rings, one instanced mesh for the whole selection.
    this.rings = new THREE.InstancedMesh(
      new THREE.RingGeometry(0.92, 1, 28),
      new THREE.MeshBasicMaterial({
        color: 0x8effc9, transparent: true, opacity: 0.9,
        depthTest: false, side: THREE.DoubleSide,
      }),
      MAX_RINGS,
    );
    this.rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 998;
    this.rings.count = 0;
    scene.add(this.rings);
  }

  updateSelectionRings() {
    const cam = this.app.scene.camera;
    let n = 0;
    for (const u of this.app.selection) {
      if (!u.alive) continue;
      const r = u.type.scale * GFX.hullScale * 3.2 + 14;
      for (const c of u.craft) {
        if (!c.alive || !c.visible || n >= MAX_RINGS) continue;
        // Billboard: copy the camera's rotation so the ring always faces us.
        _m4.compose(c.pos, cam.quaternion, _scale.setScalar(r));
        this.rings.setMatrixAt(n++, _m4);
      }
    }
    this.rings.count = n;
    this.rings.instanceMatrix.needsUpdate = true;
  }

  ndc(x, y) {
    _ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    return _ndc;
  }

  toScreen(pos, out) {
    _proj.copy(pos).project(this.app.scene.camera);
    out.x = (_proj.x * 0.5 + 0.5) * innerWidth;
    out.y = (-_proj.y * 0.5 + 0.5) * innerHeight;
    out.behind = _proj.z > 1;
    return out;
  }

  /** Where a click ray meets the horizontal plane at height `y`. */
  planePoint(x, y, planeY) {
    _ray.setFromCamera(this.ndc(x, y), this.app.scene.camera);
    _plane.set(new THREE.Vector3(0, 1, 0), -planeY);
    if (_ray.ray.intersectPlane(_plane, _hit)) return _hit.clone();
    // Looking at or above the horizon there is no intersection; fall back to
    // a point at the camera's own working distance.
    return _ray.ray.at(this.rig.radius, new THREE.Vector3());
  }

  /** Orders are given relative to the height the selection is already at. */
  referenceHeight() {
    const sel = this.app.selection.filter((u) => u.alive);
    if (!sel.length) return 0;
    return sel.reduce((s, u) => s + u.pos.y, 0) / sel.length;
  }

  /** Nearest squadron whose hull projects within `radius` px of the cursor. */
  pickUnit(x, y, radius = 34) {
    let best = null;
    let bestD = radius * radius;
    const s = { x: 0, y: 0, behind: false };
    for (const u of this.app.game.units) {
      if (!u.alive) continue;
      for (const c of u.craft) {
        if (!c.alive || !c.visible) continue;
        this.toScreen(c.pos, s);
        if (s.behind) continue;
        const dx = s.x - x;
        const dy = s.y - y;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = u; }
      }
    }
    return best;
  }

  unitsInBox(x0, y0, x1, y1, faction) {
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1);
    const top = Math.min(y0, y1);
    const bottom = Math.max(y0, y1);
    const found = new Set();
    const s = { x: 0, y: 0, behind: false };
    for (const u of this.app.game.units) {
      if (!u.alive || u.faction !== faction) continue;
      for (const c of u.craft) {
        if (!c.alive || !c.visible) continue;
        this.toScreen(c.pos, s);
        if (s.behind || s.x < left || s.x > right || s.y < top || s.y > bottom) continue;
        found.add(u);
        break;
      }
    }
    return [...found];
  }

  bind() {
    const dom = this.dom;
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => this.onDown(e));
    // Move and up go on window, so a drag that leaves the canvas still
    // tracks and still commits.
    addEventListener('pointermove', (e) => this.onMove(e));
    addEventListener('pointerup', (e) => this.onUp(e));
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.rig.zoom(e.deltaY);
    }, { passive: false });
    addEventListener('keydown', (e) => this.onKeyDown(e));
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    // Alt-tabbing away with a key held would otherwise leave it stuck down.
    addEventListener('blur', () => this.keys.clear());
  }

  onDown(e) {
    if (this.app.uiBlocking) return;
    this.start.x = e.clientX; this.start.y = e.clientY;
    this.cur.x = e.clientX; this.cur.y = e.clientY;
    this.moved = false;

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      this.dragging = e.shiftKey ? 'pan' : 'orbit';
      e.preventDefault();
      return;
    }
    if (e.button === 0) { this.dragging = 'select'; return; }
    if (e.button === 2) {
      if (!this.app.selection.length) return;
      this.dragging = 'order';
      this.orderPlaneY = this.referenceHeight();
      this.orderStartY = e.clientY;
      this.orderDragX = e.clientX;
      this.orderDragY = 0;
      this.orderBase.copy(this.planePoint(e.clientX, e.clientY, this.orderPlaneY));
      this.orderAltitude = 0;
      this.orderPoint.copy(this.orderBase);
      this.orderTargetUnit = this.pickUnit(e.clientX, e.clientY);
      this.orderOnPlanet = this.pointsAtPlanet(e.clientX, e.clientY);
      this.showGizmo();
    }
  }

  pointsAtPlanet(x, y) {
    _ray.setFromCamera(this.ndc(x, y), this.app.scene.camera);
    _sphere.center.set(...WORLD.planetCenter);
    _sphere.radius = WORLD.planetRadius;
    return _ray.ray.intersectsSphere(_sphere);
  }

  onMove(e) {
    const dx = e.clientX - this.cur.x;
    const dy = e.clientY - this.cur.y;
    this.cur.x = e.clientX;
    this.cur.y = e.clientY;
    if (Math.abs(e.clientX - this.start.x) + Math.abs(e.clientY - this.start.y) > 4) {
      this.moved = true;
    }

    if (this.dragging) {
      this.app.hoverUnit = null;
    } else {
      // Hover picking is O(craft) and runs off raw pointer moves, so rate-limit
      // it rather than doing it per event.
      const now = performance.now();
      if (now - this.lastHoverPick > 60) {
        this.lastHoverPick = now;
        this.app.hoverUnit = this.pickUnit(e.clientX, e.clientY);
      }
    }

    switch (this.dragging) {
      case 'orbit': this.rig.orbit(dx, dy); break;
      case 'pan': this.rig.pan(dx, dy); break;
      case 'select': this.updateSelectionBox(); break;
      case 'order': {
        // Horizontal drag moves the ground point; vertical drag is altitude.
        // The ground point is re-projected at the ORIGINAL screen Y, so
        // lifting the marker does not also walk it away from you.
        this.orderDragX = e.clientX;
        this.orderDragY += dy;
        this.orderBase.copy(this.planePoint(this.orderDragX, this.orderStartY, this.orderPlaneY));
        this.orderAltitude = WORLD.flat ? 0 : -this.orderDragY * this.rig.radius * 0.0018;
        this.orderPoint.copy(this.orderBase);
        this.orderPoint.y += this.orderAltitude;
        this.orderTargetUnit = this.pickUnit(e.clientX, e.clientY);
        this.orderOnPlanet = this.pointsAtPlanet(e.clientX, e.clientY);
        this.showGizmo();
        break;
      }
    }
  }

  onUp(e) {
    const was = this.dragging;
    this.dragging = null;
    if (this.selectionBox) this.selectionBox.style.display = 'none';

    if (was === 'select') {
      const add = e.shiftKey;
      if (this.moved) {
        const picked = this.unitsInBox(this.start.x, this.start.y,
          e.clientX, e.clientY, this.app.playerFaction);
        this.app.setSelection(add ? [...this.app.selection, ...picked] : picked);
      } else {
        const u = this.pickUnit(e.clientX, e.clientY);
        if (u && u.faction === this.app.playerFaction) {
          this.app.setSelection(add ? [...this.app.selection, u] : [u]);
        } else if (!add) {
          this.app.setSelection([]);
        }
      }
    } else if (was === 'order') {
      this.commitOrder(e);
      this.gizmo.visible = false;
    }
  }

  /**
   * Turn the release into an order.
   *
   * The pick is redone here from the release coordinates rather than reusing
   * `orderTargetUnit`. That field is only as fresh as the last pointermove,
   * and a click with no movement never produces one — which used to make a
   * right-click straight onto an enemy issue a plain move.
   */
  commitOrder(e) {
    const sel = this.app.selection.filter((u) => u.alive);
    if (!sel.length) return;

    const under = this.pickUnit(e.clientX, e.clientY);
    const onPlanet = this.pointsAtPlanet(e.clientX, e.clientY);
    const mine = this.app.playerFaction;
    const enemy = under && under.faction !== mine ? under : null;
    const friend = under && under.faction === mine ? under : null;

    if (friend) { this.app.orderDefend(sel, friend); return; }
    if (!enemy && onPlanet) {
      // The planet means opposite things to the two sides.
      if (mine === FACTION.ATTACK) this.app.orderSiege(sel);
      else this.app.orderDefend(sel, 'planet');
      return;
    }

    // Spread multiple squadrons over a grid so they do not all fly at one
    // point and grind against each other on arrival.
    const spacing = 130;
    const cols = Math.ceil(Math.sqrt(sel.length));
    const rows = Math.ceil(sel.length / cols);
    sel.forEach((u, i) => {
      if (enemy) {
        u.order(enemy.pos, { attack: enemy, stance: 'attack' });
        return;
      }
      const cx = i % cols;
      const cz = Math.floor(i / cols);
      _v.copy(this.orderPoint).add(new THREE.Vector3(
        (cx - (cols - 1) / 2) * spacing, 0, (cz - (rows - 1) / 2) * spacing));
      u.order(_v, { attack: null, stance: 'move' });
    });

    this.app.recorder.log('order', {
      kind: enemy ? 'attack-target' : 'move',
      at: [Math.round(this.orderPoint.x), Math.round(this.orderPoint.y),
        Math.round(this.orderPoint.z)],
      target: enemy ? enemy.label : undefined,
      units: sel.map((u) => u.label),
    });
    this.app.flashOrder(this.orderPoint.clone(), !!enemy);
  }

  showGizmo() {
    this.gizmo.visible = true;
    this.baseRing.position.copy(this.orderBase);
    this.marker.position.copy(this.orderPoint);
    this.markerInner.position.copy(this.orderPoint);
    this.marker.quaternion.copy(this.app.scene.camera.quaternion);

    const lift = this.orderPoint.y - this.orderBase.y;
    this.stalk.position.copy(this.orderBase);
    this.stalk.scale.set(1, lift, 1);
    this.stalk.visible = Math.abs(lift) > 1;

    // Colour tells you what the release will actually do before you do it.
    const u = this.orderTargetUnit;
    const mine = this.app.playerFaction;
    const isAttack = u && u.faction !== mine;
    const isDefend = (u && u.faction === mine)
      || (!u && this.orderOnPlanet && mine === FACTION.DEFENSE);
    const isSiege = !isAttack && !isDefend && this.orderOnPlanet
      && mine === FACTION.ATTACK;
    this.gizmoMat.color.set(
      isSiege ? 0xffb01e : isAttack ? 0xff6b5a : isDefend ? 0x8fd0ff : 0x7fffd0);
  }

  updateSelectionBox() {
    const box = this.selectionBox;
    if (!box) return;
    box.style.display = 'block';
    box.style.left = `${Math.min(this.start.x, this.cur.x)}px`;
    box.style.top = `${Math.min(this.start.y, this.cur.y)}px`;
    box.style.width = `${Math.abs(this.cur.x - this.start.x)}px`;
    box.style.height = `${Math.abs(this.cur.y - this.start.y)}px`;
  }

  onKeyDown(e) {
    // Escape has to work even while a modal is up — it is how you close one.
    if (e.code === 'Escape' && this.app.hud.confirmOpen) {
      this.app.hud.closeConfirm(false);
      return;
    }
    if (this.app.uiBlocking && e.code !== 'Escape') return;
    this.keys.add(e.code);
    const app = this.app;

    switch (e.code) {
      case 'Space': e.preventDefault(); app.togglePause(); break;
      case 'KeyQ': app.castSelected(); break;
      case 'KeyH':
        app.setStance(app.selection.every((u) => u.stance === 'hold') ? 'move' : 'hold');
        break;
      case 'KeyG': app.orderDefend(app.selection.filter((u) => u.alive), 'planet'); break;
      case 'KeyT':
        for (const u of app.selection) u.autocast = !u.autocast;
        app.hud.refreshPanel();
        break;
      case 'KeyF': app.toggleShields(); break;
      case 'KeyV': app.setStance('attack'); break;
      case 'KeyM': app.setStance('move'); break;
      case 'Tab':
        e.preventDefault();
        app.hud.flashMessage(app.hud.roster.toggle()
          ? 'Fleet list minimised — press Tab to bring it back.'
          : 'Fleet list shown.', 1.8);
        break;
      case 'KeyC': {
        const sel = app.selection.filter((u) => u.alive);
        if (sel.length) {
          _v.set(0, 0, 0);
          for (const u of sel) _v.add(u.pos);
          _v.divideScalar(sel.length);
          this.rig.frameOn(_v, 620);
        }
        break;
      }
      case 'KeyE': app.selectAll(); break;
      case 'KeyB': app.toggleGrid(); break;
      case 'KeyK': app.toggleLook(); break;
      case 'Enter':
      case 'NumpadEnter':
        if (app.inPrep) app.beginBattle();
        break;
      case 'KeyL':
        app.hud.flashMessage(
          `Squadron tags: ${LABEL_MODE_NAMES[app.labels.cycleMode()]}`, 1.8);
        break;
      case 'Escape': app.onEscape(); break;
      case 'BracketLeft': app.stepSpeed(-1); break;
      case 'BracketRight': app.stepSpeed(1); break;
    }

    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= 9) {
        if (e.ctrlKey || e.metaKey) app.assignGroup(n);
        else app.selectGroup(n);
      }
    }
  }

  update(dt) {
    let fwd = 0;
    let strafe = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fwd += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fwd -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) strafe += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) strafe -= 1;
    if (fwd || strafe) this.rig.panAxis(fwd, strafe, dt);

    const lift = this.rig.radius * dt * 0.7;
    if (this.keys.has('KeyR')) this.rig.targetFocus.y += lift;
    if (this.keys.has('KeyX')) this.rig.targetFocus.y -= lift;

    this.updateSelectionRings();
  }
}
