// Balance check: simulates leader fights for each path with a sensible
// player (best-effectiveness skill it can afford, heals when low).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const ctx = {}; vm.createContext(ctx);
for (const f of ['src/util.js', 'src/data.js']) vm.runInContext(readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/^const (\w+)/gm, 'var $1'), ctx);
const { SKILLS, ISSUES, FOE_MOVES, PATHS, EFF, LEADERS } = ctx;
const stage = (s) => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));
const dmg = (L, pw, a, d, m) => Math.max(1, Math.floor((Math.floor(Math.floor(Math.floor(2 * L / 5 + 2) * pw * a / d) / 50) + 2) * m * (0.85 + Math.random() * 0.15)));
function pstats(path, L) { const b = PATHS[path].base; return { maxS: Math.floor(4 * b.san * L / 100) + 3 * L + 20, conf: Math.floor(2 * b.conf * L / 100) + 5, comp: Math.floor(2 * b.comp * L / 100) + 5, hus: Math.floor(2 * b.hus * L / 100) + 5, maxE: 18 + 2 * L + b.energy }; }
function foe(id, L) { const [h, a, d, s] = ISSUES[id].base; return { id, t: ISSUES[id].type, L, hp: Math.floor(2 * h * L / 100) + L + 10, atk: Math.floor(2 * a * L / 100) + 5, dfn: Math.floor(2 * d * L / 100) + 5, spd: Math.floor(2 * s * L / 100) + 5, moves: ISSUES[id].moves }; }
function known(path, L) { const P = PATHS[path]; const k = [...P.start]; for (const [lv, id] of Object.entries(P.learn)) if (+lv <= L) k.push(id); return k; }
function fight(path, L, key, food, extra = []) {
  const st = pstats(path, L); let san = st.maxS, en = st.maxE, atkS = 0, defS = 0, items = food;
  const sk = [...new Set([...known(path, L), ...extra])];
  for (const [id, fl] of LEADERS[key].team) {
    const f = foe(id, fl); let fAtk = 0, fDef = 0; atkS = Math.max(0, atkS); defS = Math.max(0, defS);
    for (let turn = 0; turn < 40 && f.hp > 0; turn++) {
      // player
      if (san < st.maxS * 0.35 && items > 0) { items--; san = Math.min(st.maxS, san + 25); }
      else {
        let best = 'wing_it', bv = 0;
        for (const id of sk) { const s = SKILLS[id]; if (!s.power || s.cost > en) continue; const v = s.power * EFF[s.type][f.t] * (PATHS[path].boost === s.type ? 1.2 : 1); if (v > bv) { bv = v; best = id; } }
        const s = SKILLS[best]; en -= s.cost;
        if (Math.random() * 100 < s.acc) f.hp -= dmg(L, s.power, st.conf * stage(atkS), f.dfn * stage(fDef), EFF[s.type][f.t] * (PATHS[path].boost === s.type ? 1.2 : 1));
      }
      if (f.hp <= 0) break;
      const mv = FOE_MOVES[f.moves[Math.floor(Math.random() * f.moves.length)]];
      if (mv.power) san -= dmg(f.L, mv.power, f.atk * stage(fAtk), st.comp * stage(defS), 1);
      if (mv.fx?.atkDown) atkS = Math.max(-4, atkS - mv.fx.atkDown);
      if (mv.fx?.defDown) defS = Math.max(-4, defS - mv.fx.defDown);
      if (mv.fx?.drain) en = Math.max(0, en - mv.fx.drain);
      if (mv.fx?.selfAtk) fAtk++; if (mv.fx?.selfDef) fDef++;
      if (san <= 0) return false;
      en = Math.min(st.maxE, en + 2);
    }
  }
  return true;
}
const plan = { car: [9, 10, 11, 12], fitness: [13, 14, 15, 16], taxes: [17, 18, 19, 20] };
for (const key of Object.keys(plan)) for (const path of ['college', 'trade', 'job']) {
  const row = plan[key].map((L) => { let w = 0; for (let i = 0; i < 400; i++) w += fight(path, L, key, 4); return `L${L}:${(w / 4).toFixed(0)}%`; });
  console.log(key.padEnd(8), path.padEnd(8), row.join('  '));
}
if (process.argv[2] === 'debug') {
  const path = process.argv[3], L = +process.argv[4];
  const st = pstats(path, L);
  console.log(path, L, st, known(path, L));
  for (const [id, fl] of LEADERS.taxes.team) console.log(id, foe(id, fl));
}
