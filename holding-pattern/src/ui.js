// Everything in the DOM: the top bar, the ops board, the management panel
// and its detail views. The panel is rebuilt from state about once a second
// and handles clicks by delegation, so nothing here keeps its own copy of
// the game.

import {
  AIRCRAFT, CONNECTORS, CONNECTOR_ORDER, UPGRADES, UPGRADE_ORDER, STAFFING,
  TERMINAL, LEVELS, SITES, PAX, CONTRACTS, SECURITY as SECCFG,
} from './config.js';
import { SLOTS, SLOT_ORDER, PLOTS, PLOT_ORDER, TERMINAL_CODES, connectorRoute } from './layout.js';
import * as S from './sim.js';
import { money, num, duration, pathLength, clamp, rate, every } from './util.js';
import { advise, key as fixKey, offerUnlockFixes } from './advisor.js';
import { helpHtml } from './help.js';
import { activeAirport } from './game.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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
  for (const a of game.airports) net += a.perMin.net || 0;
  const sNet = $('sNet');
  sNet.textContent = rate(net, true);
  sNet.className = net >= 0 ? 'pos' : 'neg';
  $('whyBtn').hidden = !(net < 0 && ap.t > 30);
  $('sRep').textContent = stars(ap.rep);
  $('sOtp').textContent = pct(ap.rolling.otp);
  $('sPax').textContent = num(ap.rolling.landsidePerMin * 2);
  const b = $('offerBadge');
  b.hidden = !ap.offers.length;
  b.textContent = ap.offers.length;
}

// ------------------------------------------------------------------ ops board

export function renderOps(game, clockText) {
  const ap = activeAirport(game);
  const rep = S.loadReport(ap);
  const snap = S.opsSnapshot(ap);
  const rows = [];
  const rwU = S.utilisation(rep.runway.demand, rep.runway.cap);
  const holdRw = ap.holdQueue.filter((p) => p.holdReason === 'runway' || p.holdReason === 'taxi').length;
  rows.push({ k: 'Runway', s: holdRw > 2 || rwU >= 1 ? 'bad' : rwU > 0.85 || holdRw ? 'warn' : '',
    v: `${pct(rwU)} of capacity`, sub: `${rep.runway.demand.toFixed(1)} of ${rep.runway.cap.toFixed(1)} landings & take-offs a minute${holdRw ? ` · ${holdRw} circling` : ''}` });
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
  if (worst) rows.push({ k: 'Connectors', s: worst.u >= 1 ? 'bad' : worst.u > 0.85 ? 'warn' : '', v: `${pct(worst.u)} of capacity`, sub: `busiest: to ${SLOTS[worst.tr.slot].name}` });
  rows.push({ k: 'On time', s: ap.rolling.otp < 0.6 ? 'bad' : ap.rolling.otp < 0.8 ? 'warn' : '', v: pct(ap.rolling.otp), sub: `${ap.contracts.filter((c) => c.unhappyFor > 0).length} unhappy airlines` });
  const net = ap.perMin.net || 0;
  rows.push({ k: 'Money', s: net < 0 && ap.t > 30 ? 'bad' : '', v: rate(net, true), sub: net < 0 ? 'tap for why' : 'after all running costs' });
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
  if (!force && ae && ae.tagName === 'SELECT' && $('panelBody').contains(ae)) return;
  const game = ui.game;
  const ap = activeAirport(game);
  let html;
  ui.advice = advise(game, ap);
  if (ui.detail) html = renderDetail(game, ap, ui.detail);
  else if (ui.tab === 'advisor') html = renderAdvisor(game, ap);
  else if (ui.tab === 'help') html = helpHtml();
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
  rows.push(['Runway', before.runway.demand / before.runway.cap, after.runway.demand / after.runway.cap]);
  const tb = before.terminals.find((t) => t.slot === slot), ta = after.terminals.find((t) => t.slot === slot);
  if (tb) rows.push([`Gates ${TERMINAL_CODES[slot]}`, tb.gateDemand / tb.gates, ta.gateDemand / ta.gates]);
  rows.push(['Security', before.security.demand / before.security.cap, after.security.demand / after.security.cap]);
  if (tb && tb.connCap != null) rows.push([`Connector ${TERMINAL_CODES[slot]}`, tb.pax / Math.max(1, tb.connCap), ta.pax / Math.max(1, ta.connCap)]);
  rows.push(['Parking', before.parking.demand / before.parking.cap, after.parking.demand / after.parking.cap]);
  ui.lastOverload = rows.filter(([k, b, a]) => a >= 1 && k !== 'Parking').map(([k]) => k);
  return `<table class="fc">${rows.map(([k, b, a]) => `<tr><td>${k}</td><td>${barHtml(b, a)}</td><td class="num ${a >= 1 ? 'neg' : ''}">${pct(b)}→${pct(a)}</td></tr>`).join('')}</table>`;
}

