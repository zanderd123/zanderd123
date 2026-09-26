// Quackdex app logic. Plain browser JavaScript, no framework.
//
// build.mjs concatenates species.js, basemap.js, duck.js and this file into
// one inline script, stripping the import/export lines below.

import { SPECIES, SPECIES_BY_ID, GROUPS, REGIONS, STATUS } from "./species.js";
import { LAND, BORDERS } from "./basemap.js";
import { duckSVG, speciesDuck, MALLARD } from "./duck.js";

// ── Small helpers ──────────────────────────────────────────────────
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const lsGet = (k, fallback = null) => { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch {} };

const STATUS_ORDER = ["EX", "CR", "EN", "VU", "NT", "LC", "DOM"];
const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const fmtDateTime = (iso) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const fmtCoord = (lat, lng) => `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lng).toFixed(4)}°${lng >= 0 ? "E" : "W"}`;
const lenMid = (sp) => { const n = String(sp.len).match(/\d+/g)?.map(Number) ?? [0]; return (n[0] + (n[1] ?? n[0])) / 2; };
const statusPill = (code) => `<span class="status" style="--st-color:var(--st-${code})" title="${esc(STATUS[code].label)}"><b>${code}</b>${esc(STATUS[code].label)}</span>`;
const regionNames = (sp) => sp.regions.split(" ").map((r) => REGIONS[r]).join(", ");

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("is-on");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("is-on"), 2600);
}

const LOCAL_KEY = "quackdex.sightings.v1";
const API_KEY = "quackdex.anthropicKey";
const FUN_FACTS = [
  "A duck's feathers are so waterproof that water rolls straight off: a gland near the tail supplies the oil.",
  "Ducks have three eyelids. The third is see-through, like built-in swimming goggles.",
  "Ducklings can swim within hours of hatching.",
  "Most ducks moult all their flight feathers at once and can't fly for about a month.",
  "A duck's feet have no nerves or blood vessels that feel cold, so they paddle happily in icy water.",
  "Only female Mallards make the classic loud quack.",
  "Some ducks sleep in a row, and the birds at each end keep one eye open.",
  "The Steller's Eider can dive in near-freezing Arctic water for mussels.",
];
const BUSY_MSGS = [
  "Taking a closer look…", "Checking the bill colour…", "Looking for a wing patch…",
  "Comparing head shapes…", "Flipping through 140 species…", "Counting feathers (roughly)…",
];

// ── App state ──────────────────────────────────────────────────────
const state = {
  tab: "identify",
  sightings: [],
  me: "me",               // viewer id on the shared map, "me" on this device
  names: {},              // viewer id -> display name, shared map only
  store: null,
  canWrite: true,
  engine: null,           // how photos get identified
  mapWho: "all",
  mapSpecies: "",
  logWho: "mine",
  dir: { q: "", group: "", region: "", status: "", sort: "group" },
  matcher: { region: "", head: "", bill: "", size: "" },
  lastPhoto: null,        // { thumb, exif } from the most recent identification
};

// ── Sighting stores ────────────────────────────────────────────────
// Both stores expose the same shape: subscribe(cb), add(s), remove(id).

function localStore() {
  let listeners = [];
  const read = () => lsGet(LOCAL_KEY, []);
  const emit = () => listeners.forEach((cb) => cb(read()));
  window.addEventListener("storage", (e) => { if (e.key === LOCAL_KEY) emit(); });
  return {
    kind: "local",
    subscribe(cb) { listeners.push(cb); cb(read()); },
    async add(s) {
      const list = read().filter((x) => x.id !== s.id);
      list.push(s);
      if (!lsSet(LOCAL_KEY, list)) throw new Error("This browser won't let Quackdex save. Try removing the photo or freeing space.");
      emit();
    },
    async remove(id) { lsSet(LOCAL_KEY, read().filter((x) => x.id !== id)); emit(); },
  };
}

function sharedStore(db) {
  return {
    kind: "shared",
    subscribe(cb, onError) {
      return db.collection("sightings").orderBy("seenAt", "desc").limit(1000).onSnapshot(
        (snap) => cb(snap.docs.map((d) => ({ ...d.data(), id: d.id }))),
        (e) => onError?.(e),
      );
    },
    async add(s) {
      try { await db.doc("sightings/" + s.id).set(s); }
      catch (e) {
        if (e?.code === "unavailable") { await sleep(600 + Math.random() * 600); return db.doc("sightings/" + s.id).set(s); }
        throw e;
      }
    },
    async remove(id) { await db.doc("sightings/" + id).delete(); },
  };
}

function setSightings(list) {
  state.sightings = list.slice().sort((a, b) => b.seenAt.localeCompare(a.seenAt));
  resolveNames();
  renderMapMarkers();
  renderLog();
  if (state.tab === "directory") renderDirectory();
}

async function useStore(store) {
  state.store = store;
  store.subscribe(setSightings, (e) => {
    if (e?.code === "revoked") toast("The shared map is no longer available in this view.");
  });
  const chip = $("#storeChip");
  chip.classList.toggle("is-local", store.kind === "local");
  chip.querySelector("span").textContent = store.kind === "shared" ? "Shared map" : "This device";
}

// ── Claude runtime (only present when opened as a claude.ai artifact) ─
const hasRuntime = typeof window.claude?.use === "function";
let userCap = null;

async function connectRuntime() {
  if (!hasRuntime) return;
  const [sample, db, user] = await Promise.all(
    ["sample", "db", "user"].map((n) => window.claude.use(n).catch(() => null)),
  );
  userCap = user;

  if (sample) {
    const limits = await sample.limits().catch(() => null);
    if (limits?.images) state.engine = { kind: "claude", run: (img, signal) => identifyWithSample(sample, img, signal) };
  }
  if (!state.engine) state.engine = apiKeyEngine();
  renderEngineNote();

  if (db && user) {
    const id = await user.id().catch(() => null);
    if (id) {
      state.me = id;
      const can = await Promise.resolve(user.can?.("data.write")).catch(() => null);
      state.canWrite = can !== false;
      await useStore(sharedStore(db));
      renderLog();
      $("#addSightingBtn").hidden = !state.canWrite;
    }
  }
}

async function resolveNames() {
  if (!userCap?.profiles || state.store?.kind !== "shared") return;
  const ids = [...new Set(state.sightings.map((s) => s.by).filter((id) => id && id !== state.me && !(id in state.names)))];
  if (!ids.length) return;
  const profiles = await userCap.profiles(ids).catch(() => ({}));
  for (const id of ids) state.names[id] = profiles?.[id]?.name || "Someone";
  renderMapMarkers();
  renderLog();
}

const who = (s) => (s.by === state.me ? "You" : state.store?.kind === "shared" ? state.names[s.by] || "Someone" : "You");
const isMine = (s) => s.by === state.me;

// ── Photo identification ───────────────────────────────────────────
const directoryForPrompt = () => SPECIES.map((s) => `${s.id} | ${s.name} | ${s.sci}`).join("\n");

