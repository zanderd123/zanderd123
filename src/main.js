/**
 * The application shell.
 *
 * Owns the frame loop and wires everything together: scene, renderer, camera,
 * simulation, AI, and DOM. Nothing else in the codebase reaches across
 * subsystem boundaries — the Game does not know there is a HUD, the HUD does
 * not know there is a renderer, and this file is where those two facts are
 * reconciled.
 *
 * There is exactly one loop, and it is here.
 */
import * as THREE from 'three';
import {
  WORLD, GFX, GFX_PRESETS, FACTION, SPEEDS, DEFAULT_SPEED_INDEX,
  budgetFor, setGfxPreset, setPlayMode,
} from './config.js';
import { SpaceScene } from './scene.js';
import { FleetRenderer } from './render.js';
import { Game } from './game.js';
import { Commander, generateFleet } from './ai.js';
import { CameraRig, InputController } from './input.js';
import { Builder, Hud } from './ui.js';
import { Minimap } from './minimap.js';
import { UnitLabels } from './labels.js';
import { OrderOverlay } from './overlay.js';
import { Recorder } from './recorder.js';
import { preloadExternalHulls } from './hulls.js';

class App {
  constructor() {
    this.scene = new SpaceScene(document.getElementById('view'));
    this.renderer = this.scene.renderer;
    this.fleet = new FleetRenderer(this.scene.scene);
    this.rig = new CameraRig(this.scene.camera, this.renderer.domElement);
    this.game = new Game(this.fleet);

    this.selection = [];
    this.groups = new Map();
    this.hoverUnit = null;
    // Blocked until a battle starts — the builder is up and clicks belong to it.
    this.uiBlocking = true;
    this.speedIndex = DEFAULT_SPEED_INDEX;
    this.setup = null;

    this.hud = new Hud(this);
    this.minimap = new Minimap(document.getElementById('minimap'), this,
      { onExpand: () => this.openBigMap() });
    this.bigmap = new Minimap(document.getElementById('bigmap-canvas'), this,
      { interactive: true });
    this.bigmapEl = document.getElementById('bigmap');
    document.getElementById('bigmap-close')
      .addEventListener('click', () => this.closeBigMap());
    document.getElementById('bigmap-reset')
      .addEventListener('click', () => this.bigmap.reset());
    document.getElementById('bigmap-canvas').addEventListener('pointerup', (e) => {
      // A click jumps the camera and dismisses the map; a drag was a pan and
      // should leave it open.
      const panned = this.bigmap.panFrom && this.bigmap.panFrom.moved;
      this.bigmap.endClick(e);
      if (!panned) this.closeBigMap();
    });

    this.labels = new UnitLabels(document.body, this);
    this.overlay = new OrderOverlay(this.scene.scene);
    this.recorder = new Recorder(this);
    this.input = new InputController(this);
    this.builder = new Builder((setup) => this.startBattle(setup));

    setGfxPreset('cinematic');

    this.clock = new THREE.Clock();
    this.hoverPos = { x: 0, y: 0 };
    addEventListener('pointermove', (e) => {
      this.hoverPos.x = e.clientX;
      this.hoverPos.y = e.clientY;
    });

    // One frame to get the shaders compiled and the env map baked, plus the
    // imported hull decode, before the loading screen comes down.
    Promise.all([
      new Promise((r) => requestAnimationFrame(r)),
      preloadExternalHulls(),
    ]).then(() => {
      this.scene.render();
      document.getElementById('loading').classList.add('hidden');
      this.builder.show();
      this.builder.refresh();
    });

    this.loop();
  }

  get playerFaction() { return this.game.playerFaction; }

