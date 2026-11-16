/**
 * quotient.html is written for the Claude Artifact host, which supplies the
 * outer document. This wraps it into a standalone, installable web app:
 *
 *   node quotient/build.mjs  ->  quotient/app/
 *     index.html             the page, with app metadata
 *     manifest.webmanifest   name, colours and icons for "Install" / "Add to Home Screen"
 *     sw.js                  service worker, so the app opens offline
 *     config.js              Supabase settings for Friends (copied from quotient/config.js)
 *     vendor/supabase/       the Supabase client library (copied from quotient/vendor)
 *     terms.html, privacy.html, legal.css   from quotient/legal
 *     fonts/                 Fredoka and Nunito (from quotient/fonts), instead of Google Fonts
 *
 * Icons live in quotient/app/icons and are drawn by make-icons.mjs.
 * quotient/app/ is the folder to host (GitHub Pages) or wrap (Capacitor).
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'app');
mkdirSync(out, { recursive: true });
// The installed app ships its own fonts (faster, works offline, nothing loaded from Google).
const page = readFileSync(join(here, 'quotient.html'), 'utf8').replace(/<link rel="preconnect" href="https:\/\/fonts\.[^>]*>\n/g, '').replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>\n/, '');
if (/fonts\.googleapis/.test(page)) throw new Error('Google Fonts link not removed');
mkdirSync(join(out, 'fonts'), { recursive: true });
const fonts = readdirSync(join(here, 'fonts'));
for (const f of fonts) copyFileSync(join(here, 'fonts', f), join(out, 'fonts', f));
copyFileSync(join(here, 'config.js'), join(out, 'config.js'));
mkdirSync(join(out, 'vendor', 'supabase'), { recursive: true });
const vendored = readdirSync(join(here, 'vendor', 'supabase'));
for (const f of vendored) copyFileSync(join(here, 'vendor', 'supabase', f), join(out, 'vendor', 'supabase', f));
// Terms of Use and Privacy Policy: shown inside the app, and hosted for the store listings.
const legal = ['terms.html', 'privacy.html', 'legal.css'];
for (const f of legal) copyFileSync(join(here, 'legal', f), join(out, f));
const sky = page.match(/--sky: (#[0-9a-f]+);/)[1];

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
<meta name="description" content="A few minutes a day to get your brain going: puzzles, memory, speed and focus games with Peanut the elephant.">
<meta name="theme-color" content="${sky}">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Quotient">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<link rel="preload" href="fonts/nunito-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="fonts/fredoka-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="fonts/fonts.css">
<script src="config.js"></script>
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style>
</head>
<body>
${page}
<script>
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // The app opens from its saved copy straight away. When a new version has been
  // downloaded in the background, offer to switch to it.
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js');
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!had || document.getElementById('update-toast')) return;
    const b = document.createElement('button');
    b.id = 'update-toast'; b.type = 'button'; b.textContent = 'Quotient has been updated. Tap to reload.';
    b.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:40;font:800 0.95rem/1.2 Nunito,system-ui,sans-serif;padding:12px 18px;border-radius:999px;border:2.5px solid #1c2b4a;background:#ff7a45;color:#fff;box-shadow:0 4px 0 #1c2b4a;max-width:calc(100% - 32px)';
    b.addEventListener('click', () => location.reload());
    document.body.appendChild(b);
  });
}
</script>
</body>
</html>
`;
writeFileSync(join(out, 'index.html'), html);

writeFileSync(join(out, 'manifest.webmanifest'), JSON.stringify({
  name: 'Quotient',
  short_name: 'Quotient',
  description: 'A few minutes a day to get your brain going.',
  id: './',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'portrait',
  background_color: sky,
  theme_color: sky,
  categories: ['education', 'games'],
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2) + '\n');

// The cache name changes whenever the page does, so installed copies pick up new versions.
const version = createHash('sha256').update(html).update(readFileSync(join(here, 'config.js')))
  .update(legal.map(f => readFileSync(join(here, 'legal', f), 'utf8')).join(''))
  .update(fonts.map(f => readFileSync(join(here, 'fonts', f))).reduce((a, b) => Buffer.concat([a, b]), Buffer.alloc(0))).digest('hex').slice(0, 10);
writeFileSync(join(out, 'sw.js'), `// Generated by build.mjs. Keeps Quotient working offline.
const CACHE = 'quotient-${version}';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'config.js', 'vendor/supabase/supabase.js', 'vendor/supabase/591.supabase.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png', ...legal, ...fonts.filter(f => !f.endsWith('.txt')).map(f => 'fonts/' + f)];

self.addEventListener('install', e => {
  // 'reload' skips the browser's HTTP cache, so the new version really is new.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('quotient-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin && !/fonts\\.(googleapis|gstatic)\\.com$/.test(new URL(req.url).hostname)) return;
  // The page: open the saved copy instantly (no waiting on a slow connection). New
  // versions arrive through a new sw.js, which the browser checks on every visit.
  if (req.mode === 'navigate') {
    e.respondWith(caches.match(new URL(req.url).pathname.endsWith('.html') ? req : 'index.html', { ignoreSearch: true }).then(hit => hit || fetch(req)));
    return;
  }
  // Everything else (icons, Google Fonts): the saved copy first, refreshed in the background.
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; }).catch(() => hit);
    return hit || net;
  }));
});
`);
console.log(`built quotient/app (version ${version})`);