function idPrompt() {
  return `You are identifying a duck in a photo for a birdwatching field-guide app.

Choose the species from this directory (id | common name | scientific name). If the bird is a duck that is not listed, set speciesId to null and give its name in commonName. Domestic breeds and Mallard hybrids are common on park ponds; say so when the plumage suggests one.

<directory>
${directoryForPrompt()}
</directory>

Reply with only a JSON object in exactly this shape:
{"isDuck": true, "subject": "one sentence describing the bird", "speciesId": "mallard", "commonName": "Mallard", "confidence": 88, "sex": "adult male", "fieldMarks": ["glossy green head", "white neck ring"], "alternatives": [{"speciesId": "american-black-duck", "confidence": 6, "why": "short reason"}], "facts": ["fact one", "fact two", "fact three"], "note": ""}

Rules:
- isDuck is false when the main subject is not a duck (a goose, swan, coot, grebe, gull, cormorant, or not a bird at all). Then describe it in subject, set speciesId to null and confidence to 0.
- confidence is 0-100 and honest: lower it for blurry, distant, backlit or partial views.
- sex is one of: adult male, adult female, eclipse male, juvenile, duckling, mixed group, unknown.
- fieldMarks lists 2-5 short phrases describing what is visible in THIS photo that supports the identification.
- alternatives lists up to 3 other plausible species from the directory, most likely first.
- facts gives 3 short, surprising and accurate facts about the identified species, one sentence each.
- note is a short caveat (possible hybrid, several species in frame, poor light) or "".
- If several ducks are visible, identify the most prominent one and mention the others in note.`;
}

function parseJSONLoose(text) {
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch {} }
  throw new Error("Claude's answer couldn't be read. Try again.");
}

const SAMPLE_ERRORS = {
  not_granted: "Photo ID needs permission to use Claude. Reload the page to be asked again.",
  sampling_disabled: "Claude isn't available on this account, so photo ID is off. Try matching by field marks.",
  rate_limited: "Too many identifications at once. Wait a minute and try again.",
  image_rejected: "That image couldn't be read. Try a JPEG or PNG photo.",
  refused: "Claude declined to identify this image. Try a different photo.",
  session_expired: "You've been signed out of Claude. Sign in again, then retry.",
};

async function identifyWithSample(sample, img, signal) {
  try {
    return await sample.json(idPrompt(), { images: img.blob, signal, modelTier: "default" });
  } catch (e) {
    if (e?.code === "cancelled") throw e;
    throw new Error(SAMPLE_ERRORS[e?.code] || "Couldn't reach Claude just now. Check your connection and try again.");
  }
}

function apiKeyEngine() {
  const key = lsGet(API_KEY);
  if (!key) return null;
  return { kind: "api", run: (img, signal) => identifyWithApi(key, img, signal) };
}

// Standalone copy: calls the Claude API straight from the browser with the
// viewer's own key (kept in this browser's localStorage only).
async function identifyWithApi(apiKey, img, signal) {
  const { default: Anthropic } = await import("https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.128.0/+esm");
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const data = await blobToBase64(img.blob);
  let response;
  try {
    response = await client.beta.messages.create({
      model: "claude-opus-5",
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data } },
          { type: "text", text: idPrompt() },
        ],
      }],
    }, { signal });
  } catch (e) {
    if (signal?.aborted) throw { code: "cancelled" };
    if (e instanceof Anthropic.AuthenticationError) throw new Error("Your Anthropic API key was rejected. Check it in Settings.");
    if (e instanceof Anthropic.RateLimitError) throw new Error("Rate limited by the Claude API. Wait a moment and try again.");
    if (e instanceof Anthropic.APIError) throw new Error(`The Claude API returned an error (${e.status ?? "network"}). Try again.`);
    throw new Error("Couldn't reach the Claude API. Check your connection.");
  }
  if (response.stop_reason === "refusal") throw new Error(SAMPLE_ERRORS.refused);
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return parseJSONLoose(text);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// Decode a picked file, downscale it for sending, and make a small thumbnail
// for the sightings map.
async function prepareImage(file) {
  const buf = await file.arrayBuffer();
  const exif = readExif(buf);
  const url = URL.createObjectURL(file);
  try {
    const im = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That file isn't an image this browser can open. Try a JPEG or PNG."));
      i.src = url;
    });
    const draw = (max) => {
      const scale = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(im.naturalWidth * scale);
      c.height = Math.round(im.naturalHeight * scale);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      return c;
    };
    const big = draw(1568);
    const blob = await new Promise((r) => big.toBlob(r, "image/jpeg", 0.86));
    const thumb = draw(360).toDataURL("image/jpeg", 0.7);
    const preview = draw(1100).toDataURL("image/jpeg", 0.84);
    return { blob, thumb, preview, exif };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Minimal EXIF reader: capture date and GPS position from a JPEG.
function readExif(buf) {
  try {
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xffd8) return {};
    let off = 2;
    while (off + 4 < v.byteLength) {
      const marker = v.getUint16(off);
      const size = v.getUint16(off + 2);
      if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) return parseTiff(v, off + 10);
      if ((marker & 0xff00) !== 0xff00) break;
      off += 2 + size;
    }
  } catch {}
  return {};
}

function parseTiff(v, start) {
  const le = v.getUint16(start) === 0x4949;
  const u16 = (o) => v.getUint16(start + o, le);
  const u32 = (o) => v.getUint32(start + o, le);
  const readIfd = (o) => {
    const tags = {};
    const n = u16(o);
    for (let i = 0; i < n; i++) {
      const e = o + 2 + i * 12;
      tags[u16(e)] = { type: u16(e + 2), count: u32(e + 4), valOff: e + 8 };
    }
    return tags;
  };
  const ascii = (t) => {
    const o = t.count > 4 ? u32(t.valOff) : t.valOff;
    let s = "";
    for (let i = 0; i < t.count - 1; i++) s += String.fromCharCode(v.getUint8(start + o + i));
    return s;
  };
  const rationals = (t) => {
    const o = u32(t.valOff);
    return Array.from({ length: t.count }, (_, i) => u32(o + i * 8) / (u32(o + i * 8 + 4) || 1));
  };
  const out = {};
  const ifd0 = readIfd(u32(4));
  if (ifd0[0x8769]) {
    const ex = readIfd(u32(ifd0[0x8769].valOff));
    const dt = ex[0x9003] || ex[0x9004];
    if (dt) {
      const m = ascii(dt).match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/);
      if (m) out.date = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).toISOString();
    }
  }
  if (ifd0[0x8825]) {
    const g = readIfd(u32(ifd0[0x8825].valOff));
    if (g[2] && g[4]) {
      const dms = (a) => a[0] + a[1] / 60 + a[2] / 3600;
      let lat = dms(rationals(g[2])), lng = dms(rationals(g[4]));
      if (g[1] && ascii({ ...g[1], count: 2 }) === "S") lat = -lat;
      if (g[3] && ascii({ ...g[3], count: 2 }) === "W") lng = -lng;
      if (isFinite(lat) && isFinite(lng) && (lat || lng)) { out.lat = lat; out.lng = lng; }
    }
  }
  return out;
}

// ── Loading overlay ────────────────────────────────────────────────
function mountDucks() {
  for (const el of $$('[data-duck="loader"]')) el.innerHTML = duckSVG({ ...MALLARD, animated: true, label: "Loading" });
  for (const el of $$('[data-duck="logo"]')) el.innerHTML = duckSVG({ ...MALLARD, animated: true, water: true, label: "Quackdex mallard logo" });
}

let busyTimer = null;
function showBusy(onStop) {
  const el = $("#busy");
  el.hidden = false;
  el.classList.remove("is-leaving");
  let i = 0;
  $("#busyMsg").textContent = BUSY_MSGS[0];
  $("#busyFact").textContent = "Did you know? " + FUN_FACTS[Math.floor(Math.random() * FUN_FACTS.length)];
  busyTimer = setInterval(() => { i = (i + 1) % BUSY_MSGS.length; $("#busyMsg").textContent = BUSY_MSGS[i]; }, 2200);
  $("#busyStop").onclick = onStop;
}
function hideBusy() {
  clearInterval(busyTimer);
  const el = $("#busy");
  el.classList.add("is-leaving");
  setTimeout(() => { el.hidden = true; }, 350);
}

