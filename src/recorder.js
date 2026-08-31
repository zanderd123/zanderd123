/**
 * Session recorder — the REPORT button.
 *
 * Three streams, kept separately because they answer different questions:
 *
 *   errors     things that actually threw. Includes anything routed through
 *              console.error, which is hooked.
 *   anomalies  states that should be impossible — a hull inside the planet, a
 *              squadron on ATTACK that has not moved in 25 seconds. These are
 *              the ones worth reading; they are how a physics or steering bug
 *              gets caught without anybody noticing it on screen.
 *   battles    what was played and how it went, with periodic snapshots.
 *
 * Everything is deduplicated and capped. A report that scrolls for a thousand
 * lines is a report nobody reads, and one stuck unit must not drown out the
 * rest of the session.
 */
import { WORLD } from './config.js';

const MAX_EVENTS = 400;
const MAX_ANOMALIES = 60;
const MAX_ERRORS = 25;
/** Seconds between fleet snapshots. */
const SNAPSHOT_INTERVAL = 15;
/** How long a squadron must sit still before it counts as stuck. */
const STUCK_TIME = 25;
/** ...and how far it has to move to reset that. */
const STUCK_RADIUS = 40;

const KEY = 'kepler9.session';

const r0 = (n) => Math.round(n);
const vec = (v) => [r0(v.x), r0(v.y), r0(v.z)];

export class Recorder {
  constructor(app) {
    this.app = app;
    this.enabled = true;
    this.events = [];
    this.anomalies = [];
    this.errors = [];
    this.battles = [];
    this.battle = null;
    this.snapshotAt = 0;
    this.stillness = new Map();
    this.seenAnomaly = new Set();
    this.hookErrors();
  }

  hookErrors() {
    addEventListener('error', (e) => {
      this.error(e.message, e.error && e.error.stack);
    });
    addEventListener('unhandledrejection', (e) => {
      const r = e.reason;
      this.error(`unhandled rejection: ${r && r.message ? r.message : r}`, r && r.stack);
    });
    // Three.js reports shader compile failures and similar through
    // console.error rather than throwing, and those are exactly the ones worth
    // catching.
    const original = console.error;
    console.error = (...args) => {
      try {
        this.error(args.map((a) => (a && a.stack) || String(a)).join(' '));
      } catch { /* the reporter must never be the thing that breaks */ }
      original.apply(console, args);
    };
  }

  error(message, stack) {
    if (!this.enabled || this.errors.length >= MAX_ERRORS) return;
    this.errors.push({
      t: this.battle ? +this.app.game.now.toFixed(1) : null,
      battle: this.battle ? this.battle.n : null,
      message: String(message).slice(0, 400),
      stack: stack ? String(stack).split('\n').slice(0, 6).join('\n') : undefined,
    });
  }

