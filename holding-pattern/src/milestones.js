// Milestones: quiet goals for the long game, kept at the bottom of the
// Money tab. Each is checked a couple of times a second; once earned it
// stays earned.

import { SITES, LEVELS } from './config.js';

const pax = (g) => g.airports.reduce((s, a) => s + a.paxServed, 0);
const revenue = (g) => g.airports.reduce((s, a) => s + a.lifetime.revenue, 0);
const net = (g) => g.airports.reduce((s, a) => s + (a.perMin.operating || 0), 0) / 60;
const anyAp = (g, f) => g.airports.some(f);
const usesBuilt = (g) => {
  const seen = new Set();
  for (const a of g.airports) {
    for (const u of Object.values(a.parking)) seen.add(u);
    if (Object.keys(a.hangars || {}).length) seen.add('hangar');
  }
  return seen;
};

// [id, title, description, test(game), progress(game) -> [value, target]]
export const MILESTONES = [
  ['pax1k', 'First thousand', '1,000 passengers through your airports', (g) => pax(g) >= 1e3, (g) => [pax(g), 1e3]],
  ['pax100k', 'Busy skies', '100,000 passengers', (g) => pax(g) >= 1e5, (g) => [pax(g), 1e5]],
  ['pax1m', 'A million travellers', '1,000,000 passengers', (g) => pax(g) >= 1e6, (g) => [pax(g), 1e6]],
  ['pax10m', 'Ten million', '10,000,000 passengers', (g) => pax(g) >= 1e7, (g) => [pax(g), 1e7]],
  ['pax100m', 'A nation on the move', '100,000,000 passengers', (g) => pax(g) >= 1e8, (g) => [pax(g), 1e8]],
  ['ap2', 'Second base', 'Own two airports', (g) => g.airports.length >= 2, (g) => [g.airports.length, 2]],
  ['ap4', 'Regional network', 'Own four airports', (g) => g.airports.length >= 4, (g) => [g.airports.length, 4]],
  ['apAll', 'Coast to coast', `Own all ${SITES.length} airports`, (g) => g.airports.length >= SITES.length, (g) => [g.airports.length, SITES.length]],
  ['hub', 'The hub', 'Own Mid-Continent International', (g) => anyAp(g, (a) => SITES[a.siteIndex].hub), null],
  ['lvl10', 'Top of the table', `Take an airport to level ${LEVELS.length - 1}`, (g) => anyAp(g, (a) => a.level >= LEVELS.length - 1), (g) => [Math.max(...g.airports.map((a) => a.level)), LEVELS.length - 1]],
  ['net1k', 'Money machine', 'Earn $1,000 a second across the company', (g) => net(g) >= 1000, (g) => [Math.max(0, net(g)), 1000]],
  ['net100k', 'Printing money', 'Earn $100,000 a second', (g) => net(g) >= 1e5, (g) => [Math.max(0, net(g)), 1e5]],
  ['rev1b', 'Billionaire', '$1 billion earned in all', (g) => revenue(g) >= 1e9, (g) => [revenue(g), 1e9]],
  ['profitAll', 'In the black', 'Every airport making money at once (three or more)', (g) => g.airports.length >= 3 && g.airports.every((a) => (a.perMin.operating || 0) > 0 && a.t > 120), null],
  ['punctual', 'Like clockwork', '95% on time at an airport with 10 or more routes', (g) => anyAp(g, (a) => a.contracts.length >= 10 && a.rolling.otp >= 0.95), null],
  ['alliance', 'Allied', 'Sign an alliance package', (g) => (g.alliancesSigned || 0) >= 1, null],
  ['alliance5', 'The alliance of choice', 'Sign five alliance packages', (g) => (g.alliancesSigned || 0) >= 5, (g) => [g.alliancesSigned || 0, 5]],
  ['threeRunways', 'Three runways', 'Two parallel runways and a crosswind at one airport', (g) => anyAp(g, (a) => a.upgrades.runway2 && a.upgrades.crosswind), null],
  ['everyUse', 'Something for everyone', 'A garage, hotel, rental centre, solar farm and hangar somewhere', (g) => ['garage', 'hotel', 'rental', 'solar', 'hangar'].every((u) => usesBuilt(g).has(u)), (g) => [['garage', 'hotel', 'rental', 'solar', 'hangar'].filter((u) => usesBuilt(g).has(u)).length, 5]],
  ['fullHouse', 'Full house', 'Eight terminals at one airport', (g) => anyAp(g, (a) => a.terminals.length >= 8), (g) => [Math.max(...g.airports.map((a) => a.terminals.length)), 8]],
].map(([id, name, desc, test, progress]) => ({ id, name, desc, test, progress }));

// Returns the milestones earned just now.
export function checkMilestones(game) {
  game.milestones = game.milestones || {};
  const fresh = [];
  for (const m of MILESTONES) {
    if (game.milestones[m.id]) continue;
    let ok = false;
    try { ok = m.test(game); } catch { ok = false; }
    if (ok) { game.milestones[m.id] = Date.now(); fresh.push(m); }
  }
  return fresh;
}
