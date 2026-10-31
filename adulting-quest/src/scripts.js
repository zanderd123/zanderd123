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
        'And you have your phone? Good. Call me if you need anything. ANYTHING. (Within reason.)'], { name: 'MOM' });
      return;
    }
    if (!p.flags.momCash) {
      p.flags.momCash = true;
      await say(['A PATH! Oh, I\'m so proud. Your father pretends he isn\'t, but he is.',
        'Here, take this. For gas. Don\'t tell your father.'], { name: 'MOM' });
      Game.earn(20); Audio2.sfx('coin');
      await say('{NAME} received $20!');
    }
    await say('You look exhausted. Sit down, I\'ll make you a sandwich.', { name: 'MOM' });
    Game.fullHeal(); Audio2.sfx('heal');
    p.respawn = { map: Game.map.id, x: 10, y: 6, dir: 'right' };
    await say(['Everyone ate a sandwich and took a nap. Sanity and Energy fully restored!',
      'MOM: "Go get \'em. And call me. You won\'t, but call me."']);
  },

  // Call Mom from the bag: money 90% of the time, once per 5 minutes of play.
  async callMom() {
    const p = Game.p, nm = { name: 'MOM' };
    await say('*ring ring* ... *ring ring* ...');
    const wait = 300 - (p.playTime - (p.momCall ?? -1e9));
    if (wait > 0) {
      await say(U.pick(Math.random, ['Honey, didn\'t I JUST talk to you?', 'Again? Is everything okay? Are you eating?', 'I\'m in the middle of my show. Call me back.']), nm);
      await say(`(Mom needs a break. Try again in about ${Math.max(1, Math.ceil(wait / 60))} min.)`);
      UI.closeDialog();
      return 'no';
    }
    p.momCall = p.playTime;
    if (Math.random() < 0.9) {
      const amt = U.rand(15, 40) + 15 * p.badges.length;
      await say(U.pick(Math.random, [
        'Of course, sweetie. I\'ll send it now. What\'s "Venmo" again?',
        'Fine. But this is a LOAN. (It is not a loan.)',
        'Your father says no. I\'m sending it anyway.',
        'Are you sure you don\'t want to move back home? ...Okay, okay. Sending it.',
      ]), nm);
      p.money += amt; Audio2.sfx('coin');
      await say(`Mom sent ${U.money(amt)}!`);
    } else {
      await say(U.pick(Math.random, [
        'Oh honey, I\'m at book club. Can\'t talk. Love you!',
        'Did you know your cousin got engaged? To a DENTIST? ...What did you need again? Oh, I have to go.',
        'Sweetie, money doesn\'t grow on trees. Have you tried a budget? I\'ll email you a spreadsheet.',
      ]), nm);
      await say('(No money this time. Mom says hi, though.)');
    }
    UI.closeDialog();
    return 'no';
  },

  // ---------------------------------------------------------- cutscene helpers
  async walkNPC(n, dirs) {
    for (const d of dirs) {
      const [dx, dy] = DIRS[d];
      n.dir = d; n.tx = n.x + dx; n.ty = n.y + dy; n.moving = true; n.mt = 0;
      while (n.moving) await new Promise((r) => requestAnimationFrame(r));
    }
  },
  async walkPlayer(dirs) {
    const P = Game.pos;
    for (const d of dirs) {
      const [dx, dy] = DIRS[d];
      P.dir = d; P.tx = P.x + dx; P.ty = P.y + dy; P.moving = true; P.mt = 0;
      while (P.moving) await new Promise((r) => requestAnimationFrame(r));
    }
  },
  rep: (d, n) => Array(n).fill(d),

  // ---------------------------------------------------------- leader rewards
  async grantPerk(key) {
    const L = LEADERS[key], k = L.perk, p = Game.p;
    if (!k) return;
    Audio2.sfx('badge');
    await say(`REWARD: ${k.name}!`);
    await say(k.text);
    if (k.item) Game.give(k.item, 1);
    if (k.refund) { p.money += k.refund; Audio2.sfx('coin'); }
    if (k.debtPay && p.debt > 0) { const paid = Math.min(p.debt, k.debtPay); p.debt -= paid; await say(`$${paid} of debt: gone.${p.debt ? ` ($${p.debt} left.)` : ' Debt-free!'}`); }
    if (k.clearDebt) {
      if (p.debt > 0) p.debt = 0;
      else { p.money += 500; Audio2.sfx('coin'); await say('You never took out loans, so GATOR mailed you a $500 "loyalty bonus" instead. Suspicious, but okay.'); }
    }
    if (k.item === 'gym_card') Crew.members().forEach((r) => { r.sanity = Crew.stats(r).maxSanity; });
  },

  // Car keys: drive to a town you've visited (it usually starts).
  async drive() {
    const p = Game.p;
    if (Game.map.id !== 'world') { await say('You\'re indoors. Even this car can\'t drive through walls.'); UI.closeDialog(); return 'no'; }
    const towns = p.visited.slice().sort((a, b) => a - b);
    const k = await UI.choose(towns.map((t) => TOWNS[t].name).concat(['Never mind']), { cls: 'side' });
    if (k < 0 || k >= towns.length) { UI.closeDialog(); return 'no'; }
    UI.closeDialog();
    if (Math.random() < 0.1) {
      await say(['*click* ... *click click* ... *whirrrr*', 'The check engine light comes on. Then the other check engine light. Looks like you\'re walking today.']);
      UI.closeDialog();
      return 'no';
    }
    const b = World.maps.world.buildings.find((x) => x.kind === 'hospital' && x.town === towns[k]);
    Audio2.sfx('door');
    await Game.warp('world', b.x + b.doorX, b.y + b.h, 'down');
    await say(U.pick(Math.random, ['You made it! Only took three gas station stops.', 'You arrive. The radio only gets one station. It\'s polka.', 'Smooth drive. The car made a new noise, but you\'ve decided not to hear it.']));
    UI.closeDialog();
    return 'exit';
  },

  // ---------------------------------------------------------- crew
  // Your significant other is the opposite gender of your character.
  meetsYou(id) {
    if (!id.startsWith('so_')) return true;
    return id === (Game.p.hero === 'girl' ? 'so_m' : 'so_f');
  },
  // Someone runs up to you outside a leader hall and joins.
  async meet(id) {
    const A = ALLIES[id], P = Game.pos, m = Game.map, p = Game.p;
    const n = makeNPC({ x: P.x, y: P.y + 3, dir: 'up' });
    n.palObj = A.pal; n.look = A.look || null;
    m.npcs.push(n);
    await say(A.shout);
    await Scripts.walkNPC(n, ['up', 'up']);
    P.dir = 'down';
    await say(A.pitch, { name: A.name });
    Crew.add(id);
    Audio2.sfx('badge');
    await say(`${A.name} (${A.title}) joined your crew!`);
    await say(`${A.name} is best with ${A.boost} skills: ${Crew.skills(p.crew[p.crew.length - 1]).slice(1).map((k) => SKILLS[k].name).join(', ')}.`);
    if (!p.flags.crewTip) {
      p.flags.crewTip = true;
      await say(['TIP: In battle, pick CREW to tag in whoever has the right skill. If someone runs out of Sanity, the next person steps up. You only lose if EVERYONE is out.',
        'Pick who fights first in MENU > CREW. Hospitals, Mom and Pep Talks get everyone back on their feet.']);
    }
    m.npcs.splice(m.npcs.indexOf(n), 1);
    Game.autosave();
  },

  // ---------------------------------------------------------- Dr. Street
  // First time in the lab: he comes over, explains the basics, and walks you
  // to the table to choose what's next.
  async labIntro() {
    const p = Game.p, m = Game.map, D = { name: 'DR. STREET' };
    p.flags.labIntro = true;
    const st = m.npcs.find((n) => n.pal === 'street');
    await say('"Ah! {NAME}! There you are!"', D);
    await Scripts.walkNPC(st, [...Scripts.rep('down', st.y < 11 ? 11 - st.y : 0), ...Scripts.rep('left', Math.max(0, st.x - 9))]);
    st.dir = 'down';
    await say(['Congratulations on graduating! Big day. Here\'s what\'s next: everything. All at once. Forever.',
      'Don\'t panic. I\'m DR. STREET, and I\'m going to give you the short version.'], D);
    await say(['Out there, life throws ISSUES at you. Parking tickets. Group chats. Mysterious back pain.',
      'They hide in the TALL GRASS between towns. Walk through it and something will jump out.'], D);
    await say(['You fight back with LIFE SKILLS. Every skill has a TYPE, and every issue is WEAK to certain types.',
      'Hit a weakness and it does DOUBLE damage. The issue\'s box tells you what it\'s weak to. Use that.'], D);
    await say(['Skills cost ENERGY. Your SANITY is your health. Run out of Sanity and you\'ll have a full meltdown and drop half your cash.',
      'HOSPITALS patch you up. STORES sell snacks and self-help books that teach new skills. CHAPELS save your progress.'], D);
    await say(['And eight LIFE LEADERS stand between you and the end of young adulthood. CAR TROUBLE. TAXES. CAREER. You know. Life.',
      'The rest you\'ll figure out the way everyone does: badly, and then better.'], D);
    await say('Now, the big question. Come over to the table.', D);
    await Scripts.walkNPC(st, [...Scripts.rep('up', 4), 'right', 'up']);
    st.dir = 'left';
    await Scripts.walkPlayer([...Scripts.rep('up', 5), 'left', 'up']);
    Game.pos.dir = 'up';
    await say(['College, Trade School, or a Job. Each has perks, and each has a cost.',
      'There\'s no wrong answer. (There are some expensive answers.)'], D);
    UI.closeDialog();
    await Scripts.pathTable('wrench');
    if (!p.path) await say('Take your time. The table isn\'t going anywhere. Neither is your future. Well. It is, slowly.', D);
  },

  async street(npc) {
    const p = Game.p, D = { name: 'DR. STREET' };
    if (!p.path) { await say('Go on, take a look at the table. College, Trade School, or a Job.', D); return; }
    const next = LEADER_ORDER.find((k) => !LEADERS[k].locked && !p.badges.includes(k));
    if (next) {
      const L = LEADERS[next];
      await say([`Your next challenge: ${L.title}, in ${TOWNS[L.town].name}. Leader ${L.name} is no joke.`,
        'If a leader is too tough, spend some time in the tall grass first. Every fight makes you stronger.',
        'And if money\'s tight, check your BAG. Your phone can call your mom. Every parent\'s favorite feature.'], D);
    } else {
      await say(['You survived young adult life! I\'ve never been prouder of a former lab visitor.',
        'The other leaders aren\'t ready for you yet. Rumor is they\'ll open their doors in a future update.'], D);
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
    const pk = { college: 'diploma', trade: 'wrench', job: 'badge' }[chosen];
    for (const [i, k] of Game.map.props) if (k === pk) { Game.map.props.delete(i); Game.map.acts.delete(i); }
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
    await say(['Your first LIFE LEADER is CAR TROUBLE, in DUSTY GULCH, east along Route 1. You\'re on your own for this one.',
      'Don\'t worry. Nobody stays alone for long out there.',
      'Press MENU (Esc) any time for your skills, bag and map. Now go! Adulthood waits for no one!'], { name: 'DR. STREET' });
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
      4: 'Sorry, singles only past this point. Just kidding. Beat DATING in Pinewood and the road\'s yours.',
      5: 'The bridge is held as collateral. Beat STUDENT LOANS in Boggy Bayou to get it back.',
      6: 'Enrollment-verified students only. Beat MASTERS DEGREE in Harvest Hollow first.',
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
    const recs = Hints.books(stock), nextL = Hints.next();
    await UI.list(() => stock.map((id) => ({
      label: ITEMS[id].name, right: U.money(Game.priceOf(id)), icon: recs.includes(id) ? '<em class="tipchip">TIP</em>' : '',
      desc: ITEMS[id].desc + (p.items[id] ? ` <i>(You have ${p.items[id]}.)</i>` : '') + (ITEMS[id].skill && p.known.includes(ITEMS[id].skill) ? ' <i>(Already known.)</i>' : '')
        + (recs.includes(id) ? ` <b class="rec">TIP: recommended for ${LEADERS[nextL].title}: nothing you have hits its ${Hints.gaps(nextL).filter((t) => EFF[SKILLS[ITEMS[id].skill].type][t] > 1).join('/')} issues this hard.</b>` : ''),
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
        UI.closeDialog();
        if (await Saves.saveMenu()) await say('Your journey is recorded. Go in peace.', { name: 'PASTOR' });
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
    await say(['YO! Future champ! Here\'s some free advice.', ...Hints.leader(key), 'Stock up on Coffee and Comfort Food before you go up there!'], { name: 'HALL GUIDE' });
  },

  // ---------------------------------------------------------- leaders
  async leader(key, npc) {
    const L = LEADERS[key], p = Game.p;
    const nm = { name: L.name };
    if (p.badges.includes(key)) { await say(L.after, nm); return; }
    await say(L.intro, nm);
    let go;
    while (true) {
      await say(`Battle ${L.title}?`, { noWait: true });
      go = await UI.choose(['Battle!', 'Get a hint', 'Not yet'], { cls: 'side' });
      if (go !== 1) break;
      await say(Hints.leader(key));
    }
    if (go !== 0) {
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
    await Scripts.grantPerk(key);
    await say(`Somehow, almost two years have passed. {NAME} is now ${Game.age()}.`);
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
