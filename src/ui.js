/**
 * All the DOM. Three pieces:
 *
 *   Builder    the pre-battle screen — side, budget, difficulty, mode, and the
 *              fleet you buy with it.
 *   Roster     the live fleet list down the side, one row per squadron.
 *   Hud        everything else on screen during a battle: clock, gauges, the
 *              selection panel, the end screen.
 *
 * The markup already exists in index.html; nothing here builds a page from
 * scratch. Rows and cards are created once and then mutated, because the
 * roster updates every frame and rebuilding its innerHTML at 60Hz drops frames
 * on its own.
 */
import {
  SHIPS, GROUND, BUDGET, DIFFICULTY, DEFAULT_DIFFICULTY, SHIELDS, SPEEDS,
  FACTION, budgetFor, unitCost, derive, setPlayMode,
} from './config.js';
import { formatTime } from './util.js';

const $ = (id) => document.getElementById(id);

const el = (tag, cls, html) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html != null) node.innerHTML = html;
  return node;
};

/** The five bars on a unit card. All are 0-100 stats, so width is the value. */
const CARD_STATS = [
  ['SPD', 'speed'], ['HP', 'health'], ['DPS', 'dps'],
  ['AGI', 'agility'], ['SKL', 'skill'],
];

const MODE_HINTS = {
  volume: 'Full 3D. Ships manoeuvre through a tall volume and orders are placed at any altitude.',
  flat: 'Ships fly a thin plate seen from overhead. One-click orders, no altitude to judge, and the planet becomes a solid obstacle you have to go around.',
};

/** Hulls that stop helping past a couple of copies. */
const SUPPORT = new Set(['aegis', 'rig', 'specter', 'spawner']);

// ---------------------------------------------------------------------------

export class Builder {
  constructor(onLaunch) {
    this.onLaunch = onLaunch;
    this.side = null;
    this.budget = BUDGET.default;
    this.difficulty = DEFAULT_DIFFICULTY;
    this.mode = 'volume';
    this.roster = new Map();

    this.root = $('setup');
    this.budgetInput = $('budget');
    this.budgetOut = $('budget-value');
    this.budgetInput.addEventListener('input', () => {
      this.budget = Number(this.budgetInput.value);
      this.budgetOut.textContent = this.budget;
      $('budget-hint').textContent = this.budgetHint();
      this.refresh();
    });

    for (const card of document.querySelectorAll('.side-card')) {
      card.addEventListener('click', () => this.pickSide(card.dataset.side));
    }
    for (const opt of document.querySelectorAll('#difficulty .diff-opt')) {
      opt.addEventListener('click', () => this.pickDifficulty(opt.dataset.diff));
    }
    for (const opt of document.querySelectorAll('#playmode .diff-opt')) {
      opt.addEventListener('click', () => this.pickMode(opt.dataset.mode));
    }

    $('auto-fill').addEventListener('click', () => this.autoFill());
    $('clear-fleet').addEventListener('click', () => {
      this.roster.clear();
      this.refresh();
    });
    $('launch').addEventListener('click', () => {
      if (this.spent > this.effectiveBudget || !this.roster.size) return;
      this.onLaunch({
        side: this.side,
        budget: this.budget,
        difficulty: this.difficulty,
        mode: this.mode,
        roster: [...this.roster.entries()].map(([typeId, qty]) => ({ typeId, qty })),
      });
    });

    this.buildCards();
  }

  pickMode(mode) {
    if (!MODE_HINTS[mode]) return;
    // Applied immediately: the arena's dimensions change, and the builder's
    // own preview of the world has to agree with what you are about to play.
    this.mode = setPlayMode(mode);
    for (const opt of document.querySelectorAll('#playmode .diff-opt')) {
      const on = opt.dataset.mode === mode;
      opt.classList.toggle('active', on);
      opt.setAttribute('aria-checked', String(on));
    }
    $('mode-hint').textContent = MODE_HINTS[mode];
  }

  pickDifficulty(id) {
    if (!DIFFICULTY[id]) return;
    this.difficulty = id;
    for (const opt of document.querySelectorAll('.diff-opt')) {
      const on = opt.dataset.diff === id;
      opt.classList.toggle('active', on);
      opt.setAttribute('aria-checked', String(on));
    }
    $('diff-hint').textContent = DIFFICULTY[id].blurb;
  }

  budgetHint() {
    const b = this.budget;
    if (b <= 800) return 'Patrol action — small, fast, decisive';
    if (b <= 1400) return 'Skirmish — fast, readable battles';
    if (b <= 2400) return 'Battle — a proper fleet engagement';
    if (b <= 3200) return 'Fleet action — large, heavy on the GPU';
    return 'Armada — hundreds of hulls. Expect frame cost.';
  }