  log(kind, data) {
    if (!this.enabled) return;
    this.events.push({
      t: this.battle ? +this.app.game.now.toFixed(1) : 0,
      battle: this.battle ? this.battle.n : null,
      kind,
      ...data,
    });
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }
  }

  /** First occurrence is recorded in full; the rest just bump a counter. */
  anomaly(key, data) {
    if (!this.enabled) return;
    if (this.seenAnomaly.has(key)) {
      const found = this.anomalies.find((a) => a.key === key);
      if (found) found.count++;
      return;
    }
    this.seenAnomaly.add(key);
    if (this.anomalies.length >= MAX_ANOMALIES) return;
    this.anomalies.push({
      key,
      count: 1,
      t: this.battle ? +this.app.game.now.toFixed(1) : 0,
      battle: this.battle ? this.battle.n : null,
      ...data,
    });
  }

  battleStarted(setup, game) {
    this.battle = {
      n: this.battles.length + 1,
      startedAt: new Date().toISOString(),
      side: setup.side,
      budget: setup.budget,
      difficulty: setup.difficulty,
      mode: setup.mode || 'volume',
      roster: setup.roster.map((r) => `${r.qty}x ${r.typeId}`),
      // Carrier broods are excluded — they are not something the AI bought.
      enemyRoster: game.units
        .filter((u) => u.faction !== setup.side && !u.broodOf)
        .reduce((acc, u) => {
          acc[u.type.id] = (acc[u.type.id] || 0) + 1;
          return acc;
        }, {}),
      snapshots: [],
    };
    this.battles.push(this.battle);
    this.snapshotAt = 0;
    this.stillness.clear();
    this.seenAnomaly.clear();
    this.log('battle-start', {
      side: setup.side, budget: setup.budget,
      difficulty: setup.difficulty, mode: this.battle.mode,
    });
  }

  battleEnded(state, game) {
    if (!this.battle) return;
    const hulls = (f) => game.units
      .filter((u) => u.faction === f)
      .reduce((s, u) => s + u.count, 0);
    const them = game.playerFaction === 'attack' ? 'defense' : 'attack';
    this.battle.result = {
      state,
      at: +game.now.toFixed(1),
      yourHulls: hulls(game.playerFaction),
      enemyHulls: hulls(them),
      yourKills: game.kills[game.playerFaction] ?? 0,
      enemyKills: game.kills[them] ?? 0,
      planetLeft: game.planet ? +(game.planet.fraction * 100).toFixed(0) : null,
      timedOut: !!game.timedOut,
    };
    this.log('battle-end', this.battle.result);
    this.save();
  }

  update(game) {
    if (!this.enabled || !this.battle) return;
    if (game.state !== 'playing' || game.now < this.snapshotAt) return;
    this.snapshotAt = game.now + SNAPSHOT_INTERVAL;

    const mine = game.playerFaction;
    const units = [];
    for (const u of game.units) {
      if (!u.alive) continue;
      this.checkUnit(u, game, mine);
      if (u.faction !== mine) continue;
      units.push({
        id: u.id,
        name: u.label,
        type: u.type.id,
        n: u.count,
        hp: +(u.healthFraction * 100).toFixed(0),
        stance: u.stance,
        siege: u.siegeLock || undefined,
        shield: u.shieldOn || undefined,
        target: u.attackTarget ? u.attackTarget.label : undefined,
        pos: vec(u.pos),
        toOrder: r0(u.pos.distanceTo(u.movePos)),
      });
    }
    this.battle.snapshots.push({ t: +game.now.toFixed(0), units });
    // Ten minutes of history at 15s is 40 frames; keep the last ten minutes.
    if (this.battle.snapshots.length > 40) this.battle.snapshots.shift();
  }

  /** Invariants. Anything here firing is a bug, not a bad play. */
  checkUnit(u, game, mine) {
    const orbitFloor = WORLD.planetRadius + 45;

    for (const c of u.craft) {
      if (!c.alive) continue;
      const { x, y, z } = c.pos;
      if (![x, y, z, c.hp, c.speed].every(Number.isFinite)) {
        this.anomaly(`nan:${u.type.id}`, {
          what: 'NaN position/hp/speed', unit: u.label, type: u.type.id,
        });
        continue;
      }
      if (u.isGround) continue;

      // The 2-unit slack throughout is for the clamp's own settling, which
      // legitimately overshoots by a fraction before it pulls back.
      if (Math.hypot(x, z) > WORLD.arenaRadius + 2) {
        this.anomaly(`wall:${u.type.id}`, {
          what: 'craft outside the arena wall', unit: u.label,
          radius: r0(Math.hypot(x, z)), limit: WORLD.arenaRadius,
        });
      }
      if (Math.abs(y) > WORLD.arenaHeight + 2) {
        this.anomaly(`ceiling:${u.type.id}`, {
          what: 'craft outside the slab', unit: u.label,
          y: r0(y), limit: WORLD.arenaHeight,
        });
      }
      const d = Math.hypot(x - WORLD.planetCenter[0], y - WORLD.planetCenter[1],
        z - WORLD.planetCenter[2]);
      if (d < orbitFloor - 2) {
        this.anomaly(`inplanet:${u.type.id}`, {
          what: 'craft inside the planet', unit: u.label,
          distance: r0(d), floor: orbitFloor,
        });
      }
      if (c.hp > c.maxHealth + 0.01) {
        this.anomaly(`overheal:${u.type.id}`, {
          what: 'craft healed past max', unit: u.label,
        });
      }
    }

    // Stuck detection, player squadrons only — the AI reissues orders on its
    // own tick, so a stationary AI unit is usually a decision, not a fault.
    if (u.faction !== mine || u.isGround) return;
    const last = this.stillness.get(u.id);
    const moved = last ? u.pos.distanceTo(last.pos) : Infinity;
    if (!last || moved > STUCK_RADIUS) {
      this.stillness.set(u.id, { since: game.now, pos: u.pos.clone() });
      return;
    }
    if (game.now - last.since <= STUCK_TIME) return;

    const engaged = !!(u.attackTarget && u.attackTarget.alive);
    const farFromOrder = u.pos.distanceTo(u.movePos) > 200;
    if (u.stance === 'attack' && engaged && !u.siegeLock) {
      this.anomaly(`stuck-attack:${u.id}`, {
        what: 'squadron on ATTACK with a live target has not moved',
        unit: u.label, type: u.type.id,
        stillFor: r0(game.now - last.since),
        targetAt: r0(u.pos.distanceTo(u.attackTarget.pos)),
      });
    } else if (farFromOrder && u.stance !== 'hold' && !u.siegeLock) {
      this.anomaly(`stuck-move:${u.id}`, {
        what: 'squadron is far from its order and not moving',
        unit: u.label, type: u.type.id,
        stillFor: r0(game.now - last.since),
        orderAt: r0(u.pos.distanceTo(u.movePos)),
      });
    }
    // Re-arm either way, so one stuck squadron reports once per window.
    this.stillness.set(u.id, { since: game.now, pos: u.pos.clone() });
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.snapshot())); } catch { /* full or blocked */ }
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  snapshot() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      errors: this.errors,
      anomalies: this.anomalies,
      battles: this.battles,
      events: this.events,
    };
  }

  /** The human-readable half, which is what gets read first. */
  summary() {
    const out = [];
    out.push(`SIEGE OF KEPLER-9 — session report (${new Date().toLocaleString()})`);
    out.push(`battles: ${this.battles.length} · errors: ${this.errors.length} · anomalies: ${this.anomalies.length}`);
    out.push('');

    for (const b of this.battles) {
      const r = b.result;
      out.push(`— battle ${b.n}: ${b.side} · ${b.budget}pts · ${b.difficulty} · ${b.mode}`);
      out.push(`  your fleet: ${b.roster.join(', ')}`);
      if (r) {
        out.push(`  result: ${r.state} at ${Math.floor(r.at / 60)}:${String(r0(r.at % 60)).padStart(2, '0')}`
          + ` · your hulls left ${r.yourHulls} · enemy left ${r.enemyHulls}`
          + ` · kills ${r.yourKills} for ${r.enemyKills} against`
          + (r.planetLeft !== null ? ` · planet ${r.planetLeft}%` : ''));
      } else {
        out.push('  result: (still in progress / abandoned)');
      }
    }

    if (this.errors.length) {
      out.push('', 'ERRORS:');
      for (const e of this.errors) out.push(`  [battle ${e.battle} @${e.t}s] ${e.message}`);
    }

    if (this.anomalies.length) {
      out.push('', 'ANOMALIES:');
      for (const a of this.anomalies) {
        const extra = Object.entries(a)
          .filter(([k]) => !['key', 'count', 't', 'battle', 'what'].includes(k))
          .map(([k, v]) => `${k}=${v}`)
          .join(' ');
        out.push(`  x${a.count} [battle ${a.battle} @${a.t}s] ${a.what}${extra ? ` (${extra})` : ''}`);
      }
    }

    if (!this.errors.length && !this.anomalies.length) {
      out.push('', 'No errors or anomalies detected.');
    }
    return out.join('\n');
  }

  /**
   * Save the report. Inside a Claude artifact the sandbox blocks ordinary
   * downloads, so the host's `downloads` capability is used when present and
   * the raw text is handed back for display when it is not.
   */
  async download() {
    const text = `${this.summary()}\n\n--- FULL DATA ---\n`
      + JSON.stringify(this.snapshot(), null, 1);
    const filename = `kepler9-session-${Date.now()}.txt`;

    if (typeof window.claude?.use === 'function') {
      const downloads = await window.claude.use('downloads');
      if (!downloads) return { ok: false, payload: text, reason: 'unavailable' };
      try {
        await downloads.save({ filename, data: text });
        return { ok: true, payload: text };
      } catch (err) {
        return { ok: false, payload: text, reason: err?.code || 'unavailable' };
      }
    }

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { ok: true, payload: text };
  }

  clear() {
    this.events.length = 0;
    this.anomalies.length = 0;
    this.errors.length = 0;
    this.battles.length = 0;
    this.battle = null;
    this.seenAnomaly.clear();
    this.stillness.clear();
    try { localStorage.removeItem(KEY); } catch { /* nothing to remove */ }
  }
}
