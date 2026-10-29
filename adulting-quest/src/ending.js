'use strict';
// "Congratulations, you have survived young adult life." A sunset walk down
// the road with your crew, then your stats. Plays once, after the last
// playable leader; afterwards you can keep exploring.

const Ending = {
  t: 0,
  async play() {
    const p = Game.p;
    p.flags.ending = true;
    await Game.fadeTo(1, 600);
    Game.mode = 'ending';
    this.t = 0;
    Audio2.music('victory');
    await Game.fadeTo(0, 600);
    await U.wait(2600);
    const hrs = Math.floor(p.playTime / 3600), mins = Math.floor(p.playTime / 60) % 60;
    const box = UI.el('div', 'endcard', `
      <div class="e-big">CONGRATULATIONS!</div>
      <div class="e-sub">You have survived young adult life.</div>
      <div class="e-stats">
        <span>AGE</span><b>${Game.age()}</b><span>LEVEL</span><b>${p.level}</b>
        <span>PLAY TIME</span><b>${hrs}h ${String(mins).padStart(2, '0')}m</b><span>ISSUES HANDLED</span><b>${p.stats.issues}</b>
        <span>MELTDOWNS</span><b>${p.stats.meltdowns}</b><span>CASH</span><b>${U.money(p.money)}</b>
        <span>KARMA</span><b>${Game.karmaLabel()}</b><span>CREW</span><b>${Crew.members().map((r) => Crew.name(r)).join(', ')}</b>
      </div>
      <div class="e-foot">PRESS A TO KEEP EXPLORING</div>`);
    UI.root.appendChild(box);
    await new Promise((resolve) => {
      const w = { onInput: (b) => { if (b === 'A' || b === 'START') { UI.pop(w); resolve(); } return 'stop'; } };
      UI.push(w);
    });
    await Game.fadeTo(1, 500);
    box.remove();
    Game.mode = 'world';
    Game.updateMusic();
    Game.autosave();
    await Game.fadeTo(0, 500);
    await UI.say(['The other Life Leaders are still out there: DATING, STUDENT LOANS, MASTERS DEGREE, CAREER... and PARENTS.',
      'They\'ll open their doors in a future update. Until then, the world is yours to explore.']);
  },

  render(x) {
    this.t += 1 / 60;
    const t = this.t;
    const g = x.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, '#f49a5a'); g.addColorStop(1, '#ffe6a8');
    x.fillStyle = g; x.fillRect(0, 0, VIEW_W, VIEW_H);
    const sunY = 104 - Math.min(26, t * 5);
    x.fillStyle = '#fff4c8'; x.beginPath(); x.arc(214, sunY, 20, 0, Math.PI * 2); x.fill();
    x.globalAlpha = 0.35; x.fillStyle = '#ffe9a0'; x.beginPath(); x.arc(214, sunY, 26, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;
    x.fillStyle = '#8ab86a'; x.beginPath(); x.ellipse(70, 124, 110, 24, 0, Math.PI, 0); x.fill();
    x.fillStyle = '#76a85a'; x.beginPath(); x.ellipse(240, 128, 120, 22, 0, Math.PI, 0); x.fill();
    x.fillStyle = '#68b04c'; x.fillRect(0, 124, VIEW_W, VIEW_H - 124);
    for (let i = 0; i < 50; i++) { x.fillStyle = '#4a8a36'; x.fillRect(U.hash(i, 5) % VIEW_W, 128 + U.hash(i, 6) % 90, 2, 1); }
    x.fillStyle = '#cbb48a'; x.beginPath(); x.moveTo(140, 124); x.lineTo(164, 124); x.lineTo(196, VIEW_H); x.lineTo(108, VIEW_H); x.fill();
    // the crew walks down the road toward you
    const walking = t < 3.2, k = Math.min(1, t / 3.2);
    Crew.members().forEach((r, i) => {
      // walk down the road and stop above the stats box, side by side
      const py = 100 + k * 30, px = 152 - 10 * (Crew.members().length - 1) + i * 20 - 8;
      shadow(x, px, py);
      const fr = walking ? WALKCYCLE[Math.floor(t * 6 + i) % 4] : 0;
      x.drawImage(Art.character(Crew.pal(r), Crew.look(r)).down[fr], Math.round(px) - 2, Math.round(py) - 8);
    });
    if (!walking && Math.floor(t * 3) % 2) { x.fillStyle = '#ffffff'; x.fillRect(134, 118, 1, 3); x.fillRect(170, 120, 1, 3); }
  },
};