  /** The budget after any per-side adjustment. */
  get effectiveBudget() {
    return this.side ? budgetFor(this.side, this.budget) : this.budget;
  }

  get spent() {
    let total = 0;
    for (const [id, qty] of this.roster) total += unitCost(SHIPS[id] || GROUND[id]) * qty;
    return total;
  }

  pickSide(side) {
    this.side = side;
    for (const card of document.querySelectorAll('.side-card')) {
      card.classList.toggle('active', card.dataset.side === side);
    }
    $('builder').classList.remove('hidden');

    // Only the defender has ground: emplacements belong to whoever holds the
    // world.
    const ground = side === 'defense';
    $('ground-label').classList.toggle('hidden', !ground);
    $('ground-cards').classList.toggle('hidden', !ground);
    if (!ground) for (const id of Object.keys(GROUND)) this.roster.delete(id);

    this.refresh();
    $('builder').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  card(type) {
    const node = el('div', 'unit-card');
    node.dataset.type = type.id;
    const cost = unitCost(type);

    node.appendChild(el('div', 'uc-top',
      `<span class="uc-name">${type.name}</span><span class="uc-cost">${cost}</span>`));
    node.appendChild(el('div', 'uc-class', type.className.toUpperCase()));
    node.appendChild(el('div', 'uc-role', type.role));

    const stats = el('div', 'stat-rows');
    for (const [label, key] of CARD_STATS) {
      stats.appendChild(el('div', 'stat-row',
        `<span>${label}</span><div class="stat-bar"><i style="width:${type[key]}%"></i></div><b>${type[key]}</b>`));
    }
    node.appendChild(stats);
    node.appendChild(el('div', 'uc-ability',
      `<b>${type.ability.name}</b> — ${type.ability.desc}`));
    if (type.count > 1) {
      node.appendChild(el('div', 'uc-squad',
        `SQUADRON OF ${type.count} · ${type.costEach} pts each`));
    }

    const buy = el('div', 'uc-buy');
    const minus = el('button', null, '−');
    const qty = el('div', 'uc-qty', '0');
    const plus = el('button', null, '+');
    minus.addEventListener('click', () => this.adjust(type.id, -1));
    plus.addEventListener('click', () => this.adjust(type.id, 1));
    buy.append(minus, qty, plus);
    node.appendChild(buy);

    node._qty = qty;
    node._plus = plus;
    node._minus = minus;
    node._cost = cost;
    return node;
  }

  buildCards() {
    this.cards = new Map();
    const ships = $('ship-cards');
    const ground = $('ground-cards');
    for (const type of Object.values(SHIPS)) {
      const c = this.card(type);
      ships.appendChild(c);
      this.cards.set(type.id, c);
    }
    for (const type of Object.values(GROUND)) {
      const c = this.card(type);
      ground.appendChild(c);
      this.cards.set(type.id, c);
    }
  }

  adjust(id, delta) {
    const have = this.roster.get(id) || 0;
    const type = SHIPS[id] || GROUND[id];
    const next = have + delta;
    if (next < 0) return;
    if (delta > 0 && this.spent + unitCost(type) > this.effectiveBudget) return;
    if (next === 0) this.roster.delete(id);
    else this.roster.set(id, next);
    this.refresh();
  }

  /**
   * Spend the whole budget on a sensible fleet. Same three-pass shape as the
   * AI's generator, with the same support caps, but weighted a little
   * differently: the player's version leans slightly harder on line hulls,
   * because a human is far more likely to actually use them.
   */
  autoFill() {
    this.roster.clear();
    const table = this.side === 'defense'
      ? [['bastion', 0.18], ['warden', 0.16], ['falcon', 0.15], ['aegis', 0.11],
        ['sentry', 0.11], ['flak', 0.09], ['spawner', 0.09], ['wasp', 0.07], ['rig', 0.04]]
      : [['falcon', 0.27], ['bastion', 0.22], ['wasp', 0.16], ['warden', 0.13],
        ['spawner', 0.09], ['aegis', 0.08], ['specter', 0.05]];
    const caps = { aegis: 2, rig: 2, specter: 2, spawner: 2, sentry: 5, flak: 4 };
    const capOf = (id) => caps[id] ?? Infinity;

    for (const [id, weight] of table) {
      const type = SHIPS[id] || GROUND[id];
      const want = (this.effectiveBudget * weight) / unitCost(type);
      let n = Math.floor(want);
      if (Math.random() < want - n) n += 1;
      const affordable = Math.floor((this.effectiveBudget - this.spent) / unitCost(type));
      n = Math.max(0, Math.min(capOf(id), n, affordable));
      if (n > 0) this.roster.set(id, n);
    }

    // Spend the remainder on line hulls, weighted the same way.
    let guard = 0;
    while (guard++ < 400) {
      const options = table
        .filter(([id]) => !SUPPORT.has(id))
        .map(([id, w]) => ({ type: SHIPS[id] || GROUND[id], w }))
        .filter(({ type }) => (this.roster.get(type.id) || 0) < capOf(type.id)
          && this.spent + unitCost(type) <= this.effectiveBudget);
      if (!options.length) break;
      let roll = Math.random() * options.reduce((s, o) => s + o.w, 0);
      let choice = options[options.length - 1];
      for (const o of options) {
        roll -= o.w;
        if (roll <= 0) { choice = o; break; }
      }
      this.roster.set(choice.type.id, (this.roster.get(choice.type.id) || 0) + 1);
    }

    this.refresh();
  }

  refresh() {
    const spent = this.spent;
    const budget = this.effectiveBudget;
    const over = spent > budget;

    $('spent').textContent = spent;
    $('budget-total').textContent = budget;
    $('spend-fill').style.width = `${Math.min(100, (spent / budget) * 100)}%`;
    document.querySelector('.spend').classList.toggle('over', over);

    for (const [id, card] of this.cards) {
      const qty = this.roster.get(id) || 0;
      card._qty.textContent = qty;
      card.classList.toggle('owned', qty > 0);
      card._minus.disabled = qty === 0;
      card._plus.disabled = spent + card._cost > budget;
    }

    const list = $('roster-list');
    list.innerHTML = '';
    if (!this.roster.size) {
      list.appendChild(el('p', 'empty', 'No units purchased.'));
    } else {
      for (const [id, qty] of this.roster) {
        const type = SHIPS[id] || GROUND[id];
        const hulls = type.count * qty;
        list.appendChild(el('div', 'roster-item',
          `<span>${type.name} ×${qty}<br><small>${hulls} hull${hulls > 1 ? 's' : ''}</small></span>
           <b>${unitCost(type) * qty}</b>`));
      }
    }

    let hulls = 0;
    let hp = 0;
    let dps = 0;
    let squadrons = 0;
    for (const [id, qty] of this.roster) {
      const type = SHIPS[id] || GROUND[id];
      const stats = derive(type);
      squadrons += qty;
      hulls += type.count * qty;
      hp += stats.maxHealth * type.count * qty;
      dps += stats.dps * type.count * qty;
    }
    $('roster-stats').innerHTML = `
      <div><span>SQUADRONS / UNITS</span><b>${squadrons}</b></div>
      <div><span>TOTAL HULLS</span><b>${hulls}</b></div>
      <div><span>FLEET HP</span><b>${Math.round(hp).toLocaleString()}</b></div>
      <div><span>RAW DPS</span><b>${Math.round(dps).toLocaleString()}</b></div>
      <div><span>UNSPENT</span><b>${budget - spent}</b></div>`;

    $('launch').disabled = over || !this.roster.size || !this.side;
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }
}

// ---------------------------------------------------------------------------

/** The live fleet list. One row per squadron, reused for the whole battle. */
class Roster {
  constructor(app) {
    this.app = app;
    this.body = $('roster-body');
    this.panel = $('roster-panel');
    this.alarm = $('roster-alarm');
    this.rows = new Map();
    this.minimised = false;
    $('roster-toggle').addEventListener('click', () => this.toggle());
  }

