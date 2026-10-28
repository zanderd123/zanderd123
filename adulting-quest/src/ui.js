'use strict';
// Input (keyboard + on-screen pad) and the DOM overlay widgets: dialog box,
// choice menus, scrolling lists and full panels. Widgets stack; only the top
// one receives input, and every widget is driven by a Promise so game
// scripts read top to bottom with await.

const Input = {
  held: { up: false, down: false, left: false, right: false, A: false, B: false, START: false },
  queue: [],
  pressed: new Set(),
  dirStack: [],
  rep: { dir: null, t: 0 },
  touchRun: false,

  KEYS: {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
    z: 'A', Z: 'A', j: 'A', J: 'A', ' ': 'A', Enter: 'A',
    x: 'B', X: 'B', k: 'B', K: 'B', Backspace: 'B', Shift: 'B',
    Escape: 'ESC', m: 'MUSIC', M: 'MUSIC', Tab: 'START',
  },

  init() {
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      const b = this.KEYS[e.key];
      if (!b) return;
      e.preventDefault();
      Audio2.unlock();
      if (e.repeat) return;
      this.down(b);
    });
    window.addEventListener('keyup', (e) => {
      const b = this.KEYS[e.key];
      if (b) this.up(b);
    });
    window.addEventListener('blur', () => { for (const k in this.held) this.held[k] = false; this.dirStack = []; });

    // on-screen pad
    const pad = document.getElementById('dpad');
    if (pad) {
      let cur = null;
      const setDir = (d) => {
        if (d === cur) return;
        if (cur) this.up(cur);
        cur = d;
        if (d) this.down(d);
      };
      const fromEvent = (e) => {
        const r = pad.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        if (Math.hypot(dx, dy) < r.width * 0.12) return null;
        return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      };
      pad.addEventListener('pointerdown', (e) => { e.preventDefault(); Audio2.unlock(); pad.setPointerCapture(e.pointerId); setDir(fromEvent(e)); });
      pad.addEventListener('pointermove', (e) => { if (cur !== null || e.buttons) setDir(fromEvent(e)); });
      const end = () => setDir(null);
      pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end); pad.addEventListener('lostpointercapture', end);
    }
    document.querySelectorAll('[data-btn]').forEach((el) => {
      const b = el.dataset.btn;
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); Audio2.unlock(); el.setPointerCapture(e.pointerId); el.classList.add('on'); this.down(b); });
      const end = () => { el.classList.remove('on'); this.up(b); };
      el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
    });
  },

  down(b) {
    if (b === 'ESC') { this.queue.push('ESC'); return; }
    if (b === 'MUSIC') { Audio2.setMuted(!Audio2.muted); UI.toast(Audio2.muted ? 'MUSIC OFF' : 'MUSIC ON'); return; }
    if (this.held[b]) return;
    this.held[b] = true;
    this.queue.push(b);
    if (['up', 'down', 'left', 'right'].includes(b)) {
      this.dirStack = this.dirStack.filter((d) => d !== b);
      this.dirStack.push(b);
      this.rep = { dir: b, t: 0 };
    }
  },
  up(b) {
    if (!(b in this.held)) return;
    this.held[b] = false;
    this.dirStack = this.dirStack.filter((d) => d !== b);
  },
  dir() { return this.dirStack.length ? this.dirStack[this.dirStack.length - 1] : null; },

  // Called once per frame: turns queued presses into this frame's edges, and
  // auto-repeats a held direction for menus.
  frame(dt) {
    this.pressed = new Set(this.queue);
    this.queue = [];
    const d = this.dir();
    if (d && this.rep.dir === d) {
      this.rep.t += dt;
      if (this.rep.t > 0.32) { this.pressed.add('rep:' + d); this.rep.t -= 0.09; }
    }
  },
  hit(b) { return this.pressed.has(b); },
  // Menu navigation: first press or auto-repeat.
  nav(d) { return this.pressed.has(d) || this.pressed.has('rep:' + d); },
};

