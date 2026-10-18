// Report a bug: the player says what happened, the game adds what it knows
// (build, screen, airports, recent errors), and it is emailed to the game's
// maker through FormSubmit, a form-to-email relay (a static page can't send
// mail itself). If that fails, the player's own mail app opens instead.

import { showDialog, esc } from './ui.js';
import { activeAirport } from './game.js';

const TO = 'info@zdigitalfrontier.com';
const RELAY = `https://formsubmit.co/ajax/${TO}`;
const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev'; // eslint-disable-line no-undef

// the last few errors, for the report
const errors = [];
export function noteError(e) {
  const msg = (e && (e.stack || e.message)) || String(e);
  errors.push(msg.split('\n').slice(0, 3).join(' | ').slice(0, 300));
  if (errors.length > 5) errors.shift();
}
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => noteError(e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => noteError(e.reason));
}

function details(game) {
  const ap = activeAirport(game);
  const lines = [
    `Build: ${BUILD}`,
    `Screen: ${window.innerWidth}x${window.innerHeight}${matchMedia('(pointer: coarse)').matches ? ' (touch)' : ''}`,
    `Browser: ${navigator.userAgent}`,
    `On screen: ${ap.id} (level ${ap.level}), speed ${game.speed}x, cash $${Math.round(game.cash).toLocaleString('en-US')}`,
    `Airports: ${game.airports.map((a) => `${a.id} L${a.level} ${a.terminals.length}T ${a.contracts.length}R${a.expandReady ? ' grown' : ''}`).join(', ')}`,
    `Holding now: ${(ap.holdQueue || []).map((p) => p.holdWhy || p.holdReason || '?').join(', ') || 'none'}`,
  ];
  if (errors.length) lines.push(`Recent errors: ${errors.join(' || ')}`);
  return lines.join('\n');
}

let current = null;
export function openBugReport(game) {
  current = game;
  showDialog(`<h2>Report a bug</h2>
    <p>What happened, and what were you doing just before? The more detail, the easier it is to fix.</p>
    <textarea id="bugText" rows="5" placeholder="e.g. Planes circled at Bayside for five minutes while the runway was empty"></textarea>
    <label class="sub" for="bugFrom" style="display:block;margin-top:8px">Your email (optional, if you'd like a reply)</label>
    <input id="bugFrom" type="email" autocomplete="email" placeholder="you@example.com">
    <label class="sub" style="display:flex;gap:6px;align-items:center;margin:8px 0"><input type="checkbox" id="bugInfo" checked> Include game details (build, screen size, your airports)</label>
    <div class="btns"><button type="button" class="btn go" data-bug="send">Submit report</button><button type="button" class="btn" data-close="dialog">Cancel</button></div>
    <p class="note" id="bugNote"></p>`);
  setTimeout(() => { const t = document.getElementById('bugText'); if (t) t.focus(); }, 50);
}

function report() {
  const what = (document.getElementById('bugText').value || '').trim();
  const from = (document.getElementById('bugFrom').value || '').trim();
  const info = document.getElementById('bugInfo').checked ? details(current) : '';
  return { what, from, info, body: `${what || '(no description)'}${info ? `\n\n---\n${info}` : ''}` };
}

let sending = false;
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-bug]');
  if (!b || !current) return;
  const r = report();
  const note = document.getElementById('bugNote');
  if (b.dataset.bug === 'mail') {
    window.location.href = `mailto:${TO}?subject=${encodeURIComponent('Holding Pattern bug report')}&body=${encodeURIComponent(r.body.slice(0, 1800))}`;
    return;
  }
  if (b.dataset.bug !== 'send' || sending) return;
  if (!r.what) { note.textContent = 'Please describe what happened first.'; document.getElementById('bugText').focus(); return; }
  sending = true; b.disabled = true; note.textContent = 'Sending…';
  const data = { _subject: `Holding Pattern bug: ${r.what.split('\n')[0].slice(0, 70)}`, _template: 'box', _captcha: 'false', report: r.what, details: r.info || '(not included)' };
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.from)) { data.email = r.from; data._replyto = r.from; }
  fetch(RELAY, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(data) })
    .then((res) => res.json().catch(() => ({})).then((j) => { if (!res.ok || String(j.success) !== 'true') throw new Error(j.message || res.status); }))
    .then(() => {
      document.getElementById('dialogCard').innerHTML = '<h2>Thank you!</h2><p>Your report was sent. It helps make the game better.</p><div class="btns"><button type="button" class="btn go" data-close="dialog">Back to the game</button></div>';
    })
    .catch(() => {
      b.disabled = false;
      note.innerHTML = `It couldn't be sent from here (no connection, or the page blocks it). <button type="button" class="btn" data-bug="mail" style="margin-top:6px">Email it instead</button>`;
    })
    .finally(() => { sending = false; });
});