  toggle() {
    this.minimised = !this.minimised;
    this.panel.classList.toggle('min', this.minimised);
    $('roster-toggle').title = this.minimised
      ? 'Show the fleet list (Tab)' : 'Minimise the fleet list (Tab)';
    return this.minimised;
  }

  show(on) { this.panel.classList.toggle('hidden', !on); }

  makeRow(unit) {
    const node = document.createElement('div');
    node.className = 'rr';
    node.innerHTML = `
      <div class="rr-name"></div>
      <div class="rr-hulls"></div>
      <div class="rr-type"></div>
      <div class="rr-bars">
        <div class="rr-hp"><i></i><b></b></div>
        <div class="rr-sh"><i></i></div>
      </div>
      <div class="rr-foot">
        <span class="rr-state"></span>
        <span class="rr-dmg"></span>
      </div>`;
    const refs = {
      name: node.querySelector('.rr-name'),
      hulls: node.querySelector('.rr-hulls'),
      type: node.querySelector('.rr-type'),
      hp: node.querySelector('.rr-hp'),
      hpFill: node.querySelector('.rr-hp i'),
      hpGhost: node.querySelector('.rr-hp b'),
      sh: node.querySelector('.rr-sh'),
      shFill: node.querySelector('.rr-sh i'),
      state: node.querySelector('.rr-state'),
      dmg: node.querySelector('.rr-dmg'),
    };
    node.addEventListener('click', (e) => {
      if (!unit.alive) return;
      this.app.setSelection(e.shiftKey ? [...this.app.selection, unit] : [unit]);
    });
    node.addEventListener('dblclick', () => {
      if (unit.alive) this.app.rig.frameOn(unit.pos, 700);
    });
    // `ghost` is the trailing health bar that drains behind the real one, so
    // a burst of damage is visible after the fact.
    return { el: node, refs, ghost: 1 };
  }