  startBattle(setup) {
    this.setup = setup;
    this.builder.hide();
    this.hud.hideEnd();
    this.hud.show();
    this.uiBlocking = false;

    // Play mode changes the arena's dimensions, so the shell is rebuilt.
    setPlayMode(setup.mode || 'volume');
    this.scene.rebuildArena();
    this.scene.applyGfx();
    this.hud.setLookUI(GFX.preset);

    const enemy = setup.side === FACTION.ATTACK ? FACTION.DEFENSE : FACTION.ATTACK;
    const enemyRoster = generateFleet(
      budgetFor(enemy, setup.budget), enemy, (Date.now() % 100000) | 0);

    this.game.reset();
    this.game.start(setup.roster, enemyRoster, setup.side);
    this.game.onEnd = (state) => this.onBattleEnd(state);
    this.game.onHatch = (parent, brood) => this.onBroodHatch(parent, brood);
    this.game.onAutoSiege = (unit) => this.hud.flashMessage(
      `${unit.label} has a clear lane — commencing bombardment. It will not defend itself.`, 3.4);

    this.commander = new Commander(this.game, enemy, setup.difficulty);

    this.setSelection([]);
    this.groups.clear();
    this.speedIndex = DEFAULT_SPEED_INDEX;
    this.game.speed = SPEEDS[this.speedIndex];
    this.game.paused = false;
    this.hud.setSpeedUI(this.speedIndex, false);

    document.getElementById('you-name').textContent =
      setup.side === FACTION.ATTACK ? 'YOUR ASSAULT FLEET' : 'YOUR DEFENCE FLEET';
    document.getElementById('enemy-name').textContent =
      setup.side === FACTION.ATTACK ? 'PLANETARY DEFENCE' : 'ENEMY ASSAULT';

    this.recorder.battleStarted(setup, this.game);
    this.frameOnOwnFleet();
    this.beginPrep();
  }

  get inPrep() { return this.game.state === 'prep'; }

  /**
   * The planning phase. The world is live and rendering, but nothing moves —
   * so orders can be laid out in full before anything is committed.
   */
  beginPrep() {
    this.game.state = 'prep';
    this.game.paused = false;
    this.overlay.setGrid(true);
    this.hud.setGridUI(true);
    this.hud.showPrep(this.playerFaction);
  }

  beginBattle() {
    if (!this.inPrep) return;
    this.recorder.log('begin-battle', {});
    this.game.state = 'playing';
    this.hud.hidePrep();
    this.hud.setSpeedUI(this.speedIndex, false);
    this.hud.flashMessage(
      'Battle underway — your fleet is carrying out its opening orders.', 3, 'info');
  }

  /** Swap the graphics preset, and re-frame so the fleet stays the same size. */
  toggleLook() {
    const next = GFX.preset === 'cinematic' ? 'classic' : 'cinematic';
    setGfxPreset(next);
    this.scene.applyGfx();
    this.fleet.applyGfx(this.game.units);

    // CINEMATIC draws bigger hulls and pulls the camera in. Scaling the
    // current radius by the ratio keeps the view you already had, rather than
    // snapping to a default.
    const ratio = GFX.camScale / (this.lastCamScale ?? 1);
    this.lastCamScale = GFX.camScale;
    this.rig.targetRadius = Math.max(this.rig.minRadius, this.rig.targetRadius * ratio);

    this.hud.setLookUI(GFX.preset);
    this.hud.flashMessage(`${GFX_PRESETS[next].label} look — ${next === 'cinematic'
      ? 'bigger hulls, closer camera, shadows on.'
      : 'the original look, shadows off.'}`, 2.4);
    return GFX.preset;
  }

  get gfx() { return GFX; }

  toggleGrid() {
    const on = this.overlay.toggleGrid();
    this.hud.setGridUI(on);
    this.hud.flashMessage(on
      ? 'Grid on — the stalk under each hull shows its height above the plane.'
      : 'Grid off.', 1.8);
  }

