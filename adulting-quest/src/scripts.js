'use strict';
// Everything people say and do when you talk to them.

const say = (t, o) => UI.say(t, o);

const Scripts = {
  async chat(npc, lines) { await say(lines); },

  async house(npc, def, ti, slot) {
    await say(def.say.slice(0, def.gift ? def.say.length : undefined));
    if (def.gift) {
      const flag = `gift-${ti}-${slot}`;
      if (!Game.p.flags[flag]) {
        Game.p.flags[flag] = true;
        const [id, n] = def.gift;
        Game.give(id, n);
        Audio2.sfx('coin');
        await say(`{NAME} received ${n > 1 ? n + '× ' : ''}${ITEMS[id].name}!`);
      }
    }
  },

  async busker(npc, f) {
    await say(f.say);
    const p = Game.p;
    if (p.money < 5) { await say('(You check your wallet. Moths fly out.)'); return; }
    if (await UI.confirm('Tip the musician $5?')) {
      p.money -= 5; Game.addKarma(4); Audio2.sfx('coin');
      await say('"Thanks, friend! Good karma comes back around!" (Karma went up.)');
    } else {
      await say('"No worries! ♪ The best things in life are free... ♪"');
    }
  },

  // ---------------------------------------------------------- home
  async mom(npc) {
    const p = Game.p;
    if (!p.path) {
      await say(['Morning, sweetie! Dr. Street called. He wants to see you at his LAB.',
        'It\'s the building with the green roof, east side of town.',
        'And take a jacket! ...You\'re 20, you say? You\'re still taking a jacket.'], { name: 'MOM' });
      return;
    }
    if (!p.flags.momCash) {
      p.flags.momCash = true;
      await say(['A PATH! Oh, I\'m so proud. Your father pretends he isn\'t, but he is.',
        'Here, take this. For gas. Don\'t tell your father.'], { name: 'MOM' });
      Game.earn(20); Audio2.sfx('coin');
      await say('{NAME} received $20!');
    }
    if (p.badges.length >= 1 && !Crew.has('mom')) {
      await Scripts.recruit('mom', npc);
      if (!Crew.has('mom')) return;
    }
    await say('You look exhausted. Sit down, I\'ll make you a sandwich.', { name: 'MOM' });
    Game.fullHeal(); Audio2.sfx('heal');
    p.respawn = { map: Game.map.id, x: 10, y: 6, dir: 'right' };
    await say(['{NAME} ate a sandwich and took a nap. Sanity and Energy fully restored!',
      'MOM: "Go get \'em. And call me. You won\'t, but call me."']);
  },

  // ---------------------------------------------------------- crew
  async recruit(id, npc) {
    const A = ALLIES[id], p = Game.p, nm = { name: A.name };
    if (Crew.has(id)) { await say(A.after, nm); return; }
    if (!p.path) { await say(A.noPath || ['Go see Dr. Street first.'], nm); return; }
    if (p.badges.length < A.need) { await say(A.notYet, nm); return; }
    await say(A.pitch, nm);
    if (A.cost) {
      if (!(await UI.confirm(`Pay $${A.cost} so ${A.name} joins your crew?`))) { await say(A.decline || 'Maybe later.', nm); return; }
      if (p.money < A.cost) { await say(`You check your wallet. You have ${U.money(p.money)}. That's not $${A.cost}.`); return; }
      p.money -= A.cost; Audio2.sfx('coin');
    } else if (!(await UI.confirm(`Add ${A.name} to your crew?`))) { await say('Okay. Offer stands!', nm); return; }
    Crew.add(id);
    Audio2.sfx('badge');
    await say(`${A.name} (${A.title}) joined your crew!`);
    await say(`${A.name} is best with ${A.boost} skills: ${Crew.skills(p.crew[p.crew.length - 1]).map((k) => SKILLS[k].name).join(', ')}.`);
    if (!p.flags.crewTip) {
      p.flags.crewTip = true;
      await say(['TIP: In battle, pick CREW to tag in whoever has the right skill. If someone runs out of Sanity, the next person steps up. You only lose if EVERYONE is out.',
        'Pick who fights first in MENU > CREW. Hospitals, Mom and Pep Talks get everyone back on their feet.']);
    }
    if (!A.home) npc.hidden = true;
    Game.autosave();
  },

  // ---------------------------------------------------------- Dr. Street
  async street(npc) {
    const p = Game.p;
    if (!p.path) {
      await say(['Ah, {NAME}! Right on time. Well, forty minutes late, but that\'s basically on time for your generation.',
        'Out there, life is full of ISSUES. Parking tickets. Group chats. Mysterious back pain.',
        'You\'ll fight them with LIFE SKILLS. Some hit certain issues hard, some barely land. That\'s the TYPE CHART.',
        'But first, every adult needs a PATH.',
        'On the table: a DIPLOMA for College, a WRENCH for Trade School, and a NAME TAG for Getting a Job.',
        'Each comes with perks... and costs. Go have a look!'], { name: 'DR. STREET' });
      return;
    }
    const next = LEADER_ORDER.find((k) => !LEADERS[k].locked && !p.badges.includes(k));
    if (next) {
      const L = LEADERS[next];
      await say([`Your next challenge: ${L.title}, in ${TOWNS[L.town].name}. Leader ${L.name} is no joke.`,
        'Remember: HOSPITALS heal, CHAPELS save, STORES sell. The tall grass is FULL of issues, and sometimes loose cash.',
        'And if you\'re stuck, press START (or M) and check the TYPE CHART.'], { name: 'DR. STREET' });
    } else {
      await say(['Three milestones down! The other leaders aren\'t ready for you yet.',
        'Rumor is they\'ll open their doors in a future update. Until then, explore! Pinewood, Boggy Bayou, Harvest Hollow, Metro Heights...',
        'And watch out. The issues out east are no joke.'], { name: 'DR. STREET' });
    }
  },

  async pathTable(kind) {
    const p = Game.p;
    const key = { diploma: 'college', wrench: 'trade', badge: 'job' }[kind];
    if (p.path) {
      await say(p.path === key ? 'That\'s the path you chose. It\'s working out great. Mostly.' : 'Another path. You think about it sometimes. Late at night. It\'s fine.');
      return;
    }
    const chosen = await PathPicker.open(key);
    if (!chosen) return;
    const P = PATHS[chosen];
    p.path = chosen;
    p.level = 5; p.xp = Stats.xpFor(5);
    p.known = [...P.start]; p.equipped = [...P.start];
    p.money = P.money; p.debt = P.debt;
    Game.give('coffee', 3); Game.give('comfort_food', 2);
    Game.fullHeal();
    // take the chosen item off the table
    for (const [i, k] of Game.map.props) if (k === kind) { Game.map.props.delete(i); Game.map.acts.delete(i); }
    World.refreshGates();
    Audio2.sfx('badge');
    await say(`{NAME} chose ${P.name.toUpperCase()}!`);
    const lines = {
      college: ['College! Excellent. You\'ll learn fast... and owe $3,000. Ten percent of everything you earn goes to your loans until they\'re paid.',
        'You start with GOOGLING IT. BRAINS skills tear through PAPERWORK and MONEY issues.'],
      trade: ['Trade School! Smart. Real skills, real paychecks, and you can fix your own sink.',
        'You\'ve got a small tool loan to pay off. GRIT skills crush CHORE issues. You\'re tough, too!'],
      job: ['Getting a job! Bold. No debt, cash in your pocket, and a mouth that can talk your way out of anything.',
        'You\'ll level a bit slower without the degree, but SOCIAL skills hit PEOPLE issues hard. And you can HAGGLE.'],
    }[chosen];
    await say(lines, { name: 'DR. STREET' });
    await say(['Here, take these. Coffee restores Energy, comfort food restores Sanity. You\'ll need both.'], { name: 'DR. STREET' });
    await say('{NAME} received 3× Coffee and 2× Comfort Food!');
    await say(['Your first LIFE LEADER is CAR TROUBLE, in DUSTY GULCH, east along Route 1.',
      'Beat all eight leaders and you WIN at the game of life. No pressure. (Lots of pressure.)',
      'Press START or M any time for your menu. Now go! Adulthood waits for no one!'], { name: 'DR. STREET' });
    Game.autosave();
  },

  // ---------------------------------------------------------- gates
  async gate(g) {
    const r = ROUTES[g.ri];
    if (Game.gateOpen(g.ri)) { await say('The road\'s open. Good luck out there!', { name: 'GUARD' }); return; }
    if (r.gateFlag === 'path') {
      await say(['Whoa there! Dr. Street says nobody leaves Maple Grove without a PATH.',
        'His LAB is the green-roofed building in the southeast of town.'], { name: 'LAB AIDE' });
      return;
    }
    const why = {
      1: 'Tow trucks everywhere. RUSTY\'s doing. Beat CAR TROUBLE in Dusty Gulch and we\'ll clear the road.',
      2: 'A crowd is doing burpees in the middle of the road. COACH MAX\'s orders. Beat FITNESS in Sunnyside Beach.',
      3: 'The pass is frozen solid with paperwork. Only those who\'ve beaten TAXES in Frostpeak may pass.',
      7: 'Major construction. This shortcut only opens for folks with 7 LIFE MILESTONES.',
    }[g.ri];
    await say([why, `(You need ${r.need} Life Milestone${r.need > 1 ? 's' : ''}. You have ${Game.p.badges.length}.)`], { name: 'GUARD' });
  },

  // ---------------------------------------------------------- services
  async shop(ti) {
    const p = Game.p;
    const stock = ti < SHOP_STOCK.length ? SHOP_STOCK[ti] : [...new Set(SHOP_STOCK.flat())];
    await say(`Welcome to QUIK STOP! We\'re on every corner. Literally every corner.${p.karma < 30 ? ' ...Oh. It\'s you. Prices are a little higher for you today.' : p.karma >= 80 ? ' Oh, it\'s you! Good-person discount, on the house!' : ''}`, { name: 'CLERK' });
    UI.closeDialog();
    await UI.list(() => stock.map((id) => ({
      label: ITEMS[id].name, right: U.money(Game.priceOf(id)),
      desc: ITEMS[id].desc + (p.items[id] ? ` <i>(You have ${p.items[id]}.)</i>` : '') + (ITEMS[id].skill && p.known.includes(ITEMS[id].skill) ? ' <i>(Already known.)</i>' : ''),
    })), {
      title: 'QUIK STOP', headRight: () => U.money(p.money),
      footer: () => 'A: buy one · B: leave',
      onAct: async (k) => {
        const id = stock[k], pr = Game.priceOf(id);
        if (p.money < pr) { Audio2.sfx('bump'); UI.toast('Not enough cash!'); return 'keep'; }
        p.money -= pr; Game.give(id); Audio2.sfx('coin');
        UI.toast(`Bought ${ITEMS[id].name}!`);
        return 'keep';
      },
    });
    await say('Thanks! Come again! (You will. We\'re everywhere.)', { name: 'CLERK' });
  },

  async hospital(ti) {
    const p = Game.p;
    await say(['Welcome to ST. COPAY\'S! We restore Sanity, Energy, and cure Burnout.'], { name: 'NURSE' });
    const yes = await UI.confirm('The copay is $10. Want me to patch you up?', { name: 'NURSE' });
    if (!yes) { await say('Okay! Hydrate! Sleep! Nobody ever does, but I have to say it.', { name: 'NURSE' }); return; }
    if (p.money >= 10) { p.money -= 10; await say('Insurance? ...Yeah, I didn\'t think so. Ten bucks it is.', { name: 'NURSE' }); }
    else await say('You\'re broke? ...Okay. This one\'s on the house. Don\'t tell billing.', { name: 'NURSE' });
    await Game.fadeTo(0.6, 250);
    Audio2.sfx('heal');
    Game.fullHeal();
    await U.wait(700);
    await Game.fadeTo(0, 250);
    p.respawn = { map: Game.map.id, x: 9, y: 5, dir: 'up' };
    await say('All better! We hope to never see you again. (Kindly.)', { name: 'NURSE' });
  },

  async chapel(ti) {
    const p = Game.p;
    await say('Welcome, weary traveler. How may I help you?', { name: 'PASTOR' });
    let start = 0;
    while (true) {
      const i = await UI.choose(['Save my progress', 'Donate $10', 'Ask for guidance', 'Leave'], { cls: 'side', start });
      start = Math.max(0, i);
      if (i === 0) {
        const ok = Game.save();
        if (ok) Audio2.sfx('save');
        await say(ok ? 'Your journey is recorded. Go in peace. (Progress saved!)' : 'Hm, the record book is stuck. (Your browser is blocking storage.)', { name: 'PASTOR' });
      } else if (i === 1) {
        if (p.money < 10) { await say('Keep it, friend. It looks like you need it more.', { name: 'PASTOR' }); continue; }
        p.money -= 10; Game.addKarma(6); Audio2.sfx('coin');
        await say(`Bless you. Generosity is its own reward. (Karma: ${p.karma}, ${Game.karmaLabel()})`, { name: 'PASTOR' });
        if (p.karma >= 80) {
          const s = Game.stats(); p.energy = s.maxEnergy; Audio2.sfx('heal');
          await say('You feel... light. Your Energy is fully restored!');
        }
      } else if (i === 2) {
        const next = LEADER_ORDER.find((k) => !LEADERS[k].locked && !p.badges.includes(k));
        const k = p.karma;
        const read = k < 30 ? 'I sense... a lot of passive aggression in you. Shady skills come at a price. Shop clerks talk, you know.'
          : k >= 80 ? 'Your heart is light. Shopkeepers can tell. They\'ll treat you well.'
            : 'You\'re doing alright. Be kind when you can. It comes back around.';
        await say([read, next ? `Your road leads to ${LEADERS[next].title} in ${TOWNS[LEADERS[next].town].name}. ${LEADERS[next].tip}` : 'The remaining leaders are not yet ready to receive you. Rest, and explore.'], { name: 'PASTOR' });
      } else {
        await say('Go in peace. And call your mother.', { name: 'PASTOR' });
        return;
      }
    }
  },

  async guide(key) {
    const L = LEADERS[key];
    if (Game.p.badges.includes(key)) { await say(['YO! You did it! Champion of ' + L.title + '!', 'Go show the next leader what you\'ve got!'], { name: 'HALL GUIDE' }); return; }
    await say(['YO! Future champ! Here\'s some free advice.', L.tip, 'Stock up on Coffee and Comfort Food before you go up there!'], { name: 'HALL GUIDE' });
  },

  // ---------------------------------------------------------- leaders
  async leader(key, npc) {
    const L = LEADERS[key], p = Game.p;
    const nm = { name: L.name };
    if (p.badges.includes(key)) { await say(L.after, nm); return; }
    await say(L.intro, nm);
    if (!(await UI.confirm(`Battle ${L.title}?`))) {
      await say('Take your time. Issues don\'t go anywhere. That\'s kind of the problem.', nm);
      return;
    }
    UI.closeDialog();
    const res = await Battle.start({ foes: L.team, leader: key, biome: TOWNS[L.town].biome });
    if (res !== 'win') return;
    await say(L.win, nm);
    p.badges.push(key);
    Audio2.music('victory');
    Audio2.sfx('badge');
    await say(`{NAME} earned the ${L.badge.toUpperCase()}! (Life Milestone ${p.badges.length}/8)`);
    const r = Game.earn(L.reward);
    Audio2.sfx('coin');
    await say(`${L.name} paid out ${U.money(L.reward)}!${r.garnished ? ` ($${r.garnished} went straight to your loans.)` : ''}`);
    const sk = SKILLS[L.skill];
    if (!p.known.includes(L.skill)) {
      Game.learn(L.skill);
      Audio2.sfx('levelup');
      await say(`${L.name} taught {NAME} ${sk.name.toUpperCase()}! ${sk.desc}`);
      if (!p.equipped.includes(L.skill)) await Battle.offerSkill(L.skill);
    }
    await say(`Somehow, a year and a half has passed. {NAME} is now ${Game.age()}.`);
    World.refreshGates();
    Game.autosave();
    Game.updateMusic();
    const nextGate = ROUTES.findIndex((rt) => rt.need === p.badges.length);
    if (nextGate >= 0) await say('Word travels fast: a road that was blocked just opened up!');
  },
};