  /** Flash a row — used when a carrier hatches a new squadron. */
  pulse(id) {
    const row = this.rows.get(id);
    if (!row) {
      // The row does not exist until the next update; remember to flash it.
      this.pendingPulse = id;
      return;
    }
    row.el.classList.remove('hatched');
    void row.el.offsetWidth; // force reflow so the animation restarts
    row.el.classList.add('hatched');
    clearTimeout(row.pulseTimer);
    row.pulseTimer = setTimeout(() => row.el.classList.remove('hatched'), 1600);
  }

  update(game, dt) {
    if (!game.live && !this.rows.size) return;
    const mine = game.units
      .filter((u) => u.faction === game.playerFaction)
      // Brood squadrons sink to the bottom; they come and go.
      .sort((a, b) => (a.broodOf ? 1 : 0) - (b.broodOf ? 1 : 0));
    let underFire = 0;

    if (!mine.length) {
      if (!this.body.firstChild) {
        this.body.innerHTML = '<div class="roster-empty">No squadrons.</div>';
      }
      return;
    }
    if (this.body.firstChild && this.body.firstChild.className === 'roster-empty') {
      this.body.innerHTML = '';
    }

    for (const u of mine) {
      let row = this.rows.get(u.id);
      if (!row) {
        row = this.makeRow(u);
        this.rows.set(u.id, row);
        this.body.appendChild(row.el);
        row.refs.name.textContent = u.label;
        row.refs.type.textContent = u.type.name.toUpperCase();
        if (this.pendingPulse === u.id) {
          this.pendingPulse = null;
          this.pulse(u.id);
        }
      }
      const { el: node, refs } = row;

      // An empty hangar slot is not a dead squadron worth showing.
      if (u.broodOf && !u.alive && u.count === 0) {
        node.style.display = 'none';
        continue;
      }
      node.style.display = '';
      if (refs.name.textContent !== u.label) refs.name.textContent = u.label;

      const frac = u.alive ? Math.max(0, u.healthFraction) : 0;
      refs.hulls.textContent = `${u.count}/${u.type.count}`;
      refs.hpFill.style.width = `${frac * 100}%`;
      refs.hp.className = `rr-hp${frac < 0.25 ? ' crit' : frac < 0.55 ? ' warn' : ''}`;

      row.ghost = Math.max(frac, row.ghost - dt * 0.22);
      const trail = Math.max(0, row.ghost - frac);
      refs.hpGhost.style.left = `${frac * 100}%`;
      refs.hpGhost.style.width = `${trail * 100}%`;

      const shield = u.shieldFraction;
      refs.shFill.style.width = `${Math.max(0, shield) * 100}%`;
      refs.sh.className = `rr-sh${u.shieldOn ? ' up' : ''}`;

      const state = u.alive
        ? (game.state === 'prep' ? u.plannedLabel : u.statusLabel)
        : 'DESTROYED';
      if (refs.state.textContent !== state) {
        refs.state.textContent = state;
        refs.state.className = `rr-state ${state.toLowerCase().replace(/[^a-z]/g, '')}`;
      }
      refs.dmg.innerHTML = u.alive
        ? `<span class="out">${Math.round(u.dpsOut)}</span>/<span class="in">${Math.round(u.dpsIn)}</span>`
        : '';

      const threat = u.alive ? u.threat : 0;
      if (threat > 0.15) underFire++;
      node.classList.toggle('threat', threat > 0.15);
      node.classList.toggle('blink', threat > 0.45);
      node.classList.toggle('sel', !!u.selected);
      node.classList.toggle('dead', !u.alive);
    }

    this.alarm.classList.toggle('hidden', underFire === 0);
    if (underFire) this.alarm.textContent = `${underFire} UNDER FIRE`;
  }