// A button that applies one of the advisor's fixes.
function fixButton(f, cls = '') {
  const data = Object.entries(f.data || {}).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ');
  const paid = f.cost > 0;
  const dis = paid && !canAfford(f.cost) ? 'disabled' : '';
  return `<button type="button" class="btn ${cls}" data-act="${f.act}" ${data} ${dis}>${esc(f.label)}${paid ? `<span class="price">${money(f.cost)}</span>` : ''}</button>`;
}

function recTag(f) {
  return ui.advice && ui.advice.recommended.has(fixKey(f)) ? '<span class="tag rec">Recommended</span>' : '';
}

// ------------------------------------------------------------------ advisor

function renderAdvisor(game, ap) {
  const adv = ui.advice;
  const sevTag = ['<span class="tag green">Fine</span>', '<span class="tag">Worth a look</span>', '<span class="tag amber">Fix soon</span>', '<span class="tag red">Fix now</span>'];
  let h = '';
  if (adv.best) {
    h += `<div class="card best"><div class="eyebrow">Best next step</div><div class="title">${esc(adv.best.label)}</div>${adv.best.why ? `<div class="sub">${esc(adv.best.why)}</div>` : ''}<div class="btns">${fixButton(adv.best, 'go')}</div></div>`;
  }
  const m = adv.money;
  h += `<dl class="board"><div><dt>Earning</dt><dd>${rate(m.revenue)}</dd></div><div><dt>Spending</dt><dd>${rate(m.costs)}</dd></div><div><dt>Refunds</dt><dd>${rate(m.refunds)}</dd></div><div><dt>Net</dt><dd class="${(ap.perMin.net || 0) >= 0 ? 'pos' : 'neg'}">${rate(ap.perMin.net || 0, true)}</dd></div></dl>`;
  for (const i of adv.issues) {
    h += `<div class="card sev${i.sev}">
      <div class="row between"><div class="title">${esc(i.title)}</div>${sevTag[i.sev]}</div>
      <p class="note">${esc(i.detail)}</p>
      ${i.tip ? `<p class="note"><b>${esc(i.tip)}</b></p>` : ''}
      ${i.fixes.length ? `<div class="btns">${i.fixes.map((f) => fixButton(f, f === adv.best ? 'go' : '')).join('')}</div>` : ''}
      ${i.fixes.some((f) => f.why) ? `<p class="note">${i.fixes.filter((f) => f.why).map((f) => `${esc(f.label)}: ${esc(f.why)}`).join(' · ')}</p>` : ''}
    </div>`;
  }
  return h;
}

function terminalOptions(ap, cls, current) {
  return ap.terminals.filter((T) => S.isOpen(T)).map((T) => {
    const ok = S.terminalSupports(ap, T, cls);
    return `<option value="${T.slot}" ${T.slot === current ? 'selected' : ''} ${ok ? '' : 'disabled'}>${TERMINAL_CODES[T.slot]} · ${SLOTS[T.slot].name}${ok ? '' : ' (no heavy gates)'}</option>`;
  }).join('');
}

