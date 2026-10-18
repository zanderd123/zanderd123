// Everything in the DOM: the top bar, the ops board, the management panel
// and its detail views. The panel is rebuilt from state about once a second
// and handles clicks by delegation, so nothing here keeps its own copy of
// the game.

import {
  AIRCRAFT, CONNECTORS, CONNECTOR_ORDER, UPGRADES, UPGRADE_ORDER, STAFFING,
  TERMINAL, LEVELS, SITES, PAX, CONTRACTS, PARKING, LANDSIDE, HANGAR, DEMOLISH_REFUND, MANAGER,
} from './config.js';
import { SLOTS, SLOT_ORDER, PLOTS, PLOT_ORDER, TERMINAL_CODES, PARKING_SITES, PARKING_ORDER, connectorRoute } from './layout.js';
import { fieldName, siteFields, EXPAND_TERMINALS } from './hub.js';
import * as S from './sim.js';
import { money, num, duration, pathLength, clamp, rate, every } from './util.js';
import { advise, key as fixKey, offerUnlockFixes } from './advisor.js';
import { helpHtml } from './help.js';
import { MILESTONES } from './milestones.js';
import { allianceFits } from './network.js';
import { activeAirport } from './game.js';

const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const ui = {
  tab: 'advisor',
  detail: null,       // { kind, id }
  buildChoice: {},    // slot -> connector type chosen in the build view
  armed: null,        // two-step confirm key
  armedUntil: 0,
  lastHtml: '',
  holding: false,
  game: null,
  onAction: null,
};

// ------------------------------------------------------------------ helpers

function pct(u) { return `${Math.round(u * 100)}%`; }
function level(u) { return u >= 1 ? 'bad' : u >= 0.8 ? 'warn' : ''; }
function barHtml(before, after = null) {
  const b = clamp(before, 0, 1.2) / 1.2 * 100;
  const cls = level(after ?? before);
  let html = `<div class="bar ${cls}"><i style="width:${b.toFixed(1)}%"></i>`;
  if (after != null && after > before) html += `<i class="after" style="left:${b.toFixed(1)}%;width:${((clamp(after, 0, 1.2) - clamp(before, 0, 1.2)) / 1.2 * 100).toFixed(1)}%"></i>`;
  return html + '<b style="left:' + (100 / 1.2).toFixed(1) + '%"></b></div>';
}
function canAfford(cost) { return ui.game.cash >= cost; }
function priceBtn(label, act, cost, extra = '', cls = '') {
  return `<button type="button" class="btn ${cls}" data-act="${act}" ${extra} ${canAfford(cost) ? '' : 'disabled'}>${label}<span class="price">${money(cost)}</span></button>`;
}
function armBtn(key, label, armedLabel, act, extra = '') {
  const armed = ui.armed === key && performance.now() < ui.armedUntil;
  return `<button type="button" class="btn danger ${armed ? 'arm' : ''}" data-act="${armed ? act : 'arm'}" data-key="${key}" ${extra}>${armed ? armedLabel : label}</button>`;
}
// Reset: erase the saved game and start again at Pinewood. Two taps, so
// it can't happen by accident.
const resetBtn = () => armBtn('wipe', 'Reset game', 'Tap again to erase everything', 'wipe');
function resetBlock() {
  return `<h3 class="sec">Found a bug?</h3><p class="note">Tell us what happened: the report includes the game details that help fix it.</p><div class="btns"><button type="button" class="btn" data-act="bug">Report a bug</button></div>
  <h3 class="sec">Reset game</h3><p class="note">Start again from the beginning: one runway at Pinewood and $50,000. This erases every airport, all your money and your milestones, and can't be undone. To keep a copy first, use <b>Copy save code</b> in the Money tab.</p><div class="btns">${resetBtn()}</div>`;
}
function stars(rep) {
  const n = rep / 20;
  return `${n.toFixed(1)}★`;
}

// ------------------------------------------------------------------ top bar

export function renderTop(game) {
  const ap = activeAirport(game);
  $('apCode').textContent = ap.id;
  $('apName').textContent = ap.name;
  $('apLevel').textContent = `L${ap.level}`;
  $('sCash').textContent = money(game.cash);
  let net = 0;
  for (const a of game.airports) net += a.perMin.operating || 0;
  const sNet = $('sNet');
  sNet.textContent = rate(net, true);
  sNet.className = net > -3 ? 'pos' : 'neg'; // -$0.0/s is no loss
  $('whyBtn').hidden = !(net < -6 && ap.t > 30); // (a rounding-error loss is no alarm)
  $('sRep').textContent = stars(ap.rep);
  $('sOtp').textContent = pct(ap.rolling.otp);
  $('sPax').textContent = num(ap.rolling.landsidePerMin * 2);
  const b = $('offerBadge');
  b.hidden = !ap.offers.length;
  b.textContent = ap.offers.length;
  // the network tab once there is more than one airport; its badge counts
  // what waits elsewhere: offers, and airports losing money
  $('netTab').hidden = game.airports.length < 2;
  let waiting = 0;
  for (const a of game.airports) if (a !== ap) waiting += (a.manager ? 0 : a.offers.length) + ((a.perMin.operating || 0) < 0 && a.t > 60 ? 1 : 0);
  waiting += (game.alliances || []).length;
  $('netBadge').hidden = !waiting;
  $('netBadge').textContent = waiting;
}

// ------------------------------------------------------------------ ops board

export function renderOps(game, clockText) {
  const ap = activeAirport(game);
  const rep = S.loadReport(ap);
  const snap = S.opsSnapshot(ap);
  const rows = [];
  // one row for the runways: at the hub, the busiest of its airfields
  const FS = S.fields(ap);
  let worstRw = 0;
  rep.runways.forEach((r, i) => { if (S.utilisation(r.demand, r.cap) > S.utilisation(rep.runways[worstRw].demand, rep.runways[worstRw].cap)) worstRw = i; });
  const rwR = rep.runways[worstRw], rwU = S.utilisation(rwR.demand, rwR.cap);
  const holdRw = FS[worstRw].holdQueue.filter((p) => p.holdReason === 'runway' || p.holdReason === 'taxi').length;
  rows.push({ k: FS.length > 1 ? 'Runways' : 'Runway', s: holdRw > 2 || rwU >= 1 ? 'bad' : rwU > 0.85 || holdRw ? 'warn' : '',
    v: `${pct(rwU)} of capacity`, sub: `${FS.length > 1 ? `busiest: ${fieldName(ap.siteIndex, rwR.field || '')}, ` : ''}${rwR.demand.toFixed(1)} of ${rwR.cap.toFixed(1)} landings & take-offs a minute${holdRw ? ` · ${holdRw} circling` : ''}` });
  const open = rep.terminals.filter((t) => t.open);
  const gd = open.reduce((s, t) => s + t.gateDemand, 0), gc = open.reduce((s, t) => s + t.gates, 0);
  const worstGate = open.reduce((w, t) => (!w || t.gateDemand / t.gates > w.gateDemand / w.gates ? t : w), null);
  const gU = worstGate ? worstGate.gateDemand / worstGate.gates : 0;
  rows.push({ k: 'Gates', s: snap.holdingForGate > 1 || gU >= 1 ? 'bad' : snap.holdingForGate || gU > 0.85 ? 'warn' : '',
    v: `${pct(gd / Math.max(1, gc))} booked`, sub: snap.holdingForGate ? `${snap.holdingForGate} planes circling for a gate` : worstGate ? `busiest: ${TERMINAL_CODES[worstGate.slot]} at ${pct(gU)}` : '' });
  const secU = S.utilisation(rep.security.demand, rep.security.cap);
  rows.push({ k: 'Security', s: snap.secWait > 45 || secU >= 1 ? 'bad' : snap.secWait > 20 || secU > 0.85 ? 'warn' : '',
    v: `${pct(secU)} of capacity`, sub: `${num(snap.secQueue)} in line · ${duration(snap.secWait)} wait` });
  let worst = null;
  for (const tr of open) {
    if (tr.connCap == null) continue;
    const u = tr.pax / Math.max(1, tr.connCap);
    if (!worst || u > worst.u) worst = { tr, u };
  }
  if (worst) rows.push({ k: 'Connectors', s: worst.u >= 1 ? 'bad' : worst.u > 0.85 ? 'warn' : '', v: `${pct(worst.u)} of capacity`, sub: `busiest: to ${S.nm(ap, SLOTS[worst.tr.slot].name)}` });
  rows.push({ k: 'On time', s: ap.rolling.otp < 0.6 ? 'bad' : ap.rolling.otp < 0.8 ? 'warn' : '', v: pct(ap.rolling.otp), sub: `${ap.contracts.filter((c) => c.unhappyFor > 0).length} unhappy airlines` });
  const net = ap.perMin.operating || 0;
  rows.push({ k: 'Money', s: net < -6 && ap.t > 30 ? 'bad' : '', v: rate(net, true), sub: net < -6 ? 'tap for why' : 'after all running costs' });
  const bd = ap.breakdowns || [];
  if (bd.length) rows.unshift({ k: 'Repairs', s: 'bad', v: bd.length === 1 ? S.breakdownKind(bd[0]).name : `${bd.length} things broken`, sub: ap.manager && bd.every((b) => b.mgrAt != null) ? 'station manager on it' : 'tap to fix' });
  if (ap.weather.stormUntil > ap.t) rows.push({ k: 'Weather', s: 'bad', v: 'Thunderstorm', sub: `runway slowed · clears in ${duration(ap.weather.stormUntil - ap.t)}` });
  const top = ui.advice && ui.advice.issues[0];
  const tip = top && top.sev >= 2 ? `<li class="tip" data-ops="advisor"><span class="dot ${top.sev >= 3 ? 'bad' : 'warn'}"></span><span class="k">Do next</span><span class="v">${esc(ui.advice.best ? ui.advice.best.label : top.title)}<small>open the Advisor</small></span></li>` : '';
  $('opsList').innerHTML = tip + rows.map((r) => `<li data-ops="advisor"><span class="dot ${r.s}"></span><span class="k">${r.k}</span><span class="v">${esc(r.v)}<small>${esc(r.sub)}</small></span></li>`).join('');
  $('opsClock').textContent = clockText;
}