// ---------------------------------------------------------- path picker
const PathPicker = {
  open(startKey) {
    const keys = ['college', 'trade', 'job'];
    let i = Math.max(0, keys.indexOf(startKey));
    Game.scene = { kind: 'select', i };
    const box = UI.el('div', 'pathpick');
    const render = () => {
      Game.scene.i = i;
      const P = PATHS[keys[i]];
      box.innerHTML = `<div class="ps-title">CHOOSE YOUR PATH</div>
        <div class="ps-cols">${keys.map((k, n) => `<div data-i="${n}"></div>`).join('')}</div>
        <div class="ps-names">${keys.map((k, n) => `<span class="${n === i ? 'on' : ''}">${PATHS[k].name.toUpperCase()}</span>`).join('')}</div>
        <div class="ps-desc"><div class="bl">${P.blurb}</div>${P.pros.map((t) => `<div class="pro">${t}</div>`).join('')}${P.cons.map((t) => `<div class="con">${t}</div>`).join('')}<div class="foot">A: CHOOSE</div></div>`;
    };
    render();
    UI.root.appendChild(box);
    return new Promise((resolve) => {
      let asking = false;
      const pick = async () => {
        asking = true;
        box.style.visibility = 'hidden';
        const ok = await UI.confirm(`Choose ${PATHS[keys[i]].name.toUpperCase()}? This follows you forever. (Kidding. Mostly.)`);
        UI.closeDialog();
        box.style.visibility = '';
        asking = false;
        if (ok) done(keys[i]);
      };
      const w = {
        onInput: (b) => {
          if (asking) return 'stop';
          if (b === 'left' || b === 'up') { i = (i + 2) % 3; Audio2.sfx('move'); render(); }
          else if (b === 'right' || b === 'down') { i = (i + 1) % 3; Audio2.sfx('move'); render(); }
          else if (b === 'A') { Audio2.sfx('select'); pick(); }
          else if (b === 'B') { Audio2.sfx('back'); done(null); }
          return 'stop';
        },
      };
      const done = (v) => { UI.pop(w); box.remove(); Game.scene = null; resolve(v); };
      box.addEventListener('pointerdown', (e) => {
        const c = e.target.closest('[data-i]');
        if (!c || UI.top() !== w) return;
        e.preventDefault();
        const n = +c.dataset.i;
        if (n === i) pick(); else { i = n; render(); Audio2.sfx('move'); }
      });
      UI.push(w);
    });
  },
};
