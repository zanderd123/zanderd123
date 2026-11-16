// Assembles the clickable prototype into one self-contained HTML file:
//   node loobook/prototype/build.mjs  ->  loobook/prototype/dist/loobook.html
// Inlines the Leaflet stylesheet, the Natural Earth outlines and the legal
// documents (rendered from loobook/legal/*.md, so there is one source of truth).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(here, ...p), "utf8");

// Tiny Markdown renderer: headings, paragraphs, bullet lists, **bold**, _italic_.
function md(src) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|\W)_(.+?)_(?=\W|$)/g, "$1<em>$2</em>");
  const out = [];
  let list = null, para = [];
  const flush = () => {
    if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; }
    if (list) { out.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join("")}</ul>`); list = null; }
  };
  for (const line of src.split("\n")) {
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) { flush(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    const li = line.match(/^\s*[-*]\s+(.*)/);
    if (li) { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; } (list ||= []).push(li[1]); continue; }
    if (!line.trim()) { flush(); continue; }
    if (list) flush();
    para.push(line.trim());
  }
  flush();
  return out.join("\n");
}

const legal = {
  terms: md(read("..", "legal", "terms-of-service.md")),
  privacy: md(read("..", "legal", "privacy-policy.md")),
  guidelines: md(read("..", "legal", "community-guidelines.md")),
};

const json = (v) => JSON.stringify(v).replace(/</g, "\\u003c");
const world = JSON.parse(read("vendor", "countries-50m.json"));

let html = read("src", "app.html");
const swap = (marker, value) => {
  if (!html.includes(marker)) throw new Error(`missing marker ${marker}`);
  html = html.split(marker).join(value);
};
swap("/*__LEAFLET_CSS__*/", read("vendor", "leaflet.css").replace(/url\(images\/[^)]+\)/g, "none"));
swap("/*__LEGAL_JSON__*/null", json(legal));
swap("/*__WORLD_JSON__*/null", json(world));
swap("/*__APP_JS__*/", read("src", "app.js"));

mkdirSync(join(here, "dist"), { recursive: true });
const out = join(here, "dist", "loobook.html");
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);

// A standalone copy with its own document shell, for hosting anywhere (GitHub Pages, a phone browser).
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#ffffff"><style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}img{max-width:100%}</style></head><body>${html}</body></html>`;
writeFileSync(join(here, "dist", "index.html"), page);
console.log("wrote dist/index.html (standalone)");