  clear() {
    this.rows.clear();
    this.body.innerHTML = '';
    this.alarm.classList.add('hidden');
  }
}

// ---------------------------------------------------------------------------

export class Hud {
  constructor(app) {
    this.app = app;
    this.root = $('hud');

    $('btn-pause').addEventListener('click', () => app.togglePause());
    $('btn-reset').addEventListener('click', () => this.confirmReset());
    $('btn-newfleet').addEventListener('click', () => app.backToBuilder());
    $('btn-selectall').addEventListener('click', () => app.selectAll());
    $('btn-grid').addEventListener('click', () => app.toggleGrid());
    $('btn-look').addEventListener('click', () => app.toggleLook());

    $('btn-report').addEventListener('click', async () => {
      const rec = app.recorder;
      const found = rec.errors.length + rec.anomalies.length;
      const res = await rec.download();
      if (!res.ok) {
        const why = {
          declined: 'you declined the save prompt.',
          rate_limited: 'a save prompt was already open — try again.',
          unavailable: 'saving a file is not available here.',
        }[res.reason] || 'the save could not be completed.';
        this.flashMessage(`Session report not saved — ${why}`, 4.5, 'warn');
        return;
      }
      this.flashMessage(found
        ? `Session report saved — ${rec.errors.length} error(s), ${rec.anomalies.length} anomaly(ies) found.`
        : 'Session report saved — no errors or anomalies detected.', 4.5, 'info');
    });

    $('prep-go').addEventListener('click', () => app.beginBattle());
    $('prep-back').addEventListener('click', () => app.backToBuilder());

    this.rename = $('sel-rename');
    // Typing in the rename box must not reach the global hotkeys, or naming a
    // squadron "Hammer" pauses, holds, and cycles the map.
    const stop = (e) => e.stopPropagation();
    this.rename.addEventListener('keydown', (e) => {
      stop(e);
      if (e.key === 'Enter') { this.commitRename(); this.rename.blur(); }
      else if (e.key === 'Escape') this.rename.blur();
    });
    this.rename.addEventListener('keyup', stop);
    this.rename.addEventListener('change', () => this.commitRename());
    this.rename.addEventListener('blur', () => this.commitRename());

    this.speed = $('speed');
    this.speed.addEventListener('input', () => app.setSpeedIndex(Number(this.speed.value)));

    $('toggle-shield').addEventListener('click', () => app.toggleShields());
    $('stance-move').addEventListener('click', () => app.setStance('move'));
    $('stance-attack').addEventListener('click', () => app.setStance('attack'));
    $('stance-hold').addEventListener('click', () => app.setStance('hold'));
    // DEFEND needs a target, so the button explains rather than acting.
    $('stance-defend').addEventListener('click', () => this.flashMessage(
      'To defend: right-click one of your own squadrons, or press G to defend the planet.'));

    $('toggle-autocast').addEventListener('click', () => {
      const on = !app.selection.every((u) => u.autocast);
      for (const u of app.selection) u.autocast = on;
      this.refreshPanel();
    });

    $('end-again').addEventListener('click', () => app.resetBattle());
    $('end-new').addEventListener('click', () => app.backToBuilder());
    $('confirm-no').addEventListener('click', () => this.closeConfirm(false));
    $('confirm-yes').addEventListener('click', () => this.closeConfirm(true));

    this.roster = new Roster(app);
    this.hover = $('hover-card');
    this.panel = $('sel-panel');
    this.confirmEl = $('confirm');
    this.flashEl = $('flash-msg');
    this.flashTimer = 0;
  }

  commitRename() {
    const u = this.panelUnit;
    if (!u || !u.alive) return;
    const name = this.rename.value.trim();
    if (name === (u.customName || '')) return;
    u.rename(name);
    this.refreshPanel();
  }

  flashMessage(text, seconds = 3.6, tone = 'default') {
    if (!this.flashEl) return;
    this.flashEl.textContent = text;
    this.flashEl.className = `flash-msg tone-${tone}`;
    this.flashTimer = seconds;
  }

  confirmReset() {
    const game = this.app.game;
    this.wasPaused = game.paused;
    game.paused = true;
    this.app.uiBlocking = true;
    this.confirmEl.classList.remove('hidden');
    $('confirm-yes').focus();
  }

  closeConfirm(yes) {
    this.confirmEl.classList.add('hidden');
    if (yes) { this.app.resetBattle(); return; }
    this.app.uiBlocking = false;
    this.app.game.paused = this.wasPaused;
    this.setSpeedUI(this.app.speedIndex, this.app.game.paused);
  }

  get confirmOpen() { return !this.confirmEl.classList.contains('hidden'); }

  show() {
    this.root.classList.remove('hidden');
    $('minimap-panel').classList.remove('hidden');
    this.roster.show(true);
  }

  hide() {
    this.root.classList.add('hidden');
    $('minimap-panel').classList.add('hidden');
    this.roster.show(false);
    this.roster.clear();
  }

