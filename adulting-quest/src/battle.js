'use strict';
// Turn-based battles against life's issues. The scene is drawn on the
// canvas; the HUD boxes and menus are DOM. Battle.start() resolves to
// 'win' | 'lose' | 'ran'.

const stage = (s) => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));

const Battle = {
  active: false,
  s: null,
  hud: null,

  async start(o) {
    const p = Game.p;
    this.s = {
      wild: !!o.wild, leader: o.leader || null, biome: o.biome || 'suburb',
      team: o.foes.map(([id, l]) => ({ id, l })), ti: 0, foe: null,
      stages: { atk: 0, def: 0 }, meAnx: 0, cashMult: 1, escapes: 0, escaped: null,
      a: { foeX: 0, foeY: 0, meX: 0, foeBlink: 0, meBlink: 0, shake: 0, slide: 1, foeGone: 0, leaderX: 0, showLeader: !!o.leader, foeVis: !o.leader },
      disp: { foe: 1, me: p.sanity, en: p.energy },
    };
    const s = this.s;
    this.active = true;
    Audio2.music(s.leader ? 'leader' : 'battle');
    Audio2.sfx('encounter');
    // encounter flash, then cut to black
    for (let k = 0; k < 3; k++) { Game.flash = 0.9; await U.wait(90); Game.flash = 0; await U.wait(90); }
    await Game.fadeTo(1, 260);
    Game.mode = 'battle';
    this.buildHUD();
    this.nextFoe(true);
    if (s.leader) s.a.foeVis = false;
    await Game.fadeTo(0, 200);
    // slide in
    const t0 = performance.now();
    while (s.a.slide > 0) { s.a.slide = Math.max(0, 1 - (performance.now() - t0) / 650); await new Promise((r) => requestAnimationFrame(r)); }
    this.hud.foe.classList.toggle('hidden', !!s.leader);
    this.hud.me.classList.remove('hidden');
    let result;
    if (s.leader) {
      const L = LEADERS[s.leader];
      await UI.say(`LEADER ${L.name} (${L.title}) wants to battle!`);
      await this.sendOut();
    } else {
      await UI.say(`A wild ${s.foe.name.toUpperCase()} appeared!`);
    }
    result = await this.loop();
    // wrap up
    p.status = p.status === 'burnout' ? 'burnout' : null;
    await Game.fadeTo(1, 300);
    this.teardown();
    Game.mode = 'world';
    Game.updateMusic();
    await Game.fadeTo(0, 300);
    if (result === 'lose') {
      if (s.leader) await UI.say(LEADERS[s.leader].lose, { name: LEADERS[s.leader].name });
      await Game.blackout();
    }
    return result;
  },

  nextFoe(first) {
    const s = this.s, m = s.team[s.ti];
    const f = Stats.foe(m.id, m.l);
    f.hp = f.maxHp; f.st = { atk: 0, def: 0 }; f.anx = 0;
    s.foe = f;
    s.disp.foe = 1;
    if (!first) s.a.foeGone = 0;
    this.refresh(true);
  },

  async sendOut() {
    const s = this.s, L = s.leader ? LEADERS[s.leader] : null;
    if (L) {
      // leader steps aside, issue drops in
      const t0 = performance.now();
      while (true) {
        const k = Math.min(1, (performance.now() - t0) / 400);
        s.a.leaderX = k * 120;
        if (k >= 1) break;
        await new Promise((r) => requestAnimationFrame(r));
      }
      s.a.showLeader = false;
      s.a.foeVis = true; s.a.foeY = -60;
      this.hud.foe.classList.remove('hidden');
      this.refresh(true);
      await UI.say(`${L.name} throws ${s.foe.name.toUpperCase()} at you!`, { auto: 300 });
    }
  },

  // ------------------------------------------------------------ main loop
  async loop() {
    const s = this.s;
    while (true) {
      const act = await this.chooseAction();
      if (act.kind === 'assess') { await this.assess(); continue; }
      if (act.kind === 'none') continue;
      const r = await this.turn(act);
      if (r) return r;
    }
  },

  async chooseAction() {
    const p = Game.p;
    await UI.say(`What will {NAME} do?`, { noWait: true });
    const i = await this.grid(['SKILLS', 'BAG', 'ASSESS', 'AVOID'], 'actmenu', this.lastAct || 0, false);
    this.lastAct = i;
    if (i === 0) {
      const id = await this.chooseSkill();
      if (!id) return { kind: 'none' };
      return { kind: 'skill', id };
    }
    if (i === 1) {
      UI.closeDialog();
      const used = await Menu.bag(true);
      if (!used) return { kind: 'none' };
      if (this.s.escaped) return { kind: 'escaped' };
      return { kind: 'item', id: used };
    }
    if (i === 2) return { kind: 'assess' };
    return { kind: 'run' };
  },

  chooseSkill() {
    const p = Game.p, s = this.s;
    const ids = p.equipped;
    const box = UI.el('div', 'skillmenu');
    let i = Math.min(this.lastSkill || 0, ids.length - 1);
    const render = () => {
      box.innerHTML = `<div class="sk-grid">${[0, 1, 2, 3].map((k) => {
        const id = ids[k];
        if (!id) return '<div class="sk empty">—</div>';
        const sk = SKILLS[id], t = SKILL_TYPES[sk.type];
        const poor = sk.cost > p.energy;
        return `<div class="sk${k === i ? ' sel' : ''}${poor ? ' poor' : ''}" data-k="${k}"><i class="dot" style="background:${t.color}"></i>${sk.name}</div>`;
      }).join('')}</div>${this.skillInfo(ids[i])}`;
    };
    render();
    UI.root.appendChild(box);
    UI.closeDialog();
    return new Promise((resolve) => {
      const tryPick = async () => {
        const sk = SKILLS[ids[i]];
        if (sk.cost > p.energy) { Audio2.sfx('bump'); UI.toast('Not enough Energy! Wing It is free.'); return; }
        Audio2.sfx('select'); this.lastSkill = i; done(ids[i]);
      };
      const move = (dx, dy) => {
        const col = i % 2, row = Math.floor(i / 2);
        let n = (U.clamp(row + dy, 0, 1)) * 2 + U.clamp(col + dx, 0, 1);
        if (n >= ids.length) return;
        if (n !== i) { i = n; Audio2.sfx('move'); render(); }
      };
      const w = {
        onInput: (b) => {
          if (b === 'up') move(0, -1); else if (b === 'down') move(0, 1);
          else if (b === 'left') move(-1, 0); else if (b === 'right') move(1, 0);
          else if (b === 'A') tryPick();
          else if (b === 'B') { Audio2.sfx('back'); done(null); }
          return 'stop';
        },
      };
      const done = (v) => { UI.pop(w); box.remove(); resolve(v); };
      box.addEventListener('pointerdown', (e) => {
        const c = e.target.closest('.sk[data-k]');
        if (!c || UI.top() !== w) return;
        e.preventDefault();
        const k = +c.dataset.k;
        if (k === i) tryPick(); else { i = k; render(); Audio2.sfx('move'); }
      });
      UI.push(w);
    });
  },

  skillInfo(id) {
    const sk = SKILLS[id], t = SKILL_TYPES[sk.type], f = this.s.foe;
    const m = sk.power ? EFF[sk.type][f.type] : 1;
    const eff = !sk.power ? 'Support' : m > 1 ? '<b class="se">2× damage!</b>' : m < 1 ? '<b class="nve">½ damage</b>' : 'Normal damage';
    return `<div class="sk-info"><div><b style="color:${t.color}">${t.label}</b></div>
      <div>EN <b>${sk.cost}</b> / ${Game.p.energy}</div><div>${sk.power ? 'PWR ' + sk.power : ''}</div><div>${eff}</div></div>`;
  },

  // generic 2x2 menu used for the action grid
  grid(opts, cls, start, cancel) {
    const box = UI.el('div', 'menu ' + cls);
    let i = start;
    const render = () => { box.innerHTML = opts.map((o, k) => `<div class="opt${k === i ? ' sel' : ''}" data-k="${k}">${o}</div>`).join(''); };
    render();
    UI.root.appendChild(box);
    return new Promise((resolve) => {
      const move = (dx, dy) => {
        const col = i % 2, row = Math.floor(i / 2);
        const n = U.clamp(row + dy, 0, 1) * 2 + U.clamp(col + dx, 0, 1);
        if (n !== i) { i = n; Audio2.sfx('move'); render(); }
      };
      const w = {
        onInput: (b) => {
          if (b === 'up') move(0, -1); else if (b === 'down') move(0, 1);
          else if (b === 'left') move(-1, 0); else if (b === 'right') move(1, 0);
          else if (b === 'A') { Audio2.sfx('select'); done(i); }
          else if (b === 'B' && cancel) { done(-1); }
          return 'stop';
        },
      };
      const done = (v) => { UI.pop(w); box.remove(); resolve(v); };
      box.addEventListener('pointerdown', (e) => {
        const c = e.target.closest('.opt');
        if (!c || UI.top() !== w) return;
        e.preventDefault(); i = +c.dataset.k; render(); Audio2.sfx('select'); done(i);
      });
      UI.push(w);
    });
  },

  async assess() {
    const f = this.s.foe, d = f.def;
    const strong = [], weak = [];
    for (const k of Object.keys(EFF)) {
      if (k === 'BASIC') continue;
      if (EFF[k][f.type] > 1) strong.push(k);
      if (EFF[k][f.type] < 1) weak.push(k);
    }
    await UI.say(`${d.name.toUpperCase()}: "${d.dex}"`);
    await UI.say(`It's a ${f.type} issue. Hits hard: ${strong.join(', ')}. Barely lands: ${weak.join(', ')}.`);
  },

  // ------------------------------------------------------------ turns
  async turn(act) {
    const s = this.s, p = Game.p, st = Game.stats(), f = s.foe;
    if (act.kind === 'escaped') {
      await UI.say('{NAME} called a rideshare and bailed. Five stars.');
      return 'ran';
    }
    if (act.kind === 'run') {
      if (!s.wild) { await UI.say(`There's no avoiding ${LEADERS[s.leader].title}. It always finds you.`); return null; }
      s.escapes++;
      const ch = U.clamp(0.5 + (st.hus - f.spd) / (2 * f.spd) + 0.15 * (s.escapes - 1), 0.25, 1);
      if (Math.random() < ch) { Audio2.sfx('back'); await UI.say('{NAME} avoided the problem... for now.'); return 'ran'; }
      await UI.say('Couldn\'t get away! It\'s still there. Staring.');
      return (await this.foeAct()) || (await this.endTurn());
    }
    if (act.kind === 'item') {
      this.refresh();
      return (await this.foeAct()) || (await this.endTurn());
    }
    const meSpd = st.hus, foeSpd = f.spd * stage(0);
    const meFirst = meSpd > foeSpd || (meSpd === foeSpd && Math.random() < 0.5);
    if (meFirst) {
      const r = await this.playerAct(act.id); if (r) return r;
      const r2 = await this.foeAct(); if (r2) return r2;
    } else {
      const r2 = await this.foeAct(); if (r2) return r2;
      const r = await this.playerAct(act.id); if (r) return r;
    }
    return this.endTurn();
  },

  async endTurn() {
    const p = Game.p, st = Game.stats();
    if (p.status === 'burnout') {
      const d = Math.max(1, Math.floor(st.maxSanity / 12));
      p.sanity = Math.max(0, p.sanity - d);
      this.s.a.meBlink = 0.4;
      await UI.say(`{NAME} is burnt out... (-${d} Sanity)`, { auto: 700 });
      await this.settle();
      if (p.sanity <= 0) return this.lose();
    }
    p.energy = Math.min(st.maxEnergy, p.energy + 2);
    this.refresh();
    return null;
  },

  async playerAct(id) {
    const s = this.s, p = Game.p, st = Game.stats(), f = s.foe, sk = SKILLS[id], fx = sk.fx || {};
    if (s.meAnx > 0) {
      s.meAnx--;
      if (Math.random() < 0.35) { await UI.say('{NAME} is overthinking it and freezes up!'); return null; }
      if (s.meAnx === 0) await UI.say('{NAME} calmed down a little.', { auto: 600 });
    }
    p.energy = Math.max(0, p.energy - sk.cost);
    this.refresh();
    await UI.say(`{NAME} used ${sk.name.toUpperCase()}!`, { auto: 450 });
    if (fx.flee) {
      if (fx.karma) this.karma(fx.karma);
      if (s.wild) { await UI.say('{NAME} simply stopped responding. The issue drifts off, confused.'); s.escaped = 'ghost'; return 'ran'; }
      await UI.say('You can\'t ghost a Life Leader. They WILL follow up.');
      return null;
    }
    const targetsFoe = sk.power > 0 || fx.foeAtk || fx.foeDef;
    if (targetsFoe && Math.random() * 100 >= sk.acc) { Audio2.sfx('miss'); await UI.say('But it didn\'t land...'); return null; }
    if (sk.power > 0) {
      const m = EFF[sk.type][f.type];
      const boost = PATHS[p.path] && PATHS[p.path].boost === sk.type ? 1.2 : 1;
      const crit = Math.random() < 1 / 16 ? 1.5 : 1;
      const dmg = this.damage(p.level, sk.power, st.conf * stage(s.stages.atk), f.dfn * stage(f.st.def), m * boost * crit);
      await this.lunge('me');
      f.hp = Math.max(0, f.hp - dmg);
      s.a.foeBlink = 0.5;
      Audio2.sfx(m > 1 ? 'super' : m < 1 ? 'weak' : 'hit');
      if (m > 1 || crit > 1) s.a.shake = 0.25;
      this.refresh();
      await this.settle();
      if (crit > 1) await UI.say('Nailed it! A critical hit!', { auto: 700 });
      if (m > 1) await UI.say('That really hit home!', { auto: 800 });
      else if (m < 1) await UI.say('Meh. It didn\'t really land.', { auto: 800 });
      if (fx.recoil) {
        const rc = Math.max(1, Math.floor(dmg * fx.recoil));
        p.sanity = Math.max(0, p.sanity - rc); s.a.meBlink = 0.4; this.refresh();
        await UI.say(`{NAME} is running on fumes! (-${rc} Sanity)`, { auto: 700 });
        await this.settle();
      }
    }
    if (fx.heal) {
      const before = p.sanity;
      p.sanity = Math.min(st.maxSanity, p.sanity + Math.floor(st.maxSanity * fx.heal));
      if (p.sanity > before) { Audio2.sfx('heal'); this.refresh(); await this.settle(); await UI.say(`{NAME} recovered ${p.sanity - before} Sanity.`, { auto: 700 }); }
    }
    if (fx.energy) {
      p.energy = Math.min(st.maxEnergy, p.energy + fx.energy); this.refresh();
      await UI.say('{NAME} feels recharged! (+Energy)', { auto: 700 });
    }
    if (fx.cure && (p.status || s.meAnx)) { p.status = null; s.meAnx = 0; this.refresh(); await UI.say('{NAME} feels grounded again. Status cured!', { auto: 700 }); }
    if (fx.selfAtk) await this.stageMsg('me', 'atk', fx.selfAtk);
    if (fx.selfDef) await this.stageMsg('me', 'def', fx.selfDef);
    if (fx.foeAtk && f.hp > 0) await this.stageMsg('foe', 'atk', fx.foeAtk);
    if (fx.foeDef && f.hp > 0) await this.stageMsg('foe', 'def', fx.foeDef);
    if (fx.anxious && f.hp > 0 && !f.anx && Math.random() < fx.anxious) {
      f.anx = U.rand(2, 3);
      await UI.say(`${f.name} is second-guessing itself!`, { auto: 800 });
    }
    if (fx.cash) s.cashMult = Math.max(s.cashMult, fx.cash);
    if (fx.karma) this.karma(fx.karma);
    if (f.hp <= 0) return this.foeDown();
    return null;
  },

  async foeAct() {
    const s = this.s, p = Game.p, st = Game.stats(), f = s.foe;
    if (f.hp <= 0) return null;
    const pre = s.wild ? 'The wild ' : 'Foe ';
    if (f.anx > 0) {
      f.anx--;
      if (Math.random() < 0.45) { await UI.say(`${f.name} is second-guessing itself and does nothing!`); return null; }
    }
    let moves = f.def.moves.map((k) => FOE_MOVES[k]);
    // don't waste turns re-applying a status you already have
    const useful = moves.filter((mv) => !(mv.power === 0 && ((mv.fx.anxious && s.meAnx) || (mv.fx.burnout && p.status))));
    if (useful.length) moves = useful;
    const mv = moves[U.rand(0, moves.length - 1)], fx = mv.fx || {};
    await UI.say(`${pre}${f.name.toUpperCase()} used ${mv.name.toUpperCase()}!`, { auto: 450 });
    if (mv.power > 0) {
      const dmg = this.damage(f.lvl, mv.power, f.atk * stage(f.st.atk), st.comp * stage(s.stages.def), Math.random() < 1 / 20 ? 1.5 : 1);
      await this.lunge('foe');
      p.sanity = Math.max(0, p.sanity - dmg);
      s.a.meBlink = 0.5; s.a.shake = 0.2;
      Audio2.sfx('hit');
      this.refresh();
      await this.settle();
    }
    if (fx.atkDown) await this.stageMsg('me', 'atk', -fx.atkDown);
    if (fx.defDown) await this.stageMsg('me', 'def', -fx.defDown);
    if (fx.selfAtk) await this.stageMsg('foe', 'atk', fx.selfAtk);
    if (fx.selfDef) await this.stageMsg('foe', 'def', fx.selfDef);
    if (fx.drain) {
      const d = Math.min(p.energy, fx.drain);
      p.energy -= d; this.refresh();
      await UI.say(d ? `{NAME} lost ${d} Energy!` : '{NAME} has no Energy left to lose!', { auto: 700 });
    }
    if (fx.anxious) {
      if (s.meAnx) await UI.say('{NAME} is already anxious.', { auto: 600 });
      else if (Math.random() < fx.anxious) { s.meAnx = U.rand(2, 4); Audio2.sfx('debuff'); this.refresh(); await UI.say('{NAME} is feeling ANXIOUS!', { auto: 800 }); }
      else if (mv.power === 0) await UI.say('{NAME} shrugs it off.', { auto: 600 });
    }
    if (fx.burnout) {
      if (!p.status && Math.random() < fx.burnout) { p.status = 'burnout'; Audio2.sfx('debuff'); this.refresh(); await UI.say('{NAME} is BURNT OUT!', { auto: 800 }); }
    }
    if (p.sanity <= 0) return this.lose();
    return null;
  },

  damage(L, power, atk, def, mult) {
    const base = Math.floor(Math.floor(Math.floor(2 * L / 5 + 2) * power * atk / def) / 50) + 2;
    return Math.max(1, Math.floor(base * mult * (0.85 + Math.random() * 0.15)));
  },

  async stageMsg(who, stat, n) {
    const s = this.s;
    const obj = who === 'me' ? s.stages : s.foe.st;
    const before = obj[stat];
    // you can be knocked down, but not into the floor
    obj[stat] = U.clamp(obj[stat] + n, who === 'me' ? -4 : -6, 6);
    const name = who === 'me' ? Game.p.name : s.foe.name;
    const label = who === 'me' ? (stat === 'atk' ? 'Confidence' : 'Composure') : (stat === 'atk' ? 'Pressure' : 'Resistance');
    if (obj[stat] === before) { await UI.say(`${name}'s ${label} won't go any ${n > 0 ? 'higher' : 'lower'}!`, { auto: 700 }); return; }
    Audio2.sfx(n > 0 ? 'buff' : 'debuff');
    await UI.say(`${name}'s ${label} ${Math.abs(n) > 1 ? 'sharply ' : ''}${n > 0 ? 'rose' : 'fell'}!`, { auto: 800 });
  },

  karma(n) {
    Game.addKarma(n);
    UI.toast(`Karma ${n > 0 ? '+' : ''}${n} (${Game.karmaLabel()})`);
  },

  async foeDown() {
    const s = this.s, p = Game.p, f = s.foe, d = f.def;
    Audio2.sfx('faint');
    const t0 = performance.now();
    while (true) { const k = Math.min(1, (performance.now() - t0) / 450); s.a.foeGone = k; if (k >= 1) break; await new Promise((r) => requestAnimationFrame(r)); }
    this.hud.foe.classList.add('hidden');
    await UI.say(s.wild ? `${f.name.toUpperCase()} has been dealt with!` : `${LEADERS[s.leader].name}'s ${f.name.toUpperCase()} has been dealt with!`);
    const path = PATHS[p.path] || PATHS.college;
    const xp = Math.max(1, Math.floor(d.xp * f.lvl / 7 * (s.leader ? 1.5 : 1) * path.xpMult));
    p.xp += xp;
    await UI.say(`{NAME} gained ${xp} XP!`, { auto: 800 });
    await this.levelUps();
    if (s.wild) {
      const cash = Math.max(1, Math.floor(d.cash * f.lvl * path.cashMult * s.cashMult * (0.8 + Math.random() * 0.4)));
      const r = Game.earn(cash);
      Audio2.sfx('coin');
      await UI.say(`{NAME} saved ${U.money(cash)} by handling it!${r.garnished ? ` ($${r.garnished} went to loans.)` : ''}`);
      return 'win';
    }
    s.ti++;
    if (s.ti >= s.team.length) return 'win';
    const L = LEADERS[s.leader];
    this.nextFoe(false);
    // fresh issue, fresh start: shake off any stat drops (buffs stay)
    const shaken = s.stages.atk < 0 || s.stages.def < 0;
    s.stages.atk = Math.max(0, s.stages.atk); s.stages.def = Math.max(0, s.stages.def);
    s.a.foeVis = true; s.a.foeY = -60; s.a.foeGone = 0;
    this.hud.foe.classList.remove('hidden');
    await UI.say(`${L.name} throws ${s.foe.name.toUpperCase()} at you!`);
    if (shaken) await UI.say('{NAME} takes a breath and shakes off the last one. (Stat drops reset.)', { auto: 900 });
    return null;
  },

  async levelUps() {
    const p = Game.p;
    while (p.level < 60 && p.xp >= Stats.xpFor(p.level + 1)) {
      const b = Game.stats();
      p.level++;
      const a = Game.stats();
      p.sanity += a.maxSanity - b.maxSanity;
      p.energy += a.maxEnergy - b.maxEnergy;
      Audio2.sfx('levelup');
      this.refresh();
      await UI.say(`{NAME} grew to Level ${p.level}!`);
      await UI.say(`Sanity +${a.maxSanity - b.maxSanity} · Confidence +${a.conf - b.conf} · Composure +${a.comp - b.comp} · Hustle +${a.hus - b.hus}`);
      const path = PATHS[p.path];
      const id = path && path.learn[p.level];
      if (id && !p.known.includes(id)) {
        Game.learn(id);
        await UI.say(`{NAME} learned ${SKILLS[id].name.toUpperCase()}! ${SKILLS[id].desc}`);
        if (!p.equipped.includes(id)) await this.offerSkill(id);
      }
    }
  },

  // You know the skill; offer to swap it into your 4 equipped slots.
  async offerSkill(id) {
    const p = Game.p;
    if (p.equipped.includes(id)) return;
    await UI.say(`{NAME} already has 4 skills equipped. Swap one out for ${SKILLS[id].name.toUpperCase()}?`, { noWait: true });
    const opts = p.equipped.map((e) => 'Swap ' + SKILLS[e].name).concat(['Keep current']);
    const j = await UI.choose(opts, { cls: 'side' });
    if (j >= 0 && j < p.equipped.length) {
      const old = p.equipped[j];
      p.equipped[j] = id;
      await UI.say(`1, 2, and... poof! {NAME} put ${SKILLS[old].name} on the shelf and equipped ${SKILLS[id].name}.`);
    } else {
      await UI.say(`${SKILLS[id].name} is saved in the SKILLS menu for later.`);
    }
  },

  async lose() {
    Audio2.sfx('faint');
    this.refresh();
    await UI.say('{NAME} is out of Sanity!');
    return 'lose';
  },

  async lunge(who) {
    const a = this.s.a, key = who === 'me' ? 'meX' : 'foeX', dir = who === 'me' ? 1 : -1;
    for (let k = 0; k <= 6; k++) { a[key] = dir * Math.sin(k / 6 * Math.PI) * 10; await new Promise((r) => requestAnimationFrame(r)); }
    a[key] = 0;
  },

  // wait until the HUD bars have caught up with the real numbers
  async settle() {
    const t0 = performance.now();
    while (performance.now() - t0 < 1500) {
      const s = this.s, p = Game.p;
      const tf = s.foe.hp / s.foe.maxHp;
      if (Math.abs(s.disp.foe - tf) < 0.01 && Math.abs(s.disp.me - p.sanity) < 0.5) break;
      await new Promise((r) => requestAnimationFrame(r));
    }
  },

  // ------------------------------------------------------------ HUD
  buildHUD() {
    const foe = UI.el('div', 'bhud foe hidden', `<div class="bh-row"><span class="nm"></span><span class="lv"></span></div>
      <div class="bh-row"><span class="tchip"></span><span class="anx"></span></div><div class="bar"><span>SEVERITY</span><i><b></b></i></div>`);
    const me = UI.el('div', 'bhud me hidden', `<div class="bh-row"><span class="nm"></span><span class="lv"></span></div>
      <div class="bar"><span>SANITY</span><i><b></b></i></div><div class="num san"></div>
      <div class="bar en"><span>ENERGY</span><i><b></b></i></div><div class="num en"></div>
      <div class="xp"><i></i></div><div class="st"></div>`);
    UI.root.appendChild(foe); UI.root.appendChild(me);
    this.hud = { foe, me };
  },
  teardown() {
    if (this.hud) { this.hud.foe.remove(); this.hud.me.remove(); }
    this.hud = null;
    this.active = false;
    UI.closeDialog();
  },
  refresh(snap) {
    const s = this.s, p = Game.p, st = Game.stats(), f = s.foe, h = this.hud;
    if (!h || !f) return;
    if (snap) { s.disp.foe = f.hp / f.maxHp; s.disp.me = p.sanity; }
    h.foe.querySelector('.nm').textContent = f.name.toUpperCase();
    h.foe.querySelector('.lv').textContent = 'Lv' + f.lvl;
    const tc = h.foe.querySelector('.tchip');
    tc.textContent = f.type; tc.style.background = ISSUE_TYPES[f.type].color;
    h.foe.querySelector('.anx').textContent = f.anx ? 'CONFUSED' : '';
    h.me.querySelector('.nm').textContent = p.name;
    h.me.querySelector('.lv').textContent = 'Lv' + p.level;
    const en = h.me.querySelector('.bar.en b');
    en.style.width = (p.energy / st.maxEnergy * 100) + '%';
    h.me.querySelector('.num.en').textContent = `${p.energy}/${st.maxEnergy}`;
    const cur = Stats.xpFor(p.level), nx = Stats.xpFor(p.level + 1);
    h.me.querySelector('.xp i').style.width = (U.clamp((p.xp - cur) / (nx - cur), 0, 1) * 100) + '%';
    const tags = [];
    if (p.status === 'burnout') tags.push('<em class="bo">BURNT OUT</em>');
    if (s.meAnx) tags.push('<em class="ax">ANXIOUS</em>');
    h.me.querySelector('.st').innerHTML = tags.join('');
    this.drawBars();
  },
  drawBars() {
    const s = this.s, p = Game.p, st = Game.stats(), h = this.hud;
    if (!h) return;
    const col = (r) => (r > 0.5 ? '#3ec46d' : r > 0.2 ? '#f0c030' : '#e8483a');
    const fb = h.foe.querySelector('.bar b');
    fb.style.width = (s.disp.foe * 100) + '%'; fb.style.background = col(s.disp.foe);
    const mr = s.disp.me / st.maxSanity;
    const mb = h.me.querySelector('.bar:not(.en) b');
    mb.style.width = (mr * 100) + '%'; mb.style.background = col(mr);
    h.me.querySelector('.num.san').textContent = `${Math.round(s.disp.me)}/${st.maxSanity}`;
  },

  update(dt) {
    const s = this.s;
    if (!s) return;
    const a = s.a, p = Game.p;
    a.foeBlink = Math.max(0, a.foeBlink - dt);
    a.meBlink = Math.max(0, a.meBlink - dt);
    a.shake = Math.max(0, a.shake - dt);
    if (a.foeY < 0) a.foeY = Math.min(0, a.foeY + dt * 260);
    if (s.foe) {
      const tf = s.foe.hp / s.foe.maxHp;
      s.disp.foe += U.clamp(tf - s.disp.foe, -dt * 0.9, dt * 0.9);
      const st = Game.stats();
      const step = dt * st.maxSanity * 0.9;
      s.disp.me += U.clamp(p.sanity - s.disp.me, -step, step);
      this.drawBars();
    }
  },

  render(x) {
    const s = this.s;
    if (!s) return;
    const a = s.a, b = BIO[s.biome] || BIO.suburb;
    const sh = a.shake > 0 ? Math.round((Math.random() - 0.5) * 6) : 0;
    x.save();
    x.translate(sh, 0);
    // sky & ground bands
    const [sky1, sky2] = b.sky;
    for (let y = 0; y < 96; y += 8) { x.fillStyle = y < 48 ? (y % 16 ? sky2 : sky1) : sky2; x.fillRect(-4, y, VIEW_W + 8, 8); }
    x.fillStyle = sky1; x.fillRect(-4, 0, VIEW_W + 8, 40);
    x.fillStyle = U.shade(sky1, 0.15); x.fillRect(-4, 40, VIEW_W + 8, 8);
    x.fillStyle = b.field; x.fillRect(-4, 80, VIEW_W + 8, 80);
    x.fillStyle = U.shade(b.field, -0.08);
    for (let y = 84; y < VIEW_H; y += 6) x.fillRect(-4, y, VIEW_W + 8, 2);
    x.fillStyle = U.shade(b.field, 0.1); x.fillRect(-4, 48, VIEW_W + 8, 32);
    // platforms
    const slide = a.slide * 200;
    disc(x, 176 - slide, 64, 46, 10, U.shade(b.field, -0.22));
    disc(x, 176 - slide, 63, 42, 8, U.shade(b.field, -0.1));
    disc(x, 62 + slide, 114, 56, 11, U.shade(b.field, -0.22));
    disc(x, 62 + slide, 113, 52, 9, U.shade(b.field, -0.1));
    // foe / leader
    if (a.showLeader && s.leader) {
      const L = LEADERS[s.leader];
      x.drawImage(Art.portrait(L.pal, L.look, 'down'), 144 - slide + a.leaderX, 2);
    }
    if (a.foeVis && s.foe && a.foeGone < 1) {
      const img = Art.issue(s.foe.id);
      const vis = !(a.foeBlink > 0 && Math.floor(a.foeBlink * 20) % 2 === 0);
      if (vis) {
        const h = Math.round(48 * (1 - a.foeGone));
        x.drawImage(img, 0, 0, 48, h, 152 - slide + a.foeX, 17 + a.foeY + (48 - h), 48, h);
      }
    }
    // player (from behind)
    const pal = { ...PALS.player, c: Game.p.outfit };
    if (!(a.meBlink > 0 && Math.floor(a.meBlink * 20) % 2 === 0)) {
      x.drawImage(Art.portrait(pal, null, 'up'), 30 + slide + a.meX, 52);
    }
    x.restore();
  },
};
