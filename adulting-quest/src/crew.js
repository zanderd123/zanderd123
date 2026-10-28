'use strict';
// The crew: you plus the allies you've recruited. Every member is a plain
// object with sanity / energy / status; the player object is the first one.

const Crew = {
  isMe(r) { return r === Game.p; },
  def(r) { return ALLIES[r.id]; },
  // everyone, lead first
  members() {
    const p = Game.p, all = [p, ...(p.crew || [])];
    const i = all.findIndex((r) => this.key(r) === p.lead);
    if (i > 0) all.unshift(...all.splice(i, 1));
    return all;
  },
  key(r) { return this.isMe(r) ? 'me' : r.id; },
  alive() { return this.members().filter((r) => r.sanity > 0); },
  has(id) { return (Game.p.crew || []).some((r) => r.id === id); },

  name(r) { return this.isMe(r) ? Game.p.name : this.def(r).name; },
  boost(r) { return this.isMe(r) ? (PATHS[Game.p.path] || {}).boost : this.def(r).boost; },
  pal(r) { return this.isMe(r) ? { ...PALS.player, c: Game.p.outfit } : this.def(r).pal; },
  look(r) { return this.isMe(r) ? null : this.def(r).look || null; },
  stats(r) {
    if (this.isMe(r)) return Game.stats();
    const b = this.def(r).base, L = Game.p.level;
    return {
      maxSanity: Math.floor(4 * b.san * L / 100) + 3 * L + 20,
      conf: Math.floor(2 * b.conf * L / 100) + 5,
      comp: Math.floor(2 * b.comp * L / 100) + 5,
      hus: Math.floor(2 * b.hus * L / 100) + 5,
      maxEnergy: 18 + 2 * L + b.energy,
    };
  },
  skills(r) {
    if (this.isMe(r)) return Game.p.equipped;
    // Wing It is always there, so nobody is stuck at 0 Energy
    return ['wing_it', ...this.def(r).learn.filter(([lv]) => lv <= Game.p.level).map(([, id]) => id).slice(-3)];
  },

  add(id) {
    const r = { id, sanity: 0, energy: 0, status: null };
    const s = this.stats(r);
    r.sanity = s.maxSanity; r.energy = s.maxEnergy;
    Game.p.crew.push(r);
    return r;
  },
  healAll() {
    for (const r of this.members()) {
      const s = this.stats(r);
      r.sanity = s.maxSanity; r.energy = s.maxEnergy; r.status = null;
    }
  },
  // pick a crew member (for items); filter decides who can be chosen
  async pick(prompt, filter) {
    const list = this.members().filter(filter);
    if (!list.length) return null;
    if (this.members().length === 1) return list[0];
    await UI.say(prompt, { noWait: true });
    const i = await UI.choose(list.map((r) => { const s = this.stats(r); return `${this.name(r)} ${r.sanity}/${s.maxSanity}`; }), { cls: 'side' });
    return i < 0 ? null : list[i];
  },
};
