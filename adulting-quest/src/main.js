'use strict';
// Boot, title screen, the Dr. Street intro, and the frame loop.

const Intro = {
  who: null, // 'street' | 'player'
  t: 0,
  render(x) {
    this.t += 1 / 60;
    const g = x.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, '#20304a'); g.addColorStop(1, '#4a3a5a');
    x.fillStyle = g; x.fillRect(0, 0, VIEW_W, VIEW_H);
    for (let i = 0; i < 30; i++) {
      x.fillStyle = 'rgba(255,255,255,0.5)';
      x.fillRect((U.hash(i, 1) % VIEW_W), (U.hash(i, 2) % 90), 1, 1);
    }
    disc(x, 120, 102, 44, 9, 'rgba(0,0,0,0.25)');
    const bob = Math.round(Math.sin(this.t * 2) * 1);
    if (this.who === 'street') x.drawImage(Art.portrait(PALS.street, 'glasses'), 88, 40 + bob);
    if (this.who === 'player') x.drawImage(Art.portrait({ ...PALS.player }, null), 88, 40 + bob);
  },

  async run() {
    Game.mode = 'intro';
    Audio2.music('inside');
    this.who = 'street';
    await Game.fadeTo(0, 400);
    const S = { name: 'DR. STREET' };
    await UI.say(['Hello there! Welcome to the GAME OF LIFE!',
      'My name is DR. STREET. People call me that because I have two doctorates...',
      '...one from the university, and one from the STREETS.',
      'This world is full of ISSUES. Parking tickets. Group chats. Mysterious back pain.',
      'Some people run from their issues. Others stuff them in a closet until the door won\'t close.',
      'But you? You\'re going to FACE them!',
      'Now, tell me about yourself. What\'s your name?'], S);
    UI.closeDialog();
    this.who = 'player';
    const name = await UI.askName('ALEX');
    Game.p = Game.newPlayer(name);
    await UI.say([`${name}! What a great name. Very... employable.`,
      `You just turned 20, and your parents have started leaving apartment listings on your pillow.`,
      'Out there, eight LIFE LEADERS are waiting: CAR TROUBLE, TAXES, CAREER, and more.',
      'Beat all eight, and you WIN at the game of life!',
      'Swing by my LAB when you\'re up. Your adventure begins... NOW!'], S);
    UI.closeDialog();
    await Game.fadeTo(1, 500);
  },
};

const Main = {
  async boot() {
    const cv = document.getElementById('cv');
    Game.ctx = cv.getContext('2d');
    Input.init();
    UI.init();
    World.build();
    document.getElementById('muteBtn')?.addEventListener('click', () => {
      Audio2.unlock(); Audio2.setMuted(!Audio2.muted); this.syncMute();
    });
    this.syncMute();
    let last = performance.now();
    const frame = (t) => {
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      requestAnimationFrame(frame);
      // one bad frame must never kill the loop
      try {
        Input.frame(dt);
        const had = UI.busy;
        UI.update(dt);
        if (had) Input.pressed.clear();
        Game.tick(dt);
        Game.render();
      } catch (e) { console.error(e); }
    };
    requestAnimationFrame(frame);
    window.__game = { Game, World, Battle, UI, Main, PATHS, LEADERS };
    this.title();
  },

  syncMute() {
    const b = document.getElementById('muteBtn');
    if (b) b.textContent = Audio2.muted ? '♪ off' : '♪ on';
  },

  async title() {
    Game.mode = 'title';
    Game.fade = 0;
    Audio2.music('town');
    const saved = Game.loadSave();
    const box = UI.el('div', 'titlecard', `<div class="logo"><span>ADULTING</span><span>QUEST</span></div>
      <div class="tag">Defeat 8 Life Leaders. Win at the game of life.</div>`);
    UI.root.appendChild(box);
    const opts = saved ? ['CONTINUE', 'NEW GAME'] : ['NEW GAME'];
    const k = await UI.choose(opts, { cls: 'titlemenu', cancel: false });
    box.remove();
    Audio2.unlock();
    if (opts[k] === 'CONTINUE') return this.cont(saved);
    if (saved && !(await this.confirmOverwrite())) return this.title();
    return this.newGame();
  },

  async confirmOverwrite() {
    const yes = await UI.confirm('Start over? Your saved game will be replaced the next time you save.');
    UI.closeDialog();
    return yes;
  },

  async newGame() {
    await Game.fadeTo(1, 300);
    await Intro.run();
    Game.mode = 'world';
    World.refreshGates();
    Game.enter('house-0-0', 2, 3, 'down');
    await Game.fadeTo(0, 500);
    await Game.run(() => UI.say(['{NAME}\'s room. A diploma frame with no diploma in it. A laundry pile with ambitions.',
      'Mom is in the kitchen. Better say hi.']));
  },

  async cont(p) {
    // fill in anything newer saves have that older ones lack
    Game.p = Object.assign(Game.newPlayer(p.name), p);
    if (!World.maps[Game.p.map]) Object.assign(Game.p, { map: 'house-0-0', x: 2, y: 3 });
    await Game.fadeTo(1, 300);
    Game.mode = 'world';
    World.refreshGates();
    Game.enter(Game.p.map, Game.p.x, Game.p.y, Game.p.dir);
    await Game.fadeTo(0, 400);
    UI.toast(`Welcome back, ${Game.p.name}!`);
  },
};

window.addEventListener('DOMContentLoaded', () => Main.boot());
