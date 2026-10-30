'use strict';
// Core game state: the player, overworld movement, rendering, field menus,
// money, saving. Battles live in battle.js, NPC scripts in scripts.js.

const VIEW_W = 304, VIEW_H = 224;
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
const OLD_SAVE_KEY = 'adulting-quest-save-v1';

const Saves = {
  slots: ['1', '2', '3'],
  key: (slot) => 'aq-save-' + slot,
  read(slot) {
    try {
      const d = JSON.parse(localStorage.getItem(this.key(slot)) || 'null');
      return d && d.p ? d : null;
    } catch (e) { return null; }
  },
  write(slot, p) {
    try { localStorage.setItem(this.key(slot), JSON.stringify({ v: 2, p, at: Date.now() })); return true; }
    catch (e) { return false; }
  },
  // the single save from earlier versions becomes Slot 1
  migrate() {
    try {
      const old = localStorage.getItem(OLD_SAVE_KEY);
      if (old && !this.read('1')) {
        const d = JSON.parse(old);
        if (d && d.p) this.write('1', d.p);
      }
      if (old) localStorage.removeItem(OLD_SAVE_KEY);
    } catch (e) { /* storage unavailable */ }
  },
  any() { return ['auto', ...this.slots].some((s) => this.read(s)); },
  label(slot) { return slot === 'auto' ? 'AUTO' : 'SLOT ' + slot; },
  summary(d) {
    const p = d.p, m = Math.floor((p.playTime || 0) / 60);
    return `${p.name} · ${(p.badges || []).length}/8 · Lv${p.level} · ${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
  },
  when(d) {
    if (!d.at) return '';
    const t = new Date(d.at);
    return 'Saved ' + t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  },
  row(slot) {
    const d = this.read(slot);
    return { label: this.label(slot), right: d ? this.summary(d) : 'EMPTY', desc: d ? `${this.when(d)}<br>Age ${18 + Math.floor((d.p.badges || []).length * 1.75)} · ${U.money(d.p.money)} · ${(PATHS[d.p.path] || {}).name || 'No path yet'}` : 'An empty slot.' };
  },
  // MENU > SAVE GAME (and chapels): pick a slot and save there.
  async saveMenu() {
    if (Battle.active) { await UI.say('You can\'t save in the middle of a battle.'); return; }
    const since = Game.lastSave != null ? Math.floor((Game.p.playTime - Game.lastSave) / 60) : null;
    let done = false;
    await UI.list(() => this.slots.map((s) => this.row(s)), {
      title: 'SAVE GAME', start: Game.slot ? this.slots.indexOf(Game.slot) : 0,
      hint: 'Saves stay on this device.',
      headRight: () => (since == null ? '' : since < 1 ? 'SAVED JUST NOW' : `SAVED ${since} MIN AGO`),
      footer: () => 'A: save here · B: back',
      onAct: async (k) => {
        const slot = this.slots[k];
        if (this.read(slot) && !(await UI.confirm(`Overwrite ${this.label(slot)}?`))) { UI.closeDialog(); return 'keep'; }
        const ok = Game.save(slot);
        if (ok) Audio2.sfx('save');
        await UI.say(ok ? `Game saved to ${slot === 'auto' ? 'the autosave' : this.label(slot)} on this device.` : 'Couldn\'t save. Your browser is blocking storage (private window?).');
        UI.closeDialog();
        done = ok;
        return ok ? 'close' : 'keep';
      },
    });
    return done;
  },
  // title screen: pick a save to continue
  async loadMenu() {
    const slots = ['auto', ...this.slots].filter((s) => this.read(s));
    const k = await UI.list(slots.map((s) => this.row(s)), { title: 'CONTINUE', footer: () => 'A: load · B: back' });
    if (k < 0) return null;
    Game.slot = slots[k] === 'auto' ? null : slots[k];
    return this.read(slots[k]).p;
  },
};

// Stat formulas (Pokemon-style). Sanity = HP, Confidence = attack,
// Composure = defence, Hustle = speed.
const Stats = {
  of(p) {
    const b = (PATHS[p.path] || PATHS.college).base, L = p.level;
    return {
      maxSanity: Math.floor(4 * b.san * L / 100) + 3 * L + 20,
      conf: Math.floor(2 * b.conf * L / 100) + 5,
      comp: Math.floor(2 * b.comp * L / 100) + 5,
      hus: Math.floor(2 * b.hus * L / 100) + 5,
      maxEnergy: 18 + 2 * L + b.energy,
    };
  },
  xpFor(L) { return Math.floor(0.8 * L * L * L); },
  foe(id, L) {
    const d = ISSUES[id], [h, a, df, s] = d.base;
    return {
      id, def: d, name: d.name, type: d.type, lvl: L,
      maxHp: Math.floor(2 * h * L / 100) + L + 10,
      atk: Math.floor(2 * a * L / 100) + 5,
      dfn: Math.floor(2 * df * L / 100) + 5,
      spd: Math.floor(2 * s * L / 100) + 5,
    };
  },
};

const Game = {
  mode: 'boot',
  p: null,
  map: null,
  pos: { x: 0, y: 0, dir: 'down', moving: false, mt: 0, tx: 0, ty: 0, parity: 0, turnT: 0, justArrived: false, bumpT: 0 },
  busy: 0,
  fade: 0,
  flash: 0,
  time: 0,
  waterT: 0, waterF: 0,
  lastRegion: -1,
  titleCam: 0,
  ctx: null,

  // ------------------------------------------------------------ player
  newPlayer(name, hero = 'boy') {
    return {
      name, hero, path: null, level: 5, xp: Stats.xpFor(5), sanity: 30, energy: 20, status: null,
      known: ['wing_it'], equipped: ['wing_it'], items: {}, money: 0, debt: 0, karma: 50,
      badges: [], flags: {}, outfit: HEROES[hero].pal.c, crew: [], lead: 'me', momCall: -1e9, stats: { issues: 0, meltdowns: 0 }, repel: 0, steps: 0, playTime: 0,
      respawn: { map: 'house-0-0', x: 10, y: 6, dir: 'right' },
      map: 'house-0-0', x: 2, y: 3, dir: 'down',
    };
  },
  stats() { return Stats.of(this.p); },
  // 18 out of high school, 32 when all eight leaders are done
  age() { return 18 + Math.floor(this.p.badges.length * 1.75); },
  heroPal() { const H = HEROES[this.p.hero] || HEROES.boy; return { ...H.pal, c: this.p.outfit }; },
  heroLook() { return (HEROES[this.p.hero] || HEROES.boy).look; },
  playableDone() { return LEADER_ORDER.every((k) => LEADERS[k].locked || this.p.badges.includes(k)); },
  fullHeal() { Crew.healAll(); },
  fmt(t) { return String(t).replace(/\{NAME\}/g, this.p ? this.p.name : 'YOU'); },
  karmaLabel(k = this.p.karma) {
    return k < 20 ? 'Menace' : k < 40 ? 'Sketchy' : k < 65 ? 'Decent' : k < 85 ? 'Good Egg' : 'Saint';
  },
  addKarma(n) { this.p.karma = U.clamp(this.p.karma + n, 0, 100); },
  priceOf(id) {
    let pr = ITEMS[id].price;
    if (this.p.karma < 30) pr = Math.ceil(pr * 1.25);
    else if (this.p.karma >= 80) pr = Math.floor(pr * 0.9);
    return pr;
  },
  give(id, n = 1) { this.p.items[id] = (this.p.items[id] || 0) + n; },
  take(id, n = 1) { this.p.items[id] = Math.max(0, (this.p.items[id] || 0) - n); if (!this.p.items[id]) delete this.p.items[id]; },
  // Earnings: 10% goes to any outstanding debt.
  earn(amt) {
    const p = this.p;
    amt = Math.floor(amt);
    let g = 0;
    if (p.debt > 0) { g = Math.min(p.debt, Math.ceil(amt * 0.1)); p.debt -= g; }
    p.money += amt - g;
    return { net: amt - g, garnished: g };
  },
  learn(id) {
    const p = this.p;
    if (p.known.includes(id)) return false;
    p.known.push(id);
    if (p.equipped.length < 4) p.equipped.push(id);
    return true;
  },
  gateOpen(ri) {
    const r = ROUTES[ri];
    if (r.gateFlag === 'path') return !!this.p.path;
    return this.p.badges.length >= r.need;
  },

  // ------------------------------------------------------------ maps & warps
  enter(mapId, x, y, dir) {
    this.map = World.maps[mapId];
    const P = this.pos;
    Object.assign(P, { x, y, tx: x, ty: y, dir: dir || P.dir, moving: false, mt: 0 });
    this.p.map = mapId; this.p.x = x; this.p.y = y; this.p.dir = P.dir;
    this.lastRegion = -2;
    this.updateMusic();
    this.checkRegion();
  },
  updateMusic() {
    if (this.mode !== 'world') return;
    if (this.map.id !== 'world') { Audio2.music('inside'); return; }
    const r = World.regions[this.map.regionAt(this.pos.x, this.pos.y)];
    Audio2.music(r && r.kind === 'route' ? 'route' : 'town');
  },
  checkRegion() {
    if (this.map.id !== 'world') { this.lastRegion = -1; return; }
    const r = this.map.regionAt(this.pos.x, this.pos.y);
    if (r !== this.lastRegion && r >= 0) {
      const prev = this.lastRegion;
      this.lastRegion = r;
      void prev;
      UI.banner(World.regions[r].name);
      this.updateMusic();
    }
  },
  async fadeTo(v, ms = 220) {
    const from = this.fade, t0 = performance.now();
    while (true) {
      const k = Math.min(1, (performance.now() - t0) / ms);
      this.fade = from + (v - from) * k;
      if (k >= 1) break;
      await new Promise((r) => requestAnimationFrame(r));
    }
  },
  async warp(mapId, x, y, dir) {
    this.busy++;
    const from = this.map && this.map.id;
    Audio2.sfx('door');
    await this.fadeTo(1);
    this.enter(mapId, x, y, dir);
    if (mapId !== 'world') this.autosave();
    await this.fadeTo(0);
    try {
      // Dr. Street's first-visit cutscene
      if (mapId === 'lab-0-0' && !this.p.flags.labIntro) await Scripts.labIntro();
      // walking out of a leader hall: someone may be waiting, and maybe the end
      if (from && from.startsWith('hall-') && mapId === 'world') {
        for (const [id, A] of Object.entries(ALLIES)) {
          if (this.p.badges.includes(A.after) && !Crew.has(id) && Scripts.meetsYou(id)) await Scripts.meet(id);
        }
        if (this.playableDone() && !this.p.flags.ending) await Ending.play();
      }
    } finally { UI.closeDialog(); }
    this.busy--;
  },

  // ------------------------------------------------------------ scripts
  async run(fn) {
    this.busy++;
    try { await fn(); }
    catch (e) { console.error(e); }
    finally { this.busy--; UI.closeDialog(); }
  },

  // ------------------------------------------------------------ update
  tick(dt) {
    UI.updateHUD();
    this.time += dt;
    this.waterT += dt;
    if (this.waterT > 0.35) { this.waterT = 0; this.waterF = (this.waterF + 1) % 4; }
    if (this.mode === 'title') { this.titleCam += dt * 14; return; }
    if (this.mode === 'battle') { Battle.update(dt); return; }
    if (this.mode !== 'world' || !this.map) return;
    if (this.p) this.p.playTime += dt;
    this.updateNPCs(dt);
    this.updatePlayer(dt);
  },

  updateNPCs(dt) {
    const m = this.map, P = this.pos;
    for (const n of m.npcs) {
      if (n.hidden) continue;
      if (n.moving) {
        n.mt += dt * 3.6;
        if (n.mt >= 1) { n.x = n.tx; n.y = n.ty; n.moving = false; n.mt = 0; n.step ^= 1; }
        continue;
      }
      if (!n.wander || this.busy || UI.busy) continue;
      n.timer -= dt;
      if (n.timer > 0) continue;
      n.timer = 1.2 + Math.random() * 3;
      const d = ['up', 'down', 'left', 'right'][U.rand(0, 3)];
      n.dir = d;
      const [dx, dy] = DIRS[d], nx = n.x + dx, ny = n.y + dy;
      if (Math.abs(nx - n.home.x) > n.wander || Math.abs(ny - n.home.y) > n.wander) continue;
      if (m.solid(nx, ny) || m.get(nx, ny) === T.DOOR || m.get(nx, ny) === T.EXIT || m.npcAt(nx, ny)) continue;
      if ((nx === P.x && ny === P.y) || (nx === P.tx && ny === P.ty)) continue;
      n.tx = nx; n.ty = ny; n.moving = true; n.mt = 0;
    }
  },

  updatePlayer(dt) {
    const P = this.pos, m = this.map;
    P.bumpT = Math.max(0, P.bumpT - dt);
    const running = Input.held.B;
    // presses made mid-step are kept until the step ends
    if (Input.hit('START') || Input.hit('ESC')) this.want = 'menu';
    else if (Input.hit('A')) this.want = 'A';
    if (P.moving) {
      P.mt += dt * (running ? 7.8 : 4.4);
      if (P.mt >= 1) {
        P.x = P.tx; P.y = P.ty; P.moving = false; P.mt = 0; P.parity ^= 1;
        this.onArrive();
      }
      return;
    }
    if (this.busy || UI.busy) { P.justArrived = false; this.want = null; return; }
    const want = this.want; this.want = null;
    if (want === 'menu') { this.run(() => Menu.open()); return; }
    if (want === 'A') { this.interact(); return; }
    const d = Input.dir();
    if (!d) { P.justArrived = false; P.turnT = 0; return; }
    if (d !== P.dir) {
      P.dir = d;
      P.turnT = P.justArrived ? 0 : 0.09;
      if (P.turnT > 0) return;
    }
    if (P.turnT > 0) { P.turnT -= dt; return; }
    P.justArrived = false;
    const [dx, dy] = DIRS[d], nx = P.x + dx, ny = P.y + dy;
    const t = m.get(nx, ny);
    if (t === T.DOOR) {
      const door = m.doors.get(m.idx(nx, ny));
      if (door && door.locked) { this.run(() => UI.say(door.locked)); return; }
    }
    if (m.solid(nx, ny) || m.npcAt(nx, ny)) {
      if (P.bumpT <= 0) { Audio2.sfx('bump'); P.bumpT = 0.3; }
      return;
    }
    P.tx = nx; P.ty = ny; P.moving = true; P.mt = 0;
  },

  onArrive() {
    const P = this.pos, m = this.map, p = this.p;
    P.justArrived = true;
    p.x = P.x; p.y = P.y; p.dir = P.dir;
    p.steps++;
    if (p.repel > 0) { p.repel--; if (p.repel === 0) this.run(() => UI.say('Your headphones died. The world is loud again.')); }
    const t = m.get(P.x, P.y), i = m.idx(P.x, P.y);
    if (t === T.DOOR) {
      const door = m.doors.get(i);
      const im = World.maps[door.to];
      this.warp(door.to, im.entry.x, im.entry.y, 'up');
      return;
    }
    if (t === T.EXIT && m.exit) { this.warp(m.exit.map, m.exit.x, m.exit.y, 'down'); return; }
    if (m.items.has(i)) {
      const it = m.items.get(i);
      m.items.delete(i);
      const amt = it.amt;
      this.run(async () => {
        Audio2.sfx('coin');
        const r = this.earn(amt);
        await UI.say(amt >= 5 ? `You found a crumpled $5 bill in the grass!` : `You found a $1 bill in the grass!`);
        if (r.garnished) await UI.say(`(Your loan servicer somehow took $${r.garnished} of it.)`);
      });
      return;
    }
    // respawn bills over time
    if (m.id === 'world' && p.steps % 30 === 0) {
      for (let ri = 0; ri < ROUTES.length; ri++) if (World.billsInRoute(m, ri) < 5) World.spawnBill(m, ri, P);
    }
    this.checkRegion();
    if (t === T.GRASS) this.rollEncounter();
  },

  rollEncounter() {
    const m = this.map, P = this.pos;
    const reg = World.regions[m.regionAt(P.x, P.y)];
    if (!reg || reg.kind !== 'route') return;
    if (Math.random() > 0.11) return;
    const r = ROUTES[reg.route];
    const id = r.enc[U.rand(0, r.enc.length - 1)];
    const lvl = U.rand(r.lv[0], r.lv[1]);
    if (this.p.repel > 0 && lvl <= this.p.level) return;
    this.run(() => Battle.start({ foes: [[id, lvl]], wild: true, route: reg.route, biome: BIOME_IDS[m.bio[m.idx(P.x, P.y)]] }));
  },

  interact() {
    const P = this.pos, m = this.map;
    const [dx, dy] = DIRS[P.dir];
    let fx = P.x + dx, fy = P.y + dy;
    let n = m.npcAt(fx, fy);
    if (!n && m.get(fx, fy) === T.COUNTER) n = m.npcAt(fx + dx, fy + dy);
    if (n && n.talk) {
      if (n.kind === 'person') n.dir = OPP[P.dir];
      this.run(() => n.talk(n));
      return;
    }
    const i = m.idx(fx, fy);
    if (m.signs.has(i)) { this.run(() => UI.say(m.signs.get(i))); return; }
    if (m.acts.has(i)) { this.run(() => m.acts.get(i)()); return; }
    const t = m.get(fx, fy);
    const flavour = {
      [T.TV]: 'It\'s a cooking show. Someone is making a $90 sandwich.',
      [T.BOOKS]: 'Self-help books. "Atomic Habits," "Atomic Habits 2," "Why You Didn\'t Finish Atomic Habits."',
      [T.SHELF]: 'Shelves of snacks. Talk to the clerk at the counter to buy things.',
      [T.MACHINE]: 'It beeps reassuringly. Nobody knows what it does.',
      [T.BED]: 'A bed. It is calling your name. You must resist.',
      [T.HBED]: 'A hospital bed. The sheets are suspiciously crisp.',
      [T.STATUE]: 'A trophy engraved: "I SURVIVED."',
      [T.ALTAR]: 'A quiet, peaceful place.',
    }[t];
    if (flavour) this.run(() => UI.say(flavour));
  },

  async blackout() {
    const p = this.p;
    const lost = Math.floor(p.money / 2);
    p.stats.meltdowns++;
    p.money -= lost;
    await UI.say(`{NAME} had a full-on meltdown!`);
    if (lost) await UI.say(`In the panic, {NAME} dropped ${U.money(lost)}...`);
    await this.fadeTo(1, 500);
    this.mode = 'world';
    const r = p.respawn;
    this.enter(r.map, r.x, r.y, r.dir);
    this.fullHeal();
    await this.fadeTo(0, 500);
    await UI.say(this.map.isHome ? 'Mom: "Oh, honey. Sit down. I made soup."' : 'Nurse: "We patched you up. Try to pace yourself out there, okay?"');
  },

  // ------------------------------------------------------------ save
  // Saves live on this device (browser storage): three slots you pick, plus
  // an autosave that never touches them.
  save(slot) {
    const p = this.p;
    p.map = this.map.id; p.x = this.pos.x; p.y = this.pos.y; p.dir = this.pos.dir;
    const ok = Saves.write(slot, p);
    if (ok && slot !== 'auto') { this.slot = slot; this.lastSave = p.playTime; }
    return ok;
  },
  autosave() { if (this.p && this.p.path && this.map) this.save('auto'); },

  // ------------------------------------------------------------ render
  render() {
    const x = this.ctx;
    x.imageSmoothingEnabled = false;
    if (this.mode === 'battle') { Battle.render(x); this.drawFade(x); return; }
    x.fillStyle = '#000';
    x.fillRect(0, 0, VIEW_W, VIEW_H);
    if (this.mode === 'title') { this.renderTitle(x); return; }
    if (this.mode === 'intro') { Intro.render(x); this.drawFade(x); return; }
    if (this.mode === 'ending') { Ending.render(x); this.drawFade(x); return; }
    if (this.scene && this.scene.kind === 'select') { this.renderSelect(x); this.drawFade(x); return; }
    if (this.scene && this.scene.kind === 'hero') { this.renderHeroes(x); this.drawFade(x); return; }
    if (!this.map) return;
    this.renderMap(x);
    this.drawFade(x);
  },
  drawFade(x) {
    if (this.fade > 0) { x.fillStyle = `rgba(0,0,0,${this.fade})`; x.fillRect(0, 0, VIEW_W, VIEW_H); }
    if (this.flash > 0) { x.fillStyle = `rgba(255,255,255,${this.flash})`; x.fillRect(0, 0, VIEW_W, VIEW_H); }
  },
  // Night over the suburbs, the city glowing behind: the twenties.
  renderTitle(x) {
    const t = this.time;
    const gr = x.createLinearGradient(0, 0, 0, VIEW_H);
    gr.addColorStop(0, '#0a0820'); gr.addColorStop(1, '#3a2050');
    x.fillStyle = gr; x.fillRect(0, 0, VIEW_W, VIEW_H);
    for (let i = 0; i < 60; i++) {
      const sx = U.hash(i, 1) % VIEW_W, sy = U.hash(i, 2) % 120;
      if (Math.sin(t * 2 + i) > -0.6) px(x, i % 7 ? '#c8c0e8' : '#fff8c0', sx, sy, 1, 1);
    }
    disc(x, 252, 30, 9, 9, '#f4ecc8'); px(x, '#ddd2ac', 249, 27, 3, 3); px(x, '#ddd2ac', 255, 33, 2, 2);
    // far skyline
    const towers = [[150, 70, 16], [168, 54, 14], [184, 80, 20], [206, 62, 12], [220, 90, 18], [240, 72, 14], [256, 96, 22], [280, 78, 16]];
    for (const [tx, h, w] of towers) {
      px(x, '#1e1838', tx, 196 - h, w, h);
      for (let wy = 196 - h + 4; wy < 190; wy += 6) for (let wx = tx + 2; wx < tx + w - 2; wx += 4) {
        if (U.hash(wx, wy, Math.floor(t / 2)) % 10 < 4) px(x, '#f0c060', wx, wy, 2, 3);
      }
    }
    // near houses
    const houses = [[8, 46], [62, 52], [118, 44]];
    for (const [hx, w] of houses) {
      px(x, '#120c1e', hx, 150, w, 46);
      for (let i = 0; i < w / 2 + 2; i++) px(x, '#120c1e', hx - 2 + i, 150 - i * 0.6, w + 4 - i * 2, 1);
      for (let i = 0; i < 2; i++) px(x, U.hash(hx, i, Math.floor(t / 3)) % 10 < 6 ? '#f0c060' : '#2a2038', hx + 8 + i * (w - 24), 162, 8, 10);
      px(x, '#2a1a10', hx + w / 2 - 4, 178, 8, 18);
    }
    px(x, '#1a1428', 0, 196, VIEW_W, 28);
    px(x, '#2a2240', 0, 196, VIEW_W, 2);
  },
  // Dr. Street's path choice: three spotlights (the House Keeper select screen).
  renderSelect(x) {
    const t = this.time, sel = this.scene.i;
    const gr = x.createLinearGradient(0, 0, 0, VIEW_H);
    gr.addColorStop(0, '#1a1230'); gr.addColorStop(1, '#2e2048');
    x.fillStyle = gr; x.fillRect(0, 0, VIEW_W, VIEW_H);
    for (let y = 120; y < VIEW_H; y += 8) for (let X = 0; X < VIEW_W; X += 8) px(x, ((X + y) / 8) % 2 ? '#3a2a5a' : '#32244e', X, y, 8, 8);
    ['diploma', 'wrench', 'badge'].forEach((k, i) => {
      const cx = 52 + i * 100, on = i === sel;
      x.fillStyle = on ? 'rgba(255,230,160,.18)' : 'rgba(255,255,255,.04)';
      x.beginPath(); x.moveTo(cx - 8, 0); x.lineTo(cx + 8, 0); x.lineTo(cx + 38, 128); x.lineTo(cx - 38, 128); x.fill();
      x.fillStyle = 'rgba(0,0,0,.3)'; x.beginPath(); x.ellipse(cx, 124, 26, 5, 0, 0, Math.PI * 2); x.fill();
      const bob = on ? Math.round(Math.sin(t * 4) * 2) : 0;
      x.globalAlpha = on ? 1 : 0.5;
      x.drawImage(Art.icon(k, 3), cx - 24, 70 + bob);
      x.globalAlpha = 1;
      if (on && Math.floor(t * 3) % 2) { x.fillStyle = '#f0c040'; x.beginPath(); x.moveTo(cx - 5, 50); x.lineTo(cx + 5, 50); x.lineTo(cx, 56); x.fill(); }
    });
  },

  // boy / girl select: two spotlights with the walking sprites
  renderHeroes(x) {
    const t = this.time, sel = this.scene.i;
    const gr = x.createLinearGradient(0, 0, 0, VIEW_H);
    gr.addColorStop(0, '#1a1230'); gr.addColorStop(1, '#2e2048');
    x.fillStyle = gr; x.fillRect(0, 0, VIEW_W, VIEW_H);
    for (let y = 120; y < VIEW_H; y += 8) for (let X = 0; X < VIEW_W; X += 8) px(x, ((X + y) / 8) % 2 ? '#3a2a5a' : '#32244e', X, y, 8, 8);
    ['boy', 'girl'].forEach((k, i) => {
      const cx = 76 + i * 152, on = i === sel, H = HEROES[k];
      x.fillStyle = on ? 'rgba(255,230,160,.18)' : 'rgba(255,255,255,.04)';
      x.beginPath(); x.moveTo(cx - 10, 0); x.lineTo(cx + 10, 0); x.lineTo(cx + 46, 150); x.lineTo(cx - 46, 150); x.fill();
      x.fillStyle = 'rgba(0,0,0,.3)'; x.beginPath(); x.ellipse(cx, 146, 30, 6, 0, 0, Math.PI * 2); x.fill();
      const fr = on ? WALKCYCLE[Math.floor(t * 6) % 4] : 0;
      x.globalAlpha = on ? 1 : 0.55;
      x.drawImage(Art.character(H.pal, H.look).down[fr], cx - 30, 74, 60, 72);
      x.globalAlpha = 1;
      if (on && Math.floor(t * 3) % 2) { x.fillStyle = '#f0c040'; x.beginPath(); x.moveTo(cx - 5, 50); x.lineTo(cx + 5, 50); x.lineTo(cx, 56); x.fill(); }
    });
  },

  camera(m) {
    const P = this.pos;
    const px_ = (P.moving ? P.x + (P.tx - P.x) * P.mt : P.x) * 16;
    const py_ = (P.moving ? P.y + (P.ty - P.y) * P.mt : P.y) * 16;
    let cx = px_ + 8 - VIEW_W / 2, cy = py_ + 8 - VIEW_H / 2;
    const mw = m.w * 16, mh = m.h * 16;
    cx = mw <= VIEW_W ? (mw - VIEW_W) / 2 : U.clamp(cx, 0, mw - VIEW_W);
    cy = mh <= VIEW_H ? (mh - VIEW_H) / 2 : U.clamp(cy, 0, mh - VIEW_H);
    return [Math.round(cx), Math.round(cy), px_, py_];
  },

  renderMap(x, o = {}) {
    const m = o.map || this.map;
    let cx, cy, ppx, ppy;
    if (o.cam) [cx, cy] = o.cam; else [cx, cy, ppx, ppy] = this.camera(m);
    const x0 = Math.floor(cx / 16), y0 = Math.floor(cy / 16);
    for (let ty = y0; ty <= y0 + VIEW_H / 16; ty++) for (let tx = x0; tx <= x0 + Math.ceil(VIEW_W / 16); tx++) {
      if (!m.in(tx, ty)) continue;
      let id = m.get(tx, ty);
      if (id === T.BUILD || id === T.DOOR) id = T.GROUND;
      const theme = m.themeAt(tx, ty);
      let v;
      if (m.theme) v = (id === T.WALL || id === T.WWALL || id === T.BANNER) ? (ty === 0 || tx === 0 || tx === m.w - 1 || ty === m.h - 1 ? 0 : 1) : (id === T.FLOOR || id === T.MAT ? (tx + ty) % 2 + 2 * (U.hash(tx, ty) % 4) : (tx + ty) % 2);
      else v = U.hash(tx, ty) % 8;
      x.drawImage(Art.tile(id, theme, v, this.waterF), tx * 16 - cx, ty * 16 - cy);
      const pr = m.props.get(m.idx(tx, ty));
      if (pr) x.drawImage(Art.prop(pr), tx * 16 - cx, ty * 16 - cy - 2);
    }
    for (const b of m.buildings) {
      const bx = b.x * 16 - cx, by = b.y * 16 - cy;
      if (bx > VIEW_W || by > VIEW_H || bx + b.w * 16 < 0 || by + b.h * 16 < 0) continue;
      x.drawImage(Art.building(b, b.theme), bx, by);
    }
    const blink = Math.floor(this.time * 3);
    for (const [i, it] of m.items) {
      const ix = (i % m.w) * 16 - cx, iy = Math.floor(i / m.w) * 16 - cy;
      if (ix < -16 || iy < -16 || ix > VIEW_W || iy > VIEW_H) continue;
      x.drawImage(Art.bill(it.amt, blink), ix, iy - 2);
    }
    // y-sorted entities
    const ents = [];
    for (const n of m.npcs) {
      if (n.hidden) continue;
      const nx = (n.moving ? n.x + (n.tx - n.x) * n.mt : n.x) * 16, ny = (n.moving ? n.y + (n.ty - n.y) * n.mt : n.y) * 16;
      if (nx - cx < -16 || ny - cy < -16 || nx - cx > VIEW_W || ny - cy > VIEW_H) continue;
      ents.push({ y: ny, draw: () => this.drawEntity(x, n, nx - cx, ny - cy, m) });
    }
    if (!o.noPlayer && this.p) {
      const P = this.pos;
      ents.push({ y: ppy, draw: () => this.drawPlayer(x, ppx - cx, ppy - cy, m) });
    }
    ents.sort((a, b) => a.y - b.y).forEach((e) => e.draw());
  },

  drawEntity(x, n, sx, sy, m) {
    if (n.kind === 'cone') { x.drawImage(Art.cone(), sx, sy - 2); return; }
    const pal = n.palObj || PALS[n.pal] || PALS.dude;
    const fr = n.moving ? WALKCYCLE[(n.step * 2 + Math.floor(n.mt * 2)) % 4] : 0;
    shadow(x, sx, sy);
    x.drawImage(Art.character(pal, n.look)[n.dir][fr], sx - 2, sy - 8);
    this.grassOver(x, m, n.moving ? n.tx : n.x, n.moving ? n.ty : n.y, sx, sy, n.moving);
  },
  drawPlayer(x, sx, sy, m) {
    const P = this.pos;
    const pal = this.heroPal();
    const fr = P.moving ? WALKCYCLE[(P.parity * 2 + Math.floor(P.mt * 2)) % 4] : 0;
    sx = Math.round(sx); sy = Math.round(sy);
    shadow(x, sx, sy);
    x.drawImage(Art.character(pal, this.heroLook())[P.dir][fr], sx - 2, sy - 8);
    this.grassOver(x, m, P.moving ? P.tx : P.x, P.moving ? P.ty : P.y, sx, sy, P.moving && P.mt < 0.5);
  },
  grassOver(x, m, tx, ty, sx, sy, skip) {
    if (skip || m.get(tx, ty) !== T.GRASS) return;
    const tile = Art.tile(T.GRASS, m.themeAt(tx, ty), U.hash(tx, ty) % 8, 0);
    x.drawImage(tile, 0, 9, 16, 7, sx, sy + 9, 16, 7);
  },
};

// ---------------------------------------------------------------- field menu
const Menu = {
  async open() {
    Audio2.sfx('select');
    let start = 0;
    while (true) {
      const opts = ['SKILLS', 'CREW', 'BAG', 'SAVE GAME', 'PROFILE', 'MAP', 'WHAT BEATS WHAT', 'SOUND: ' + (Audio2.muted ? 'OFF' : 'ON'), 'CLOSE'];
      const i = await UI.choose(opts, { cls: 'side', start });
      if (i < 0 || i === 8) return;
      start = i;
      if (i === 0) await this.skills();
      if (i === 1) await this.crew();
      if (i === 2) await this.bag(false);
      if (i === 3) await Saves.saveMenu();
      if (i === 4) await this.profile();
      if (i === 5) await this.map();
      if (i === 6) await this.chart();
      if (i === 7) Audio2.setMuted(!Audio2.muted);
    }
  },

  skillRow(id) {
    const s = SKILLS[id], t = SKILL_TYPES[s.type];
    return `<b style="color:${t.color}">${t.label}</b> · ${s.power ? 'Power ' + s.power : 'Support'} · ${s.cost} Energy<br>${U.esc(s.desc)}`;
  },

  async skills() {
    const p = Game.p;
    const rows = () => p.known.map((id) => ({
      label: SKILLS[id].name,
      right: p.equipped.includes(id) ? '<span class="eq">EQUIPPED</span>' : '',
      desc: this.skillRow(id),
      icon: `<i class="dot" style="background:${SKILL_TYPES[SKILLS[id].type].color}"></i>`,
    }));
    await UI.list(rows, {
      title: 'SKILLS', hint: 'Up to 4 skills can be equipped for battle.',
      footer: () => `A: equip / unequip · B: back · ${p.equipped.length}/4 equipped`,
      onAct: async (k) => {
        const id = p.known[k];
        if (p.equipped.includes(id)) {
          if (p.equipped.length === 1) { UI.toast('You need at least one skill!'); return 'keep'; }
          p.equipped = p.equipped.filter((e) => e !== id);
        } else if (p.equipped.length < 4) {
          p.equipped.push(id);
        } else {
          const j = await UI.choose(p.equipped.map((e) => 'Swap out ' + SKILLS[e].name), { cls: 'side' });
          if (j >= 0) p.equipped[j] = id;
        }
        return 'keep';
      },
    });
  },

  async crew() {
    const p = Game.p;
    const list = () => Crew.members();
    const rows = () => list().map((r) => {
      const st = Crew.stats(r);
      return {
        label: Crew.name(r) + (Crew.isMe(r) ? '' : ' · ' + ALLIES[r.id].title), right: (Crew.key(r) === p.lead ? 'LEAD ' : '') + (r.sanity > 0 ? `${r.sanity}/${st.maxSanity}` : 'OUT'),
        desc: `Best with <b style="color:${(SKILL_TYPES[Crew.boost(r)] || SKILL_TYPES.BASIC).color}">${Crew.boost(r) || '-'}</b> · EN ${r.energy}/${st.maxEnergy}<br>` +
          Crew.skills(r).map((id) => `<span style="color:${SKILL_TYPES[SKILLS[id].type].color}">${SKILLS[id].name}</span>`).join(' · '),
      };
    });
    await UI.list(rows, {
      title: 'CREW', hint: '', empty: '',
      footer: () => p.crew.length ? 'A: make leader (fights first) · B: back' : 'Friends join you as you beat Life Leaders.',
      onAct: async (k) => {
        const r = list()[k];
        p.lead = Crew.key(r);
        UI.toast(`${Crew.name(r)} will lead`);
        return 'keep';
      },
    });
  },

  // inBattle: returns the item id used (or null). Field use happens here.
  async bag(inBattle) {
    const p = Game.p;
    let used = null;
    const ids = () => Object.keys(p.items).filter((id) => p.items[id] > 0).sort((a, b) => (ITEMS[b].key ? 1 : 0) - (ITEMS[a].key ? 1 : 0));
    const rows = () => ids().map((id) => ({
      label: ITEMS[id].name, right: ITEMS[id].key ? '' : '×' + p.items[id], desc: ITEMS[id].desc,
      disabled: inBattle && !ITEMS[id].battle,
    }));
    await UI.list(rows, {
      title: 'BAG', empty: 'Your bag is empty. Even the gum is gone.',
      headRight: () => U.money(p.money),
      onAct: async (k) => {
        const id = ids()[k];
        const r = await Items.use(id, inBattle);
        if (r === 'used' && inBattle) { used = id; return 'close'; }
        return inBattle ? 'keep' : 'keep';
      },
    });
    return used;
  },

  async profile() {
    const p = Game.p, s = Game.stats();
    const next = Stats.xpFor(p.level + 1), cur = Stats.xpFor(p.level);
    const xpPct = U.clamp((p.xp - cur) / (next - cur), 0, 1) * 100;
    const badges = LEADER_ORDER.map((k) => {
      const L = LEADERS[k], got = p.badges.includes(k);
      return `<div class="bdg${got ? ' got' : ''}" title="${L.title}"><img src="${Art.iconURL(L.badgeIcon, 2)}"><span>${got ? L.title : '???'}</span></div>`;
    }).join('');
    const hrs = Math.floor(p.playTime / 3600), mins = Math.floor(p.playTime / 60) % 60;
    const path = PATHS[p.path];
    await UI.panel(`<div class="p-title">LIFE ID CARD</div>
      <div class="card">
        <div class="card-top">
          <img class="card-face" src="${Art.portrait(Game.heroPal(), Game.heroLook()).toDataURL()}">
          <div class="card-info">
            <div class="big">${U.esc(p.name)}</div>
            <div>Age ${Game.age()} · ${path ? path.name : 'No path yet'}</div>
            <div>Level ${p.level} <span class="xpbar"><i style="width:${xpPct}%"></i></span></div>
            <div>Cash <b>${U.money(p.money)}</b>${p.debt ? ` · Debt <b class="neg">${U.money(p.debt)}</b>` : ''}</div>
            <div>Karma <b>${p.karma}</b> (${Game.karmaLabel()})</div>
          </div>
        </div>
        <div class="statgrid">
          <span>Sanity</span><b>${p.sanity}/${s.maxSanity}</b><span>Energy</span><b>${p.energy}/${s.maxEnergy}</b>
          <span>Confidence</span><b>${s.conf}</b><span>Composure</span><b>${s.comp}</b>
          <span>Hustle</span><b>${s.hus}</b><span>Played</span><b>${hrs}h ${mins}m</b>
        </div>
        <div class="p-sub">LIFE MILESTONES ${p.badges.length}/8</div>
        <div class="badges">${badges}</div>
      </div>`, { cls: 'profile' });
  },

  async map() {
    const m = World.maps.world;
    const [c, x] = U.canvas(m.w, m.h);
    for (let y = 0; y < m.h; y++) for (let X = 0; X < m.w; X++) {
      const t = m.get(X, y), b = BIO[m.themeAt(X, y)];
      let col = b.ground[0];
      if (t === T.TREE) col = U.shade(b.canopy[0], -0.1);
      else if (t === T.WATER) col = b.water[0];
      else if (t === T.PATH) col = b.path[0];
      else if (t === T.GRASS) col = b.grass[1];
      else if (t === T.BUILD || t === T.DOOR) col = '#e8e0d0';
      x.fillStyle = col; x.fillRect(X, y, 1, 1);
    }
    const P = Game.pos;
    let me = null;
    if (Game.map.id === 'world') me = [P.x, P.y];
    else if (Game.map.exit) me = [Game.map.exit.x, Game.map.exit.y];
    const labels = TOWNS.map((t, i) => {
      const [ox, oy] = World.townOrigin(i);
      return `<span class="mlabel" style="left:${(ox + TW / 2) / m.w * 100}%;top:${(oy + (TOWNS[i].row ? TH + 1 : -1)) / m.h * 100}%">${t.name}</span>`;
    }).join('');
    const dot = me ? `<span class="mdot" style="left:${(me[0] + 0.5) / m.w * 100}%;top:${(me[1] + 0.5) / m.h * 100}%"></span>` : '';
    await UI.panel(`<div class="p-title">MAP</div><div class="mapwrap"><img src="${c.toDataURL()}">${labels}${dot}</div>`, { cls: 'mappanel' });
  },

  // Read as "what beats what": one row per issue type.
  async chart() {
    const chip = (k, src) => `<em style="background:${src[k].color}">${k}</em>`;
    const rows = Object.keys(ISSUE_TYPES).map((it) => {
      const strong = Object.keys(EFF).filter((k) => EFF[k][it] > 1), weak = Object.keys(EFF).filter((k) => EFF[k][it] < 1);
      return `<tr><td>${chip(it, ISSUE_TYPES)}</td><td>${strong.map((k) => chip(k, SKILL_TYPES)).join('')}</td><td>${weak.map((k) => chip(k, SKILL_TYPES)).join('')}</td></tr>`;
    }).join('');
    await UI.panel(`<div class="p-title">WHAT BEATS WHAT</div>
      <table class="chart2"><tr><th>ISSUE TYPE</th><th>2× DAMAGE</th><th>½ DAMAGE</th></tr>${rows}</table>
      <div class="p-desc">Use a skill whose type is in the 2× column. Each skill's colored dot is its type. SHADY is strong but costs Karma.</div>`, { cls: 'chartpanel' });
  },
};

