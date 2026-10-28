/**
 * Builds one self-contained HTML file with every script and style inlined.
 *
 *   node build.mjs             ->  dist/adulting-quest.html  (full document)
 *   node build.mjs --artifact  ->  dist/adulting-quest-artifact.html
 *
 * The game is plain browser scripts (no modules, no bundler), so the build is
 * just concatenation in the order index.html lists them.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'styles.css'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const js = scripts.map((s) => `// ---- ${s}\n` + readFileSync(join(root, s), 'utf8')).join('\n');

const body = html
  .slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'))
  .replace(/<!-- scripts[\s\S]*$/, '')
  .trim();
const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link href="https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@400;600;700&display=swap" rel="stylesheet">';

const forArtifact = process.argv.includes('--artifact');
const inner = `${fonts}\n<style>\n${css}\n</style>\n${body}\n<script>\n${js}\n</script>\n`;
const out = forArtifact
  ? `<title>Adulting Quest</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n${inner}`
  : `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n<title>Adulting Quest</title>\n</head>\n<body>\n${inner}</body>\n</html>\n`;

mkdirSync(join(root, 'dist'), { recursive: true });
const file = join(root, 'dist', forArtifact ? 'adulting-quest-artifact.html' : 'adulting-quest.html');
writeFileSync(file, out);
console.log(`wrote ${file} (${(out.length / 1024).toFixed(1)} KB)`);
