// Report a bug: the player says what happened, the game adds what it knows
// (build, screen, airports, recent errors), and it goes to the game's GitHub
// issues, or onto the clipboard to send any other way.

import { showDialog, esc } from './ui.js';
import { activeAirport } from './game.js';

const REPO = 'https://github.com/zanderd123/Holding-Pattern-/issues/new';
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
    <label class="sub" style="display:flex;gap:6px;align-items:center;margin:8px 0"><input type="checkbox" id="bugInfo" checked> Include game details (build, screen size, your airports)</label>
    <div class="btns"><button type="button" class="btn go" data-bug="github">Send on GitHub</button><button type="button" class="btn" data-bug="copy">Copy report</button><button type="button" class="btn" data-close="dialog">Cancel</button></div>
    <p class="note" id="bugNote">Sending on GitHub needs a free GitHub account. No account? Copy the report and send it to whoever shared the game with you.</p>`);
  setTimeout(() => { const t = document.getElementById('bugText'); if (t) t.focus(); }, 50);
}

function reportText() {
  const what = (document.getElementById('bugText').value || '').trim();
  const info = document.getElementById('bugInfo').checked ? `\n\n---\n${details(current)}` : '';
  return { what, body: `${what || '(no description)'}${info}` };
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-bug]');
  if (!b || !current) return;
  const { what, body } = reportText();
  const note = document.getElementById('bugNote');
  if (b.dataset.bug === 'github') {
    const title = `Bug: ${(what.split('\n')[0] || 'something went wrong').slice(0, 70)}`;
    const url = `${REPO}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body.slice(0, 5000))}`;
    window.open(url, '_blank', 'noopener');
    note.innerHTML = 'GitHub opened in a new tab: check the report there and press <b>Submit new issue</b>. Thank you!';
  } else {
    const done = () => { note.textContent = 'Copied. Paste it into a message, email or chat to send it.'; };
    const fallback = () => {
      const t = document.getElementById('bugText');
      t.value = body; t.select();
      try { document.execCommand('copy'); done(); } catch { note.textContent = 'Select the text above and copy it.'; }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(body).then(done, fallback);
    else fallback();
  }
});