  showPrep(side) {
    $('prep-line').textContent = side === FACTION.ATTACK
      ? 'Plan the assault. Nothing moves until you begin.'
      : 'Set your defence. Nothing moves until you begin.';
    $('prep-bar').classList.remove('hidden');
    document.body.classList.add('in-prep');
    $('bottom-bar-el').classList.add('prep');
    $('btn-pause').classList.add('disabled');
    $('speed-label').textContent = 'STANDING BY';
  }

  hidePrep() {
    $('prep-bar').classList.add('hidden');
    document.body.classList.remove('in-prep');
    $('bottom-bar-el').classList.remove('prep');
    $('btn-pause').classList.remove('disabled');
  }

  setGridUI(on) { $('btn-grid').classList.toggle('on', !!on); }

  setFps(fps) {
    const box = $('fps');
    $('fps-value').textContent = fps > 0 ? Math.round(fps) : '--';
    box.classList.toggle('ok', fps >= 50);
    box.classList.toggle('warn', fps >= 30 && fps < 50);
    box.classList.toggle('bad', fps > 0 && fps < 30);
  }

  setLookUI(preset) {
    const cine = preset === 'cinematic';
    $('btn-look').classList.toggle('on', cine);
    $('btn-look-label').textContent = cine ? 'CINEMA' : 'LOOK';
  }

  setSpeedUI(index, paused) {
    const mult = SPEEDS[index];
    this.speed.value = index;
    $('speed-value').textContent = `${mult}x`;
    $('speed-label').textContent = paused ? 'PAUSED' : `${mult}x`;
    const btn = $('btn-pause');
    btn.classList.toggle('paused', paused);
    $('pause-label').textContent = paused ? 'RESUME' : 'PAUSE';
    btn.querySelector('.ic-pause').classList.toggle('hidden', paused);
    btn.querySelector('.ic-play').classList.toggle('hidden', !paused);
  }

  update(game) {
    const you = { n: 0, hp: 0, max: 0, dps: 0 };
    const them = { n: 0, hp: 0, max: 0, dps: 0 };
    for (const u of game.units) {
      const side = u.faction === game.playerFaction ? you : them;
      // Max is over the type's full complement, so the bar reads as losses
      // rather than rescaling as hulls die.
      side.max += u.stats.maxHealth * u.type.count;
      side.dps += u.dpsOut;
      if (u.alive) {
        side.n += u.count;
        side.hp += u.craft.reduce((s, c) => s + (c.alive ? c.hp : 0), 0);
      }
    }
    $('you-count').textContent = you.n;
    $('enemy-count').textContent = them.n;

    const dpsOut = { you: $('you-dps'), them: $('enemy-dps') };
    dpsOut.you.textContent = `${Math.round(you.dps)}/s`;
    dpsOut.them.textContent = `${Math.round(them.dps)}/s`;
    dpsOut.you.classList.toggle('hot', you.dps > them.dps * 1.15);
    dpsOut.them.classList.toggle('hot', them.dps > you.dps * 1.15);

    $('you-fill').style.width = `${you.max ? (you.hp / you.max) * 100 : 0}%`;
    $('enemy-fill').style.width = `${them.max ? (them.hp / them.max) * 100 : 0}%`;

    const left = game.timeRemaining;
    $('clock').textContent = formatTime(left);
    const clock = document.querySelector('.battle-clock');
    clock.classList.toggle('warning', left <= 120 && left > 30);
    clock.classList.toggle('critical', left <= 30);

    if (game.planet) {
      const frac = game.planet.fraction;
      const gauge = $('planet-gauge');
      $('planet-fill').style.width = `${frac * 100}%`;
      $('planet-value').textContent = `${Math.ceil(frac * 100)}%`;
      gauge.classList.toggle('warning', frac <= 0.55 && frac > 0.25);
      gauge.classList.toggle('critical', frac <= 0.25);
      gauge.classList.toggle('under-fire', game.now - game.planet.lastHitAt < 2);
    }

    if (this.flashTimer > 0) {
      this.flashTimer -= 1 / 60;
      if (this.flashTimer <= 0) this.flashEl.className = 'flash-msg hidden';
    }

    // The panel's static half only needs rebuilding when the selection
    // changes or something in it dies; the rest is live numbers.
    if (this.panelUnit && this.panelUnit.alive) this.refreshLive();
    else if (this.panelUnit && !this.panelUnit.alive) this.refreshPanel();
  }