// ------------------------------------------------------------------ panel

export function renderPanel(force = false) {
  if (!force && ui.holding) return;
  const ae = document.activeElement;
  // not while the player is choosing or typing (a redraw would wipe it)
  if (!force && ae && /^(SELECT|TEXTAREA|INPUT)$/.test(ae.tagName) && $('panelBody').contains(ae)) return;
  const game = ui.game;
  const ap = activeAirport(game);
  let html;
  ui.advice = advise(game, ap);
  // A selected aircraft that has left: back to the tab underneath.
  if (ui.detail && ui.detail.kind === 'plane' && !S.allPlanes(ap).includes(ui.detail.plane)) ui.detail = null;
  if (ui.detail) html = renderDetail(game, ap, ui.detail);
  else if (ui.tab === 'advisor') html = renderAdvisor(game, ap);
  else if (ui.tab === 'network') html = renderNetwork(game);
  else if (ui.tab === 'help') html = helpHtml() + resetBlock();
  else if (ui.tab === 'contracts') html = renderContracts(game, ap);
  else if (ui.tab === 'build') html = renderBuild(game, ap);
  else if (ui.tab === 'ops') html = renderOperations(game, ap);
  else html = renderFinance(game, ap);
  if (html !== ui.lastHtml) {
    $('panelBody').innerHTML = html;
    ui.lastHtml = html;
  }
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', !ui.detail && b.dataset.tab === ui.tab);
}

// ------------------------------------------------------------------ contracts

function forecastRows(ap, o, slot) {
  const before = S.loadReport(ap);
  const extra = { ...o, terminal: slot };
  const after = S.loadReport(ap, extra);
  const rows = [];
  const rb = S.runwayFor(before, slot), ra = S.runwayFor(after, slot);
  rows.push([rb.field === 'X' ? 'Star runways' : rb.field ? `Runway (${fieldName(ap.siteIndex, rb.field)})` : 'Runway', rb.demand / rb.cap, ra.demand / ra.cap]);
  const tb = before.terminals.find((t) => t.slot === slot), ta = after.terminals.find((t) => t.slot === slot);
  if (tb) rows.push([`Gates ${TERMINAL_CODES[slot]}`, tb.gateDemand / tb.gates, ta.gateDemand / ta.gates]);
  rows.push(['Security', before.security.demand / before.security.cap, after.security.demand / after.security.cap]);
  if (tb && tb.connCap != null) rows.push([`Connector ${TERMINAL_CODES[slot]}`, tb.pax / Math.max(1, tb.connCap), ta.pax / Math.max(1, ta.connCap)]);
  rows.push(['Parking', before.parking.demand / before.parking.cap, after.parking.demand / after.parking.cap]);
  ui.lastOverload = rows.filter(([k, b, a]) => a >= 1 && k !== 'Parking').map(([k]) => k);
  return `<table class="fc">${rows.map(([k, b, a]) => `<tr><td>${k}</td><td>${barHtml(b, a)}</td><td class="num ${a >= 1 ? 'neg' : ''}">${pct(b)}→${pct(a)}</td></tr>`).join('')}</table>`;
}

// A button that applies one of the advisor's fixes.
function fixButton(f, cls = '', apIndex = null) {
  const data = Object.entries(f.data || {}).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ') + (apIndex != null ? ` data-ap="${apIndex}"` : '');
  const paid = f.cost > 0;
  const dis = paid && !canAfford(f.cost) ? 'disabled' : '';
  return `<button type="button" class="btn ${cls}" data-act="${f.act}" ${data} ${dis}>${esc(f.label)}${paid ? `<span class="price">${money(f.cost)}</span>` : ''}</button>`;
}

function recTag(f) {
  return ui.advice && ui.advice.recommended.has(fixKey(f)) ? '<span class="tag rec">Recommended</span>' : '';
}

// ------------------------------------------------------------------ advisor

// ------------------------------------------------------------------ network