function renderContracts(game, ap) {
  let h = `<h3 class="sec">Offers on the table</h3>`;
  if (!ap.offers.length) h += `<p class="empty">No airline is asking right now. New offers arrive every minute or so; a better reputation brings better ones.</p>`;
  for (const o of ap.offers) {
    const A = AIRCRAFT[o.cls];
    const blocked = S.classAllowed(ap, o.cls);
    if (!ui.offerSlot) ui.offerSlot = {};
    const slot = ui.offerSlot[o.id] && S.terminalBySlot(ap, ui.offerSlot[o.id]) ? ui.offerSlot[o.id] : S.suggestTerminal(ap, o.cls);
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
      ${ui.lastOverload.length ? `<p class="note neg">Signing puts ${esc(ui.lastOverload.join(', '))} over capacity: flights will run late and passengers will miss them.</p>` : ''}
      <div class="btns">${ui.lastOverload.length
        ? armBtn('sign-' + o.id, `Sign anyway · bonus ${money(o.bonus)}`, 'Confirm: overload it', 'accept', `data-id="${o.id}" data-slot="${slot}"`)
        : `<button type="button" class="btn go" data-act="accept" data-id="${o.id}" data-slot="${slot}">Sign · bonus <span class="price">${money(o.bonus)}</span></button>`}<button type="button" class="btn" data-act="decline" data-id="${o.id}">Decline</button></div>`}
      <div class="timer"><i style="width:${clamp(left / CONTRACTS.offerLife, 0, 1) * 100}%"></i></div>
    </div>`;
  }
  h += `<h3 class="sec">Active routes · ${ap.contracts.length}</h3>`;
  if (!ap.contracts.length) h += `<p class="empty">No routes yet.</p>`;
  for (const c of ap.contracts) {
    const A = AIRCRAFT[c.cls];
    const otp = c.otpHist.length ? c.otpHist.reduce((a, b) => a + b, 0) / c.otpHist.length : 1;
    const unhappy = c.unhappyFor > 0;
    const status = unhappy
      ? `<span class="tag red">Unhappy · leaves in ${duration(CONTRACTS.leaveAfter - c.unhappyFor)}</span>`
      : otp < 0.75 ? `<span class="tag amber">Watching delays</span>` : `<span class="tag green">Happy</span>`;
    h += `<div class="card">
      <div class="row between"><div class="row"><span class="chip" style="background:${c.color}"></span><div><div class="title">${esc(c.airline)}</div><div class="sub">${esc(c.city)} · ${A.name} · ${every(c.freq)}</div></div></div>${status}</div>
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
      <div class="btns">${armBtn('cancel-' + c.id, 'End contract', `Confirm · pay ${money(S.cancelPenalty(ap, c, game))}`, 'cancel', `data-id="${c.id}"`)}</div>
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
    <div class="row between"><div><div class="title">${TERMINAL_CODES[T.slot]} · ${SLOTS[T.slot].name}</div>
    <div class="sub">${T.gates} gates${T.heavy ? ' · heavy' : ''} · retail L${T.retail + 1}${C ? ` · ${CONNECTORS[C.type].name.toLowerCase()}` : ' · security & curb'}</div></div>${state}</div>
    ${rep && rep.open ? `<table class="fc"><tr><td>Gate load</td><td>${barHtml(rep.gateDemand / rep.gates)}</td><td class="num">${pct(rep.gateDemand / rep.gates)}</td></tr>${rep.connCap != null ? `<tr><td>Connector</td><td>${barHtml(rep.pax / Math.max(1, rep.connCap))}</td><td class="num">${pct(rep.pax / Math.max(1, rep.connCap))}</td></tr>` : ''}</table>` : ''}
  </div>`;
}

function renderBuild(game, ap) {
  let h = `<h3 class="sec">Terminals</h3>`;
  for (const T of ap.terminals) h += terminalSummary(ap, T);
  const free = SLOT_ORDER.filter((s) => !S.terminalBySlot(ap, s) && ap.plots[SLOTS[s].plot]);
  if (free.length) {
    h += `<h3 class="sec">Open sites</h3><ul class="list">`;
    for (const s of free) h += `<li><div class="what"><b>${SLOTS[s].name}</b><span>${SLOTS[s].row === 'mid' ? 'Midfield: across the apron from the main terminal' : SLOTS[s].adjacent ? 'Next to the main terminal: a walkway can reach it' : 'Main row, further out'}</span></div><button type="button" class="btn go" data-act="detail" data-kind="slot" data-id="${s}">Plan · ${money(S.terminalCost(ap))}+</button></li>`;
    h += `</ul>`;
  } else {
    h += `<p class="note">Buy more land to open new terminal sites.</p>`;
  }
  h += `<h3 class="sec">Land</h3><ul class="list">`;
  for (const id of PLOT_ORDER) {
    const P = PLOTS[id];
    const owned = ap.plots[id];
    const opens = SLOT_ORDER.filter((s) => SLOTS[s].plot === id).map((s) => SLOTS[s].name);
    const ups = Object.entries(UPGRADES).filter(([, u]) => u.needsPlot === id).map(([, u]) => u.name);
    const what = [...opens, ...ups].join(', ');
    const needs = P.needs && !ap.plots[P.needs] ? `Buy the ${PLOTS[P.needs].name} first` : null;
    h += `<li><div class="what"><b>${P.name} ${recTag({ act: 'plot', data: { id } })}</b><span>${owned ? 'Owned' : `Opens: ${what}`}${owned ? '' : ` · tax ${rate(14 * S.site(ap).cost)}`}</span></div>${owned ? '<span class="tag green">Owned</span>' : needs ? `<span class="tag">${needs}</span>` : priceBtn('Buy', `plot" data-id="${id}`, S.plotCost(ap, id))}</li>`;
  }
  h += `</ul>`;
  h += `<h3 class="sec">Airfield & landside</h3><ul class="list">`;
  for (const k of UPGRADE_ORDER) {
    const U = UPGRADES[k];
    const why = S.upgradeBlocked(ap, k);
    h += `<li><div class="what"><b>${U.name} ${recTag({ act: 'upgrade', data: { id: k } })}</b><span>${U.desc}</span></div>${ap.upgrades[k] ? '<span class="tag green">Built</span>' : why ? `<span class="tag">${esc(why)}</span>` : priceBtn('Build', `upgrade" data-id="${k}`, S.upgradeCost(ap, k))}</li>`;
  }
  h += `</ul>`;
  return h;
}

function connectorCard(ap, type, slot, chosen, current = null) {
  const def = CONNECTORS[type];
  const allowed = S.connectorAllowed(type, slot);
  const len = pathLength(connectorRoute(type, slot));
  const fake = { type, level: 0, buses: type === 'shuttle' ? 2 : 0, buildLeft: 0, len, route: connectorRoute(type, slot) };
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
    <p>${allowed ? def.blurb : 'Only reaches the piers next to the main terminal.'}${crosses ? ' <b style="color:var(--amber)">Crosses the apron lane here.</b>' : ''}${type === 'shuttle' ? ' *with 2 buses; add more later.' : ''}</p>
  </button>`;
}

function renderSlotDetail(game, ap, slot) {
  const S0 = SLOTS[slot];
  const chosen = ui.buildChoice[slot] || (S0.adjacent ? 'walkway' : 'shuttle');
  const tcost = S.terminalCost(ap);
  const ccost = S.connectorBuildCost(chosen, slot, ap);
  let h = `<button type="button" class="back" data-act="back">◂ Back</button>
  <div class="title" style="font-size:24px">${S0.name}</div>
  <p class="note">A new terminal opens with ${TERMINAL.startGates} gates (room for ${S0.maxGates}). Passengers clear security in the main terminal, so they need a way to get here. Each terminal also adds an air traffic controller, ground crews, climate control and cleaning to your running costs.</p>
  <dl class="board">
    <div><dt>Terminal</dt><dd>${money(tcost)}</dd></div>
    <div><dt>Connector</dt><dd>${money(ccost)}</dd></div>
    <div><dt>Builds in</dt><dd>${duration(Math.max(TERMINAL.buildTime, CONNECTORS[chosen].buildTime))}</dd></div>
    <div><dt>New staff</dt><dd>~${rate(S.site(ap).cost * (95 + 18 * 3 + 40 + 33 + 30))}</dd></div>
  </dl>
  <h3 class="sec">How will passengers get there?</h3>
  <div class="conn-grid">${CONNECTOR_ORDER.map((t) => connectorCard(ap, t, slot, t === chosen)).join('')}</div>
  <div class="btns">${priceBtn('Build terminal', `build" data-slot="${slot}" data-type="${chosen}`, tcost + ccost, '', 'go')}</div>`;
  return h;
}

function renderTerminalDetail(game, ap, slot) {
  const T = S.terminalBySlot(ap, slot);
  if (!T) { ui.detail = null; return renderBuild(game, ap); }
  const S0 = SLOTS[slot];
  const rep = S.loadReport(ap).terminals.find((t) => t.slot === slot);
  const C = T.connector;
  const routes = ap.contracts.filter((c) => c.terminal === slot);
  let h = `<button type="button" class="back" data-act="back">◂ Back</button>
  <div class="row between"><div class="title" style="font-size:24px">${TERMINAL_CODES[slot]} · ${S0.name}</div>${T.buildLeft > 0 ? `<span class="tag amber">Building · ${duration(T.buildLeft)}</span>` : ''}</div>
  <dl class="board">
    <div><dt>Gates</dt><dd>${T.gates}${T.heavy ? ' heavy' : ''}</dd></div>
    <div><dt>Gate load</dt><dd>${rep ? pct(rep.gateDemand / rep.gates) : '—'}</dd></div>
    <div><dt>People</dt><dd>${num(T.occupancy || 0)}</dd></div>
    <div><dt>Comfort</dt><dd>${num(T.comfort || T.gates * PAX.terminalComfortPerGate)}</dd></div>
  </dl>
  <h3 class="sec">Terminal</h3><ul class="list">
    <li><div class="what"><b>Add a gate ${recTag({ act: 'gate', data: { slot } })}</b><span>${T.gates} of ${S0.maxGates} · each gate adds ground crew and climate costs</span></div>${T.gates < S0.maxGates ? priceBtn('Add', `gate" data-slot="${slot}`, S.gateCost(ap, T)) : '<span class="tag">Full</span>'}</li>
    <li><div class="what"><b>Heavy gates ${recTag({ act: 'heavy', data: { slot } })}</b><span>Widebodies and superjumbos need them</span></div>${T.heavy ? '<span class="tag green">Done</span>' : priceBtn('Convert', `heavy" data-slot="${slot}`, S.heavyCost(ap, T))}</li>
    <li><div class="what"><b>Shops & dining · L${T.retail + 1}</b><span>Waiting passengers spend ×${TERMINAL.retailLevels[T.retail].mult}. Crowds spend less.</span></div>${S.retailCost(ap, T) != null ? priceBtn('Upgrade', `retail" data-slot="${slot}`, S.retailCost(ap, T)) : '<span class="tag">Max</span>'}</li>
  </ul>`;
  if (C) {
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
  h += `<h3 class="sec">Routes using this terminal · ${routes.length}</h3>`;
  h += routes.length ? `<ul class="list">${routes.map((c) => `<li><div class="what"><b>${esc(c.airline)} · ${esc(c.city)}</b><span>${AIRCRAFT[c.cls].name} · ${every(c.freq)}</span></div><span class="mono">${c.otpHist.length ? pct(c.otpHist.reduce((a, b) => a + b, 0) / c.otpHist.length) : '—'}</span></li>`).join('')}</ul>` : '<p class="empty">None. Assign routes from the Contracts tab.</p>';
  return h;
}

function securityBlock(ap) {
  const rep = S.loadReport(ap);
  return `<table class="fc"><tr><td>Load</td><td>${barHtml(rep.security.demand / rep.security.cap)}</td><td class="num">${pct(rep.security.demand / rep.security.cap)}</td></tr></table>
  <p class="note">${ap.securityLanes} lanes screen ${num(rep.security.cap)} passengers a minute against ${num(rep.security.demand)} booked. ${num(ap.secQueue || 0)} in line now.</p>
  ${recTag({ act: 'lane+', data: {} })}
  <div class="btns">${ap.securityLanes < SECCFG.maxLanes ? priceBtn('Open a lane', 'lane+', S.laneCost(ap)) : ''}<button type="button" class="btn" data-act="lane-" ${ap.securityLanes > 1 ? '' : 'disabled'}>Close a lane</button></div>`;
}

function renderPlotDetail(game, ap, id) {
  const P = PLOTS[id];
  const opens = SLOT_ORDER.filter((s) => SLOTS[s].plot === id).map((s) => SLOTS[s].name);
  const ups = Object.entries(UPGRADES).filter(([, u]) => u.needsPlot === id).map(([, u]) => u.name);
  const needs = P.needs && !ap.plots[P.needs] ? PLOTS[P.needs].name : null;
  return `<button type="button" class="back" data-act="back">◂ Back</button>
  <div class="title" style="font-size:24px">${P.name}</div>
  <p class="note">Farmland for now. Owning it opens:</p>
  <ul class="list">${[...opens.map((o) => `<li><div class="what"><b>${o}</b><span>Terminal site</span></div></li>`), ...ups.map((u) => `<li><div class="what"><b>${u}</b><span>Upgrade</span></div></li>`)].join('')}${id === 'west' || id === 'east' ? `<li><div class="what"><b>Taxilane</b><span>A second route for aircraft between the runway and the main apron</span></div></li>` : ''}</ul>
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
    <div><dt>Holding</dt><dd>${snap.holding}</dd></div>
  </dl>
  <p class="note">Every flight is two movements: a landing and a take-off. Throughput is the lower of what the runway can physically take and what your controllers can sequence. When arrivals cannot be slotted in they circle in the holding stack west of the field, burning the airline's time.</p>
  <h3 class="sec">Tower staffing</h3>
  <p class="note">${S.controllers(ap)} controllers on shift: one per runway and one per terminal. Each sequences about ${(rep.runway.atc / Math.max(1, S.controllers(ap))).toFixed(1)} movements a minute.</p>
  ${staffRow(ap, 'atc', 'Controllers')}
  <h3 class="sec">Airfield upgrades</h3>
  <ul class="list">${['radar', 'rapidExits', 'automation', 'cat3', 'longRunway', 'runway2'].map((k) => { const U = UPGRADES[k]; const why = S.upgradeBlocked(ap, k); return `<li><div class="what"><b>${U.name}</b><span>${U.desc}</span></div>${ap.upgrades[k] ? '<span class="tag green">Built</span>' : why ? `<span class="tag">${esc(why)}</span>` : priceBtn('Build', `upgrade" data-id="${k}`, S.upgradeCost(ap, k))}</li>`; }).join('')}</ul>`;
}

function renderPlaneDetail(game, ap, p) {
  if (!ap.planes.includes(p)) { ui.detail = null; return renderContracts(game, ap); }
  const f = p.f;
  const A = AIRCRAFT[p.cls];
  const states = {
    inbound: 'Inbound to the approach fix', holding: 'Holding: waiting for a landing slot', final: 'On final approach',
    rollout: 'Landing roll', crossHold: 'Holding short of the main runway', crossing: 'Crossing the main runway',
    taxiIn: 'Taxiing to the gate', toWait: 'No gate free: heading to a waiting spot', waitGate: 'Waiting for a gate',
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
  ${p.busDelay ? `<p class="note">Stopped ${duration(p.busDelay)} for shuttle buses crossing the apron.</p>` : ''}`;
}

function renderDetail(game, ap, d) {
  if (d.kind === 'slot') return S.terminalBySlot(ap, d.id) ? renderTerminalDetail(game, ap, d.id) : renderSlotDetail(game, ap, d.id);
  if (d.kind === 'terminal') return renderTerminalDetail(game, ap, d.id);
  if (d.kind === 'plot') return renderPlotDetail(game, ap, d.id);
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
  <p class="note">${S.controllers(ap)} controllers (one per runway, one per terminal) sequence ${rep.runway.atc.toFixed(1)} movements a minute. The runway itself takes ${rep.runway.physical.toFixed(1)}.</p>
  <div class="btns"><button type="button" class="btn" data-act="detail" data-kind="runway">Runway & tower details</button></div>
  <h3 class="sec">Parking</h3>
  <table class="fc"><tr><td>Car park</td><td>${barHtml(rep.parking.demand / rep.parking.cap)}</td><td class="num">${pct(rep.parking.demand / rep.parking.cap)}</td></tr></table>
  <p class="note">${num(rep.parking.cap)} drivers a minute fit; ${num(rep.parking.demand)} want to park. Drivers who find it full pay nothing. Monorail yards and bus depots take parking space.</p>`;
  return h;
}

// ------------------------------------------------------------------ finance

function renderFinance(game, ap) {
  const pm = ap.perMin;
  const rev = [['landing', 'Landing fees'], ['paxFees', 'Passenger fees'], ['retail', 'Shops & dining'], ['parking', 'Parking'], ['bonus', 'Signing bonuses']];
  const max = Math.max(1, ...rev.map(([k]) => pm[k] || 0), ...ap.costLines.map((l) => l.v));
  let h = `<h3 class="sec">${ap.name} · per second</h3><table class="ledger">`;
  for (const [k, label] of rev) h += `<tr><td>${label}</td><td class="lb"><div class="bar"><i style="width:${((pm[k] || 0) / max * 100).toFixed(1)}%"></i></div></td><td class="num pos">${rate(pm[k] || 0)}</td></tr>`;
  if (pm.refunds) h += `<tr><td>Missed-flight compensation</td><td class="lb"><div class="bar bad"><i style="width:${(-pm.refunds / max * 100).toFixed(1)}%"></i></div></td><td class="num neg">${rate(pm.refunds)}</td></tr>`;
  if (pm.penalties) h += `<tr><td>Contract penalties</td><td class="lb"></td><td class="num neg">${rate(pm.penalties)}</td></tr>`;
  for (const l of ap.costLines) h += `<tr><td>${esc(l.label)}</td><td class="lb"><div class="bar warn"><i style="width:${(l.v / max * 100).toFixed(1)}%"></i></div></td><td class="num neg">${rate(-l.v)}</td></tr>`;
  h += `<tr class="total"><td>Net</td><td></td><td class="num ${pm.net >= 0 ? 'pos' : 'neg'}">${rate(pm.net || 0, true)}</td></tr></table>`;
  h += `<p class="note">Costs run every second whether planes fly or not. Revenue arrives with each landing, each boarded passenger and every minute people spend waiting airside.</p>`;
  h += `<h3 class="sec">Company</h3><dl class="board">
    <div><dt>Airports</dt><dd>${game.airports.length}</dd></div>
    <div><dt>Revenue</dt><dd>${money(game.airports.reduce((s, a) => s + a.lifetime.revenue, 0))}</dd></div>
    <div><dt>Flights</dt><dd>${num(game.airports.reduce((s, a) => s + a.lifetime.flights, 0))}</dd></div>
    <div><dt>Passengers</dt><dd>${num(game.airports.reduce((s, a) => s + a.paxServed, 0))}</dd></div>
  </dl>`;
  const nextL = LEVELS[ap.level];
  if (nextL) h += `<p class="note">Level ${ap.level + 1} at ${num(nextL)} passengers served (${num(ap.paxServed)} so far). Levels bring bigger aircraft and, at level 4, the next airport.</p>`;
  h += `<h3 class="sec">Save</h3>
  <p class="note">The game saves itself in this browser every few seconds. Copy a save code to move it elsewhere.</p>
  <div class="btns"><button type="button" class="btn" data-act="export">Copy save code</button><button type="button" class="btn" data-act="import-open">Load a save code</button>${armBtn('wipe', 'Start over', 'Confirm: erase everything', 'wipe')}</div>
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