  refreshPanel() {
    const sel = this.app.selection.filter((u) => u.alive);
    if (!sel.length) {
      this.panel.classList.add('hidden');
      this.panelUnit = null;
      return;
    }
    this.panel.classList.remove('hidden');

    const lead = sel[0];
    this.panelUnit = lead;
    const type = lead.type;
    const mixed = sel.some((u) => u.type.id !== type.id);

    $('sel-title').textContent = mixed ? `${sel.length} SQUADRONS` : lead.label.toUpperCase();
    $('sel-sub').textContent = mixed
      ? sel.map((u) => u.label).join(' · ')
      : `${type.name.toUpperCase()} · ${type.className.toUpperCase()}${sel.length > 1 ? ` · ×${sel.length}` : ''}`;

    this.rename.classList.toggle('hidden', sel.length !== 1);
    // Never stomp what is being typed.
    if (sel.length === 1 && document.activeElement !== this.rename) {
      this.rename.value = lead.customName || '';
      this.rename.placeholder = lead.callsign;
    }
    $('siege-note').classList.toggle('hidden', !sel.some((u) => u.siegeLock));

    const hulls = sel.reduce((s, u) => s + u.count, 0);
    const maxHulls = sel.reduce((s, u) => s + u.type.count, 0);
    const note = mixed
      ? `<div class="row muted"><span>STATS SHOWN FOR</span><b>${type.name}</b></div>` : '';

    $('sel-stats').innerHTML = `
      <div class="hp-track"><i id="sel-hp" style="width:100%"></i></div>
      <div class="shield-track" title="Shield reserve">
        <i id="sel-shield" style="width:100%"></i>
      </div>
      <div class="row"><span>HULLS</span><b id="sel-hulls">${hulls} / ${maxHulls}</b></div>
      ${note}
      <div class="row"><span>SPEED</span><b>${type.speed}</b></div>
      <div class="row"><span>DPS (each)</span><b>${type.dps}</b></div>
      <div class="row"><span>AGILITY</span><b>${type.agility}</b></div>
      <div class="row"><span>WEAPON RANGE</span><b>${type.range || '—'}</b></div>
      <div class="row"><span>SENSORS</span><b>${type.sensor}</b></div>
      <div class="row live"><span>DEALING</span><b id="sel-out">0/s</b></div>
      <div class="row live"><span>TAKING</span><b id="sel-in">0/s</b></div>`;

    const abilityBox = $('sel-ability');
    abilityBox.innerHTML = '';
    if (mixed) {
      // A mixed selection has no single ability to show or fire.
      this.abilityBtn = null;
      this.abilityCd = null;
    } else {
      const btn = el('button', 'ability-btn', `
        <span class="ab-key">${type.ability.key}</span>
        <span class="ab-name">${type.ability.name}</span>
        <span class="ab-desc">${type.ability.desc}</span>
        <i class="ab-cd" style="width:0%"></i>`);
      btn.addEventListener('click', () => this.app.castSelected());
      abilityBox.appendChild(btn);
      this.abilityBtn = btn;
      this.abilityCd = btn.querySelector('.ab-cd');
    }

    const autocast = sel.every((u) => u.autocast);
    $('toggle-autocast').classList.toggle('on', autocast);
    $('toggle-autocast').title = mixed
      ? `AUTOCAST (T) — ${autocast ? 'ON' : 'OFF'}. When on, each squadron fires its own special ability by itself whenever it would help. When off, only you fire it, with Q.`
      : `AUTOCAST (T) — ${autocast ? 'ON' : 'OFF'}. When on, this squadron fires ${type.ability.name} by itself whenever it would help. When off, only you fire it, with Q.`;

    const stance = sel.every((u) => u.stance === sel[0].stance) ? sel[0].stance : null;
    for (const s of ['move', 'attack', 'defend', 'hold']) {
      $(`stance-${s}`).classList.toggle('on', stance === s);
    }

    const guard = $('guard-note');
    const escorts = sel.filter((u) => u.stance === 'defend' && u.guardTarget);
    if (escorts.length && escorts.length === sel.length) {
      const names = [...new Set(escorts.map((u) =>
        (u.guardTarget === 'planet' ? 'the planet' : u.guardTarget.label)))];
      guard.textContent = `ESCORTING ${names.join(' · ').toUpperCase()}`;
      guard.classList.remove('hidden');
    } else {
      guard.classList.add('hidden');
    }

    this.refreshLive();
  }

