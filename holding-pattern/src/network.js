// The company level: alliance offers that span several of your airports.
// Each is a package of routes, one per airport, signed or declined as one,
// with a premium fee and a big joint bonus.

import { ALLIANCE, AIRCRAFT } from './config.js';
import * as S from './sim.js';

export function updateNetwork(game, dt) {
  game.netT = (game.netT || 0) + dt;
  game.alliances = (game.alliances || []).filter((a) => a.expires > game.netT);
  if (game.airports.length < ALLIANCE.minAirports) return;
  if (game.nextAllianceAt == null) game.nextAllianceAt = game.netT + ALLIANCE.every[0];
  if (game.netT < game.nextAllianceAt) return;
  game.nextAllianceAt = game.netT + ALLIANCE.every[0] + Math.random() * (ALLIANCE.every[1] - ALLIANCE.every[0]);
  if (game.alliances.length >= 2) return;
  const a = rollAlliance(game);
  if (a) {
    game.alliances.push(a);
    game.allianceNews = a; // the UI announces it once
  }
}

function rollAlliance(game) {
  const [name, color] = ALLIANCE.names[Math.floor(Math.random() * ALLIANCE.names.length)];
  const n = Math.min(game.airports.length, ALLIANCE.legs[0] + Math.floor(Math.random() * (ALLIANCE.legs[1] - ALLIANCE.legs[0] + 1)));
  const picks = game.airports.map((ap, i) => i).sort(() => Math.random() - 0.5).slice(0, n).sort((x, y) => x - y);
  const legs = [];
  let bonus = 0;
  for (const i of picks) {
    const ap = game.airports[i];
    // a route this airport can take: roll until the aircraft fits its gates
    let o = null;
    for (let k = 0; k < 6 && (!o || S.classAllowed(ap, o.cls)); k++) o = S.rollOffer(ap, game);
    if (!o || S.classAllowed(ap, o.cls)) continue;
    o.paxFee = Math.round(o.paxFee * ALLIANCE.feeBonus * 10) / 10;
    o.airline = name; o.color = color; o.alliance = name;
    o.code = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    bonus += o.bonus;
    o.bonus = 0;
    legs.push({ ap: i, offer: o });
  }
  if (legs.length < 2) return null;
  return { id: `al-${Math.floor(game.netT)}-${Math.floor(Math.random() * 1e6)}`, name, color, legs, bonus: Math.round(bonus * ALLIANCE.bonusMult / 100) * 100, expires: game.netT + ALLIANCE.life };
}

// Where each leg would go and whether it fits, for the offer card.
export function allianceFits(game, a) {
  return a.legs.map((l) => ({ ...l, airport: game.airports[l.ap], fit: S.offerFit(game.airports[l.ap], l.offer) }));
}

export function acceptAlliance(game, id) {
  const a = (game.alliances || []).find((x) => x.id === id);
  if (!a) return 'That offer has expired';
  const fits = allianceFits(game, a);
  const stuck = fits.find((f) => !f.fit.slot);
  if (stuck) return `${stuck.airport.name} can't take the ${AIRCRAFT[stuck.offer.cls].name.toLowerCase()}: ${stuck.fit.why}`;
  for (const f of fits) {
    f.airport.offers.push(f.offer);
    S.acceptOffer(game, f.airport, f.offer.id, f.fit.slot);
  }
  S.earn(game, fits[0].airport, 'bonus', a.bonus);
  game.alliances = game.alliances.filter((x) => x !== a);
  game.alliancesSigned = (game.alliancesSigned || 0) + 1;
  return null;
}

export function declineAlliance(game, id) {
  game.alliances = (game.alliances || []).filter((x) => x.id !== id);
}