  /**
   * Point the camera at the player's fleet with the objective behind it, and
   * back off far enough to actually contain the formation.
   *
   * The distance is fitted rather than fixed: a fixed radius sliced the front
   * rank off a deep fleet at CINEMATIC's camera scale. The preset's pull-in is
   * treated as a floor, and the camera backs off toward the classic radius
   * when the fleet needs the room.
   */
  frameOnOwnFleet() {
    const units = this.game.playerUnits;
    if (!units.length) return;

    const centre = new THREE.Vector3();
    for (const u of units) centre.add(u.pos);
    centre.divideScalar(units.length);

    // Bias the focus toward the planet, so the objective is in shot.
    const planet = new THREE.Vector3(...WORLD.planetCenter);
    this.rig.targetFocus.copy(centre).lerp(planet, WORLD.camLead * GFX.camScale);
    this.rig.focus.copy(this.rig.targetFocus);
    this.rig.theta = this.playerFaction === FACTION.ATTACK ? Math.PI : 0;
    this.rig.phi = WORLD.camPhi;

    let reach = 0;
    const halfFov = THREE.MathUtils.degToRad(this.scene.camera.fov) * 0.5;
    for (const u of units) {
      for (const c of u.craft) {
        if (!c.alive) continue;
        // Include the hull's own drawn size, or the outermost ship is framed
        // with its nose out of shot.
        reach = Math.max(reach, c.pos.distanceTo(this.rig.targetFocus)
          + u.type.scale * GFX.hullScale);
      }
    }
    const needed = (reach / Math.tan(halfFov)) * 1.05;
    const radius = Math.min(WORLD.camRadius,
      Math.max(WORLD.camRadius * GFX.camScale, needed));

    this.lastCamScale = GFX.camScale;
    this.rig.targetRadius = radius;
    this.rig.radius = radius;
    this.rig.apply();
  }

  resetBattle() {
    if (!this.setup) return;
    this.hud.hideEnd();
    this.startBattle(this.setup);
  }

  backToBuilder() {
    this.hud.hideEnd();
    this.hud.hidePrep();
    this.hud.hide();
    this.game.reset();
    this.labels.clear();
    this.overlay.clear();
    this.setSelection([]);
    this.uiBlocking = true;
    this.builder.show();
    this.builder.refresh();
  }

  onBattleEnd(state) {
    this.uiBlocking = true;
    this.recorder.battleEnded(state, this.game);
    this.hud.showEnd(state, this.game);
  }

  get bigMapOpen() { return !this.bigmapEl.classList.contains('hidden'); }

  openBigMap() {
    if (this.game.state !== 'playing' && !this.inPrep) return;
    this.bigmap.cx = this.rig.focus.x;
    this.bigmap.cz = this.rig.focus.z;
    this.bigmapEl.classList.remove('hidden');
    // It was hidden, so its canvas had no size until now.
    this.bigmap.resize();
    this.bigmap.draw(this.game);
  }

  closeBigMap() { this.bigmapEl.classList.add('hidden'); }

  onEscape() {
    if (this.bigMapOpen) { this.closeBigMap(); return; }
    if (this.selection.length) this.setSelection([]);
  }

  setSelection(units) {
    const seen = new Set();
    this.selection = units.filter((u) => {
      if (!u || !u.alive || u.faction !== this.playerFaction || seen.has(u)) return false;
      seen.add(u);
      return true;
    });
    for (const u of this.game.units) u.selected = false;
    for (const u of this.selection) u.selected = true;
    this.hud.refreshPanel();
  }

  selectAll() { this.setSelection(this.game.playerUnits); }

  /**
   * Commit squadrons to bombarding the planet. A siege lock is a real
   * commitment — a locked hull stops defending itself — so the failures are
   * reported individually rather than silently doing nothing.
   */
  orderSiege(units) {
    if (this.playerFaction !== FACTION.ATTACK) {
      this.hud.flashMessage('Only the assault can bombard the planet.');
      return;
    }
    if (!this.game.planet || !this.game.planet.alive) return;

    const enemyCraft = this.game.craftOf(
      this.playerFaction === FACTION.ATTACK ? FACTION.DEFENSE : FACTION.ATTACK);
    let locked = 0;
    let blocked = 0;
    let incapable = 0;
    let dps = 0;

    for (const u of units) {
      if (!u.alive) continue;
      if (!u.canSiege) { incapable++; continue; }
      if (!u.clearToSiege(enemyCraft)) { blocked++; continue; }
      if (u.beginSiege()) { locked++; dps += u.siegeDps; }
    }

    if (locked) {
      this.fleet.bubble(new THREE.Vector3(...WORLD.planetCenter),
        WORLD.planetRadius * 1.5, this.playerFaction, 0xffb01e);
      const eta = this.game.planet
        ? ` — about ${Math.max(1, Math.round(this.game.planet.maxHealth / Math.max(1, dps)))}s to break the crust at that rate`
        : '';
      this.recorder.log('siege', { units: locked, dps: Math.round(dps) });
      this.hud.flashMessage(
        `${locked} unit${locked > 1 ? 's' : ''} bombarding at ${Math.round(dps)}/s${eta}. They will not defend themselves.`, 4.2);
    } else if (blocked) {
      this.hud.flashMessage(
        'Cannot lock on: enemy ships are inside weapon range. Clear them first.');
    } else if (incapable) {
      this.hud.flashMessage(
        'Emplacements cannot bombard — they are bolted to the planet.');
    }
    this.hud.refreshPanel();
  }