  /** The per-frame half of the selection panel. */
  refreshLive() {
    const sel = this.app.selection.filter((u) => u.alive);
    if (!sel.length) return;

    const hulls = sel.reduce((s, u) => s + u.count, 0);
    const maxHulls = sel.reduce((s, u) => s + u.type.count, 0);
    const frac = sel.reduce((s, u) => s + u.healthFraction * u.type.count, 0) / maxHulls;
    const hp = document.getElementById('sel-hp');
    const hullsOut = document.getElementById('sel-hulls');
    if (hp) hp.style.width = `${Math.max(0, frac * 100)}%`;
    if (hullsOut) hullsOut.textContent = `${hulls} / ${maxHulls}`;

    const shieldBar = document.getElementById('sel-shield');
    if (shieldBar) {
      const s = sel.reduce((acc, u) => acc + u.shieldFraction, 0) / sel.length;
      shieldBar.style.width = `${Math.max(0, s * 100)}%`;
      shieldBar.classList.toggle('low', s < SHIELDS.minToRaise / SHIELDS.max);
    }

    const out = document.getElementById('sel-out');
    const inc = document.getElementById('sel-in');
    if (out) {
      const dealt = sel.reduce((s, u) => s + u.dpsOut, 0);
      const taken = sel.reduce((s, u) => s + u.dpsIn, 0);
      out.textContent = `${Math.round(dealt)}/s`;
      inc.textContent = `${Math.round(taken)}/s`;
      out.classList.toggle('good', dealt > 0);
      inc.classList.toggle('bad', taken > 0);
    }

    const up = sel.some((u) => u.shieldOn);
    const canRaise = sel.some((u) => u.canRaiseShield);
    const btn = $('toggle-shield');
    btn.classList.toggle('on', up);
    btn.classList.toggle('depleted', !up && !canRaise);
    btn.textContent = up ? 'SHIELDS UP' : canRaise ? 'SHIELDS' : 'RECHARGING';
    btn.title = up
      ? `SHIELDS UP (F) — taking ${Math.round(SHIELDS.damageTaken * 100)}% damage, but firing at only ${Math.round(SHIELDS.fireRate * 100)}% rate. Reserve drains while up.`
      : 'SHIELDS (F) — cuts incoming damage to 28%, but drops your rate of fire to 30% and drains a reserve. Raise it to survive a burst, drop it to fight.';

    if (this.abilityBtn) {
      const u = sel[0];
      const cd = Math.max(0, u.abilityCooldown);
      this.abilityCd.style.width = `${(cd / u.type.ability.cooldown) * 100}%`;
      this.abilityBtn.disabled = cd > 0;
      const name = this.abilityBtn.querySelector('.ab-name');
      name.textContent = cd > 0
        ? `${u.type.ability.name} — ${cd.toFixed(1)}s` : u.type.ability.name;
    }
  }

  showHover(unit, x, y, mine) {
    if (!unit || !unit.alive) { this.hover.classList.add('hidden'); return; }
    const own = unit.faction === mine;
    this.hover.classList.remove('hidden');
    this.hover.innerHTML = `
      <b style="color:${own ? 'var(--cyan)' : 'var(--amber)'}">${unit.label}</b>
      <span class="hc-type"> ${unit.type.name}</span>
      <span class="hc-hp"> ${unit.count}/${unit.type.count} · ${Math.round(unit.healthFraction * 100)}%</span>`;
    this.hover.style.left = `${x + 16}px`;
    this.hover.style.top = `${y + 14}px`;
  }

  showEnd(state, game) {
    const won = state === 'victory';
    const attacking = game.playerFaction === 'attack';
    let title = won ? 'VICTORY' : state === 'defeat' ? 'DEFEAT' : 'MUTUAL DESTRUCTION';
    if (game.timedOut) title = 'TIME EXPIRED';
    if (game.planetFell) title = 'THE WORLD IS GONE';
    $('end-title').textContent = title;
    $('end-title').className = won ? 'victory' : 'defeat';

    let sub;
    if (game.planetFell) {
      sub = attacking
        ? 'The crust gave way under sustained bombardment. Nothing down there is worth defending now.'
        : 'The bombardment got through. There is nothing left to hold.';
    } else if (game.timedOut) {
      sub = attacking
        ? 'The clock ran out with the defence still standing. The assault is called off.'
        : 'You held them off until their window closed. The world stands.';
    } else if (won) {
      sub = attacking
        ? 'The orbital cordon is broken and the surface is silent.'
        : 'The assault is scattered. The world holds.';
    } else {
      sub = attacking
        ? 'Your assault has been annihilated in orbit.'
        : 'The cordon has fallen. The world is theirs.';
    }
    $('end-sub').textContent = sub;

    const survivors = game.units
      .filter((u) => u.faction === game.playerFaction && u.alive)
      .reduce((s, u) => s + u.count, 0);
    const planetLeft = game.planet ? Math.ceil(game.planet.fraction * 100) : 100;

    $('end-stats').innerHTML = `
      <div><span>${game.timedOut ? 'TIME USED' : 'DURATION'}</span><b>${formatTime(game.now)}</b></div>
      <div><span>KILLS</span><b>${game.kills[game.playerFaction]}</b></div>
      <div><span>SURVIVORS</span><b>${survivors}</b></div>
      <div><span>PLANET LEFT</span><b>${planetLeft}%</b></div>`;
    $('endscreen').classList.remove('hidden');
  }

  hideEnd() { $('endscreen').classList.add('hidden'); }
}
