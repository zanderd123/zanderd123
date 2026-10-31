'use strict';
// Hints: which skill to use, which crew member to tag in, which books to buy
// before the next leader. Everything reads the same EFF table the battles use.

const Hints = {
  // rough value of a damaging skill against an issue type (power x type x path boost)
  value(fighter, id, type) {
    const sk = SKILLS[id];
    if (!sk.power) return 0;
    return sk.power * EFF[sk.type][type] * (Crew.boost(fighter) === sk.type ? 1.2 : 1) * sk.acc / 100;
  },

  // The skill to highlight in the battle menu, with a one-line reason.
  best(fighter, foe) {
    const st = Crew.stats(fighter), ids = Crew.skills(fighter).filter((id) => SKILLS[id].cost <= fighter.energy);
    const low = fighter.sanity < st.maxSanity * 0.35;
    const healer = ids.filter((id) => SKILLS[id].fx && SKILLS[id].fx.heal >= 0.3).sort((a, b) => SKILLS[b].fx.heal - SKILLS[a].fx.heal)[0];
    if (low && healer) return { id: healer, why: 'Your Sanity is low. Heal up first.' };
    let id = null, v = 0;
    for (const k of ids) { const x = this.value(fighter, k, foe.type); if (x > v) { v = x; id = k; } }
    if (!id) return { id: null, why: '' };
    const m = EFF[SKILLS[id].type][foe.type];
    return { id, why: m > 1 ? `${SKILLS[id].type} beats ${foe.type}: double damage!` : m < 1 ? `Nothing you have beats ${foe.type}. This is your best shot.` : 'Your strongest hit right now.' };
  },

  // Longer advice for the "?" button in battle.
  battle(fighter, foe) {
    const b = this.best(fighter, foe);
    const lines = [`${foe.name.toUpperCase()} is a ${foe.type} issue. ${Battle.counters(foe.type).join(' and ')} skills do double damage to it.`];
    if (b.id) lines.push(`Best pick: ${SKILLS[b.id].name.toUpperCase()}. ${b.why}`);
    if (!b.id || EFF[SKILLS[b.id].type][foe.type] <= 1) lines.push(Battle.advice(foe.type));
    return lines;
  },

  next() { return Game.p ? LEADER_ORDER.find((k) => !Game.p.badges.includes(k)) : null; },
  teamTypes(key) { return [...new Set(LEADERS[key].team.map(([id]) => ISSUES[id].type))]; },

  // who in the crew can hit an issue type for double damage, and with what
  answer(t) {
    let best = null;
    for (const r of Crew.members()) {
      const pool = Crew.isMe(r) ? Game.p.known : Crew.skills(r);
      for (const id of pool) if (SKILLS[id].power && EFF[SKILLS[id].type][t] > 1 && (!best || SKILLS[id].power > SKILLS[best.id].power)) best = { r, id };
    }
    return best;
  },
  // issue types in a leader's team that nobody in the crew can hit for double damage
  gaps(key) { return this.teamTypes(key).filter((t) => !this.answer(t)); },

  // books in this stock that fill a gap for the next leader
  books(stock) {
    const key = this.next();
    if (!key) return [];
    const gaps = this.gaps(key);
    return stock.filter((id) => {
      const it = ITEMS[id];
      if (it.use !== 'book' || Game.p.known.includes(it.skill)) return false;
      const sk = SKILLS[it.skill];
      return sk.power > 0 && gaps.some((t) => EFF[sk.type][t] > 1);
    });
  },

  // what the hall guide / leader hint says
  leader(key) {
    const L = LEADERS[key], types = this.teamTypes(key), gaps = this.gaps(key);
    const lines = [L.tip];
    const covered = types.filter((t) => !gaps.includes(t));
    if (covered.length) lines.push('Your answers: ' + covered.map((t) => { const a = this.answer(t); return `${t}: ${Crew.isMe(a.r) ? 'your' : Crew.name(a.r) + '\'s'} ${SKILLS[a.id].name.toUpperCase()}`; }).join('. ') + '.');
    if (gaps.length) {
      const fix = gaps.map((t) => {
        const book = Object.keys(ITEMS).find((id) => ITEMS[id].use === 'book' && SKILLS[ITEMS[id].skill].power && EFF[SKILLS[ITEMS[id].skill].type][t] > 1);
        return `${t} (${Battle.counters(t).join('/')}${book ? `, try ${ITEMS[book].name}` : ''})`;
      });
      lines.push(`Nothing you have beats ${fix.join('; ')}. The QUIK STOP tags helpful books with TIP.`);
    } else lines.push('You can cover every type on this team. Use CREW to swap in whoever has the answer!');
    return lines;
  },

  // floating "?" explainer in battle
  pop(lines) {
    document.querySelectorAll('.hintpop').forEach((e) => e.remove());
    const el = UI.el('div', 'hintpop', lines.map((t) => `<p>${t}</p>`).join('') + '<i>tap to close</i>');
    const close = () => { el.remove(); clearTimeout(tm); };
    const tm = setTimeout(close, 9000);
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); close(); });
    UI.root.appendChild(el);
  },
};
