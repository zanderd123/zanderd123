/**
 * Builds Holding Pattern into one self-contained HTML file.
 *
 *   node build.mjs             ->  dist/holding-pattern.html          (standalone page)
 *   node build.mjs --artifact  ->  dist/holding-pattern-artifact.html  (no outer html/head/body)
 *
 * The page needs no server: open the file directly. Fonts come from Google
 * Fonts when online and fall back to system faces when not.
 */
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

const result = await build({
  entryPoints: [join(root, 'src/main.js')],
  bundle: true, format: 'iife', minify: true, write: false, target: 'es2020',
  logLevel: 'warning',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync(join(root, 'styles.css'), 'utf8');
const html = readFileSync(join(root, 'index.html'), 'utf8');

const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'))
  .replace(/<link rel="stylesheet" href="styles.css" \/>/, '')
  .replace(/<meta charset[^>]*>\s*/, '')
  .replace(/<meta name="viewport"[^>]*>\s*/, '')
  .trim();
const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'))
  .replace(/<script type="module"[\s\S]*?<\/script>/g, '')
  .trim();

const artifact = process.argv.includes('--artifact');
const inner = `${head}
<style>
${css}
</style>
${body}
<script>
${js}
</script>
`;
const out = artifact ? inner : `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
${inner.replace(body, '</head>\n<body>\n' + body)}</body>
</html>
`;

mkdirSync(join(root, 'dist'), { recursive: true });
const dest = join(root, 'dist', artifact ? 'holding-pattern-artifact.html' : 'holding-pattern.html');
writeFileSync(dest, out);
console.log(`built ${dest} — ${(statSync(dest).size / 1024).toFixed(0)} KB`);
