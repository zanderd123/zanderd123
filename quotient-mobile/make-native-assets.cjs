/**
 * Draws the Android and iOS app icons and splash screens from Peanut's icons in
 * ../quotient/app/icons, at every size the native projects already contain.
 *
 *   node make-native-assets.cjs      (needs Playwright: npm i -D playwright)
 */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const here = __dirname, icons = path.join(here, '..', 'quotient', 'app', 'icons');
const sky = fs.readFileSync(path.join(here, '..', 'quotient', 'quotient.html'), 'utf8').match(/--sky: (#[0-9a-f]+);/)[1];
const png = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
const size = f => { const b = fs.readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), p = await b.newPage();
  const draw = (w, h, kind, src) => p.evaluate(async ({ w, h, kind, src, sky }) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
    if (kind === 'splash') {
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      const s = Math.round(Math.min(w, h) * 0.32), x = (w - s) / 2, y = (h - s) / 2, r = s * 0.22;
      g.save(); g.beginPath(); g.roundRect(x, y, s, s, r); g.clip(); g.drawImage(img, x, y, s, s); g.restore();
    } else if (kind === 'round') {
      g.beginPath(); g.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2); g.clip(); g.drawImage(img, 0, 0, w, h);
    } else g.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/png').split(',')[1];
  }, { w, h, kind, src, sky });
  const icon = png(path.join(icons, 'icon-1024.png')), maskable = png(path.join(icons, 'icon-maskable-512.png'));
  const jobs = [];
  for (const f of walk(path.join(here, 'android', 'app', 'src', 'main', 'res'))) {
    const n = path.basename(f);
    if (n === 'ic_launcher.png') jobs.push([f, 'square', icon]);
    if (n === 'ic_launcher_round.png') jobs.push([f, 'round', icon]);
    if (n === 'ic_launcher_foreground.png') jobs.push([f, 'square', maskable]);
    if (n === 'splash.png') jobs.push([f, 'splash', icon]);
  }
  const ios = path.join(here, 'ios', 'App', 'App', 'Assets.xcassets');
  jobs.push([path.join(ios, 'AppIcon.appiconset', 'AppIcon-512@2x.png'), 'square', icon]);
  for (const f of walk(path.join(ios, 'Splash.imageset'))) if (f.endsWith('.png')) jobs.push([f, 'splash', icon]);
  for (const [f, kind, src] of jobs) { const [w, h] = size(f); fs.writeFileSync(f, Buffer.from(await draw(w, h, kind, src), 'base64')); }
  // The adaptive icon's background layer matches the sky colour.
  const bg = path.join(here, 'android', 'app', 'src', 'main', 'res', 'values', 'ic_launcher_background.xml');
  fs.writeFileSync(bg, `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${sky.toUpperCase()}</color>\n</resources>\n`);
  console.log(`drew ${jobs.length} icons and splash screens`);
  await b.close();
})();
