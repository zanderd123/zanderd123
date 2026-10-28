// Playthrough bot, injected into the page by tools/playthrough.mjs.
// It plays through the real controls: it presses buttons via Input and reads
// the on-screen menus (DOM) to decide what to press, like a player would.
/* global Game, World, Battle, UI, Input, Crew, T, SOLID, ITEMS, SKILLS, EFF, LEADERS, TOWNS, ALLIES, Stats, VIEW_W */
(() => {
  const B = window.Bot = {
    path: 'college', t0: performance.now(), log: [], done: false, error: null,
    counts: { wild: 0, wildWon: 0, wildLost: 0, steps: 0, dialogs: 0, leaderTries: {} },
    intent: null,       // what the brain wants from the next menu
  };
  const now = () => (performance.now() - B.t0) / 1000;
  const note = (msg) => { B.log.push([Math.round(now()), msg]); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (q) => document.querySelector(q);
  const tap = async (b) => { Input.down(b); await sleep(40); Input.up(b); await sleep(40); };

  // ------------------------------------------------------------ menu helpers
  const selIndex = (sel, all) => [...document.querySelectorAll(all)].findIndex((e) => e.matches(sel));
  async function gridTo(box, target) {          // 2x2 grids (.actmenu / .sk-grid)
    for (let g = 0; g < 6; g++) {
      const opts = [...box.querySelectorAll('.opt, .sk')];
      const i = opts.findIndex((e) => e.classList.contains('sel'));
      if (i === target) return tap('A');
      const [r, c] = [Math.floor(i / 2), i % 2], [tr, tc] = [Math.floor(target / 2), target % 2];
      await tap(tr < r ? 'up' : tr > r ? 'down' : tc < c ? 'left' : 'right');
    }
  }
  async function listTo(box, pred) {           // .panel.list rows or .choice opts
    const rows = () => [...box.querySelectorAll('.row, .opt')];
    const target = rows().findIndex(pred);
    if (target < 0) return tap('B');
    for (let g = 0; g < 30; g++) {
      const i = rows().findIndex((e) => e.classList.contains('sel'));
      if (i === target) return tap('A');
      await tap(i < target ? 'down' : 'up');
    }
  }

  // ------------------------------------------------------------ battle brain
  const score = (r, id, foe) => {
    const sk = SKILLS[id];
    if (!sk.power || sk.cost > r.energy) return 0;
    return sk.power * EFF[sk.type][foe.type] * (Crew.boost(r) === sk.type ? 1.2 : 1) * (sk.acc / 100);
  };
  const best = (r, foe) => Crew.skills(r).reduce((b, id) => (score(r, id, foe) > b.v ? { id, v: score(r, id, foe) } : b), { id: null, v: 0 });
  const frac = (r) => r.sanity / Crew.stats(r).maxSanity;
  const has = (id) => (Game.p.items[id] || 0) > 0;

  function decideAction() {
    const s = Battle.s, cur = s.cur, foe = s.foe;
    const mine = best(cur, foe);
    // heal when low
    if (frac(cur) < 0.3) {
      const heal = Crew.skills(cur).find((id) => SKILLS[id].fx && SKILLS[id].fx.heal >= 0.3 && SKILLS[id].cost <= cur.energy);
      if (heal) return { act: 0, skill: heal };
      for (const id of ['pizza', 'comfort_food', 'therapy']) if (has(id)) return { act: 1, item: ITEMS[id].name };
    }
    // get a downed teammate back up when things are calm
    if (has('pep_talk') && frac(cur) > 0.5 && Crew.members().some((r) => r.sanity <= 0)) return { act: 1, item: 'Pep Talk' };
    // a teammate with a much better matchup tags in
    const mates = Crew.members().filter((r) => r !== cur && r.sanity > 0 && frac(r) > 0.45);
    const mate = mates.map((r) => ({ r, v: best(r, foe).v })).sort((a, b) => b.v - a.v)[0];
    if (mate && mate.v > mine.v * 1.6 && mate.v >= 60) return { act: 2, swap: Crew.name(mate.r) };
    if (!mine.id || mine.v < 30) {
      if (has('coffee') && cur.energy < 6) return { act: 1, item: 'Coffee' };
      if (has('energy_drink') && cur.energy < 6) return { act: 1, item: 'Energy Drink' };
    }
    return { act: 0, skill: mine.id || 'wing_it' };
  }

  // Reacts to whatever menu is on screen. Returns true if it pressed something.
  async function react() {
    const top = UI.top();
    if (!top) return false;
    const title = $('.panel .p-title') ? $('.panel .p-title').textContent : '';
    if ($('#nameIn')) { $('#nameIn').value = 'BOT'; $('#nameOk').click(); return true; }
    if ($('.pathpick')) {
      const want = ['college', 'trade', 'job'].indexOf(B.path);
      const on = [...document.querySelectorAll('.ps-names span')].findIndex((e) => e.classList.contains('on'));
      await tap(on === want ? 'A' : 'right');
      return true;
    }
    if ($('.titlemenu')) { await listTo($('.titlemenu'), (e) => e.textContent === 'NEW GAME'); return true; }
    if ($('.actmenu')) {
      B.intent = decideAction();
      await gridTo($('.actmenu'), B.intent.act);
      return true;
    }
    if ($('.skillmenu')) {
      const ids = Crew.skills(Battle.s.cur);
      let k = ids.indexOf(B.intent && B.intent.skill);
      if (k < 0) k = 0;
      await gridTo($('.skillmenu .sk-grid'), k);
      return true;
    }
    if ($('.panel.list')) {
      const box = $('.panel.list');
      if (/WHO TAGS IN|^CREW/.test(title)) {
        const foe = Battle.s && Battle.s.foe;
        const alive = Crew.members().filter((r) => r.sanity > 0 && r !== Battle.s.cur);
        const pick = (B.intent && B.intent.swap) || (alive.sort((a, b) => best(b, foe).v - best(a, foe).v)[0] ? Crew.name(alive[0]) : '');
        await listTo(box, (e) => e.querySelector('.l').textContent.startsWith(pick) && !e.classList.contains('dis'));
        B.intent = null;
        return true;
      }
      if (/^BAG/.test(title)) {
        const name = B.intent && B.intent.item;
        B.intent = null;
        if (!name) { await tap('B'); return true; }
        await listTo(box, (e) => e.querySelector('.l').textContent === name);
        return true;
      }
      if (/QUIK STOP/.test(title)) {
        const buy = B.shopping && B.shopping.shift();
        if (!buy) { await tap('B'); return true; }
        await listTo(box, (e) => e.querySelector('.l').textContent === ITEMS[buy].name);
        return true;
      }
      await tap('B');
      return true;
    }
    if ($('.choice')) {
      const opts = [...$('.choice').querySelectorAll('.opt')].map((e) => e.textContent);
      if (opts[0] === 'Yes') { await listTo($('.choice'), (e) => e.textContent === (B.sayNo ? 'No' : 'Yes')); return true; }
      if (opts.some((o) => o.startsWith('Swap '))) {       // new skill: drop the weakest non-free skill
        const eq = Game.p.equipped;
        let w = -1, wv = 1e9;
        eq.forEach((id, i) => { const v = SKILLS[id].cost === 0 ? 1e8 : SKILLS[id].power; if (v < wv) { wv = v; w = i; } });
        await listTo($('.choice'), (e, i) => i === w);
        return true;
      }
      if (opts.some((o) => /\d+\/\d+/.test(o))) { await listTo($('.choice'), () => true); return true; }  // "who gets it"
      await tap('B');
      return true;
    }
    if (!$('.dlg').classList.contains('hidden')) { B.counts.dialogs++; await tap('A'); return true; }
    if ($('.panel')) { await tap('B'); return true; }
    return false;
  }

  // ------------------------------------------------------------ movement
  const W = () => World.maps.world;
  function bfs(m, sx, sy, goal, opts = {}) {
    const start = m.idx(sx, sy), prev = new Int32Array(m.w * m.h).fill(-1), q = [start];
    prev[start] = start;
    while (q.length) {
      const i = q.shift(), x = i % m.w, y = (i / m.w) | 0;
      if (goal(x, y)) { const path = []; let k = i; while (k !== start) { path.push(k); k = prev[k]; } return path.reverse(); }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!m.in(nx, ny)) continue;
        const j = m.idx(nx, ny);
        if (prev[j] !== -1) continue;
        const t = m.get(nx, ny);
        const isGoal = goal(nx, ny);
        if (!isGoal && (SOLID.has(t) || t === T.DOOR || t === T.EXIT)) continue;
        if (!isGoal && opts.avoidGrass && t === T.GRASS) continue;
        if (m.npcs.some((n) => !n.hidden && n.x === nx && n.y === ny)) continue;
        prev[j] = i; q.push(j);
      }
    }
    return null;
  }
  async function waitIdle() {
    for (let g = 0; g < 4000; g++) {
      if (Game.mode === 'world' && !Game.busy && !UI.busy && !Game.pos.moving) return;
      if (!(await react())) await sleep(30);
    }
  }
  // walk until goal(x, y) is reached (on the current map)
  async function walk(goal, opts = {}) {
    for (let tries = 0; tries < 60; tries++) {
      await waitIdle();
      const P = Game.pos, m = Game.map;
      if (goal(P.x, P.y)) return true;
      let path = bfs(m, P.x, P.y, goal, opts);
      if (!path && opts.avoidGrass) path = bfs(m, P.x, P.y, goal);
      if (!path) { await tap(['up', 'down', 'left', 'right'][tries % 4]); continue; }
      const mapId = m.id;
      for (const k of path) {
        const tx = k % m.w, ty = (k / m.w) | 0;
        const d = tx > Game.pos.x ? 'right' : tx < Game.pos.x ? 'left' : ty > Game.pos.y ? 'down' : 'up';
        Input.down('B'); Input.down(d);
        let ok = false;
        for (let g = 0; g < 80; g++) {
          await sleep(20);
          if (Game.mode !== 'world' || UI.busy || Game.busy) break;
          if (Game.pos.x === tx && Game.pos.y === ty && !Game.pos.moving) { ok = true; break; }
        }
        Input.up(d); Input.up('B');
        B.counts.steps++;
        if (!ok || Game.map.id !== mapId) break;
      }
      if (Game.map.id !== mapId) return true;   // went through a door
    }
    return false;
  }
  const at = (x, y) => (px, py) => px === x && py === y;
  async function face(d) { if (Game.pos.dir !== d) { await tap(d); await sleep(150); } }
  async function talk(d) { await face(d); await tap('A'); await sleep(200); await waitIdle(); }

  // ------------------------------------------------------------ places
  const bld = (kind, town) => W().buildings.find((b) => b.kind === kind && b.town === town);
  const doorOf = (b) => [b.x + b.doorX, b.y + b.h - 1];
  async function enter(kind, town) {
    if (Game.map.id !== 'world') await leave();
    const [dx, dy] = doorOf(bld(kind, town));
    await walk(at(dx, dy), { avoidGrass: true });
    await waitIdle();
  }
  async function leave() {
    if (Game.map.id === 'world') return;
    const m = Game.map;
    await walk((x, y) => m.get(x, y) === T.EXIT);
    await waitIdle();
  }
  async function heal(town) {
    await enter('hospital', town);
    await walk(at(9, 5)); await talk('up');
    note(`healed at ${TOWNS[town].name}`);
  }
  async function shop(town) {
    const p = Game.p, want = [];
    const plan = [['comfort_food', 6], ['coffee', 4], ['pep_talk', 2], ['energy_drink', 2], ['pizza', 3]];
    let money = p.money - (B.reserve || 0);
    const stock = SHOP_STOCK[Math.min(town, SHOP_STOCK.length - 1)];
    for (const [id, n] of plan) {
      if (!stock.includes(id)) continue;
      while ((p.items[id] || 0) + want.filter((w) => w === id).length < n && money >= Game.priceOf(id)) { want.push(id); money -= Game.priceOf(id); }
    }
    if (!want.length) return;
    B.shopping = want;
    await enter('store', town);
    await walk(at(2, 5)); await talk('up');
    note(`shopped in ${TOWNS[town].name}: ${want.length} items`);
  }
  async function recruit(id) {
    const n = W().npcs.find((k) => k.ally === id);
    if (!n || n.hidden || Crew.has(id)) return;
    await leave();
    n.wander = 0;
    await walk((x, y) => Math.abs(x - n.x) + Math.abs(y - n.y) === 1, { avoidGrass: true });
    const P = Game.pos;
    await talk(n.x > P.x ? 'right' : n.x < P.x ? 'left' : n.y > P.y ? 'down' : 'up');
    if (Crew.has(id)) note(`${ALLIES[id].name} joined`);
  }
  // Grind on the route next to `town` until the crew reaches `lvl`.
  async function grind(town, route, lvl) {
    const m = W(), hosp = doorOf(bld('hospital', town));
    while (Game.p.level < lvl) {
      if (crewLow()) { await heal(town); await shop(town); }
      await leave();
      // nearest grass tile of that route
      const path = bfs(m, Game.pos.x, Game.pos.y, (x, y) => m.get(x, y) === T.GRASS && m.regionAt(x, y) === 8 + route);
      if (!path) { note('no grass found'); return; }
      await walk((x, y) => m.get(x, y) === T.GRASS && m.regionAt(x, y) === 8 + route);
      // pace back and forth inside the grass
      for (let k = 0; k < 40 && Game.p.level < lvl && !crewLow(); k++) {
        const P = Game.pos;
        const opts = ['left', 'right', 'up', 'down'].map((d) => [d, P.x + { left: -1, right: 1 }[d] || P.x * 0, P.y + ({ up: -1, down: 1 }[d] || 0)]);
        const cands = [['left', P.x - 1, P.y], ['right', P.x + 1, P.y], ['up', P.x, P.y - 1], ['down', P.x, P.y + 1]].filter(([, x, y]) => m.get(x, y) === T.GRASS);
        void opts;
        if (!cands.length) break;
        const [, x, y] = cands[k % cands.length];
        const before = B.counts.wild;
        await walk(at(x, y));
        await waitIdle();
        if (Game.map.id !== 'world') break;     // lost a battle and woke up somewhere
        if (B.counts.wild !== before) { /* counted in battle hook */ }
      }
      void hosp;
    }
  }
  const crewLow = () => {
    const ms = Crew.members();
    const tot = ms.reduce((a, r) => a + Math.max(0, r.sanity), 0), max = ms.reduce((a, r) => a + Crew.stats(r).maxSanity, 0);
    return tot / max < 0.45 || Game.p.sanity <= 0 && !ms.some((r) => r.sanity > Crew.stats(r).maxSanity * 0.5);
  };
  async function fightLeader(key) {
    const L = LEADERS[key];
    B.counts.leaderTries[key] = (B.counts.leaderTries[key] || 0) + 1;
    await heal(L.town);
    await shop(L.town);
    await enter('hall', L.town);
    await walk(at(9, 4));
    const before = Game.p.badges.length;
    await talk('up');
    await waitIdle();
    const won = Game.p.badges.length > before;
    note(`${won ? 'BEAT' : 'lost to'} ${L.title} at level ${Game.p.level} (try ${B.counts.leaderTries[key]})`);
    return won;
  }

  // count battles by watching Battle.start
  const origStart = Battle.start.bind(Battle);
  Battle.start = async (o) => {
    if (o.wild) B.counts.wild++;
    const r = await origStart(o);
    if (o.wild) { if (r === 'win') B.counts.wildWon++; if (r === 'lose') { B.counts.wildLost++; note(`wiped by a wild issue at level ${Game.p.level}`); } }
    return r;
  };

  // ------------------------------------------------------------ the run
  B.run = async (path) => {
    B.path = path;
    try {
      // title -> intro -> house
      for (let g = 0; g < 3000 && !(Game.mode === 'world' && Game.p && /say hi/.test($('.dlg-text').textContent)); g++) { if (!(await react())) await sleep(30); }
      await waitIdle();
      note('in bedroom');
      await talkTo('mom');
      await leave();
      // Dr. Street's lab, pick the path
      await enter('lab', 0);
      await walk(at(13, 5)); await talk('up');
      await walk(at(8, 6)); await talk('up');
      note(`chose ${path}`);
      await leave();               // Corbin meets you outside
      await waitIdle();
      note(`crew: ${Crew.members().map((r) => Crew.name(r)).join(', ')}`);
      await shop(0);
      // the three leaders, with the routes between them
      const plan = [
        { key: 'car', town: 1, route: 0, lvl: 10, before: async () => { B.reserve = 50; await shop(0); await walkTo(1); await recruitAt('sam', 1); B.reserve = 0; } },
        { key: 'fitness', town: 2, route: 1, lvl: 14, before: async () => { await walkTo(2); await recruit('pat'); } },
        { key: 'taxes', town: 3, route: 2, lvl: 18, before: async () => { B.reserve = 40; await walkTo(3); await recruitAt('kim', 3); B.reserve = 0; } },
      ];
      for (const st of plan) {
        if (st.key === 'car') await grind(0, 0, 7);
        await st.before();
        let tries = 0;
        while (!Game.p.badges.includes(st.key) && tries < 6) {
          await grind(st.town, st.route, st.lvl + tries);
          if (await fightLeader(st.key)) break;
          tries++;
        }
        if (!Game.p.badges.includes(st.key)) { note(`gave up on ${st.key}`); break; }
        note(`milestones: ${Game.p.badges.length}/3 playable`);
      }
    } catch (e) { B.error = e.message + '\n' + e.stack; }
    B.done = true;
    B.total = now();
  };
  async function talkTo(pal) {
    const n = Game.map.npcs.find((k) => k.pal === pal);
    await walk((x, y) => Math.abs(x - n.x) + Math.abs(y - n.y) === 1);
    const P = Game.pos;
    await talk(n.x > P.x ? 'right' : n.x < P.x ? 'left' : n.y > P.y ? 'down' : 'up');
  }
  async function walkTo(town) {
    await leave();
    const [ox, oy] = World.townOrigin(town);
    await walk((x, y) => x >= ox + 3 && x < ox + TW - 3 && y >= oy + 3 && y < oy + TH - 3 && W().get(x, y) === T.PATH, { avoidGrass: true });
    note(`arrived in ${TOWNS[town].name} (level ${Game.p.level})`);
  }
  async function recruitAt(id, town) { if (Game.p.money >= (ALLIES[id].cost || 0)) await recruit(id); else note(`couldn't afford ${ALLIES[id].name}`); }
})();
