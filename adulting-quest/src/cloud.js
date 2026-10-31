'use strict';
// Cloud saves: an online copy of each save slot, so a save follows the player
// to another device. Browser storage stays what the game reads; the cloud is a
// mirror that gets pulled in on the title screen (newest save wins).
//
// A backend is { name, read(slot) -> {json, at} | null, write(slot, {json, at}) }.
// Today there is one: the claude.ai artifact database, where each player gets
// private docs tied to their Claude login. A website build can add another
// (Supabase, Firebase, a small server) in connect() without touching the game.

const Cloud = {
  backend: null,
  readOnly: false,   // signed in but not allowed to write (view-only link)
  timers: {},
  writing: {},
  pulled: false,

  async claude() {
    if (!window.claude || typeof window.claude.use !== 'function') return null;
    const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
    if (!db || !user) return null;
    const id = await user.id();
    if (!id) return null;
    const docs = db.collection('data/users/' + id);
    return {
      name: 'your Claude account',
      async read(slot) { const s = await docs.doc('save-' + slot).get(); return s.exists ? s.data() : null; },
      async write(slot, rec) { await docs.doc('save-' + slot).set(rec); },
    };
  },

  // resolves to the backend, or null when there is no cloud here
  connect() {
    if (!this.ready) {
      this.ready = this.claude().catch(() => null).then((b) => { this.backend = b; return b; });
    }
    return this.ready;
  },
  // wait for the cloud, but never hold up the title screen for long
  async settle(ms) {
    return Promise.race([this.connect(), new Promise((r) => setTimeout(() => r(null), ms))]);
  },

  slots() { return ['auto', ...Saves.slots]; },
  local(slot) { try { return localStorage.getItem(Saves.key(slot)); } catch (e) { return null; } },
  at(json) { try { return (JSON.parse(json) || {}).at || 0; } catch (e) { return 0; } },

  // bring newer cloud saves down, send newer local saves up
  async pull() {
    if (!this.backend) return 0;
    let got = 0;
    for (const slot of this.slots()) {
      try {
        const rec = await this.backend.read(slot), mine = this.local(slot);
        const theirs = rec && typeof rec.json === 'string' ? rec.at || 0 : 0;
        if (theirs > this.at(mine)) { localStorage.setItem(Saves.key(slot), rec.json); got++; }
        else if (mine && this.at(mine) > theirs) this.queue(slot, 0);
      } catch (e) { /* offline or not allowed: keep the local copy */ }
    }
    this.pulled = true;
    return got;
  },

  // mirror a slot after it was saved locally; the autosave fires on every
  // door, so it waits for a quiet moment instead of writing each time
  queue(slot, delay) {
    if (!this.backend || this.readOnly) return;
    clearTimeout(this.timers[slot]);
    this.timers[slot] = setTimeout(() => this.push(slot), delay);
  },
  async push(slot) {
    delete this.timers[slot];
    const json = this.local(slot);
    if (!json || !this.backend) return;
    if (this.writing[slot]) { await this.writing[slot]; if (this.local(slot) !== json) return; }
    this.writing[slot] = this.backend.write(slot, { json, at: this.at(json) })
      .catch((e) => { if (e && /not_granted|denied|permission|unauth/i.test(e.code || e.message || '')) this.readOnly = true; })
      .finally(() => { delete this.writing[slot]; });
    return this.writing[slot];
  },
  flush() { for (const slot of Object.keys(this.timers)) { clearTimeout(this.timers[slot]); this.push(slot); } },

  // one line for the save menu
  status() {
    if (!this.backend) return 'Saves stay on this device. Use GET SAVE CODE to move one.';
    if (this.readOnly) return 'Saves stay on this device (this link can\'t back up saves).';
    return `Saves also back up to ${this.backend.name}.`;
  },
};

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') Cloud.flush(); });
window.addEventListener('pagehide', () => Cloud.flush());