// ---------------------------------------------------------------- items
const Items = {
  // returns 'used' | 'no'
  async use(id, inBattle) {
    const p = Game.p, it = ITEMS[id];
    // who gets it: the fighter in battle, or anyone in the field
    const target = async (msg, filter) => {
      if (inBattle && it.use !== 'revive') return filter(Battle.s.cur) ? Battle.s.cur : null;
      return Crew.pick(msg, filter);
    };
    switch (it.use) {
      case 'sanity': case 'full': {
        const r = await target('Who gets it?', (m) => m.sanity > 0 && (m.sanity < Crew.stats(m).maxSanity || (it.use === 'full' && m.status)));
        if (!r) { await UI.say(inBattle ? 'Sanity is already full.' : 'Nobody needs that right now.'); UI.closeDialog(); return 'no'; }
        const st = Crew.stats(r), before = r.sanity;
        r.sanity = it.use === 'full' ? st.maxSanity : Math.min(st.maxSanity, r.sanity + it.amt);
        if (it.use === 'full') r.status = null;
        Game.take(id); Audio2.sfx('heal');
        await UI.say(`${Crew.name(r)} had some ${it.name}. Recovered ${r.sanity - before} Sanity!`);
        break;
      }
      case 'energy': {
        const r = await target('Who gets it?', (m) => m.sanity > 0 && m.energy < Crew.stats(m).maxEnergy);
        if (!r) { await UI.say(inBattle ? 'Energy is already full.' : 'Nobody needs that right now.'); UI.closeDialog(); return 'no'; }
        const st = Crew.stats(r), before = r.energy;
        r.energy = Math.min(st.maxEnergy, r.energy + it.amt);
        Game.take(id); Audio2.sfx('heal');
        await UI.say(`${Crew.name(r)} downed a ${it.name}. Recovered ${r.energy - before} Energy!`);
        break;
      }
      case 'revive': {
        const r = await Crew.pick('Who needs a pep talk?', (m) => m.sanity <= 0);
        if (!r) { await UI.say('Nobody needs a pep talk right now. Everyone\'s hanging in there.'); UI.closeDialog(); return 'no'; }
        r.sanity = Math.floor(Crew.stats(r).maxSanity / 2);
        Game.take(id); Audio2.sfx('heal');
        await UI.say(`"You've got this!" ${Crew.name(r)} is back up with ${r.sanity} Sanity.`);
        if (inBattle) Battle.refresh();
        break;
      }
      case 'repel':
        if (inBattle) return 'no';
        p.repel = it.amt; Game.take(id);
        await UI.say('{NAME} put on the headphones. Weak issues will leave you alone for a while.');
        break;
      case 'escape':
        if (inBattle) {
          if (!Battle.s.wild) { await UI.say('You can\'t ride away from this one.'); return 'no'; }
          Game.take(id);
          Battle.s.escaped = 'uber';
          return 'used';
        }
        if (!(await UI.confirm('Ride back to the last place you recovered?'))) { UI.closeDialog(); return 'no'; }
        Game.take(id);
        UI.closeDialog();
        await Game.warp(p.respawn.map, p.respawn.x, p.respawn.y, p.respawn.dir);
        await UI.say('Your driver had a lot of opinions about traffic. You made it, though.');
        break;
      case 'book': {
        if (inBattle) return 'no';
        const sk = SKILLS[it.skill];
        if (p.known.includes(it.skill)) { await UI.say(`You already know ${sk.name}. You skim it anyway. Still good.`); UI.closeDialog(); return 'no'; }
        Game.take(id); Game.learn(it.skill); Audio2.sfx('levelup');
        await UI.say(`{NAME} read the whole thing. In one sitting! {NAME} learned ${sk.name}!`);
        if (!p.equipped.includes(it.skill)) await UI.say('Equip it from the SKILLS menu.');
        break;
      }
      case 'phone': return Scripts.callMom();
      case 'outfit': {
        if (inBattle) return 'no';
        const k = await UI.choose(OUTFIT_COLORS.map((o) => o[0]), { cls: 'side' });
        if (k < 0) return 'no';
        p.outfit = OUTFIT_COLORS[k][1]; Game.take(id);
        await UI.say(`Looking sharp in ${OUTFIT_COLORS[k][0]}!`);
        break;
      }
      case 'scratch': {
        if (inBattle) return 'no';
        Game.take(id);
        const r = Math.random();
        const win = r < 0.02 ? 50 : r < 0.1 ? 10 : r < 0.3 ? 2 : 0;
        await UI.say('{NAME} scratches furiously with a coin...');
        if (win) { Audio2.sfx('coin'); Game.earn(win); await UI.say(`WINNER! {NAME} won $${win}!`); }
        else await UI.say(['Nothing. Classic.', 'So close. (It was not close.)', 'You won... the experience.'][U.rand(0, 2)]);
        break;
      }
      default: return 'no';
    }
    UI.closeDialog();
    return 'used';
  },
};
