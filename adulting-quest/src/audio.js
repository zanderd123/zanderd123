'use strict';
// Tiny chiptune engine: square/triangle oscillators, a handful of sound
// effects and four short looping tracks. Nothing to download.

const NOTE = (() => {
  const names = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
  return (n) => {
    if (n === '-' || n === '.') return 0;
    const m = /^([A-G]#?)(\d)$/.exec(n);
    return 440 * Math.pow(2, (names[m[1]] + (+m[2] + 1) * 12 - 69) / 12);
  };
})();

// Each track: tempo (bpm), melody & bass as "note:beats" tokens.
const TRACKS = {
  town: { bpm: 116,
    mel: 'E4:1 G4:1 C5:1 G4:1 A4:1 G4:1 E4:1 D4:1 E4:1 G4:1 C5:1 D5:1 E5:2 D5:1 C5:1 A4:1 C5:1 F5:1 E5:1 D5:1 C5:1 A4:1 G4:1 E4:1 G4:1 D5:1 C5:1 C5:3 -:1',
    bass: 'C3:2 G2:2 A2:2 E2:2 C3:2 G2:2 C3:2 G2:2 F2:2 C3:2 F2:2 G2:2 C3:2 G2:2 C3:4' },
  route: { bpm: 132,
    mel: 'G4:1 B4:1 D5:1 B4:1 C5:1 E5:1 D5:2 B4:1 G4:1 A4:1 B4:1 A4:2 -:2 G4:1 B4:1 D5:1 G5:1 F#5:1 E5:1 D5:2 C5:1 B4:1 A4:1 F#4:1 G4:2 -:2',
    bass: 'G2:2 D3:2 C3:2 D3:2 G2:2 D3:2 D2:2 D3:2 G2:2 D3:2 C3:2 D3:2 C3:2 D3:2 G2:4' },
  inside: { bpm: 96,
    mel: 'C5:1 E5:1 G5:1 E5:1 F5:1 D5:1 B4:2 C5:1 E5:1 A5:1 G5:1 F5:2 E5:2 D5:1 F5:1 A5:1 F5:1 E5:1 C5:1 A4:2 B4:1 D5:1 G5:1 F5:1 E5:3 -:1',
    bass: 'C3:4 G2:4 A2:4 F2:4 D3:4 A2:4 G2:4 C3:4' },
  battle: { bpm: 168,
    mel: 'A4:1 A4:1 C5:1 A4:1 E5:1 A4:1 D5:1 C5:1 B4:1 B4:1 D5:1 B4:1 E5:2 G#4:2 A4:1 A4:1 C5:1 E5:1 A5:1 G5:1 F5:1 E5:1 D5:1 C5:1 B4:1 G#4:1 A4:2 -:2',
    bass: 'A2:1 A3:1 A2:1 A3:1 A2:1 A3:1 A2:1 A3:1 E2:1 E3:1 E2:1 E3:1 E2:1 E3:1 E2:1 E3:1 F2:1 F3:1 F2:1 F3:1 D2:1 D3:1 D2:1 D3:1 E2:1 E3:1 E2:1 E3:1 A2:1 A3:1 A2:1 A3:1' },
  leader: { bpm: 176,
    mel: 'D5:1 D5:1 F5:1 D5:1 A5:1 G5:1 F5:1 E5:1 F5:1 F5:1 A5:1 F5:1 C6:2 A5:2 A#5:1 A5:1 G5:1 F5:1 G5:1 F5:1 E5:1 C#5:1 D5:2 A4:2 D5:2 -:2',
    bass: 'D2:1 D3:1 D2:1 D3:1 D2:1 D3:1 D2:1 D3:1 F2:1 F3:1 F2:1 F3:1 F2:1 F3:1 F2:1 F3:1 A#1:1 A#2:1 A#1:1 A#2:1 A2:1 A3:1 A2:1 A3:1 D2:1 D3:1 D2:1 D3:1 D2:1 D3:1 D2:1 D3:1' },
  victory: { bpm: 150, once: true,
    mel: 'C5:1 C5:1 C5:1 C5:3 G#4:3 A#4:3 C5:2 A#4:1 C5:6',
    bass: 'C3:3 C3:3 G#2:3 A#2:3 C3:6' },
};

const Audio2 = {
  ctx: null, master: null, muted: false, track: null, want: null, timer: null,

  unlock() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.5;
        this.master.connect(this.ctx.destination);
      } catch (e) { this.ctx = null; return; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (this.want && !this.track) this.music(this.want);
  },
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
    try { localStorage.setItem('aq-muted', m ? '1' : '0'); } catch (e) { /* storage unavailable */ }
  },

  tone(freq, dur, type = 'square', vol = 0.08, when = 0, slide = 0) {
    if (!this.ctx || !freq) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.linearRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, vol = 0.12, when = 0) {
    if (!this.ctx) return;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain();
    s.buffer = buf; g.gain.value = vol;
    s.connect(g); g.connect(this.master);
    s.start(this.ctx.currentTime + when);
  },

  sfx(name) {
    if (!this.ctx) return;
    switch (name) {
      case 'blip': this.tone(880, 0.03, 'square', 0.02); break;
      case 'move': this.tone(660, 0.04, 'square', 0.04); break;
      case 'select': this.tone(990, 0.06, 'square', 0.05); break;
      case 'back': this.tone(440, 0.06, 'square', 0.05); break;
      case 'bump': this.tone(110, 0.08, 'square', 0.06); break;
      case 'door': this.tone(300, 0.08, 'triangle', 0.1); this.tone(200, 0.1, 'triangle', 0.1, 0.07); break;
      case 'coin': this.tone(988, 0.07, 'square', 0.06); this.tone(1319, 0.18, 'square', 0.06, 0.07); break;
      case 'hit': this.noise(0.12, 0.18); this.tone(180, 0.12, 'square', 0.08, 0, -100); break;
      case 'super': this.noise(0.2, 0.22); this.tone(260, 0.2, 'sawtooth', 0.08, 0, -200); break;
      case 'weak': this.tone(220, 0.1, 'triangle', 0.08, 0, -60); break;
      case 'heal': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.12, 'triangle', 0.08, i * 0.08)); break;
      case 'buff': [440, 554, 659].forEach((f, i) => this.tone(f, 0.08, 'square', 0.05, i * 0.05)); break;
      case 'debuff': [659, 554, 440].forEach((f, i) => this.tone(f, 0.08, 'square', 0.05, i * 0.05)); break;
      case 'faint': this.tone(400, 0.5, 'square', 0.07, 0, -340); break;
      case 'encounter': for (let i = 0; i < 6; i++) this.tone(i % 2 ? 784 : 988, 0.07, 'square', 0.06, i * 0.07); break;
      case 'levelup': [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, 0.1, 'square', 0.06, i * 0.08)); break;
      case 'badge': [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.18, 'square', 0.07, i * 0.12)); break;
      case 'save': [784, 988, 1175].forEach((f, i) => this.tone(f, 0.1, 'triangle', 0.08, i * 0.09)); break;
      case 'miss': this.tone(300, 0.15, 'triangle', 0.06, 0, 200); break;
    }
  },

  music(name) {
    this.want = name;
    if (!this.ctx) return;
    if (this.track && this.track.name === name) return;
    this.stopMusic();
    const tr = TRACKS[name];
    if (!tr) return;
    const parse = (s) => s.split(/\s+/).filter(Boolean).map((tok) => { const [n, b] = tok.split(':'); return [NOTE(n), +b]; });
    const beat = 60 / tr.bpm / 2;
    const voices = [
      { notes: parse(tr.mel), i: 0, t: this.ctx.currentTime + 0.1, type: 'square', vol: 0.045 },
      { notes: parse(tr.bass), i: 0, t: this.ctx.currentTime + 0.1, type: 'triangle', vol: 0.09 },
    ];
    this.track = { name, voices };
    const tick = () => {
      if (!this.ctx || this.track === null || this.track.name !== name) return;
      const horizon = this.ctx.currentTime + 0.4;
      for (const v of voices) {
        while (v.t < horizon) {
          if (v.i >= v.notes.length) {
            if (tr.once) { v.t = Infinity; break; }
            v.i = 0;
          }
          const [f, b] = v.notes[v.i++];
          const dur = b * beat;
          if (f) this.tone(f, dur * 0.9, v.type, v.vol, v.t - this.ctx.currentTime);
          v.t += dur;
        }
      }
    };
    tick();
    this.timer = setInterval(tick, 120);
  },
  stopMusic() {
    clearInterval(this.timer);
    this.timer = null;
    this.track = null;
  },
};
try { Audio2.muted = localStorage.getItem('aq-muted') === '1'; } catch (e) { /* storage unavailable */ }
