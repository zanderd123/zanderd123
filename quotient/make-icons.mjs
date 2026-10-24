/**
 * Draws the app icons from Peanut, the mascot SVG inside quotient.html, so the
 * icon always matches the character in the app.
 *
 *   node quotient/make-icons.mjs  ->  quotient/app/icons/*.png
 *
 * Set CHROMIUM_PATH to use a Chromium other than the one Playwright installed.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, 'quotient.html'), 'utf8');
const svg = page.match(/<svg viewBox="0 0 200 192"[\s\S]*?<\/svg>/)[0];
const tokens = page.match(/:root \{([\s\S]*?)\n\}/)[1];

// name, size, how much of the square Peanut fills. Maskable icons keep him inside
// the central safe zone because Android crops them to circles and squircles.
const ICONS = [
  ['icon-192.png', 192, 0.78],
  ['icon-512.png', 512, 0.78],
  ['icon-1024.png', 1024, 0.78], // App Store
  ['icon-maskable-512.png', 512, 0.6],
  ['apple-touch-icon.png', 180, 0.74],
  ['favicon-32.png', 32, 0.9],
];

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
for (const [name, size, fill] of ICONS) {
  const p = await browser.newPage({ viewport: { width: size, height: size } });
  await p.setContent(`<!doctype html><style>:root{${tokens}} *{animation:none!important}
    /* Peanut's happy face: closed smiling eyes, trunk up, mouth open */
    .eyes-open,.trunk-down,.trunk-curl,.face-sad,.face-think,.tear,.drops{display:none}
    html,body{margin:0;width:${size}px;height:${size}px;background:var(--sky);display:grid;place-items:center;overflow:hidden}
    svg{width:${Math.round(size * fill)}px;height:auto;overflow:visible}</style>${svg}`);
  await p.screenshot({ path: join(here, 'app', 'icons', name) });
  await p.close();
}
await browser.close();
console.log(`drew ${ICONS.length} icons`);
