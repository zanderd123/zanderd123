/**
 * quotient.html is written for the Claude Artifact host, which supplies the
 * outer document. This wraps it into a standalone page that opens by
 * double-clicking it or from any static host.
 *
 *   node quotient/build.mjs  ->  quotient/index.html
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, 'quotient.html'), 'utf8');

writeFileSync(join(here, 'index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style>
</head>
<body>
${page}
</body>
</html>
`);
console.log('built quotient/index.html');