  assignGroup(n) {
    if (this.selection.length) this.groups.set(n, [...this.selection]);
  }

  selectGroup(n) {
    const g = this.groups.get(n);
    if (g) this.setSelection(g.filter((u) => u.alive));
  }

  setStance(stance, { announce = true } = {}) {
    const sel = this.selection.filter((u) => u.alive);
    if (!sel.length) {
      if (announce) this.hud.flashMessage('Select a squadron first.');
      return;
    }
    for (const u of sel) {
      u.stance = stance;
      // Leaving DEFEND drops the escort assignment with it.
      if (stance !== 'defend') u.guardTarget = null;
    }
    this.recorder.log('stance', { stance, units: sel.map((u) => u.label) });

    if (announce) {
      const who = `${sel.length} squadron${sel.length > 1 ? 's' : ''}`;
      const line = {
        attack: `${who} set to ATTACK — closest enemy first, answering anything that shoots them, and taking a clear shot at the planet if one opens.`,
        move: `${who} set to MOVE — they will hold station and fire at what comes in range.`,
        hold: `${who} set to HOLD — frozen in place, still firing at anything in range.`,
        defend: `${who} set to DEFEND.`,
      }[stance];
      if (line) this.hud.flashMessage(line);
    }
    this.hud.refreshPanel();
  }

  orderDefend(units, target) {
    const sel = (units || []).filter((u) => u.alive);
    if (!sel.length) { this.hud.flashMessage('Select a squadron first.'); return; }
    if (target !== 'planet' && (!target || !target.alive)) return;

    let posted = 0;
    for (const u of sel) if (u.defend(target)) posted++;
    if (!posted) {
      this.hud.flashMessage('A squadron cannot be posted to guard itself.');
      return;
    }

    const name = target === 'planet' ? 'the planet' : target.label;
    this.hud.flashMessage(
      `${posted} squadron${posted > 1 ? 's' : ''} now defending ${name} — they will stay with it and answer anything that attacks it.`);
    this.fleet.bubble(
      target === 'planet' ? new THREE.Vector3(...WORLD.planetCenter) : target.pos.clone(),
      target === 'planet' ? WORLD.planetRadius * 1.4 : 120,
      this.playerFaction, 0x8fd0ff);
    this.hud.refreshPanel();
  }

  toggleShields() {
    const sel = this.selection.filter((u) => u.alive);
    if (!sel.length) return;
    // If anything could still raise, the toggle raises; otherwise it lowers.
    const up = sel.some((u) => !u.shieldOn && u.canRaiseShield);
    for (const u of sel) u.toggleShield(up);
    this.recorder.log('shields', { up, units: sel.map((u) => u.label) });
    this.hud.refreshPanel();
  }

  castSelected() {
    for (const u of this.selection) {
      if (!u.alive || !u.abilityReady) continue;
      this.recorder.log('ability', { unit: u.label, ability: u.type.ability.name });
      this.game.castFor(u);
    }
    this.hud.refreshPanel();
  }