// ── Identify view ──────────────────────────────────────────────────
function renderEngineNote() {
  const e = state.engine;
  const note = $("#engineNote");
  if (e?.kind === "claude") {
    note.innerHTML = `<span class="engine-dot is-on"></span><span><b>Photo ID by Claude.</b> Uses your Claude account. You'll be asked once before the first photo is sent.</span>`;
  } else if (e?.kind === "api") {
    note.innerHTML = `<span class="engine-dot is-on"></span><span><b>Photo ID by Claude</b> with your API key. <button class="btn btn-ghost btn-sm" data-open-settings type="button">Change key</button></span>`;
  } else {
    note.innerHTML = `<span class="engine-dot"></span><span><b>Photo ID is off.</b> Add an Anthropic API key in Settings to identify photos, or match by field marks below. <button class="btn btn-soft btn-sm" data-open-settings type="button">Open settings</button></span>`;
  }
}

async function handlePhoto(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) { toast("That isn't an image file."); return; }
  let img;
  try { img = await prepareImage(file); }
  catch (e) { renderResultError(e.message); return; }
  state.lastPhoto = img;

  if (!state.engine) {
    renderNoEngine(img);
    return;
  }
  const ctl = new AbortController();
  showBusy(() => ctl.abort());
  try {
    const [result] = await Promise.all([state.engine.run(img, ctl.signal), sleep(900)]);
    renderResult(result, img);
  } catch (e) {
    if (e?.code === "cancelled" || ctl.signal.aborted) renderResultError("Stopped. Pick the photo again to retry.", img);
    else renderResultError(e.message || "Something went wrong. Try again.", img);
  } finally {
    hideBusy();
  }
}

function speciesFacts(sp) {
  const cells = [
    ["Length", `${sp.len} cm`],
    sp.x?.weight && ["Weight", sp.x.weight],
    sp.x?.wingspan && ["Wingspan", sp.x.wingspan],
    sp.x?.lifespan && ["Lifespan", sp.x.lifespan],
  ].filter(Boolean);
  return `<div class="facts-grid">${cells.map(([k, v]) => `<div class="fact-cell"><span class="label">${k}</span><b class="num">${esc(v)}</b></div>`).join("")}</div>`;
}

