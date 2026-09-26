// Builds Quackdex into single, self-contained HTML files.
//
//   node build.mjs
//
// dist/quackdex.html           standalone page: open it directly, or host it
//                              anywhere static (GitHub Pages, Netlify, ...)
// dist/quackdex.artifact.html  the same app as a page fragment for publishing
//                              as a claude.ai artifact (the host adds <head>)
//
// The source modules are concatenated in dependency order into one inline
// script, with their import/export lines stripped. No bundler needed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { duckSVG, MALLARD } from "./src/duck.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (f) => fs.readFileSync(path.join(here, "src", f), "utf8");

const MODULES = ["species.js", "basemap.js", "duck.js", "app.js"];
const LEAFLET_JS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js";
const FONTS = "https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600&family=Nunito+Sans:opsz,wght@6..12,400;6..12,700;6..12,800&display=swap";

const script = MODULES.map((f) =>
  `// ── ${f} ──\n` +
  src(f)
    .replace(/^import [^;]+;\s*$/gm, "")
    .replace(/^export /gm, ""),
).join("\n");

const js = `(() => {\n"use strict";\n${script}\n})();`.replace(/<\/script/gi, "<\\/script");
const css = src("leaflet.css") + "\n" + src("styles.css");
const shell = src("shell.html");
const favicon = "data:image/svg+xml," + encodeURIComponent(duckSVG({ ...MALLARD, water: false }).replace(/\s+/g, " "));

const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">`;

const body = `${shell}
<script src="${LEAFLET_JS}" crossorigin="anonymous"></script>
<script>
${js}
</script>`;

const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#FFFFFF">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Quackdex">
<meta name="description" content="Identify any duck from a photo, browse every duck species, and pin your sightings on a map.">
<title>Quackdex</title>
<link rel="icon" href="${favicon}">
${fonts}
<style>
${css}
</style>
</head>
<body>
${body}
</body>
</html>
`;

const fragment = `<title>Quackdex</title>
${fonts}
<style>
${css}
</style>
${body}
`;

fs.mkdirSync(path.join(here, "dist"), { recursive: true });
for (const [name, html] of [["quackdex.html", standalone], ["quackdex.artifact.html", fragment]]) {
  fs.writeFileSync(path.join(here, "dist", name), html);
  console.log(`dist/${name}  ${(html.length / 1024).toFixed(0)} KB`);
}