// Every airport at once: how each is doing, the one thing each most needs,
// and every open offer, all actionable from here.
function renderNetwork(game) {
  const rows = game.airports.map((ap, i) => ({ ap, i, adv: i === game.active ? ui.advice : advise(game, ap) }));
  const total = rows.reduce((s, r) => s + (r.ap.perMin.operating || 0), 0);
  const offers = rows.reduce((s, r) => s + r.ap.offers.length, 0);
  let h = `<dl class="board"><div><dt>Airports</dt><dd>${rows.length}</dd></div><div><dt>Net, all</dt><dd class="${total >= 0 ? 'pos' : 'neg'}">${rate(total, true)}</dd></div><div><dt>Open offers</dt><dd>${offers}</dd></div><div><dt>Losing money</dt><dd>${rows.filter((r) => (r.ap.perMin.operating || 0) < -6 && r.ap.t > 60).length}</dd></div></dl>`;
  for (const a of game.alliances || []) {
    const fits = allianceFits(game, a);
    const allFit = fits.every((f) => f.fit.fits);
    const stuck = fits.find((f) => !f.fit.slot);
    const left = Math.max(0, a.expires - (game.netT || 0));
    h += `<div class="card best"><div class="eyebrow">Alliance offer · ${fits.length} airports · ${duration(left)} left</div>
      <div class="row between"><div class="row"><span class="chip" style="background:${a.color}"></span><div class="title">${esc(a.name)}</div></div><span class="tag ${allFit ? 'green' : 'amber'}">${allFit ? 'Fits' : 'Tight'}</span></div>
      <ul class="list">${fits.map((f) => `<li><div class="what"><b>${f.airport.id} · ${esc(f.offer.city)}</b><span>${AIRCRAFT[f.offer.cls].name} · ${every(f.offer.freq)} · ${f.fit.slot ? `${rate(S.contractValue(f.airport, { ...f.offer, terminal: f.fit.slot }, game))} at ${TERMINAL_CODES[f.fit.slot]}` : ''}${f.fit.fits ? '' : ` · <b class="neg">${esc(f.fit.why)}</b>`}</span></div></li>`).join('')}</ul>
      <p class="note">Premium fees on every route and a joint bonus of <b>${money(a.bonus)}</b>. Signed or declined as one package.</p>
      <div class="btns">${stuck ? `<span class="tag">${esc(stuck.airport.id)} can't take its route yet</span>` : allFit ? `<button type="button" class="btn go" data-act="alliance-accept" data-id="${a.id}">Sign all · bonus <span class="price">${money(a.bonus)}</span></button>` : armBtn('al-' + a.id, `Sign all anyway · ${money(a.bonus)}`, 'Confirm: sign the package', 'alliance-accept', `data-id="${a.id}"`)}<button type="button" class="btn" data-act="alliance-decline" data-id="${a.id}">Decline</button></div>
    </div>`;
  }
  h += `<h3 class="sec">Airports</h3>`;
  for (const { ap, i, adv } of rows) {
    const net = ap.perMin.operating || 0;
    const top = adv.issues.find((x) => x.sev >= 2);
    const state = net < -6 && ap.t > 60 ? '<span class="tag red">Losing money</span>' : top && top.sev >= 3 ? '<span class="tag red">Fix now</span>' : top ? '<span class="tag amber">Fix soon</span>' : '<span class="tag green">Fine</span>';
    h += `<div class="card${i === game.active ? ' best' : ''}">
      <div class="row between"><div><div class="title">${ap.id} · ${esc(ap.name)} <span class="sub">L${ap.level}</span></div></div>${state}</div>
      <dl class="board"><div><dt>Net</dt><dd class="${net > -3 ? 'pos' : 'neg'}">${rate(net, true)}</dd></div><div><dt>On time</dt><dd>${pct(ap.rolling.otp)}</dd></div><div><dt>Routes</dt><dd>${ap.contracts.length}</dd></div><div><dt>Offers</dt><dd>${ap.offers.length}</dd></div></dl>
      ${top ? `<p class="note"><b>${esc(top.title)}.</b></p>` : ''}
      <div class="btns">${adv.best ? fixButton(adv.best, 'go', i) : ''}${i === game.active ? '' : `<button type="button" class="btn" data-act="goto" data-ap="${i}">Go there</button>`}
      <button type="button" class="btn ${ap.manager ? 'arm' : ''}" data-act="manager" data-ap="${i}" data-on="${ap.manager ? 0 : 1}">${ap.manager ? 'Station manager: on' : `Hire station manager · ${rate(MANAGER.salary * S.site(ap).cost)}`}</button></div>
    </div>`;
  }
  h += `<h3 class="sec">Offers everywhere · ${offers}</h3>`;
  if (!offers) h += `<p class="empty">No offers open right now${rows.some((r) => r.ap.manager) ? ' (station managers handle theirs as they come in)' : ''}.</p>`;
  for (const { ap, i } of rows) {
    for (const o of ap.offers) {
      const A = AIRCRAFT[o.cls];
      const fit = S.offerFit(ap, o);
      const val = fit.slot ? S.contractValue(ap, { ...o, terminal: fit.slot }, game) : 0;
      const where = fit.slot ? `${TERMINAL_CODES[fit.slot]} · ${S.nm(ap, SLOTS[fit.slot].name)}` : '';
      h += `<div class="card"><div class="row between"><div class="row"><span class="chip" style="background:${o.color}"></span><div><div class="title">${esc(o.airline)} <span class="sub">at ${ap.id}</span></div><div class="sub">to ${esc(o.city)} · ${A.name} · ${every(o.freq)} · ${rate(val)}</div></div></div>${fit.fits ? '<span class="tag green">Fits</span>' : '<span class="tag amber">Tight</span>'}</div>
        <p class="note">${fit.slot ? (fit.fits ? `Would go to ${esc(where)}; every bar stays comfortable.` : `At ${esc(where)}, ${esc(fit.why)}.`) : esc(fit.why)}</p>
        <div class="btns">${!fit.slot ? '' : fit.fits ? `<button type="button" class="btn go" data-act="accept" data-ap="${i}" data-id="${o.id}" data-slot="${fit.slot}">Sign · bonus <span class="price">${money(o.bonus)}</span></button>` : armBtn('nsign-' + ap.id + o.id, `Sign anyway · bonus ${money(o.bonus)}`, 'Confirm: sign it', 'accept', `data-ap="${i}" data-id="${o.id}" data-slot="${fit.slot}"`)}<button type="button" class="btn" data-act="decline" data-ap="${i}" data-id="${o.id}">Decline</button></div>
      </div>`;
    }
  }
  return h;
}

function renderMilestones(game) {
  const got = game.milestones || {};
  const rows = MILESTONES.map((m) => {
    const done = got[m.id];
    let prog = '';
    if (!done && m.progress) {
      try { const [v, target] = m.progress(game); prog = `<div class="bar" style="margin-top:6px"><i style="width:${(clamp(v / target, 0, 1) * 100).toFixed(1)}%"></i></div><span>${num(v)} of ${num(target)}</span>`; } catch { prog = ''; }
    }
    return `<li class="stack" style="${done ? '' : 'opacity:0.72'}"><div class="what"><b>${done ? '✓ ' : ''}${esc(m.name)}</b><span>${esc(m.desc)}${done ? ` · ${new Date(done).toLocaleDateString()}` : ''}</span>${prog}</div></li>`;
  }).join('');
  return `<button type="button" class="back" data-act="back">◂ Back</button>
  <div class="title" style="font-size:24px">Milestones · ${Object.keys(got).length} of ${MILESTONES.length}</div>
  <p class="note">Nothing to win: just landmarks along the way.</p>
  <ul class="list">${rows}</ul>`;
}

function renderAdvisor(game, ap) {
  const adv = ui.advice;
  const sevTag = ['<span class="tag green">Fine</span>', '<span class="tag">Worth a look</span>', '<span class="tag amber">Fix soon</span>', '<span class="tag red">Fix now</span>'];
  let h = '';
  if (adv.best) {
    h += `<div class="card best"><div class="eyebrow">Best next step</div><div class="title">${esc(adv.best.problem || adv.best.label)}</div>${adv.best.why ? `<div class="sub">${esc(adv.best.why)}</div>` : ''}<div class="btns">${fixButton(adv.best, 'go')}</div></div>`;
  }
  const m = adv.money;
  h += `<dl class="board"><div><dt>Earning</dt><dd>${rate(m.revenue)}</dd></div><div><dt>Spending</dt><dd>${rate(m.costs)}</dd></div><div><dt>Refunds</dt><dd>${rate(m.refunds)}</dd></div><div><dt>Net</dt><dd class="${(ap.perMin.operating || 0) > -3 ? 'pos' : 'neg'}">${rate(ap.perMin.operating || 0, true)}</dd></div></dl>`;
  for (const i of adv.issues) {
    h += `<div class="card sev${i.sev}">
      <div class="row between"><div class="title">${esc(i.title)}</div>${sevTag[i.sev]}</div>
      <p class="note">${esc(i.detail)}</p>
      ${i.tip ? `<p class="note"><b>${esc(i.tip)}</b></p>` : ''}
      ${i.fixes.length ? `<div class="btns">${i.fixes.map((f) => fixButton(f, adv.best && fixKey(f) === fixKey(adv.best) ? 'go' : '')).join('')}</div>` : ''}
      ${i.fixes.some((f) => f.why) ? `<p class="note">${i.fixes.filter((f) => f.why).map((f) => `${esc(f.label)}: ${esc(f.why)}`).join(' · ')}</p>` : ''}
    </div>`;
  }
  return h;
}

function terminalOptions(ap, cls, current) {
  return ap.terminals.filter((T) => S.isOpen(T)).map((T) => {
    const ok = S.terminalSupports(ap, T, cls);
    return `<option value="${T.slot}" ${T.slot === current ? 'selected' : ''} ${ok ? '' : 'disabled'}>${TERMINAL_CODES[T.slot]} · ${S.nm(ap, SLOTS[T.slot].name)}${ok ? '' : ' (no heavy gates)'}</option>`;
  }).join('');
}

function renderContracts(game, ap) {
  const late = ui.advice && ui.advice.delayed;
  let h = `<h3 class="sec">Offers on the table</h3>`;
  if (!ap.offers.length) h += `<p class="empty">No airline is asking right now. New offers arrive every minute or so; a better reputation brings better ones.</p>`;
  for (const o of ap.offers) {
    const A = AIRCRAFT[o.cls];
    const blocked = S.classAllowed(ap, o.cls);
    if (!ui.offerSlot) ui.offerSlot = {};
    const chosen = ui.offerSlot[o.id] && S.terminalBySlot(ap, ui.offerSlot[o.id]);
    const slot = chosen && S.isOpen(chosen) && S.terminalSupports(ap, chosen, o.cls) ? chosen.slot : S.suggestTerminal(ap, o.cls);
    const val = S.contractValue(ap, { ...o, terminal: slot || 'main' }, game);
    const left = o.expires - ap.t;
    h += `<div class="card">
      <div class="row between"><div class="row"><span class="chip" style="background:${o.color}"></span><div><div class="title">${esc(o.airline)}</div><div class="sub">to ${esc(o.city)}${o.network ? ' · <span class="tag">network route</span>' : ''}</div></div></div><span class="tag">${A.short} · ${A.name}</span></div>
      <dl class="board">
        <div><dt>Flights</dt><dd>${every(o.freq)}</dd></div>
        <div><dt>Seats</dt><dd>${Math.round(A.pax * o.load)}</dd></div>
        <div><dt>Fee / pax</dt><dd>$${o.paxFee.toFixed(1)}</dd></div>
        <div><dt>Revenue</dt><dd>${rate(val)}</dd></div>
      </dl>
      ${slot ? forecastRows(ap, o, slot) : (ui.lastOverload = [], '')}
      ${blocked ? `<div class="sign stop" style="font-size:13px">${esc(blocked)}</div><div class="btns">${offerUnlockFixes(ap, o.cls).map((f) => fixButton(f, 'go')).join('')}<button type="button" class="btn" data-act="decline" data-id="${o.id}">Decline</button></div>` : `
      <div class="row between">
        <label class="sub" for="os-${o.id}">Terminal</label>
        <select id="os-${o.id}" data-offer-slot="${o.id}">${terminalOptions(ap, o.cls, slot)}</select>
      </div>
      ${ui.lastOverload.length ? `<p class="note neg">Signing puts ${esc(ui.lastOverload.join(', '))} over capacity: flights will run late and passengers will miss them.</p>` : late ? `<p class="note neg">Flights are already running late (${pct(ap.rolling.otp)} on time). Another route makes every flight later; the Advisor says what is causing it.</p>` : ''}
      <div class="btns">${ui.lastOverload.length || late
        ? armBtn('sign-' + o.id, `Sign anyway · bonus ${money(o.bonus)}`, ui.lastOverload.length ? 'Confirm: overload it' : 'Confirm: sign it anyway', 'accept', `data-id="${o.id}" data-slot="${slot}"`)
        : `<button type="button" class="btn go" data-act="accept" data-id="${o.id}" data-slot="${slot}">Sign · bonus <span class="price">${money(o.bonus)}</span></button>`}<button type="button" class="btn" data-act="decline" data-id="${o.id}">Decline</button></div>`}
      <div class="timer"><i style="width:${clamp(left / CONTRACTS.offerLife, 0, 1) * 100}%"></i></div>
    </div>`;
  }
  h += `<h3 class="sec">Active routes · ${ap.contracts.length}</h3>`;
  if (!ap.contracts.length) h += `<p class="empty">No routes yet.</p>`;
  else h += `<p class="note">When planes queue, <b>priority</b> routes land and push back first (up to ${S.MAX_PRIORITY} per airport), then airlines that are unhappy, then everyone else in turn. Mark the ones that pay most or are close to leaving.</p>`;
  for (const c of ap.contracts) {
    const A = AIRCRAFT[c.cls];
    const otp = c.otpHist.length ? c.otpHist.reduce((a, b) => a + b, 0) / c.otpHist.length : 1;
    const unhappy = c.unhappyFor > 0;
    const status = unhappy
      ? `<span class="tag red">Unhappy · leaves in ${duration(CONTRACTS.leaveAfter - c.unhappyFor)}</span>`
      : otp < 0.75 ? `<span class="tag amber">Watching delays</span>` : `<span class="tag green">Happy</span>`;
    h += `<div class="card">
      <div class="row between"><div class="row"><span class="chip" style="background:${c.color}"></span><div><div class="title">${c.priority ? '★ ' : ''}${esc(c.airline)}</div><div class="sub">${esc(c.city)} · ${A.name} · ${every(c.freq)}</div></div></div>${status}</div>
      <dl class="board">
        <div><dt>On time</dt><dd>${c.otpHist.length ? pct(otp) : '—'}</dd></div>
        <div><dt>Last delay</dt><dd>${c.lastDelay != null ? duration(c.lastDelay) : '—'}</dd></div>
        <div><dt>Flown</dt><dd>${c.flown || 0}</dd></div>
        <div><dt>Revenue</dt><dd>${rate(S.contractValue(ap, c, game))}</dd></div>
      </dl>
      <div class="row between">
        <label class="sub" for="cs-${c.id}">Terminal</label>
        <select id="cs-${c.id}" data-contract-slot="${c.id}">${terminalOptions(ap, c.cls, c.terminal)}</select>
      </div>
      <div class="btns"><button type="button" class="btn ${c.priority ? 'go' : ''}" data-act="priority" data-id="${c.id}" data-on="${c.priority ? '0' : '1'}">${c.priority ? '★ Priority' : '☆ Make priority'}</button>${armBtn('cancel-' + c.id, 'End contract', `Confirm · pay ${money(S.cancelPenalty(ap, c, game))}`, 'cancel', `data-id="${c.id}"`)}</div>
    </div>`;
  }
  return h;
}

// ------------------------------------------------------------------ build

function terminalSummary(ap, T) {
  const rep = S.loadReport(ap).terminals.find((t) => t.slot === T.slot);
  const C = T.connector;
  let state = '';
  if (T.buildLeft > 0) state = `<span class="tag amber">Building · ${duration(T.buildLeft)}</span>`;
  else if (C && C.buildLeft > 0) state = `<span class="tag amber">${CONNECTORS[C.type].name} · ${duration(C.buildLeft)}</span>`;
  else state = `<span class="tag green">Open</span>`;
  return `<div class="card click" data-act="detail" data-kind="terminal" data-id="${T.slot}">
    <div class="row between"><div><div class="title">${TERMINAL_CODES[T.slot]} · ${S.nm(ap, SLOTS[T.slot].name)}</div>
    <div class="sub">${T.gates} gates${T.heavy ? ' · heavy' : ''} · retail L${T.retail + 1}${C ? ` · ${CONNECTORS[C.type].name.toLowerCase()}` : ' · security & curb'}</div></div>${state}</div>
    ${rep && rep.open ? `<table class="fc"><tr><td>Gate load</td><td>${barHtml(rep.gateDemand / rep.gates)}</td><td class="num">${pct(rep.gateDemand / rep.gates)}</td></tr>${rep.connCap != null ? `<tr><td>Connector</td><td>${barHtml(rep.pax / Math.max(1, rep.connCap))}</td><td class="num">${pct(rep.pax / Math.max(1, rep.connCap))}</td></tr>` : ''}</table>` : ''}
  </div>`;
}

// Room to grow: how close the airport is to adding its new airfields, or
// what it has added.
function growBlock(ap) {
  const n = siteFields(ap.siteIndex).length;
  if (S.grown(ap)) {
    const open = siteFields(ap.siteIndex).filter((k) => S.hasField(ap, k)).length;
    return `<h3 class="sec">Room to grow</h3><p class="note">${ap.name} has grown: ${n} new airfields around the old one, ${open} open. Each has its own runway, tower and six terminal sites, reached by tunnel or monorail. Their land is for sale below.</p>`;
  }
  const done = Math.min(EXPAND_TERMINALS, S.growProgress(ap));
  return `<h3 class="sec">Room to grow</h3><p class="note">Build out <b>${EXPAND_TERMINALS} terminals</b> to every gate and ${ap.name} can grow to the size of Mid-Continent: ${n} new airfields, each with its own runway and six terminal sites.</p><div class="bar"><i style="width:${(done / EXPAND_TERMINALS * 100).toFixed(0)}%;background:var(--sign)"></i></div><p class="note">${done} of ${EXPAND_TERMINALS} terminals built out</p>`;
}

function renderBuild(game, ap) {
  let h = `<h3 class="sec">Terminals</h3>`;
  for (const T of ap.terminals) h += terminalSummary(ap, T);
  if (S.canGrow(ap)) h += growBlock(ap);
  const hangars = S.slotList(ap).filter((s) => ap.hangars[s]);
  if (hangars.length) {
    h += `<h3 class="sec">Hangars</h3><ul class="list">`;
    for (const s of hangars) h += `<li><div class="what"><b>${HANGAR.name}</b><span>${S.nm(ap, SLOTS[s].name)}</span></div><button type="button" class="btn" data-act="detail" data-kind="slot" data-id="${s}">Open</button></li>`;
    h += `</ul>`;
  }
  const free = S.slotList(ap).filter((s) => !S.terminalBySlot(ap, s) && !ap.hangars[s] && ap.plots[SLOTS[s].plot] && S.slotAvailable(ap, s));
  if (free.length) {
    h += `<h3 class="sec">Open sites</h3><ul class="list">`;
    for (const s of free) h += `<li><div class="what"><b>${S.nm(ap, SLOTS[s].name)}</b><span>${SLOTS[s].field ? `${fieldName(ap.siteIndex, SLOTS[s].field)}: reached by tunnel or monorail` : SLOTS[s].row === 'mid' ? 'Midfield: across the apron from the main terminal' : SLOTS[s].adjacent ? 'Next to the main terminal: a walkway can reach it' : 'Main row, further out'}</span></div><button type="button" class="btn go" data-act="detail" data-kind="slot" data-id="${s}">Plan · ${money(S.terminalCost(ap, s))}+</button></li>`;
    h += `</ul>`;
  } else {
    h += `<p class="note">Buy more land to open new terminal sites.</p>`;
  }
  h += `<h3 class="sec">Landside: car parks, hotels, rentals, solar</h3>${parkingBlock(ap)}`;
  h += `<h3 class="sec">Land</h3><ul class="list">`;
  for (const id of S.plotList(ap)) {
    const P = PLOTS[id];
    const owned = ap.plots[id];
    const what = plotOpens(ap, id).join(', ');
    const needs = P.needs && !ap.plots[P.needs] ? `Buy the ${S.nm(ap, PLOTS[P.needs].name)} first` : null;
    h += `<li><div class="what"><b>${S.nm(ap, P.name)} ${recTag({ act: 'plot', data: { id } })}</b><span>${owned ? 'Owned' : `Opens: ${what}`}${owned ? '' : ` · tax ${rate(14 * S.site(ap).cost)}`}</span></div>${owned ? '<span class="tag green">Owned</span>' : needs ? `<span class="tag">${needs}</span>` : priceBtn('Buy', `plot" data-id="${id}`, S.plotCost(ap, id))}</li>`;
  }
  h += `</ul>`;
  h += `<h3 class="sec">Airfield & landside</h3><ul class="list">`;
  for (const k of UPGRADE_ORDER) {
    const U = UPGRADES[k];
    const why = S.upgradeBlocked(ap, k);
    if (why === 'Not at this airport') continue;
    h += `<li><div class="what"><b>${U.name} ${recTag({ act: 'upgrade', data: { id: k } })}</b><span>${U.desc}</span></div>${ap.upgrades[k] ? '<span class="tag green">Built</span>' : why ? `<span class="tag">${esc(why)}</span>` : priceBtn('Build', `upgrade" data-id="${k}`, S.upgradeCost(ap, k))}</li>`;
  }
  h += `</ul>`;
  return h;
}

function connectorCard(ap, type, slot, chosen, current = null) {
  const def = CONNECTORS[type];
  const allowed = S.connectorAllowed(type, slot);
  const route = connectorRoute(type, slot, ap.siteIndex);
  const len = pathLength(route);
  const fake = { type, level: 0, buses: type === 'shuttle' ? 2 : 0, buildLeft: 0, len, route };
  const cap = S.connectorCap(fake) * 60;
  const trip = S.connectorTravel(fake);
  const cost = S.connectorBuildCost(type, slot, ap);
  const upkeep = S.connectorUpkeep(fake) * S.site(ap).cost;
  const crosses = def.apron && SLOTS[slot].row === 'mid';
  return `<button type="button" class="conn ${chosen ? 'on' : ''}" data-act="pick-conn" data-slot="${slot}" data-type="${type}" ${allowed && type !== current ? '' : 'disabled'}>
    <h4>${def.name}${type === current ? ' · current' : ''}</h4>
    <dl>
      <dt>Build</dt><dd>${money(cost)}</dd>
      <dt>Running</dt><dd>${rate(upkeep)}</dd>
      <dt>Capacity</dt><dd>${num(cap)} pax/min${type === 'shuttle' ? '*' : ''}</dd>
      <dt>Trip</dt><dd>${duration(trip)}</dd>
      <dt>Build time</dt><dd>${duration(def.buildTime)}</dd>
      <dt>Parking lost</dt><dd>${def.land ? `${def.land}/min` : 'none'}</dd>
    </dl>
    <p>${allowed ? def.blurb : SLOTS[slot].field ? 'Cannot cross the runways to reach this site.' : 'Only reaches the piers next to the main terminal.'}${crosses ? ' <b style="color:var(--amber)">Crosses the apron lane here.</b>' : ''}${type === 'shuttle' ? ' *with 2 buses; add more later.' : ''}</p>
  </button>`;
}

function renderSlotDetail(game, ap, slot) {
  const S0 = SLOTS[slot];
  const chosen = ui.buildChoice[slot] || (S0.field ? 'tunnel' : S0.adjacent ? 'walkway' : 'shuttle');
  const tcost = S.terminalCost(ap, slot);
  const ccost = S.connectorBuildCost(chosen, slot, ap);
  let h = `<button type="button" class="back" data-act="back">◂ Back</button>
  <div class="title" style="font-size:24px">${S.nm(ap, S0.name)}</div>
  <p class="note">A new terminal opens with ${Math.min(TERMINAL.startGates, S.maxGates(ap, slot))} gates${S.maxGates(ap, slot) > TERMINAL.startGates ? ` (room for ${S.maxGates(ap, slot)})` : ''}. Passengers clear security in the main terminal, so they need a way to get here. Each terminal also adds an air traffic controller, ground crews, climate control and cleaning to your running costs.</p>
  <dl class="board">
    <div><dt>Terminal</dt><dd>${money(tcost)}</dd></div>
    <div><dt>Connector</dt><dd>${money(ccost)}</dd></div>
    <div><dt>Builds in</dt><dd>${duration(Math.max(TERMINAL.buildTime, CONNECTORS[chosen].buildTime))}</dd></div>
    <div><dt>New staff</dt><dd>~${rate(S.site(ap).cost * (95 + 18 * 3 + 40 + 33 + 30))}</dd></div>
  </dl>
  <h3 class="sec">How will passengers get there?</h3>
  <div class="conn-grid">${CONNECTOR_ORDER.map((t) => connectorCard(ap, t, slot, t === chosen)).join('')}</div>
  <div class="btns">${priceBtn('Build terminal', `build" data-slot="${slot}" data-type="${chosen}`, tcost + ccost, '', 'go')}</div>
  <h3 class="sec">Or: ${HANGAR.name.toLowerCase()}</h3>
  <p class="note">${HANGAR.desc} No gates, no passengers: ${rate(HANGAR.income * S.site(ap).rev)} of outside work, ${rate(HANGAR.upkeep * S.site(ap).cost)} to run. ${S.hangarCount(ap) ? `You have ${S.hangarCount(ap)}.` : ''}</p>
  <div class="btns">${S.hangarBlocked(ap, slot) ? `<span class="tag">${esc(S.hangarBlocked(ap, slot))}</span>` : priceBtn('Build hangar', `hangar" data-slot="${slot}`, S.hangarCost(ap))}</div>`;
  return h;
}

function renderHangarDetail(game, ap, slot) {
  return `<button type="button" class="back" data-act="back">◂ Back</button>
  <div class="title" style="font-size:24px">${HANGAR.name} · ${S.nm(ap, SLOTS[slot].name)}</div>
  <p class="note">${HANGAR.desc}</p>
  <dl class="board">
    <div><dt>Hangars</dt><dd>${S.hangarCount(ap)}</dd></div>
    <div><dt>Turnarounds</dt><dd>-${Math.round((1 - Math.pow(HANGAR.turn, Math.min(2, S.hangarCount(ap)))) * 100)}%</dd></div>
    <div><dt>Work</dt><dd>${rate(HANGAR.income * S.site(ap).rev)}</dd></div>
    <div><dt>Running</dt><dd>${rate(HANGAR.upkeep * S.site(ap).cost)}</dd></div>
  </dl>
  <div class="btns">${armBtn('dhangar-' + slot, `Tear down · get back ${money(Math.round(HANGAR.cost * S.site(ap).cost * DEMOLISH_REFUND))}`, 'Confirm: tear it down', 'demolish-hangar', `data-slot="${slot}"`)}</div>
  <p class="note">Tearing it down leaves the site free for a terminal.</p>`;
}

function renderTerminalDetail(game, ap, slot) {
  const T = S.terminalBySlot(ap, slot);
  if (!T) { ui.detail = null; return renderBuild(game, ap); }
  const S0 = SLOTS[slot];
  const rep = S.loadReport(ap).terminals.find((t) => t.slot === slot);
  const C = T.connector;
  const routes = ap.contracts.filter((c) => c.terminal === slot);
  let h = `<button type="button" class="back" data-act="back">◂ Back</button>
  <div class="row between"><div class="title" style="font-size:24px">${TERMINAL_CODES[slot]} · ${S.nm(ap, S0.name)}</div>${T.demolishing ? '<span class="tag red">Closing</span>' : T.buildLeft > 0 ? `<span class="tag amber">Building · ${duration(T.buildLeft)}</span>` : ''}</div>
  ${T.demolishing ? '<p class="note">Being torn down: its routes have moved to other terminals, and it goes as soon as the aircraft at its gates have left.</p>' : ''}
  ${(ap.breakdowns || []).filter((b) => b.slot === slot).map((b) => `<div class="card sev3"><div class="row between"><div class="title">${esc(S.breakdownKind(b).name)}</div><span class="tag red">Broken</span></div><p>${esc(S.breakdownKind(b).what)}${b.mgrAt != null ? ' Your station manager has a crew on it.' : ''}</p><div class="btns">${fixButton({ label: 'Repair it', act: 'repair', data: { id: b.id }, cost: b.cost }, 'go')}</div></div>`).join('')}
  <dl class="board">
    <div><dt>Gates</dt><dd>${T.gates}${T.heavy ? ' heavy' : ''}</dd></div>
    <div><dt>Gate load</dt><dd>${rep ? pct(rep.gateDemand / rep.gates) : '—'}</dd></div>
    <div><dt>People</dt><dd>${num(T.occupancy || 0)}</dd></div>
    <div><dt>Comfort</dt><dd>${num(T.comfort || T.gates * PAX.terminalComfortPerGate)}</dd></div>
  </dl>
  ${T.demolishing ? '' : `<h3 class="sec">Terminal</h3><ul class="list">
    <li><div class="what"><b>Add a gate ${recTag({ act: 'gate', data: { slot } })}</b><span>${T.gates} of ${S.maxGates(ap, slot)} · each gate adds ground crew and climate costs</span></div>${T.gates < S.maxGates(ap, slot) ? priceBtn('Add', `gate" data-slot="${slot}`, S.gateCost(ap, T)) : '<span class="tag">Full</span>'}</li>
    <li><div class="what"><b>Heavy gates ${recTag({ act: 'heavy', data: { slot } })}</b><span>Widebodies and superjumbos need them</span></div>${T.heavy ? '<span class="tag green">Done</span>' : priceBtn('Convert', `heavy" data-slot="${slot}`, S.heavyCost(ap, T))}</li>
    <li><div class="what"><b>Shops & dining · L${T.retail + 1}</b><span>Waiting passengers spend ×${TERMINAL.retailLevels[T.retail].mult}. Crowds spend less.</span></div>${S.retailCost(ap, T) != null ? priceBtn('Upgrade', `retail" data-slot="${slot}`, S.retailCost(ap, T)) : '<span class="tag">Max</span>'}</li>
  </ul>`}`;
  // nothing more to spend on a terminal that is closing
  if (C && !T.demolishing) {
    const def = CONNECTORS[C.type];
    const cap = S.connectorCap(C, ap) * 60;
    h += `<h3 class="sec">Connector · ${def.name}</h3>
    <dl class="board">
      <div><dt>Capacity</dt><dd>${num(cap)}/min</dd></div>
      <div><dt>Demand</dt><dd>${rep ? num(rep.pax) : 0}/min</dd></div>
      <div><dt>Trip</dt><dd>${duration(S.connectorTravel(C))}</dd></div>
      <div><dt>Running</dt><dd>${rate(S.connectorUpkeep(C) * S.site(ap).cost)}</dd></div>
    </dl>
    <p class="note">${num(C.outSize || 0)} waiting to go out · ${num(C.inSize || 0)} waiting to come back${C.brokenUntil > ap.t ? ' · <b class="neg">broken down</b>' : ''}</p>
    <div class="btns">`;
    if (C.type === 'shuttle') {
      const b = def.bus;
      h += priceBtn(`Add bus (${C.buses}/${b.max})`, `bus+" data-slot="${slot}`, Math.round(b.cost * S.site(ap).cost));
      h += `<button type="button" class="btn" data-act="bus-" data-slot="${slot}" ${C.buses > 1 ? '' : 'disabled'}>Sell a bus</button>`;
    } else if (def.upgrade && !C.level) {
      h += priceBtn(def.upgrade.name, `connup" data-slot="${slot}`, Math.round(def.upgrade.cost * S.site(ap).cost));
    } else if (def.upgrade) {
      h += `<span class="tag green">${def.upgrade.name}</span>`;
    }
    h += `</div>`;
    if (T.pendingConnector) {
      h += `<p class="note">Replacing with a ${CONNECTORS[T.pendingConnector.type].name.toLowerCase()}: ${duration(T.pendingConnector.buildLeft)} to go. The current one keeps running until then.</p>`;
    } else {
      const chosen = ui.buildChoice['re-' + slot];
      h += `<h3 class="sec">Replace connector</h3><div class="conn-grid">${CONNECTOR_ORDER.map((t) => connectorCard(ap, t, slot, t === chosen, C.type).replace('data-act="pick-conn"', 'data-act="pick-reconn"')).join('')}</div>`;
      if (chosen && chosen !== C.type) h += `<div class="btns">${priceBtn(`Switch to ${CONNECTORS[chosen].name.toLowerCase()}`, `reconn" data-slot="${slot}" data-type="${chosen}`, S.connectorBuildCost(chosen, slot, ap), '', 'go')}</div>`;
    }
  } else {
    h += `<h3 class="sec">Security checkpoint</h3>${securityBlock(ap)}`;
  }
  if (slot !== 'main' && !T.demolishing) {
    const why = S.demolishBlocked(ap, slot);
    h += `<h3 class="sec">Tear it down</h3><p class="note">Its routes move to your other terminals at once (you can move them again in Contracts), and the site is free for a new terminal or a hangar. You get back ${Math.round(DEMOLISH_REFUND * 100)}% of the building and its connector.</p>
    <div class="btns">${why ? `<span class="tag">${esc(why)}</span>` : armBtn('dterm-' + slot, `Tear down · get back ${money(S.terminalRefund(ap, T))}`, 'Confirm: tear it down', 'demolish', `data-slot="${slot}"`)}</div>`;
  }
  h += `<h3 class="sec">Routes using this terminal · ${routes.length}</h3>`;
  h += routes.length ? `<ul class="list">${routes.map((c) => `<li><div class="what"><b>${esc(c.airline)} · ${esc(c.city)}</b><span>${AIRCRAFT[c.cls].name} · ${every(c.freq)}</span></div><span class="mono">${c.otpHist.length ? pct(c.otpHist.reduce((a, b) => a + b, 0) / c.otpHist.length) : '—'}</span></li>`).join('')}</ul>` : '<p class="empty">None. Assign routes from the Contracts tab.</p>';
  return h;
}

function securityBlock(ap) {
  const rep = S.loadReport(ap);
  return `<table class="fc"><tr><td>Load</td><td>${barHtml(rep.security.demand / rep.security.cap)}</td><td class="num">${pct(rep.security.demand / rep.security.cap)}</td></tr></table>
  <p class="note">${ap.securityLanes} lanes screen ${num(rep.security.cap)} passengers a minute against ${num(rep.security.demand)} booked. ${num(ap.secQueue || 0)} in line now.</p>
  ${recTag({ act: 'lane+', data: {} })}
  <div class="btns">${ap.securityLanes < S.maxLanes(ap) ? priceBtn('Open a lane', 'lane+', S.laneCost(ap)) : ''}<button type="button" class="btn" data-act="lane-" ${ap.securityLanes > 1 ? '' : 'disabled'}>Close a lane</button></div>`;
}

// Landside sites: what stands there, what it could become, and what each
// choice would bring at today's traffic.
const USE_NAMES = { lot: 'Surface car park', garage: 'Parking garage' };
const useName = (u) => USE_NAMES[u] || LANDSIDE[u].name;
function siteGain(ap, id, use) {
  const rep = S.loadReport(ap);
  const rev = S.site(ap).rev;
  if (use === 'lot' || use === 'garage') return `+${num(S.parkingSiteCap(id, use) - S.parkingSiteCap(id, ap.parking[id]))} drivers/min`;
  const L = LANDSIDE[use];
  if (use === 'solar') {
    const hvac = ap.costLines.find((l) => l.key === 'hvac');
    return `saves ~${rate((hvac ? hvac.v : 0) * (1 - L.hvac))}`;
  }
  return `~${rate(Math.min(rep.security.demand * L.share, L.cap) * L.perPax * rev)}`;
}
function siteRow(ap, id, detail = false) {
  const P = PARKING_SITES[id];
  const u = ap.parking[id];
  const owned = ap.plots[P.plot];
  const now = u ? `${useName(u)}${u === 'lot' || u === 'garage' ? ` · ${num(S.parkingSiteCap(id, u))} drivers/min` : ''}` : owned ? 'Empty land' : `On the ${S.nm(ap, PLOTS[P.plot].name)}`;
  let btns = '';
  const kept = !S.parkingAvailable(ap, id);
  if (kept && u) {
    // built before this land was kept for the crosswind runway
    const back = S.landsideRefund(ap, id);
    btns = `<span class="tag amber">Kept for the crosswind runway</span>${armBtn('dsite-' + id, `Tear down${back ? ` · get back ${money(back)}` : ''}`, 'Confirm: tear it down', 'demolish-site', `data-id="${id}"`)}`;
  } else if (!owned) btns = `<span class="tag">Buy the ${esc(S.nm(ap, PLOTS[P.plot].name))} first</span>`;
  else if (!kept) {
    const opts = S.landsideOptions(ap, id);
    for (const use of detail ? opts : opts.slice(0, u ? 1 : 2)) {
      btns += priceBtn(`${use === 'garage' ? 'Garage' : useName(use)} · ${siteGain(ap, id, use)}`, `landside" data-id="${id}" data-use="${use}`, S.landsideCost(ap, id, use));
    }
    if (!detail && !u && opts.length > 2) btns += `<button type="button" class="btn" data-act="detail" data-kind="parking" data-id="${id}">More choices</button>`;
    if (u && detail) {
      const back = S.landsideRefund(ap, id);
      btns += armBtn('dsite-' + id, `Tear down${back ? ` · get back ${money(back)}` : ''}`, 'Confirm: tear it down', 'demolish-site', `data-id="${id}"`);
    }
  }
  return `<li class="stack"><div class="what"><b>${P.code} · ${S.nm(ap, P.name)} ${recTag({ act: 'parking', data: { id } })}</b><span>${now}</span></div><div class="btns">${btns}</div></li>`;
}

function parkingBlock(ap) {
  const rep = S.loadReport(ap);
  return `<table class="fc"><tr><td>Car parks</td><td>${barHtml(rep.parking.demand / rep.parking.cap)}</td><td class="num">${pct(rep.parking.demand / rep.parking.cap)}</td></tr></table>
  <p class="note">${num(rep.parking.demand)} drivers a minute want to park; ${num(rep.parking.cap)} fit. Each parcel of land has a landside site: a car park (a garage can go on top later), an airport hotel, a rental car centre or a solar farm. Open a site to see every choice, or to tear down what is there.</p>
  <ul class="list">${S.parkingList(ap).filter((id) => (S.parkingAvailable(ap, id) || ap.parking[id]) && (!PARKING_SITES[id].field || ap.plots[PARKING_SITES[id].plot] || ap.parking[id])).map((id) => `<li class="stack click" data-act="detail" data-kind="parking" data-id="${id}" style="cursor:pointer">${siteRow(ap, id).slice('<li class="stack">'.length)}`).join('')}</ul>`;
}

function renderParkingDetail(game, ap, id) {
  const P = PARKING_SITES[id];
  const opts = LANDSIDE_LIST.map((u) => `<li><div class="what"><b>${useName(u)}</b><span>${u === 'lot' ? 'Cheap, quick. A garage can go on top later.' : LANDSIDE[u].desc}</span></div></li>`).join('');
  return `<button type="button" class="back" data-act="back">◂ Back</button>
  <div class="title" style="font-size:24px">${P.code} · ${S.nm(ap, P.name)}</div>
  <ul class="list">${siteRow(ap, id, true)}</ul>
  <h3 class="sec">What a landside site can be</h3><ul class="list">${opts}</ul>
  <p class="note">Tearing something down gives back ${Math.round(DEMOLISH_REFUND * 100)}% of what it cost and leaves the site empty for something else.</p>`;
}
const LANDSIDE_LIST = ['lot', 'hotel', 'rental', 'solar'];

// What owning a parcel opens: terminal sites, upgrades, landside sites.
function plotParts(ap, id) {
  return {
    opens: S.slotList(ap).filter((s) => SLOTS[s].plot === id && S.slotAvailable(ap, s)).map((s) => S.nm(ap, SLOTS[s].name)),
    ups: Object.entries(UPGRADES).filter(([k, u]) => u.needsPlot === id && S.upgradeBlocked(ap, k) !== 'Not at this airport').map(([, u]) => u.name),
    lots: S.parkingList(ap).filter((p) => PARKING_SITES[p].plot === id && S.parkingAvailable(ap, p)).map((p) => S.nm(ap, PARKING_SITES[p].name)),
  };
}
function plotOpens(ap, id) {
  const { opens, ups, lots } = plotParts(ap, id);
  return [...(PLOTS[id].opens ? [PLOTS[id].opens] : []), ...opens, ...ups, ...lots];
}

function renderPlotDetail(game, ap, id) {
  const P = PLOTS[id];
  const { opens, ups, lots } = plotParts(ap, id);
  const needs = P.needs && !ap.plots[P.needs] ? S.nm(ap, PLOTS[P.needs].name) : null;
  return `<button type="button" class="back" data-act="back">◂ Back</button>
  <div class="title" style="font-size:24px">${S.nm(ap, P.name)}</div>
  <p class="note">Farmland for now. Owning it opens:</p>
  <ul class="list">${P.opens ? `<li><div class="what"><b>${P.opens}</b><span>A third runway with its own tower, holding stack and taxiways</span></div></li>` : ''}${[...opens.map((o) => `<li><div class="what"><b>${o}</b><span>Terminal site</span></div></li>`), ...ups.map((u) => `<li><div class="what"><b>${u}</b><span>Upgrade</span></div></li>`), ...lots.map((u) => `<li><div class="what"><b>${u}</b><span>Room for a surface lot, later a garage</span></div></li>`)].join('')}${id === 'west' || id === 'east' ? `<li><div class="what"><b>Taxilane</b><span>A second route for aircraft between the runway and the main apron</span></div></li>` : ''}</ul>
  <p class="note">Land carries property tax of ${rate(14 * S.site(ap).cost)} once bought.</p>
  <div class="btns">${ap.plots[id] ? '<span class="tag green">Owned</span>' : needs ? `<span class="tag">Buy the ${needs} first</span>` : priceBtn('Buy land', `plot" data-id="${id}`, S.plotCost(ap, id), '', 'go')}</div>`;
}

function renderRunwayDetail(game, ap) {
  const rep = S.loadReport(ap);
  const snap = S.opsSnapshot(ap);
  return `<button type="button" class="back" data-act="back">◂ Back</button>
  <div class="title" style="font-size:24px">Runway & tower</div>
  <dl class="board">
    <div><dt>Demand</dt><dd>${rep.runway.demand.toFixed(1)}/m</dd></div>
    <div><dt>Runway</dt><dd>${rep.runway.physical.toFixed(1)}/m</dd></div>
    <div><dt>Tower</dt><dd>${rep.runway.atc.toFixed(1)}/m</dd></div>
    <div><dt>Holding</dt><dd>${ap.holdQueue.length}</dd></div>
  </dl>
  ${rep.runways.slice(1).map((r, i) => `<h3 class="sec">${fieldName(ap.siteIndex, r.field)}</h3>
  <dl class="board">
    <div><dt>Demand</dt><dd>${r.demand.toFixed(1)}/m</dd></div>
    <div><dt>Runway${r.field === 'X' ? 's' : ''}</dt><dd>${r.physical.toFixed(1)}/m</dd></div>
    <div><dt>Tower</dt><dd>${r.atc.toFixed(1)}/m</dd></div>
    <div><dt>Holding</dt><dd>${S.fields(ap)[i + 1].holdQueue.length}</dd></div>
  </dl>`).join('')}
  ${rep.runways.length > 1 ? `<p class="note">Each of the hub's airfields has its own runways and tower, and its aircraft never taxi onto another's ground: a route uses the runways of the airfield its terminal is on. The star's three runways land and take off at once; take-offs cross the centre one at a time.</p>` : ''}
  ${ap.upgrades.crosswind ? `<p class="note">The crosswind runway takes the departures from main-terminal-row gates, up to about ${S.XW_DEPARTURES} a minute; everything else uses the parallel runway${ap.upgrades.runway2 ? 's' : ''}. Put busy routes on main-row terminals to use it.</p>` : ''}
  <p class="note">Every flight is two movements: a landing and a take-off. Throughput is the lower of what the runway can physically take and what your controllers can sequence. When arrivals cannot be slotted in they circle in the holding stack ${S.nm(ap, "west")} of the field, burning the airline's time.</p>
  <h3 class="sec">Tower staffing</h3>
  <p class="note">${S.controllers(ap)} controllers on shift: one per runway and one per terminal. Each sequences about ${(rep.runway.atc / Math.max(1, S.controllers(ap))).toFixed(1)} movements a minute.</p>
  ${staffRow(ap, 'atc', 'Controllers')}
  <h3 class="sec">Airfield upgrades</h3>
  <ul class="list">${['radar', 'rapidExits', 'automation', 'cat3', 'longRunway', 'runway2', 'crosswind'].filter((k) => S.upgradeBlocked(ap, k) !== 'Not at this airport').map((k) => { const U = UPGRADES[k]; const why = S.upgradeBlocked(ap, k); return `<li><div class="what"><b>${U.name}</b><span>${U.desc}</span></div>${ap.upgrades[k] ? '<span class="tag green">Built</span>' : why ? `<span class="tag">${esc(why)}</span>` : priceBtn('Build', `upgrade" data-id="${k}`, S.upgradeCost(ap, k))}</li>`; }).join('')}</ul>`;
}

// Why a plane is circling, and what the player can do about it.
export function holdText(ap, p) {
  if (p.state !== 'holding' && p.state !== 'inbound') return null;
  const k = p.holdWhy || p.holdReason;
  if (!k) return null;
  const T = S.terminalBySlot(ap, p.f.terminal);
  const tn = T ? `${TERMINAL_CODES[T.slot]} · ${S.nm(ap, SLOTS[T.slot].name)}` : 'its terminal';
  const W = {
    gate: [`Waiting for a gate: all ${T ? T.gates : ''} gates at ${tn} are taken.`, 'Add gates or a terminal (Build), or move a route to a terminal with free gates (Routes).'],
    exit: ['Waiting for the runway turn-off to clear.', 'Usually brief. Rapid-exit taxiways (Build) clear the runway sooner.'],
    ground: ['Ground control is full: too many planes taxiing in.', 'Faster turnarounds (surge ground staff, hangars) free the taxiways sooner.'],
    tower: ['The tower is at capacity: no controller is free.', 'Radar, automation or surge tower staffing (Staff tab) handle more movements.'],
    sequence: ['In sequence: another plane is cleared to land first.', 'Normal: it lands next if nothing else is in the way.'],
    runway: ['Runway busy: a plane is landing, taking off or turning off.', 'A second runway or rapid exits add capacity.'],
    crossing: ['Planes are crossing the runway.', 'Normal with two runways: it lands once they are across.'],
    turn: ['Take-offs\u2019 turn: landings and take-offs alternate on one runway.', 'A second runway lets landings and take-offs run side by side.'],
  }[k];
  if (!W) return null;
  const c = ap.contracts.find((x) => x.id === p.f.contract);
  const order = c && c.priority ? 'Priority route: lands first.' : c && c.unhappyFor > 0 ? 'Airline unhappy: lands before the others.' : '';
  return { why: W[0], fix: W[1], order, held: p.heldFor || 0 };
}

function renderPlaneDetail(game, ap, p) {
  const f = p.f;
  const A = AIRCRAFT[p.cls];
  const states = {
    inbound: 'Inbound to the approach fix', holding: 'Holding: circling until it can land', final: 'On final approach',
    rollout: 'Landing roll', crossHold: 'Holding short of the main runway', crossing: 'Crossing the main runway',
    taxiIn: 'Taxiing to the gate',
    gate: 'At the gate: turnaround', pushback: 'Pushing back', taxiOut: 'Taxiing to the runway',
    holdShort: 'Waiting for take-off clearance', takeoff: 'Taking off',
  };
  const late = ap.t - f.std;
  return `<button type="button" class="back" data-act="back">◂ Back</button>
  <div class="row"><span class="chip" style="background:${p.color}"></span><div><div class="title" style="font-size:24px">${f.no}</div><div class="sub">${esc(f.city)} · ${A.name}</div></div></div>
  <p class="sign loc" style="margin:12px 0">${states[p.state] || p.state}</p>
  <dl class="board">
    <div><dt>Terminal</dt><dd>${TERMINAL_CODES[f.terminal]}${p.gate >= 0 ? p.gate + 1 : ''}</dd></div>
    <div><dt>Departs</dt><dd>${late < 0 ? 'in ' + duration(-late) : duration(late) + ' late'}</dd></div>
    <div><dt>Boarded</dt><dd>${Math.round(f.boarded)}/${f.expected}</dd></div>
    <div><dt>Turn</dt><dd>${p.state === 'gate' ? duration(Math.max(0, p.turnLeft)) : '—'}</dd></div>
  </dl>
  ${p.busDelay ? `<p class="note">Stopped ${duration(p.busDelay)} for shuttle buses crossing the apron.</p>` : ''}
  ${(() => { const w = holdText(ap, p); return w ? `<div class="card sev2"><div class="title">Why it is circling</div><p>${esc(w.why)}${w.held > 5 ? ` For ${duration(w.held)} so far.` : ''}</p><p class="note">${esc(w.fix)}${w.order ? ` ${esc(w.order)}` : ''}</p></div>` : ''; })()}`;
}

function renderDetail(game, ap, d) {
  if (d.kind === 'slot') return S.terminalBySlot(ap, d.id) ? renderTerminalDetail(game, ap, d.id) : ap.hangars[d.id] ? renderHangarDetail(game, ap, d.id) : renderSlotDetail(game, ap, d.id);
  if (d.kind === 'terminal') return renderTerminalDetail(game, ap, d.id);
  if (d.kind === 'plot') return renderPlotDetail(game, ap, d.id);
  if (d.kind === 'milestones') return renderMilestones(game);
  if (d.kind === 'parking') return renderParkingDetail(game, ap, d.id);
  if (d.kind === 'runway') return renderRunwayDetail(game, ap);
  if (d.kind === 'plane') return renderPlaneDetail(game, ap, d.plane);
  return '';
}

// ------------------------------------------------------------------ operations

function staffRow(ap, dept, label) {
  const cur = ap.staffing[dept];
  const effect = { atc: 'movements sequenced', security: 'passengers screened', ground: 'turnaround speed' }[dept];
  return `<div class="row between" style="margin:6px 0 4px"><b>${label} ${recTag({ act: 'staff', data: { dept } })}</b><div class="seg">${Object.entries(STAFFING).map(([k, v]) => `<button type="button" class="${k === cur ? 'on' : ''}" data-act="staff" data-dept="${dept}" data-level="${k}">${v.label}</button>`).join('')}</div></div>
  <p class="note">${STAFFING[cur].label}: pay ×${STAFFING[cur].cost.toFixed(2)}, ${effect} ×${(dept === 'ground' ? 1 / STAFFING[cur].turn : STAFFING[cur].capacity).toFixed(2)}.</p>`;
}

function renderOperations(game, ap) {
  const rep = S.loadReport(ap);
  let h = `<h3 class="sec">Staffing</h3>
  <p class="note">Lean shifts save wages and cost capacity. Surge shifts cost more and clear queues faster.</p>
  ${staffRow(ap, 'atc', 'Air traffic control')}
  ${staffRow(ap, 'security', 'Security screeners')}
  ${staffRow(ap, 'ground', 'Ground crews')}
  <h3 class="sec">Security checkpoint</h3>${securityBlock(ap)}
  <h3 class="sec">Tower</h3>
  <p class="note">${S.controllers(ap)} controllers (one per runway, one per terminal) sequence ${rep.runway.atc.toFixed(1)} movements a minute. The runway itself takes ${rep.runway.physical.toFixed(1)}.${rep.runways.length > 1 ? ' The hub\'s other airfields have their own towers: see the runway details.' : ''}</p>
  <div class="btns"><button type="button" class="btn" data-act="detail" data-kind="runway">Runway & tower details</button></div>
  <h3 class="sec">Parking</h3>
  <table class="fc"><tr><td>Car park</td><td>${barHtml(rep.parking.demand / rep.parking.cap)}</td><td class="num">${pct(rep.parking.demand / rep.parking.cap)}</td></tr></table>
  <p class="note">${num(rep.parking.cap)} drivers a minute fit; ${num(rep.parking.demand)} want to park. Drivers who find it full pay nothing. Monorail yards and bus depots take parking space.</p>
  <div class="btns"><button type="button" class="btn" data-act="tab" data-tab="build">Build car parks (Build tab)</button></div>`;
  return h;
}

// ------------------------------------------------------------------ finance

function renderFinance(game, ap) {
  const pm = ap.perMin;
  const rev = [['landing', 'Landing fees'], ['paxFees', 'Passenger fees'], ['retail', 'Shops & dining'], ['parking', 'Parking'], ['hotel', 'Hotels'], ['rental', 'Rental cars'], ['maintenance', 'Hangar maintenance work'], ['bonus', 'Bonuses (signing, golden planes)']].filter(([k]) => k === 'landing' || k === 'paxFees' || pm[k]);
  const max = Math.max(1, ...rev.map(([k]) => pm[k] || 0), ...ap.costLines.map((l) => l.v));
  let h = `<h3 class="sec">${ap.name} · per second</h3><table class="ledger">`;
  for (const [k, label] of rev) h += `<tr><td>${label}</td><td class="lb"><div class="bar"><i style="width:${((pm[k] || 0) / max * 100).toFixed(1)}%"></i></div></td><td class="num pos">${rate(pm[k] || 0)}</td></tr>`;
  if (pm.refunds) h += `<tr><td>Missed-flight compensation</td><td class="lb"><div class="bar bad"><i style="width:${(-pm.refunds / max * 100).toFixed(1)}%"></i></div></td><td class="num neg">${rate(pm.refunds)}</td></tr>`;
  if (pm.penalties) h += `<tr><td>Contract penalties</td><td class="lb"></td><td class="num neg">${rate(pm.penalties)}</td></tr>`;
  if (pm.repairs) h += `<tr><td>Repairs</td><td class="lb"></td><td class="num neg">${rate(pm.repairs)}</td></tr>`;
  for (const l of ap.costLines) if (l.v > 0) h += `<tr><td>${esc(l.label)}</td><td class="lb"><div class="bar warn"><i style="width:${(l.v / max * 100).toFixed(1)}%"></i></div></td><td class="num neg">${rate(-l.v)}</td></tr>`;
  h += `<tr class="total"><td>Net</td><td></td><td class="num ${pm.net >= 0 ? 'pos' : 'neg'}">${rate(pm.net || 0, true)}</td></tr></table>`;
  h += `<p class="note">Costs run every second whether planes fly or not. Revenue arrives with each landing, each boarded passenger and every minute people spend waiting airside.</p>`;
  h += `<h3 class="sec">Company</h3><dl class="board">
    <div><dt>Airports</dt><dd>${game.airports.length}</dd></div>
    <div><dt>Revenue</dt><dd>${money(game.airports.reduce((s, a) => s + a.lifetime.revenue, 0))}</dd></div>
    <div><dt>Flights</dt><dd>${num(game.airports.reduce((s, a) => s + a.lifetime.flights, 0))}</dd></div>
    <div><dt>Passengers</dt><dd>${num(game.airports.reduce((s, a) => s + a.paxServed, 0))}</dd></div>
  </dl>
  <p class="note"><a href="#" class="quiet" data-act="detail" data-kind="milestones" data-id="">Milestones · ${Object.keys(game.milestones || {}).length} of ${MILESTONES.length}</a></p>`;
  const nextL = LEVELS[ap.level];
  if (nextL) h += `<p class="note">Level ${ap.level + 1} at ${num(nextL)} passengers served (${num(ap.paxServed)} so far). Levels bring bigger aircraft and, at level 4, the next airport.</p>`;
  h += `<h3 class="sec">Save</h3>
  <p class="note">The game saves itself in this browser every few seconds. Copy a save code to move it elsewhere.</p>
  <div class="btns"><button type="button" class="btn" data-act="export">Copy save code</button><button type="button" class="btn" data-act="import-open">Load a save code</button>${resetBtn()}</div>
  ${ui.importOpen ? `<div style="margin-top:10px"><label class="sub" for="importBox">Paste a save code</label><textarea id="importBox"></textarea><div class="btns"><button type="button" class="btn go" data-act="import">Load</button></div></div>` : ''}
  ${ui.exported ? `<div style="margin-top:10px"><label class="sub" for="exportBox">Save code</label><textarea id="exportBox" readonly>${esc(ui.exported)}</textarea></div>` : ''}`;
  return h;
}

// ------------------------------------------------------------------ toasts & dialogs

export function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  $('toasts').appendChild(el);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
  setTimeout(() => el.remove(), 4200);
}

export function showDialog(html) {
  $('dialogCard').innerHTML = html;
  $('dialog').hidden = false;
}
