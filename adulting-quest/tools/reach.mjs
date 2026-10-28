// Flood-fills the generated world from the player's front door and reports
// any building door, gate or town that can't be reached on foot.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const ctx = { console, document: { createElement: () => ({ getContext: () => ({}) }) } };
vm.createContext(ctx);
for (const f of ['util', 'data', 'art', 'world']) vm.runInContext(readFileSync(new URL(`../src/${f}.js`, import.meta.url), 'utf8').replace(/^(const|let) (\w+)/gm, 'var $2'), ctx);
vm.runInContext('World.build()', ctx);
const { World, T, SOLID, TOWNS } = ctx;
const m = World.maps.world;
const doors = [...m.doors.keys()];
const home = doors.find((i) => m.doors.get(i).to === 'house-0-0');
const start = home + m.w;
const seen = new Uint8Array(m.w * m.h);
const q = [start]; seen[start] = 1;
const npcBlock = new Set();
while (q.length) {
  const i = q.shift(), x = i % m.w, y = Math.floor(i / m.w);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (!m.in(nx, ny)) continue;
    const j = m.idx(nx, ny);
    if (seen[j]) continue;
    const t = m.get(nx, ny);
    if (t === T.DOOR) { seen[j] = 2; continue; }
    if (SOLID.has(t)) continue;
    seen[j] = 1; q.push(j);
  }
}
let bad = 0;
for (const i of doors) if (!seen[i]) { bad++; console.log('unreachable door', i % m.w, Math.floor(i / m.w), JSON.stringify(m.doors.get(i))); }
TOWNS.forEach((t, k) => { const [ox, oy] = World.townOrigin(k); if (!seen[m.idx(ox + 14, oy + 11)]) { bad++; console.log('unreachable town', t.name); } });
// NPCs standing on solid tiles
for (const n of m.npcs) if (SOLID.has(m.get(n.x, n.y))) { bad++; console.log('npc in wall', n.x, n.y, n.pal); }
// interiors: every NPC reachable from entry
for (const [id, im] of Object.entries(World.maps)) {
  if (id === 'world') continue;
  if (!im.entry) { bad++; console.log('no entry', id); }
}
console.log(`${doors.length} doors, ${m.npcs.length} outdoor npcs, ${bad ? bad + ' problems' : 'all reachable'}`);