function renderResult(r, img) {
  const area = $("#resultArea");
  const sp = r?.speciesId ? SPECIES_BY_ID[r.speciesId] : null;
  const conf = Math.max(0, Math.min(100, Math.round(Number(r?.confidence) || 0)));
  const photo = `<div class="result-photo"><img src="${img.preview}" alt="Your photo"></div>`;

  if (!r || r.isDuck === false) {
    area.innerHTML = `<div class="section"><div class="result">${photo}<div class="result-body">
      <span class="label">Not a duck?</span>
      <h2>${esc(r?.commonName || "No duck found")}</h2>
      <p>${esc(r?.subject || "Claude couldn't find a duck in this photo.")}</p>
      ${r?.note ? `<p class="muted">${esc(r.note)}</p>` : ""}
      <div class="row-actions"><label class="btn btn-soft" for="uploadInput">Try another photo</label></div>
    </div></div></div>`;
    area.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const name = sp?.name || r.commonName || "Unknown duck";
  const alts = (r.alternatives || []).filter((a) => SPECIES_BY_ID[a.speciesId] && a.speciesId !== sp?.id).slice(0, 3);
  const facts = (r.facts || []).filter(Boolean).slice(0, 3);
  const confWord = conf >= 85 ? "Very likely" : conf >= 65 ? "Likely" : conf >= 40 ? "Possible" : "Uncertain";

  area.innerHTML = `<div class="section"><div class="result">${photo}<div class="result-body">
    <div class="result-title">
      ${sp ? speciesDuck(sp, { animated: true }) : duckSVG({ animated: true })}
      <div><span class="label">${esc(confWord)} · ${esc(r.sex || "unknown")}</span><h2>${esc(name)}</h2>
      ${sp ? `<p class="sci">${esc(sp.sci)}</p>` : ""}</div>
    </div>
    <div class="confidence">
      <div class="section-head"><span class="label">Confidence</span><b class="num">${conf}%</b></div>
      <div class="meter" role="meter" aria-valuenow="${conf}" aria-valuemin="0" aria-valuemax="100" aria-label="Confidence"><i style="width:${conf}%"></i></div>
    </div>
    ${sp ? `<div class="tags">${statusPill(sp.status)}<span class="tag">${esc(GROUPS[sp.group].name)}</span></div>` : ""}
    ${r.note ? `<div class="callout">${esc(r.note)}</div>` : ""}
    ${(r.fieldMarks || []).length ? `<div class="prose"><span class="label">What Claude noticed</span><ul class="checklist">${r.fieldMarks.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>` : ""}
    ${sp ? `<div class="prose"><span class="label">About the ${esc(sp.name)}</span><p>${esc(sp.about)}</p><p class="muted">${esc(sp.marks)}</p></div>${speciesFacts(sp)}` : ""}
    ${facts.length ? `<div class="prose"><span class="label">Fun facts</span><ul class="facts">${facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>` : ""}
    ${alts.length ? `<div class="prose"><span class="label">Could also be</span><div class="alt-list">${alts.map((a) => `<button class="alt" type="button" data-species="${a.speciesId}"><b>${esc(SPECIES_BY_ID[a.speciesId].name)}</b><span class="muted">${esc(a.why || "")}${a.confidence ? ` · ${Math.round(a.confidence)}%` : ""}</span></button>`).join("")}</div></div>` : ""}
    <div class="row-actions">
      ${state.canWrite ? `<button class="btn btn-primary" type="button" data-log-species="${sp?.id || ""}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>
        Pin this sighting</button>` : ""}
      ${sp ? `<button class="btn btn-soft" type="button" data-species="${sp.id}">Open in directory</button>` : ""}
    </div>
  </div></div></div>`;
  area.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderResultError(msg, img) {
  $("#resultArea").innerHTML = `<div class="section"><div class="callout"><b>Couldn't identify that photo</b><span>${esc(msg)}</span>
    <div class="row-actions"><label class="btn btn-soft btn-sm" for="uploadInput">Choose another photo</label>
    ${img && state.canWrite ? `<button class="btn btn-ghost btn-sm" type="button" data-log-species="">Pin it anyway</button>` : ""}</div></div></div>`;
}

function renderNoEngine(img) {
  $("#resultArea").innerHTML = `<div class="section"><div class="result">
    <div class="result-photo"><img src="${img.preview}" alt="Your photo"></div>
    <div class="result-body">
      <span class="label">Photo ready</span>
      <h2>Photo ID needs Claude</h2>
      <p>Add an Anthropic API key in Settings and Quackdex will name the species from your photo. Meanwhile, compare it against the field-mark matcher below, or pin it on the map as an unknown duck.</p>
      <div class="row-actions">
        <button class="btn btn-primary" type="button" data-open-settings>Add API key</button>
        ${state.canWrite ? `<button class="btn btn-soft" type="button" data-log-species="">Pin as unknown duck</button>` : ""}
      </div>
    </div></div></div>`;
  $("#matcherSection").scrollIntoView({ behavior: "smooth", block: "start" });
}

// Field-mark matcher: scores species by adult-male colours, size and region.
function colorFamily(hex) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
  let hue = 0;
  if (max !== min) {
    hue = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
    hue = (hue * 60 + 360) % 360;
  }
  if (l > 0.86) return "white";
  if (l < 0.17) return "black";
  if (s < 0.14) return l > 0.62 ? "white" : "grey";
  if (hue < 18 || hue >= 330) return l > 0.62 ? "pink" : "red";
  if (hue < 42) return l > 0.62 ? "buff" : "brown";
  if (hue < 68) return l > 0.62 ? "buff" : "yellow";
  if (hue < 170) return "green";
  if (hue < 255) return "blue";
  return l > 0.55 ? "pink" : "purple";
}
const HEAD_OPTS = [
  ["green", "Green", "#1F7A4D", ["green"]],
  ["brown", "Brown / chestnut", "#8B3A24", ["brown", "red"]],
  ["buff", "Pale / buff", "#D9C9A6", ["buff", "yellow"]],
  ["grey", "Grey / blue-grey", "#8A93A0", ["grey", "blue"]],
  ["black", "Black / purple", "#1E1A26", ["black", "purple"]],
  ["white", "White", "#F4F4F2", ["white", "pink"]],
];
const BILL_OPTS = [
  ["yellow", "Yellow / orange", "#F2C230", ["yellow", "buff", "brown"]],
  ["red", "Red / pink", "#D9362F", ["red", "pink", "purple"]],
  ["blue", "Blue", "#4AA0E0", ["blue"]],
  ["dark", "Black / grey", "#2A2A2A", ["black", "grey", "green", "white"]],
];
const SIZE_OPTS = [["small", "Small (under 40 cm)", 0, 40], ["medium", "Medium (40–55 cm)", 40, 55], ["large", "Large (over 55 cm)", 55, 999]];

function renderMatcher() {
  const m = state.matcher;
  const chip = (key, val, text, sw) =>
    `<button class="chip" type="button" data-m="${key}" data-v="${val}" aria-pressed="${m[key] === val}">${sw ? `<span class="sw" style="background:${sw}"></span>` : ""}${esc(text)}</button>`;
  const regionOpts = Object.entries(REGIONS).map(([k, v]) => `<option value="${k}"${m.region === k ? " selected" : ""}>${esc(v)}</option>`).join("");
  const active = m.head || m.bill || m.size || m.region;

  let results = "";
  if (active) {
    const scored = SPECIES.map((sp) => {
      let score = 0;
      const [head, bill] = sp.colors;
      if (m.head && HEAD_OPTS.find((o) => o[0] === m.head)[3].includes(colorFamily(head))) score += 3;
      if (m.bill && BILL_OPTS.find((o) => o[0] === m.bill)[3].includes(colorFamily(bill))) score += 2;
      if (m.size) { const [, , lo, hi] = SIZE_OPTS.find((o) => o[0] === m.size); const L = lenMid(sp); if (L >= lo && L < hi) score += 1.5; }
      if (m.region) score += sp.regions.includes(m.region) ? 2 : -4;
      if (sp.status === "EX") score -= 5;
      return { sp, score };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || lenMid(a.sp) - lenMid(b.sp)).slice(0, 6);
    results = scored.length
      ? `<div class="cards">${scored.map(({ sp }) => speciesCard(sp)).join("")}</div>`
      : `<p class="muted">No species match all of those. Try loosening a choice.</p>`;
  }

  $("#matcher").innerHTML = `
    <p class="muted" style="font-size:.9rem">Pick what you can see. Colours are for adult males; brown females are easier to pin down in the directory with a region filter.</p>
    <div class="field"><span class="label">Where are you?</span><select class="select" id="mRegion"><option value="">Anywhere</option>${regionOpts}</select></div>
    <div class="field"><span class="label">Head colour</span><div class="chips">${HEAD_OPTS.map((o) => chip("head", o[0], o[1], o[2])).join("")}</div></div>
    <div class="field"><span class="label">Bill colour</span><div class="chips">${BILL_OPTS.map((o) => chip("bill", o[0], o[1], o[2])).join("")}</div></div>
    <div class="field"><span class="label">Size</span><div class="chips">${SIZE_OPTS.map((o) => chip("size", o[0], o[1])).join("")}</div></div>
    ${results ? `<div class="field"><span class="label">Best matches</span>${results}</div>` : ""}`;
  $("#mRegion").onchange = (e) => { state.matcher.region = e.target.value; renderMatcher(); };
}

function renderDuckOfTheDay() {
  const pool = SPECIES.filter((s) => s.status !== "DOM");
  const day = Math.floor(Date.now() / 86400000);
  const sp = pool[(day * 37) % pool.length];
  $("#dotdDate").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  $("#dotd").innerHTML = `<button class="dotd" type="button" data-species="${sp.id}">
    ${speciesDuck(sp, { animated: true })}
    <span style="display:grid;gap:6px"><span class="card-name" style="font-size:1.1rem">${esc(sp.name)}</span>
    <span class="sci">${esc(sp.sci)}</span><span>${esc(sp.about)}</span>
    <span class="tags">${statusPill(sp.status)}<span class="tag">${esc(regionNames(sp))}</span></span></span>
  </button>`;
}

// ── Directory ──────────────────────────────────────────────────────
function seenCounts() {
  const mine = {}, all = {};
  for (const s of state.sightings) {
    if (!s.speciesId) continue;
    all[s.speciesId] = (all[s.speciesId] || 0) + 1;
    if (isMine(s)) mine[s.speciesId] = (mine[s.speciesId] || 0) + 1;
  }
  return { mine, all };
}

function speciesCard(sp, seen) {
  return `<button class="card" type="button" data-species="${sp.id}">
    ${speciesDuck(sp)}
    <span><span class="card-name">${esc(sp.name)}</span><br><span class="sci" style="font-size:.85rem">${esc(sp.sci)}</span>
    <span class="card-meta">${statusPill(sp.status)}<span class="num">${esc(sp.len)} cm</span>${seen ? `<span class="seen-badge">Seen ×${seen}</span>` : ""}</span></span>
  </button>`;
}

function initDirectoryControls() {
  $("#groupChips").innerHTML = [["", "All ducks"], ...Object.entries(GROUPS).map(([k, g]) => [k, g.name])]
    .map(([k, n]) => `<button class="chip" type="button" data-group="${k}" aria-pressed="${state.dir.group === k}">${esc(n)}</button>`).join("");
  $("#dirRegion").innerHTML = `<option value="">All regions</option>` + Object.entries(REGIONS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
  $("#dirStatus").innerHTML = `<option value="">Any status</option><option value="threatened">Threatened (VU, EN, CR)</option>` +
    STATUS_ORDER.map((k) => `<option value="${k}">${esc(STATUS[k].label)}</option>`).join("");
  $("#dirSearch").addEventListener("input", (e) => { state.dir.q = e.target.value; renderDirectory(); });
  $("#dirRegion").onchange = (e) => { state.dir.region = e.target.value; renderDirectory(); };
  $("#dirStatus").onchange = (e) => { state.dir.status = e.target.value; renderDirectory(); };
  $("#dirSort").onchange = (e) => { state.dir.sort = e.target.value; renderDirectory(); };
  $("#groupChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-group]");
    if (!b) return;
    state.dir.group = b.dataset.group;
    $$("#groupChips .chip").forEach((c) => c.setAttribute("aria-pressed", c.dataset.group === state.dir.group));
    renderDirectory();
  });
}

function renderDirectory() {
  const d = state.dir;
  const q = d.q.trim().toLowerCase();
  const { mine } = seenCounts();
  let list = SPECIES.filter((sp) =>
    (!q || `${sp.name} ${sp.sci} ${sp.marks} ${GROUPS[sp.group].name}`.toLowerCase().includes(q)) &&
    (!d.group || sp.group === d.group) &&
    (!d.region || sp.regions.includes(d.region)) &&
    (!d.status || (d.status === "threatened" ? ["VU", "EN", "CR"].includes(sp.status) : sp.status === d.status)),
  );
  const wild = SPECIES.filter((s) => s.status !== "DOM").length;
  $("#dirCount").textContent = list.length === SPECIES.length
    ? `${wild} wild species · ${SPECIES.length - wild} domestic breeds`
    : `${list.length} of ${SPECIES.length} shown`;

  if (!list.length) {
    $("#dirList").innerHTML = `<div class="empty">${duckSVG({ animated: true })}<p>No ducks match that. Try a shorter search or clear a filter.</p></div>`;
    return;
  }
  if (d.sort === "group") {
    $("#dirList").innerHTML = Object.entries(GROUPS).map(([k, g]) => {
      const items = list.filter((s) => s.group === k);
      if (!items.length) return "";
      return `<div class="group-block"><h2 style="--g:${g.color}"><i></i>${esc(g.name)} <span class="muted num" style="font-size:.9rem;font-family:var(--body)">${items.length}</span></h2>
        <p>${esc(g.blurb)}</p><div class="cards">${items.map((s) => speciesCard(s, mine[s.id])).join("")}</div></div>`;
    }).join("");
    return;
  }
  const sorters = {
    az: (a, b) => a.name.localeCompare(b.name),
    size: (a, b) => lenMid(b) - lenMid(a),
    rare: (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.name.localeCompare(b.name),
  };
  list = list.slice().sort(sorters[d.sort]);
  $("#dirList").innerHTML = `<div class="cards" style="margin-top:14px">${list.map((s) => speciesCard(s, mine[s.id])).join("")}</div>`;
}

function openSpecies(id) {
  const sp = SPECIES_BY_ID[id];
  if (!sp) return;
  const g = GROUPS[sp.group];
  const { mine, all } = seenCounts();
  const sheet = $("#speciesSheet");
  sheet.innerHTML = `<div class="sheet-inner">
    <div class="sheet-head"><div><span class="label">${esc(g.name)}</span><h2 id="speciesSheetTitle" style="font-size:1.6rem">${esc(sp.name)}</h2><p class="sci">${esc(sp.sci)}</p></div>
      <button class="icon-btn" type="button" data-close aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    <div class="sheet-hero">${speciesDuck(sp, { animated: true })}<small>${sp.status === "DOM" ? "Cartoon, typical colours" : "Cartoon of the adult male"}</small></div>
    <div class="tags">${statusPill(sp.status)}${sp.regions.split(" ").map((r) => `<span class="tag">${esc(REGIONS[r])}</span>`).join("")}</div>
    ${speciesFacts(sp)}
    <div class="prose">
      <div><span class="label">How to recognise it</span><p>${esc(sp.marks)}</p></div>
      <div><span class="label">Where to look</span><p>${esc(sp.habitat)}</p></div>
      <div><span class="label">Diet</span><p>${esc(sp.x?.diet || g.diet)}</p></div>
      ${sp.x?.voice ? `<div><span class="label">Voice</span><p>${esc(sp.x.voice)}</p></div>` : ""}
      <div><span class="label">Worth knowing</span><p>${esc(sp.about)}</p></div>
    </div>
    ${sp.x?.facts ? `<ul class="facts">${sp.x.facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
    <p class="muted num">${mine[id] ? `You've logged it ${mine[id]}×. ` : "Not in your log yet. "}${state.store?.kind === "shared" ? `${all[id] || 0} sighting${all[id] === 1 ? "" : "s"} on the shared map.` : ""}</p>
    <div class="row-actions">
      ${state.canWrite && sp.status !== "EX" ? `<button class="btn btn-primary" type="button" data-log-species="${sp.id}" data-fresh>Log a sighting</button>` : ""}
      ${all[id] ? `<button class="btn btn-soft" type="button" data-show-on-map="${sp.id}">Show on map</button>` : ""}
    </div>
  </div>`;
  openSheet(sheet);
}

function openSheet(sheet) {
  if (sheet.open) return;
  if (typeof sheet.showModal === "function") sheet.showModal();
  else sheet.setAttribute("open", "");
}
function closeSheet(sheet) {
  if (typeof sheet.close === "function") sheet.close();
  else sheet.removeAttribute("open");
}

// ── Map ────────────────────────────────────────────────────────────
let map = null, markerLayer = null, tilesFailed = false;
const hasLeaflet = () => typeof window.L !== "undefined";

function decodeLine(str) {
  const a = str.split(",").map(Number);
  const out = [];
  let x = 0, y = 0;
  for (let i = 0; i < a.length; i += 2) { x += a[i]; y += a[i + 1]; out.push([y / 100, x / 100]); }
  return out;
}

function addBasemap(m, withTiles) {
  const renderer = L.canvas({ padding: 0.5 });
  L.polygon(LAND.map((poly) => poly.map(decodeLine)), {
    renderer, stroke: true, color: "#9CC7E6", weight: 1, fillColor: "#FFFFFF", fillOpacity: 1, interactive: false,
  }).addTo(m);
  L.polyline(BORDERS.map(decodeLine), { renderer, color: "#C9DCEA", weight: 0.8, interactive: false }).addTo(m);
  if (!withTiles || tilesFailed) return;
  let errors = 0;
  const tiles = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd", maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  });
  tiles.on("tileerror", () => {
    if (++errors >= 4 && m.hasLayer(tiles)) {
      tilesFailed = true;
      m.removeLayer(tiles);
      $("#mapOffline").hidden = false;
    }
  });
  tiles.addTo(m);
}

function initMap() {
  if (map || !hasLeaflet()) return;
  map = L.map("map", { worldCopyJump: true, zoomControl: false, minZoom: 2 }).setView([30, -20], 2);
  L.control.zoom({ position: "bottomleft" }).addTo(map);
  addBasemap(map, true);
  markerLayer = L.layerGroup().addTo(map);
  map.on("popupopen", (e) => {
    const el = e.popup.getElement();
    if (el && !el.dataset.bound) { el.dataset.bound = "1"; el.addEventListener("click", handleAction); }
  });
  map.on("click", (e) => {
    if (!state.canWrite) return;
    L.popup().setLatLng(e.latlng).setContent(`<div class="pop"><div class="pop-title">Spotted a duck here?</div>
      <div class="pop-meta num">${fmtCoord(e.latlng.lat, e.latlng.lng)}</div>
      <button class="btn btn-primary btn-sm" type="button" data-add-at="${e.latlng.lat},${e.latlng.lng}">Add a sighting here</button></div>`).openOn(map);
  });
  renderMapMarkers(true);
}

const EXAMPLES = [
  { id: "ex1", speciesId: "mallard", count: 4, lat: 40.7794, lng: -73.9632, seenAt: "2026-04-12T09:30:00Z", place: "Central Park, New York", notes: "Pair with ducklings by the Pond." },
  { id: "ex2", speciesId: "wood-duck", count: 1, lat: 38.8893, lng: -77.0502, seenAt: "2026-03-28T08:10:00Z", place: "Washington, DC", notes: "Drake perched on a low branch." },
  { id: "ex3", speciesId: "tufted-duck", count: 12, lat: 51.5025, lng: -0.1348, seenAt: "2026-02-03T14:00:00Z", place: "St James's Park, London", notes: "Diving near the bridge." },
  { id: "ex4", speciesId: "mandarin-duck", count: 2, lat: 35.7148, lng: 139.7745, seenAt: "2026-01-20T10:45:00Z", place: "Ueno Park, Tokyo", notes: "" },
  { id: "ex5", speciesId: "pacific-black-duck", count: 6, lat: -33.8642, lng: 151.2166, seenAt: "2026-05-05T07:20:00Z", place: "Sydney", notes: "" },
];

function visibleSightings() {
  return state.sightings.filter((s) =>
    (state.mapWho === "all" || isMine(s)) && (!state.mapSpecies || s.speciesId === state.mapSpecies));
}

function pinIcon(s, example) {
  const sp = SPECIES_BY_ID[s.speciesId];
  const duck = sp ? speciesDuck(sp) : duckSVG({ head: "#8A93A0", bill: "#F2C230", breast: "#A89C8C", body: "#C9CED3" });
  return L.divIcon({
    className: "",
    html: `<div class="pin${example ? " is-example" : ""}${!example && isMine(s) ? " is-mine" : ""}"><span class="pin-badge"></span>${duck}${s.count > 1 ? `<span class="pin-count num">${s.count}</span>` : ""}</div>`,
    iconSize: [44, 44], iconAnchor: [4, 44], popupAnchor: [18, -40],
  });
}

function popupHTML(s, example) {
  const sp = SPECIES_BY_ID[s.speciesId];
  const name = sp?.name || s.speciesName || "Unknown duck";
  return `<div class="pop">
    ${s.photo ? `<img src="${s.photo}" alt="">` : ""}
    <div><div class="pop-title">${esc(name)}${s.count > 1 ? ` <span class="muted num">×${s.count}</span>` : ""}</div>
    <div class="pop-meta">${example ? "Example sighting" : `${esc(who(s))} · ${fmtDateTime(s.seenAt)}`}</div>
    <div class="pop-meta num">${esc(s.place || fmtCoord(s.lat, s.lng))}</div></div>
    ${s.notes ? `<div>${esc(s.notes)}</div>` : ""}
    <div class="row-actions">
      ${sp ? `<button class="btn btn-soft btn-sm" type="button" data-species="${sp.id}">About this duck</button>` : ""}
      ${!example && isMine(s) ? `<button class="btn btn-danger btn-sm" type="button" data-delete="${s.id}">Delete</button>` : ""}
    </div>
  </div>`;
}

function renderMapMarkers(fit) {
  if (!map) return;
  markerLayer.clearLayers();
  const list = visibleSightings();
  const example = state.sightings.length === 0;
  const shown = example ? EXAMPLES : list;
  for (const s of shown) {
    L.marker([s.lat, s.lng], { icon: pinIcon(s, example), keyboard: true, title: SPECIES_BY_ID[s.speciesId]?.name || "Duck" })
      .bindPopup(popupHTML(s, example), { maxWidth: 280, autoPanPaddingTopLeft: L.point(16, 130), autoPanPaddingBottomRight: L.point(16, 90) })
      .addTo(markerLayer);
  }
  const banner = $("#mapBanner");
  banner.hidden = !example;
  if (example) {
    banner.innerHTML = `${duckSVG({ ...MALLARD, animated: true, water: true })}<span>These dashed pins are examples. ${state.canWrite ? "Tap anywhere on the map to add the first real sighting." : "Sightings people add will appear here."}</span>`;
  }
  $("#mapCount").textContent = example ? "Examples" : `${list.length} sighting${list.length === 1 ? "" : "s"}`;

  const present = [...new Set(state.sightings.map((s) => s.speciesId).filter(Boolean))].map((id) => SPECIES_BY_ID[id]).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  if (state.mapSpecies && !present.some((p) => p.id === state.mapSpecies)) state.mapSpecies = "";
  $("#mapSpecies").innerHTML = `<option value="">All species</option>` + present.map((sp) => `<option value="${sp.id}"${sp.id === state.mapSpecies ? " selected" : ""}>${esc(sp.name)}</option>`).join("");

  if (fit && shown.length) {
    const b = L.latLngBounds(shown.map((s) => [s.lat, s.lng]));
    map.fitBounds(b.pad(0.25), { maxZoom: tilesFailed ? 9 : 13 });
  }
}

function focusSighting(s) {
  setTab("map");
  setTimeout(() => {
    if (!map) return;
    map.setView([s.lat, s.lng], Math.max(map.getZoom(), 14));
    markerLayer.eachLayer((mk) => {
      const ll = mk.getLatLng();
      if (Math.abs(ll.lat - s.lat) < 1e-9 && Math.abs(ll.lng - s.lng) < 1e-9) mk.openPopup();
    });
  }, 120);
}

// ── Sighting form ──────────────────────────────────────────────────
let pickMap = null, pickMarker = null;

function speciesOptions(selected) {
  return `<option value="">Not sure / unknown duck</option>` + Object.entries(GROUPS).map(([k, g]) =>
    `<optgroup label="${esc(g.name)}">${SPECIES.filter((s) => s.group === k && s.status !== "EX").map((s) =>
      `<option value="${s.id}"${s.id === selected ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</optgroup>`).join("");
}

function toLocalInput(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function openSightingForm({ speciesId = "", lat, lng, usePhoto = false } = {}) {
  if (!state.canWrite) { toast("You can view the shared map but not add to it."); return; }
  const photo = usePhoto ? state.lastPhoto : null;
  const exif = photo?.exif || {};
  const start = {
    lat: lat ?? exif.lat ?? (map ? map.getCenter().lat : 40.7794),
    lng: lng ?? exif.lng ?? (map ? map.getCenter().lng : -73.9632),
  };
  const fromPhoto = lat == null && exif.lat != null;
  const sheet = $("#sightingSheet");
  sheet.innerHTML = `<form class="sheet-inner" id="sightingForm" novalidate>
    <div class="sheet-head"><div><span class="label">${state.store?.kind === "shared" ? "Add to the shared map" : "Add to your map"}</span><h2 id="sightingSheetTitle">New sighting</h2></div>
      <button class="icon-btn" type="button" data-close aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    <div class="form-grid">
      <div class="thumb-row">
        ${photo ? `<img class="thumb" id="fThumb" src="${photo.thumb}" alt="Sighting photo">` : `<div class="thumb" id="fThumb" style="display:grid;place-items:center">${duckSVG({ ...MALLARD })}</div>`}
        <div style="display:grid;gap:6px">
          <label class="btn btn-soft btn-sm" for="fPhoto">${photo ? "Change photo" : "Add a photo"}</label>
          <input class="sr-file" id="fPhoto" type="file" accept="image/*">
          ${photo ? `<button class="btn btn-ghost btn-sm" type="button" id="fNoPhoto">Remove photo</button>` : `<span class="muted" style="font-size:.8rem">Optional</span>`}
        </div>
      </div>
      <label class="field"><span class="label">Species</span><select class="select" id="fSpecies">${speciesOptions(speciesId)}</select></label>
      <div class="two-col">
        <label class="field"><span class="label">How many</span><input class="input num" id="fCount" type="number" min="1" max="9999" value="1" inputmode="numeric"></label>
        <label class="field"><span class="label">When</span><input class="input" id="fWhen" type="datetime-local" value="${toLocalInput(exif.date || new Date().toISOString())}"></label>
      </div>
      <div class="field">
        <span class="label">Where${fromPhoto ? " · from your photo" : ""}</span>
        <div class="pick-wrap"><div id="pickMap"></div></div>
        <div class="pick-hint"><span>Tap the map or drag the pin.</span><span class="num" id="fCoord"></span></div>
        ${"geolocation" in navigator ? `<button class="btn btn-soft btn-sm" type="button" id="fLocate" style="justify-self:start">Use my location</button>` : ""}
      </div>
      <label class="field"><span class="label">Place name (optional)</span><input class="input" id="fPlace" maxlength="80" placeholder="e.g. Lake Merritt, by the boathouse"></label>
      <label class="field"><span class="label">Notes (optional)</span><textarea class="input" id="fNotes" rows="3" maxlength="500" placeholder="Behaviour, ducklings, anything unusual"></textarea></label>
      <p class="callout" id="fError" hidden></p>
      <div class="row-actions"><button class="btn btn-primary" type="submit" id="fSave">Save sighting</button><button class="btn btn-ghost" type="button" data-close>Cancel</button></div>
    </div>
  </form>`;
  openSheet(sheet);

  let chosen = { ...start };
  let thumb = photo?.thumb || null;
  const setCoord = () => { $("#fCoord").textContent = fmtCoord(chosen.lat, chosen.lng); };
  setCoord();

  if (hasLeaflet()) {
    if (pickMap) { pickMap.remove(); pickMap = null; }
    pickMap = L.map("pickMap", { zoomControl: true, attributionControl: false, minZoom: 2 }).setView([chosen.lat, chosen.lng], fromPhoto || lat != null ? 14 : map ? map.getZoom() : 3);
    addBasemap(pickMap, true);
    pickMarker = L.marker([chosen.lat, chosen.lng], { draggable: true, icon: pinIcon({ speciesId: $("#fSpecies").value, count: 1, by: state.me }, false) }).addTo(pickMap);
    const move = (ll) => { chosen = { lat: ll.lat, lng: ll.lng }; pickMarker.setLatLng(ll); setCoord(); };
    pickMap.on("click", (e) => move(e.latlng));
    pickMarker.on("dragend", () => move(pickMarker.getLatLng()));
    setTimeout(() => pickMap.invalidateSize(), 60);
    $("#fSpecies").onchange = () => pickMarker.setIcon(pinIcon({ speciesId: $("#fSpecies").value, count: 1, by: state.me }, false));
    $("#fLocate")?.addEventListener("click", () => {
      const btn = $("#fLocate");
      btn.disabled = true; btn.textContent = "Finding you…";
      navigator.geolocation.getCurrentPosition(
        (pos) => { move(L.latLng(pos.coords.latitude, pos.coords.longitude)); pickMap.setView(pickMarker.getLatLng(), 15); btn.textContent = "Location set"; },
        () => { btn.textContent = "Location unavailable here"; toast("Couldn't get your location. Tap the map instead."); },
        { enableHighAccuracy: true, timeout: 10000 },
      );
    });
  } else {
    $("#pickMap").innerHTML = `<div class="empty">The map couldn't load. The sighting will use ${fmtCoord(chosen.lat, chosen.lng)}.</div>`;
  }

  $("#fPhoto").onchange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const img = await prepareImage(f);
      thumb = img.thumb;
      $("#fThumb").outerHTML = `<img class="thumb" id="fThumb" src="${thumb}" alt="Sighting photo">`;
      if (img.exif.lat != null && pickMap) { chosen = { lat: img.exif.lat, lng: img.exif.lng }; pickMarker.setLatLng(chosen); pickMap.setView(chosen, 14); setCoord(); }
      if (img.exif.date) $("#fWhen").value = toLocalInput(img.exif.date);
    } catch (err) { toast(err.message); }
  };
  $("#fNoPhoto")?.addEventListener("click", () => { thumb = null; $("#fThumb").outerHTML = `<div class="thumb" id="fThumb" style="display:grid;place-items:center">${duckSVG({ ...MALLARD })}</div>`; });

  $("#sightingForm").onsubmit = async (e) => {
    e.preventDefault();
    const when = $("#fWhen").value ? new Date($("#fWhen").value) : new Date();
    const count = Math.max(1, Math.min(9999, parseInt($("#fCount").value, 10) || 1));
    const sid = $("#fSpecies").value || null;
    const s = {
      id: uid(), speciesId: sid, speciesName: sid ? SPECIES_BY_ID[sid].name : "Unknown duck",
      count, seenAt: when.toISOString(), lat: +chosen.lat.toFixed(6), lng: +chosen.lng.toFixed(6),
      place: $("#fPlace").value.trim(), notes: $("#fNotes").value.trim(), photo: thumb,
      by: state.me, createdAt: new Date().toISOString(),
    };
    const btn = $("#fSave");
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      await state.store.add(s);
      closeSheet(sheet);
      toast(state.store.kind === "shared" ? "Pinned on the shared map" : "Sighting saved");
      state.mapWho = "all"; state.mapSpecies = "";
      $$("[data-who]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.who === "all"));
      focusSighting(s);
    } catch (err) {
      const msg = err?.code === "invalid_argument" ? "You don't have permission to add to this shared map." :
        err?.code === "quota_exceeded" ? "The shared map is full. Delete some old sightings first." :
        err?.message || "Couldn't save. Try again.";
      $("#fError").hidden = false; $("#fError").textContent = msg;
      btn.disabled = false; btn.textContent = "Save sighting";
    }
  };
}

async function deleteSighting(id) {
  const s = state.sightings.find((x) => x.id === id);
  if (!s || !isMine(s)) return;
  const pop = document.querySelector(`[data-delete="${id}"]`);
  if (pop && !pop.dataset.armed) { pop.dataset.armed = "1"; pop.textContent = "Tap again to delete"; return; }
  try { await state.store.remove(id); map?.closePopup(); toast("Sighting deleted"); }
  catch { toast("Couldn't delete that sighting."); }
}

// ── Log ────────────────────────────────────────────────────────────
function renderLog() {
  const shared = state.store?.kind === "shared";
  $$("[data-logwho]").forEach((b) => { b.hidden = !shared; b.setAttribute("aria-pressed", b.dataset.logwho === state.logWho); });
  const list = state.sightings.filter((s) => !shared || state.logWho === "all" || isMine(s));
  const species = [...new Set(list.map((s) => s.speciesId).filter(Boolean))];
  const ducks = list.reduce((n, s) => n + (s.count || 1), 0);
  const wildTotal = SPECIES.filter((s) => s.status !== "DOM" && s.status !== "EX").length;
  const body = $("#logBody");

  if (!list.length) {
    body.innerHTML = `<div class="empty">${duckSVG({ ...MALLARD, animated: true })}
      <h2>${shared && state.logWho === "all" ? "No sightings on the shared map yet" : "Your log is empty"}</h2>
      <p>Identify a duck or tap the map to pin your first sighting. Every species you log builds your life list.</p>
      <div class="row-actions" style="justify-content:center"><button class="btn btn-primary" type="button" data-tab-link="identify">Identify a duck</button><button class="btn btn-soft" type="button" data-tab-link="map">Open the map</button></div></div>`;
    return;
  }

  const byMonth = {};
  for (const s of list) {
    const k = new Date(s.seenAt).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    (byMonth[k] ||= []).push(s);
  }
  body.innerHTML = `
    <div class="stats">
      <div class="stat"><b class="num">${species.length}<span style="font-size:1rem;color:var(--muted)"> / ${wildTotal}</span></b><span>Species seen</span></div>
      <div class="stat"><b class="num">${list.length}</b><span>Sightings</span></div>
      <div class="stat"><b class="num">${ducks}</b><span>Ducks counted</span></div>
    </div>
    <div class="section" style="margin-top:18px"><span class="label">Life list</span>
      <div class="lifelist">${species.map((id) => SPECIES_BY_ID[id]).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name)).map((sp) => `<button class="chip" type="button" data-species="${sp.id}">${esc(sp.name)}</button>`).join("")}</div></div>
    ${Object.entries(byMonth).map(([month, items]) => `<div class="section log-month"><span class="label">${esc(month)}</span><div class="log-list">
      ${items.map((s) => {
        const sp = SPECIES_BY_ID[s.speciesId];
        return `<button class="log-row" type="button" data-focus="${s.id}">
          ${sp ? speciesDuck(sp) : duckSVG({ head: "#8A93A0", bill: "#F2C230", breast: "#A89C8C", body: "#C9CED3" })}
          <span><span class="log-title">${esc(sp?.name || s.speciesName || "Unknown duck")}${s.count > 1 ? ` <span class="muted num">×${s.count}</span>` : ""}</span><br>
          <span class="log-meta">${fmtDate(s.seenAt)} · ${esc(s.place || fmtCoord(s.lat, s.lng))}${shared ? ` · ${esc(who(s))}` : ""}</span></span>
          ${s.photo ? `<img src="${s.photo}" alt="">` : "<span></span>"}
        </button>`;
      }).join("")}</div></div>`).join("")}`;
}

// ── Settings ───────────────────────────────────────────────────────
function openSettings() {
  const key = lsGet(API_KEY) || "";
  const shared = state.store?.kind === "shared";
  const sheet = $("#settingsSheet");
  sheet.innerHTML = `<form class="sheet-inner" id="settingsForm" novalidate>
    <div class="sheet-head"><div><span class="label">Quackdex</span><h2 id="settingsSheetTitle">Settings</h2></div>
      <button class="icon-btn" type="button" data-close aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    <div class="prose">
      <span class="label">Photo identification</span>
      ${state.engine?.kind === "claude"
        ? `<p>Photos are identified by Claude using your Claude account. Nothing else to set up.</p>`
        : `<p>Paste an Anthropic API key to identify photos with Claude. The key stays in this browser only and is sent straight to Anthropic.</p>
           <label class="field"><span class="label">Anthropic API key</span><input class="input" id="sKey" type="password" autocomplete="off" placeholder="sk-ant-…" value="${esc(key)}"></label>
           <div class="row-actions"><button class="btn btn-primary btn-sm" type="submit">Save key</button>${key ? `<button class="btn btn-danger btn-sm" type="button" id="sKeyClear">Remove key</button>` : ""}</div>`}
    </div>
    <div class="prose">
      <span class="label">Sightings</span>
      <p>${shared
        ? "You're on the shared map: everyone with access to this Quackdex sees and adds sightings. You can delete only your own pins."
        : "Sightings are saved in this browser on this device. A shared map needs Quackdex to be hosted with a backend (see the README)."}</p>
      <p class="muted num">${state.sightings.length} sighting${state.sightings.length === 1 ? "" : "s"} ${shared ? "on the map" : "saved here"}.</p>
    </div>
    <div class="prose"><span class="label">About</span><p class="muted">Species data covers ${SPECIES.length} ducks and domestic breeds. Conservation statuses follow the IUCN Red List. Map data © OpenStreetMap contributors, CARTO, and Natural Earth.</p></div>
  </form>`;
  openSheet(sheet);
  $("#settingsForm").onsubmit = (e) => {
    e.preventDefault();
    const v = $("#sKey")?.value.trim();
    if (!v) return;
    lsSet(API_KEY, v);
    state.engine = apiKeyEngine();
    renderEngineNote();
    closeSheet(sheet);
    toast("API key saved. Photo ID is on.");
  };
  $("#sKeyClear")?.addEventListener("click", () => {
    lsDel(API_KEY);
    state.engine = null;
    renderEngineNote();
    closeSheet(sheet);
    toast("API key removed");
  });
}

// ── Tabs & events ──────────────────────────────────────────────────
function setTab(tab) {
  state.tab = tab;
  for (const t of $$("[data-tab]")) t.setAttribute("aria-selected", t.dataset.tab === tab);
  for (const v of $$(".view")) v.hidden = v.id !== `view-${tab}`;
  if (tab === "map") {
    if (!map) initMap();
    setTimeout(() => map?.invalidateSize(), 50);
    if (!hasLeaflet()) $("#map").innerHTML = `<div class="empty">${duckSVG({ ...MALLARD, animated: true })}<p>The map needs an internet connection to load. Your sightings are safe; try again when you're online.</p></div>`;
  }
  if (tab === "directory") renderDirectory();
  if (tab === "log") renderLog();
  try { history.replaceState(null, "", "#" + tab); } catch {}
  if (tab !== "map") window.scrollTo({ top: 0 });
}

function bindEvents() {
  $$("[data-tab]").forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));

  for (const id of ["cameraInput", "uploadInput"]) {
    $("#" + id).addEventListener("change", (e) => { handlePhoto(e.target.files?.[0]); e.target.value = ""; });
  }
  const drop = $("#drop");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("is-over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("is-over"); handlePhoto(e.dataTransfer.files?.[0]); });
  document.addEventListener("paste", (e) => {
    if (state.tab !== "identify") return;
    const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith("image/"));
    if (f) handlePhoto(f);
  });

  $("#matcherReset").onclick = () => { state.matcher = { region: "", head: "", bill: "", size: "" }; renderMatcher(); };
  $("#matcher").addEventListener("click", (e) => {
    const b = e.target.closest("[data-m]");
    if (!b) return;
    const k = b.dataset.m;
    state.matcher[k] = state.matcher[k] === b.dataset.v ? "" : b.dataset.v;
    renderMatcher();
  });

  $$("[data-who]").forEach((b) => b.addEventListener("click", () => {
    state.mapWho = b.dataset.who;
    $$("[data-who]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    renderMapMarkers(true);
  }));
  $$("[data-logwho]").forEach((b) => b.addEventListener("click", () => { state.logWho = b.dataset.logwho; renderLog(); }));
  $("#mapSpecies").onchange = (e) => { state.mapSpecies = e.target.value; renderMapMarkers(true); };
  $("#addSightingBtn").onclick = () => openSightingForm();
  $("#settingsBtn").onclick = openSettings;

  // Delegated actions used across views, popups and sheets. Leaflet stops
  // clicks inside popups from bubbling, so popups get the handler directly.
  document.addEventListener("click", handleAction);
  // Close a sheet by tapping its backdrop.
  for (const d of $$("dialog.sheet")) d.addEventListener("click", (e) => { if (e.target === d) closeSheet(d); });
}

function handleAction(e) {
  const t = e.target.closest("[data-species],[data-log-species],[data-close],[data-open-settings],[data-add-at],[data-delete],[data-focus],[data-show-on-map],[data-tab-link]");
  if (!t) return;
  if (t.matches("[data-close]")) { closeSheet(t.closest("dialog")); return; }
  if (t.matches("[data-open-settings]")) { openSettings(); return; }
  if (t.matches("[data-tab-link]")) { e.preventDefault(); setTab(t.dataset.tabLink); return; }
  if (t.matches("[data-log-species]")) {
    $$("dialog[open]").forEach(closeSheet);
    openSightingForm({ speciesId: t.dataset.logSpecies, usePhoto: !("fresh" in t.dataset) });
    return;
  }
  if (t.matches("[data-species]")) { openSpecies(t.dataset.species); return; }
  if (t.matches("[data-add-at]")) { const [lat, lng] = t.dataset.addAt.split(",").map(Number); map.closePopup(); openSightingForm({ lat, lng }); return; }
  if (t.matches("[data-delete]")) { deleteSighting(t.dataset.delete); return; }
  if (t.matches("[data-focus]")) { const s = state.sightings.find((x) => x.id === t.dataset.focus); if (s) focusSighting(s); return; }
  if (t.matches("[data-show-on-map]")) {
    $$("dialog[open]").forEach(closeSheet);
    state.mapSpecies = t.dataset.showOnMap; state.mapWho = "all";
    $$("[data-who]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.who === "all"));
    setTab("map");
    renderMapMarkers(true);
  }
}

// ── Boot ───────────────────────────────────────────────────────────
async function boot() {
  const started = performance.now();
  mountDucks();
  bindEvents();
  initDirectoryControls();
  state.engine = apiKeyEngine();
  renderEngineNote();
  renderMatcher();
  renderDuckOfTheDay();
  await useStore(localStore());

  const initial = (location.hash || "").slice(1);
  setTab(["identify", "directory", "map", "log"].includes(initial) ? initial : "identify");

  // Let the duck paddle for a moment, then get out of the way.
  await sleep(Math.max(0, 1100 - (performance.now() - started)));
  const splash = $("#splash");
  splash.classList.add("is-leaving");
  setTimeout(() => { splash.hidden = true; }, 400);

  connectRuntime().catch(() => {});
}

boot();