const UI = {
  root: null,
  stack: [],
  dlg: null,

  init() {
    this.root = document.getElementById('ui');
    this.dlg = this.el('div', 'dlg hidden', '<div class="dlg-name"></div><div class="dlg-text"></div><div class="dlg-more">▼</div>');
    this.root.appendChild(this.dlg);
    this.toastEl = this.el('div', 'toast hidden');
    this.root.appendChild(this.toastEl);
    this.hud = this.el('div', 'hud hidden');
    this.root.appendChild(this.hud);
  },
  el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  },
  get busy() { return this.stack.length > 0; },
  push(w) { this.stack.push(w); },
  pop(w) { const i = this.stack.lastIndexOf(w); if (i >= 0) this.stack.splice(i, 1); },
  top() { return this.stack[this.stack.length - 1]; },

  update(dt) {
    for (const w of this.stack) if (w.update) w.update(dt);
    const t = this.top();
    if (!t) return;
    for (const b of ['A', 'B', 'START', 'ESC', 'up', 'down', 'left', 'right']) {
      const hit = ['up', 'down', 'left', 'right'].includes(b) ? Input.nav(b) : Input.hit(b);
      if (hit) {
        const bb = b === 'ESC' ? 'B' : b;
        if (t.onInput(bb) === 'stop') break;
        if (this.top() !== t) break;
      }
    }
  },

  // -------------------------------------------------------------- dialog
  // say(text | [texts], { name, auto: ms, fast })
  async say(text, o = {}) {
    if (Array.isArray(text)) { for (const t of text) await this.say(t, o); return; }
    text = Game.fmt(text);
    // House Keeper boxes: 34 characters a line, 3 lines a box
    const pages = this.paginate(text);
    if (pages.length > 1) {
      for (let i = 0; i < pages.length; i++) await this.say(pages[i], { ...o, raw: true, noWait: i === pages.length - 1 ? o.noWait : false, auto: i === pages.length - 1 ? o.auto : 0 });
      return;
    }
    text = pages[0];
    const box = this.dlg;
    box.classList.remove('hidden');
    box.classList.toggle('battle', !!Battle.active);
    box.querySelector('.dlg-name').textContent = o.name || '';
    box.querySelector('.dlg-name').style.display = o.name ? '' : 'none';
    const tx = box.querySelector('.dlg-text'), more = box.querySelector('.dlg-more');
    tx.textContent = '';
    more.style.visibility = 'hidden';
    return new Promise((resolve) => {
      const speed = o.fast ? 140 : 70;
      let shown = 0, done = false, wait = 0, blip = 0;
      const w = {
        update: (dt) => {
          if (!done) {
            shown = Math.min(text.length, shown + speed * dt);
            tx.textContent = text.slice(0, Math.floor(shown));
            blip += dt;
            if (blip > 0.07) { blip = 0; Audio2.sfx('blip'); }
            if (shown >= text.length) { done = true; more.style.visibility = o.auto || o.noWait ? 'hidden' : 'visible'; }
          } else if (o.noWait) {
            finish();
          } else if (o.auto) {
            wait += dt * 1000;
            if (wait >= o.auto) finish();
          }
        },
        onInput: (b) => {
          if (b !== 'A' && b !== 'B') return;
          if (!done) { shown = text.length; tx.textContent = text; done = true; more.style.visibility = o.auto ? 'hidden' : 'visible'; return 'stop'; }
          Audio2.sfx('select');
          finish();
          return 'stop';
        },
      };
      const finish = () => { UI.pop(w); more.style.visibility = 'hidden'; resolve(); };
      this.push(w);
    });
  },
  closeDialog() { this.dlg.classList.add('hidden'); },
  paginate(text, width = 34, rows = 3) {
    const lines = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const w of para.split(' ')) {
        if (!line) line = w;
        else if ((line + ' ' + w).length <= width) line += ' ' + w;
        else { lines.push(line); line = w; }
        while (line.length > width) { lines.push(line.slice(0, width)); line = line.slice(width); }
      }
      lines.push(line);
    }
    const pages = [];
    for (let i = 0; i < lines.length; i += rows) pages.push(lines.slice(i, i + rows).join('\n'));
    return pages.length ? pages : [''];
  },

  // -------------------------------------------------------------- choice
  choose(options, o = {}) {
    const box = this.el('div', 'menu choice' + (o.cls ? ' ' + o.cls : ''));
    if (o.style) Object.assign(box.style, o.style);
    let i = o.start || 0;
    const render = () => {
      box.innerHTML = options.map((op, k) => `<div class="opt${k === i ? ' sel' : ''}">${U.esc(op)}</div>`).join('');
    };
    render();
    this.root.appendChild(box);
    return new Promise((resolve) => {
      const w = {
        onInput: (b) => {
          if (b === 'up') { i = (i + options.length - 1) % options.length; Audio2.sfx('move'); render(); }
          else if (b === 'down') { i = (i + 1) % options.length; Audio2.sfx('move'); render(); }
          else if (b === 'A') { Audio2.sfx('select'); done(i); }
          else if (b === 'B' && o.cancel !== false) { Audio2.sfx('back'); done(-1); }
          return 'stop';
        },
      };
      const done = (v) => { UI.pop(w); box.remove(); resolve(v); };
      box.addEventListener('pointerdown', (e) => {
        const opts = [...box.children];
        const k = opts.indexOf(e.target.closest('.opt'));
        if (k >= 0 && UI.top() === w) { e.preventDefault(); i = k; render(); Audio2.sfx('select'); done(k); }
      });
      this.push(w);
    });
  },
  async confirm(q, o = {}) {
    await this.say(q, { ...o, noWait: true });
    const r = await this.choose(['Yes', 'No'], { cls: 'yesno' });
    return r === 0;
  },

  // -------------------------------------------------------------- lists
  // items: [{ label, right, desc, disabled, icon }]; returns index or -1.
  // o.title, o.footer(), o.onAct(i) => keep open when it returns 'keep'
  list(items, o = {}) {
    const box = this.el('div', 'panel list' + (o.cls ? ' ' + o.cls : ''));
    let i = Math.min(o.start || 0, Math.max(0, items.length - 1));
    const render = () => {
      const its = typeof items === 'function' ? items() : items;
      i = Math.min(i, Math.max(0, its.length - 1));
      const head = o.title ? `<div class="p-title">${o.title}${o.headRight ? `<span>${o.headRight()}</span>` : ''}</div>` : '';
      const rows = its.length
        ? its.map((it, k) => `<div class="row${k === i ? ' sel' : ''}${it.disabled ? ' dis' : ''}">${it.icon || ''}<span class="l">${U.esc(it.label)}</span><span class="r">${it.right ?? ''}</span></div>`).join('')
        : `<div class="row dis"><span class="l">${o.empty || 'Nothing here.'}</span></div>`;
      const desc = its[i] && its[i].desc ? its[i].desc : (o.hint || '');
      box.innerHTML = `${head}<div class="rows">${rows}</div><div class="p-desc">${desc}</div><div class="p-foot">${o.footer ? o.footer() : 'A: select · B: back'}</div>`;
      const sel = box.querySelector('.row.sel');
      if (sel) sel.scrollIntoView({ block: 'nearest' });
      return its;
    };
    let its = render();
    this.root.appendChild(box);
    return new Promise((resolve) => {
      let busy = false;
      const act = async (k) => {
        if (busy) return;
        if (!its[k] || its[k].disabled) { Audio2.sfx('bump'); return; }
        Audio2.sfx('select');
        if (o.onAct) {
          busy = true;
          const r = await o.onAct(k, its[k]);
          busy = false;
          if (r === 'keep') { its = render(); return; }
        }
        done(k);
      };
      const w = {
        onInput: (b) => {
          if (busy) return 'stop';
          if (b === 'up' && its.length) { i = (i + its.length - 1) % its.length; Audio2.sfx('move'); its = render(); }
          else if (b === 'down' && its.length) { i = (i + 1) % its.length; Audio2.sfx('move'); its = render(); }
          else if (b === 'A') act(i);
          else if (b === 'B' && !o.noCancel) { Audio2.sfx('back'); done(-1); }
          return 'stop';
        },
      };
      const done = (v) => { UI.pop(w); box.remove(); resolve(v); };
      box.addEventListener('pointerdown', (e) => {
        const row = e.target.closest('.row');
        if (!row || UI.top() !== w) return;
        const k = [...box.querySelectorAll('.row')].indexOf(row);
        if (k < 0) return;
        e.preventDefault();
        if (k === i) act(k); else { i = k; its = render(); Audio2.sfx('move'); }
      });
      this.push(w);
    });
  },

  // A full-screen info panel closed with A or B.
  panel(html, o = {}) {
    const box = this.el('div', 'panel info' + (o.cls ? ' ' + o.cls : ''), html + '<div class="p-foot">A / B: close</div>');
    this.root.appendChild(box);
    return new Promise((resolve) => {
      const w = { onInput: (b) => { if (b === 'A' || b === 'B' || b === 'START') { Audio2.sfx('back'); UI.pop(w); box.remove(); resolve(); } return 'stop'; } };
      box.addEventListener('pointerdown', (e) => { if (UI.top() === w) { e.preventDefault(); w.onInput('A'); } });
      this.push(w);
    });
  },

  // Always-on stats strip in the overworld (House Keeper's top-right HUD).
  updateHUD() {
    const p = Game.p, h = this.hud;
    const show = Game.mode === 'world' && p && p.path && !this.root.querySelector('.panel');
    h.classList.toggle('hidden', !show);
    if (!show) return;
    const st = Game.stats();
    const key = [p.money, p.level, p.sanity, p.energy, p.badges.length, p.status, st.maxSanity, p.crew.map((r) => r.sanity > 0).join()].join('|');
    if (key === this._hudKey) return;
    this._hudKey = key;
    const pct = (a, b) => Math.round(U.clamp(a / b, 0, 1) * 100);
    const sr = p.sanity / st.maxSanity;
    h.innerHTML = `<span class="h-cash">${U.money(p.money)}</span><span>LV${p.level}</span>
      <span class="h-bars"><i class="hs"><b style="width:${pct(p.sanity, st.maxSanity)}%;background:${sr > 0.5 ? '#3ec46d' : sr > 0.2 ? '#f0c030' : '#e8483a'}"></b></i><i class="he"><b style="width:${pct(p.energy, st.maxEnergy)}%"></b></i></span>
      <span class="h-star">★${p.badges.length}</span>${p.crew.length ? `<span class="h-crew">${Crew.members().map((r) => `<i class="${r.sanity <= 0 ? 'out' : ''}"></i>`).join('')}</span>` : ''}${p.status === 'burnout' ? '<span class="h-bo">BURNT OUT</span>' : ''}`;
  },

  toast(text, ms = 1600) {
    const t = this.toastEl;
    t.textContent = text;
    t.classList.remove('hidden');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => t.classList.add('hidden'), ms);
  },

  banner(text) {
    const b = this.el('div', 'banner', U.esc(text));
    this.root.appendChild(b);
    setTimeout(() => b.classList.add('out'), 1800);
    setTimeout(() => b.remove(), 2400);
  },

  // Name entry uses a real text field so phone keyboards work.
  askName(def) {
    const box = this.el('div', 'panel namebox', `<div class="p-title">What's your name?</div>
      <input id="nameIn" maxlength="10" autocomplete="off" spellcheck="false" value="${U.esc(def)}">
      <div class="nb-btns"><button id="nameOk">OK</button></div>`);
    this.root.appendChild(box);
    const inp = box.querySelector('input');
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
    return new Promise((resolve) => {
      const w = { onInput: () => 'stop' };
      const done = () => {
        const v = inp.value.trim().replace(/[^\w .'-]/g, '').slice(0, 10) || def;
        UI.pop(w); box.remove(); resolve(v.toUpperCase());
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(); } e.stopPropagation(); });
      box.querySelector('#nameOk').addEventListener('click', done);
      this.push(w);
    });
  },
};