  onBroodHatch(parent, brood) {
    if (brood.faction !== this.playerFaction) return;
    this.hud.roster.pulse(brood.id);
    const cap = parent.type.spawns?.cap ?? 0;
    if (brood.count === 1) {
      this.hud.flashMessage(
        `${parent.label} launched ${brood.label} — a new squadron, select and order it like any other.`, 4.2, 'info');
    } else {
      this.hud.flashMessage(`${brood.label} +1 — ${brood.count} of ${cap} hulls.`, 1.8, 'info');
    }
  }

  /** Planet scorch and the arena wall's glow, both driven off the simulation. */
  updateWorldFeedback(dt) {
    const game = this.game;
    if (game.planet) {
      this.scene.setPlanetDamage(game.planet.fraction,
        Math.max(0, game.planet.hitFlash || 0));
    }
    let press = 0;
    for (const u of game.units) {
      if (!u.alive || u.faction !== this.playerFaction) continue;
      for (const c of u.craft) {
        if (c.alive && c.wallPress > press) press = c.wallPress;
      }
    }
    // Smoothed, or the wall strobes as individual hulls graze it.
    this.wallGlow = (this.wallGlow ?? 0)
      + (press - (this.wallGlow ?? 0)) * Math.min(1, dt * 5);
    this.scene.setWallPressure(this.wallGlow);
  }

  flashOrder(at, isAttack) {
    this.fleet.bubble(at, 70, this.playerFaction, isAttack ? 0xff6b5a : 0x7fffd0);
  }

  togglePause() {
    if (this.inPrep) {
      this.hud.flashMessage(
        'Still in preparation — press Enter, or BEGIN BATTLE, to start.', 2.2);
      return;
    }
    if (this.game.state !== 'playing') return;
    this.game.paused = !this.game.paused;
    this.hud.setSpeedUI(this.speedIndex, this.game.paused);
  }

  setSpeedIndex(i) {
    if (this.inPrep) return;
    this.speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, i));
    this.game.speed = SPEEDS[this.speedIndex];
    // Touching the speed control means you want it running.
    if (this.game.paused) this.game.paused = false;
    this.hud.setSpeedUI(this.speedIndex, this.game.paused);
  }

  stepSpeed(delta) { this.setSpeedIndex(this.speedIndex + delta); }

  loop() {
    requestAnimationFrame(() => this.loop());
    // Cap the step: a backgrounded tab returns with a huge delta, and the
    // simulation would try to catch up all at once.
    const dt = Math.min(this.clock.getDelta(), 0.1);

    if (dt > 0) {
      this.frameMs = this.frameMs
        ? this.frameMs + (dt * 1000 - this.frameMs) * 0.06
        : dt * 1000;
      this.fpsTimer = (this.fpsTimer || 0) + dt;
      if (this.fpsTimer > 0.25) {
        this.fpsTimer = 0;
        this.hud.setFps(1000 / this.frameMs);
      }
    }

    // Camera and scene always update, even behind a modal — a frozen view
    // behind a dialog reads as a crash.
    this.input.update(dt);
    this.rig.update(dt);
    this.scene.update(dt);
    this.scene.followShadow(this.rig.focus);

    if (!this.uiBlocking || this.game.state !== 'playing') {
      this.game.update(dt);
      if (this.commander && !this.game.paused && this.game.state === 'playing') {
        // The AI thinks in simulated time, so speeding the game up speeds up
        // its decisions too.
        this.commander.update(dt * this.game.speed);
      }
      this.game.drawTracers();
      this.hud.update(this.game);
      this.minimap.update(dt, this.game);
      if (this.bigMapOpen) this.bigmap.update(dt, this.game);
      this.fleet.syncShields(this.game.units, dt);
      this.labels.update(this.game);
      this.hud.roster.update(this.game, dt);
      this.overlay.update(this.game, this.selection, { showAllOrders: this.inPrep });
      this.recorder.update(this.game);
      this.updateWorldFeedback(dt);
      this.hud.showHover(this.hoverUnit, this.hoverPos.x, this.hoverPos.y,
        this.playerFaction);
    }

    this.scene.render();
  }
}

const app = new App();
window.__app = app;
