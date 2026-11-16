(() => {
"use strict";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const H = 3600e3, D = 24 * H;
const now = () => Date.now();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const store = {
  get(k, d) { try { const v = localStorage.getItem("loobook:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("loobook:" + k, JSON.stringify(v)); } catch { /* storage off: keep going */ } },
  del(k) { try { localStorage.removeItem("loobook:" + k); } catch { /* ignore */ } },
};

function ago(t) {
  const s = Math.max(0, (now() - t) / 1000);
  if (s < 60) return "just now";
  const m = s / 60; if (m < 60) return `${Math.round(m)} min ago`;
  const h = m / 60; if (h < 24) return `${Math.round(h)} hour${Math.round(h) === 1 ? "" : "s"} ago`;
  const d = h / 24; if (d < 30) return `${Math.round(d)} day${Math.round(d) === 1 ? "" : "s"} ago`;
  const mo = d / 30; if (mo < 12) return `${Math.round(mo)} month${Math.round(mo) === 1 ? "" : "s"} ago`;
  return `${Math.round(mo / 12)} year${Math.round(mo / 12) === 1 ? "" : "s"} ago`;
}
const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function distM(a, b) {
  const R = 6371e3, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function fmtDist(m) {
  const mi = m / 1609.34;
  if (mi < 0.1) return `${Math.round(m * 3.281)} ft`;
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi).toLocaleString()} mi`;
}

let toastTimer;
function toast(msg) {
  $$(".toast").forEach((t) => t.remove());
  const t = document.createElement("div");
  t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
  $("#app").appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 2600);
}

/* ------------------------------------------------------------------ */
/* sample data (fictional places; codes are made up)                   */
/* ------------------------------------------------------------------ */
const TYPES = {
  coffee: "Coffee shop", diner: "Restaurant", fastfood: "Fast food", grocery: "Grocery store",
  gas: "Gas station", retail: "Store", bakery: "Bakery", bar: "Bar",
};
const FOOD = new Set(["coffee", "diner", "fastfood", "bakery", "bar"]);

const T = now();
const c = (code, kind, hoursAgo, by, confirms, fails, note, confirmedHoursAgo) => ({
  code, kind, note: note || "", by, at: T - hoursAgo * H,
  confirms, fails, confirmedAt: T - (confirmedHoursAgo ?? hoursAgo) * H,
});

const SEED = [
  // Chicago Loop (the demo "you are here")
  { id: "chi1", name: "Corner Bean Coffee", type: "coffee", addr: "118 N Wells St, Chicago, IL 60606", lat: 41.8840, lng: -87.6338,
    codes: [c("4512#", "keypad", 50, "dana_eats", 14, 0, "Door at the back, past the pickup counter.", 2), c("1290#", "keypad", 24 * 40, "jmarq", 9, 4)] },
  { id: "chi2", name: "Maple & Rye Diner", type: "diner", addr: "27 E Monroe St, Chicago, IL 60603", lat: 41.8807, lng: -87.6263,
    codes: [c("2468", "keypad", 5, "lakeview_lou", 3, 0, "", 1)] },
  { id: "chi3", name: "Lakeside Burrito Co.", type: "fastfood", addr: "201 N Michigan Ave, Chicago, IL 60601", lat: 41.8858, lng: -87.6245,
    codes: [c("1357*", "keypad", 24 * 9, "ken_w", 6, 1, "Code is printed at the bottom of your receipt too.", 30)] },
  { id: "chi4", name: "Quick Fuel Gas & Snacks", type: "gas", addr: "400 S Wells St, Chicago, IL 60607", lat: 41.8763, lng: -87.6339,
    codes: [c("Ask cashier for key", "ask", 24 * 3, "roadtrip_ri", 5, 0, "Key is on a big wooden spoon. You can't miss it.")] },
  { id: "chi5", name: "Wabash Books & Tea", type: "retail", addr: "60 E Lake St, Chicago, IL 60601", lat: 41.8857, lng: -87.6261, codes: [] },
  { id: "chi6", name: "Union Grocer", type: "grocery", addr: "500 W Madison St, Chicago, IL 60661", lat: 41.8818, lng: -87.6400,
    codes: [c("0909", "keypad", 20, "mo_shops", 4, 0)] },
  { id: "chi7", name: "Loop Noodle House", type: "diner", addr: "175 W Lake St, Chicago, IL 60601", lat: 41.8857, lng: -87.6330,
    codes: [c("7781", "keypad", 24 * 46, "noodlefan", 11, 3, "Might have changed. Last two people said it didn't work.", 24 * 20)] },
  { id: "chi8", name: "Clark St. Pizza", type: "fastfood", addr: "36 S Clark St, Chicago, IL 60603", lat: 41.8813, lng: -87.6307, codes: [] },
  { id: "chi9", name: "Sunrise Bagels", type: "bakery", addr: "222 W Randolph St, Chicago, IL 60606", lat: 41.8846, lng: -87.6345,
    codes: [c("On your receipt", "receipt", 24 * 12, "bagel_bri", 7, 0, "Changes daily. Look for 'Restroom' near the total.")] },
  { id: "chi10", name: "Randolph Street Market Café", type: "coffee", addr: "105 W Randolph St, Chicago, IL 60601", lat: 41.8843, lng: -87.6312,
    codes: [c("No code needed", "open", 24 * 2, "amyk", 2, 0, "Unlocked, upstairs on the left.")] },

  // New York
  { id: "nyc1", name: "Herald Sq. Coffee Bar", type: "coffee", addr: "W 34th St & 6th Ave, New York, NY 10001", lat: 40.7496, lng: -73.9880,
    codes: [c("8833", "keypad", 30, "nyc_nomad", 22, 1, "", 3)] },
  { id: "nyc2", name: "Penn Deli & Grill", type: "diner", addr: "W 31st St, New York, NY 10001", lat: 40.7488, lng: -73.9935,
    codes: [c("2020#", "keypad", 24 * 6, "subwaysam", 8, 2)] },
  { id: "nyc3", name: "Bryant Books", type: "retail", addr: "W 42nd St, New York, NY 10036", lat: 40.7537, lng: -73.9832, codes: [] },
  { id: "nyc4", name: "Times Sq. Burger Stop", type: "fastfood", addr: "W 45th St, New York, NY 10036", lat: 40.7580, lng: -73.9855,
    codes: [c("On your receipt", "receipt", 24 * 4, "tourist_tina", 15, 0)] },

  // Los Angeles
  { id: "la1", name: "Grand Park Tacos", type: "fastfood", addr: "N Hill St, Los Angeles, CA 90012", lat: 34.0560, lng: -118.2468,
    codes: [c("5150", "keypad", 24 * 1, "dtla_dev", 6, 0)] },
  { id: "la2", name: "Spring St. Roasters", type: "coffee", addr: "S Spring St, Los Angeles, CA 90013", lat: 34.0479, lng: -118.2500,
    codes: [c("3344*", "keypad", 24 * 22, "rosie_la", 4, 2)] },

  // Austin
  { id: "atx1", name: "Congress Ave. BBQ", type: "diner", addr: "Congress Ave, Austin, TX 78701", lat: 30.2690, lng: -97.7428,
    codes: [c("1836", "keypad", 24 * 2, "smoke_show", 9, 0)] },
  { id: "atx2", name: "6th Street Kolaches", type: "bakery", addr: "E 6th St, Austin, TX 78701", lat: 30.2672, lng: -97.7393, codes: [] },

  // Abroad
  { id: "lon1", name: "Strand Tea Rooms", type: "coffee", addr: "Strand, London WC2R", lat: 51.5108, lng: -0.1196,
    codes: [c("2580", "keypad", 24 * 5, "mind_the_gap", 12, 0)] },
  { id: "lon2", name: "Covent Garden Pie Shop", type: "diner", addr: "Covent Garden, London WC2E", lat: 51.5117, lng: -0.1240,
    codes: [c("On your receipt", "receipt", 24 * 15, "pieguy", 3, 0)] },
  { id: "par1", name: "Café du Pont", type: "coffee", addr: "Quai du Louvre, 75001 Paris", lat: 48.8590, lng: 2.3410,
    codes: [c("1789", "keypad", 24 * 8, "baguette_b", 5, 1, "Code changes on Mondays.")] },
  { id: "tok1", name: "Marunouchi Curry Stand", type: "fastfood", addr: "Marunouchi, Chiyoda, Tokyo", lat: 35.6815, lng: 139.7650,
    codes: [c("No code needed", "open", 24 * 3, "ramen_rei", 8, 0, "Shared restroom on B1 of the building.")] },
];

/* user changes live on top of the seed */
let places = JSON.parse(JSON.stringify(SEED));
const extra = store.get("places", []);
const patches = store.get("patches", {});
places = places.concat(extra);
places.forEach((p) => { if (patches[p.id]) p.codes = patches[p.id]; });

function savePlace(p) {
  if (p.id.startsWith("u")) {
    store.set("places", places.filter((x) => x.id.startsWith("u")));
  } else {
    const all = store.get("patches", {}); all[p.id] = p.codes; store.set("patches", all);
  }
}

/* ------------------------------------------------------------------ */
/* gazetteer for search (works offline; a real app uses a geocoder)   */
/* ------------------------------------------------------------------ */
const GAZ = [
  // cities
  ["Chicago", "Illinois", 41.8827, -87.6278, 14], ["New York", "New York", 40.7505, -73.9890, 14],
  ["Los Angeles", "California", 34.0522, -118.2437, 14], ["Austin", "Texas", 30.2672, -97.7431, 14],
  ["Houston", "Texas", 29.7604, -95.3698, 13], ["Dallas", "Texas", 32.7767, -96.7970, 13],
  ["San Antonio", "Texas", 29.4241, -98.4936, 13], ["Miami", "Florida", 25.7617, -80.1918, 13],
  ["Orlando", "Florida", 28.5384, -81.3789, 13], ["Tampa", "Florida", 27.9506, -82.4572, 13],
  ["Atlanta", "Georgia", 33.7490, -84.3880, 13], ["Seattle", "Washington", 47.6062, -122.3321, 13],
  ["San Francisco", "California", 37.7749, -122.4194, 13], ["San Diego", "California", 32.7157, -117.1611, 13],
  ["Denver", "Colorado", 39.7392, -104.9903, 13], ["Boston", "Massachusetts", 42.3601, -71.0589, 13],
  ["Philadelphia", "Pennsylvania", 39.9526, -75.1652, 13], ["Phoenix", "Arizona", 33.4484, -112.0740, 13],
  ["Las Vegas", "Nevada", 36.1699, -115.1398, 13], ["Nashville", "Tennessee", 36.1627, -86.7816, 13],
  ["New Orleans", "Louisiana", 29.9511, -90.0715, 13], ["Minneapolis", "Minnesota", 44.9778, -93.2650, 13],
  ["Portland", "Oregon", 45.5152, -122.6784, 13], ["Detroit", "Michigan", 42.3314, -83.0458, 13],
  ["Washington", "District of Columbia", 38.9072, -77.0369, 13], ["Columbus", "Ohio", 39.9612, -82.9988, 13],
  ["Charlotte", "North Carolina", 35.2271, -80.8431, 13], ["Salt Lake City", "Utah", 40.7608, -111.8910, 13],
  ["Kansas City", "Missouri", 39.0997, -94.5786, 13], ["St. Louis", "Missouri", 38.6270, -90.1994, 13],
  ["London", "United Kingdom", 51.5110, -0.1220, 15], ["Paris", "France", 48.8590, 2.3420, 14],
  ["Tokyo", "Japan", 35.6812, 139.7671, 14], ["Toronto", "Ontario, Canada", 43.6532, -79.3832, 13],
  ["Mexico City", "Mexico", 19.4326, -99.1332, 12], ["Sydney", "Australia", -33.8688, 151.2093, 13],
  ["Berlin", "Germany", 52.5200, 13.4050, 12], ["Dublin", "Ireland", 53.3498, -6.2603, 13],
].map(([name, region, lat, lng, z]) => ({ kind: "city", name, sub: region, lat, lng, z }));

const STATES = [
  ["Illinois", "IL", 40.0, -89.2], ["New York", "NY", 42.9, -75.5], ["California", "CA", 37.2, -119.5],
  ["Texas", "TX", 31.0, -99.3], ["Florida", "FL", 28.1, -81.7], ["Georgia", "GA", 32.7, -83.4],
  ["Washington", "WA", 47.4, -120.5], ["Colorado", "CO", 39.0, -105.5], ["Massachusetts", "MA", 42.3, -71.8],
  ["Pennsylvania", "PA", 40.9, -77.8], ["Arizona", "AZ", 34.3, -111.7], ["Nevada", "NV", 39.3, -116.6],
  ["Tennessee", "TN", 35.9, -86.4], ["Louisiana", "LA", 31.0, -92.0], ["Minnesota", "MN", 46.3, -94.3],
  ["Oregon", "OR", 43.9, -120.6], ["Michigan", "MI", 44.3, -85.4], ["Ohio", "OH", 40.3, -82.8],
  ["North Carolina", "NC", 35.5, -79.4], ["Utah", "UT", 39.3, -111.7], ["Missouri", "MO", 38.4, -92.5],
].map(([name, abbr, lat, lng]) => ({ kind: "state", name, abbr, sub: "State", lat, lng, z: 6 }));

const ZIPS = [
  ["60601", "Chicago, IL", 41.8858, -87.6229], ["60602", "Chicago, IL", 41.8829, -87.6291],
  ["60603", "Chicago, IL", 41.8800, -87.6262], ["60604", "Chicago, IL", 41.8783, -87.6290],
  ["60606", "Chicago, IL", 41.8822, -87.6377], ["60607", "Chicago, IL", 41.8721, -87.6511],
  ["60611", "Chicago, IL", 41.8949, -87.6201], ["60661", "Chicago, IL", 41.8826, -87.6431],
  ["10001", "New York, NY", 40.7506, -73.9971], ["10036", "New York, NY", 40.7590, -73.9845],
  ["10019", "New York, NY", 40.7654, -73.9858], ["90012", "Los Angeles, CA", 34.0614, -118.2385],
  ["90013", "Los Angeles, CA", 34.0448, -118.2426], ["78701", "Austin, TX", 30.2711, -97.7437],
  ["94103", "San Francisco, CA", 37.7726, -122.4099], ["02108", "Boston, MA", 42.3576, -71.0636],
  ["33131", "Miami, FL", 25.7663, -80.1897], ["98101", "Seattle, WA", 47.6114, -122.3305],
  ["30303", "Atlanta, GA", 33.7529, -84.3925], ["20001", "Washington, DC", 38.9109, -77.0163],
].map(([name, sub, lat, lng]) => ({ kind: "zip", name, sub, lat, lng, z: 15 }));

/* ------------------------------------------------------------------ */
/* navigation                                                          */
/* ------------------------------------------------------------------ */
let session = store.get("session", null);
const screens = ["welcome", "login", "verify", "permission", "map", "profile", "doc"];
function show(name) {
  screens.forEach((s) => { $("#s-" + s).hidden = s !== name; });
  if (name === "map") { initMap(); setTimeout(() => map && map.invalidateSize(), 30); }
  if (name === "profile") renderProfile();
}

/* ------------------------------------------------------------------ */
/* legal docs                                                          */
/* ------------------------------------------------------------------ */
let docReturn = "welcome";
const DOC_TITLES = { terms: "Terms of Service", privacy: "Privacy Policy", guidelines: "Community Guidelines" };
function openDoc(key) {
  docReturn = screens.find((s) => !$("#s-" + s).hidden) || "welcome";
  $("#doc-title").textContent = DOC_TITLES[key];
  $("#doc-body").innerHTML = (window.LEGAL && window.LEGAL[key]) || "<p>Document not bundled in this build.</p>";
  show("doc");
  $("#s-doc .scroll").scrollTop = 0;
}
document.addEventListener("click", (e) => {
  const d = e.target.closest("[data-doc]");
  if (d) { e.preventDefault(); openDoc(d.dataset.doc); }
});
$("[data-close-doc]").addEventListener("click", () => show(docReturn));

/* ------------------------------------------------------------------ */
/* welcome + login                                                     */
/* ------------------------------------------------------------------ */
let mode = "signup";
function setMode(m) {
  mode = m;
  $("#tab-signup").setAttribute("aria-selected", m === "signup");
  $("#tab-signin").setAttribute("aria-selected", m === "signin");
  $("#f-name").hidden = m !== "signup";
  $("#f-terms").hidden = m !== "signup";
  $("#forgot").hidden = m !== "signin";
  $("#pwrules").hidden = m !== "signup";
  $("#in-pass").setAttribute("autocomplete", m === "signup" ? "new-password" : "current-password");
  $("#login-submit").textContent = m === "signup" ? "Create account" : "Log in";
  $("#login-error").hidden = true;
}
$$("[data-go]").forEach((b) => b.addEventListener("click", () => {
  if (b.dataset.mode) setMode(b.dataset.mode);
  show(b.dataset.go);
}));
$("#tab-signup").addEventListener("click", () => setMode("signup"));
$("#tab-signin").addEventListener("click", () => setMode("signin"));
$("#forgot").addEventListener("click", () => toast("We'd email you a reset link."));

function loginError(msg) { const el = $("#login-error"); el.textContent = msg; el.hidden = false; }

function finishLogin(name, via) {
  session = { name, via, since: now(), added: 0, confirmed: 0 };
  store.set("session", session);
  renderAvatar();
  show("permission");
}
$$("[data-sso]").forEach((b) => b.addEventListener("click", () => {
  if (mode === "signup" && !$("#in-terms").checked) {
    loginError("Please tick the box to agree to the Terms first.");
    $("#in-terms").focus(); return;
  }
  finishLogin(b.dataset.sso === "Apple" ? "apple_user" : "google_user", b.dataset.sso);
}));
$("#login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const email = $("#in-email").value.trim(), pass = $("#in-pass").value, name = $("#in-name").value.trim();
  if (mode === "signup" && name.length < 3) return loginError("Pick a display name with at least 3 characters.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return loginError("Enter an email like name@example.com.");
  if (mode === "signup") {
    const missing = PW_RULES.filter((r) => !r.test(pass)).map((r) => r.label.toLowerCase());
    if (missing.length) return loginError(`Your password needs ${missing.join(", ")}.`);
    if (!$("#in-terms").checked) return loginError("Please tick the box to agree to the Terms first.");
    pendingSignup = { name: name || email.split("@")[0] };
    $("#verify-email").textContent = email;
    $("#in-otp").value = ""; $("#verify-error").hidden = true;
    show("verify");
    startResendTimer();
    setTimeout(() => $("#in-otp").focus(), 50);
    return;
  }
  if (!pass) return loginError("Enter your password.");
  finishLogin(email.split("@")[0], "email");
});

/* password rules + email code */
const PW_RULES = [
  { id: "length", label: "At least 8 characters", test: (p) => p.length >= 8 },
  { id: "letter", label: "A letter (a–z)", test: (p) => /[A-Za-z]/.test(p) },
  { id: "number", label: "A number", test: (p) => /[0-9]/.test(p) },
  { id: "special", label: "A special character", test: (p) => /[^A-Za-z0-9\s]/.test(p) },
];
$("#in-pass").addEventListener("input", (e) => {
  const v = e.target.value;
  PW_RULES.forEach((r) => $(`#pwrules [data-rule="${r.id}"]`).classList.toggle("met", r.test(v)));
});
let pendingSignup = null, resendTimer = null;
function startResendTimer() {
  let left = 60;
  const b = $("#verify-resend");
  b.disabled = true;
  clearInterval(resendTimer);
  resendTimer = setInterval(() => {
    left--;
    if (left <= 0) { clearInterval(resendTimer); b.disabled = false; b.textContent = "Send a new code"; }
    else b.textContent = `Send a new code in ${left}s`;
  }, 1000);
  b.textContent = "Send a new code in 60s";
}
$("#verify-resend").addEventListener("click", () => { toast("New code sent"); startResendTimer(); });
$("#in-otp").addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
  if (e.target.value.length === 6) $("#verify-go").click();
});
$("#verify-go").addEventListener("click", () => {
  const v = $("#in-otp").value;
  if (!/^\d{6}$/.test(v)) { const er = $("#verify-error"); er.textContent = "Enter the 6-digit code from the email."; er.hidden = false; return; }
  clearInterval(resendTimer);
  toast("Email confirmed");
  finishLogin(pendingSignup ? pendingSignup.name : "you", "email");
});

/* ------------------------------------------------------------------ */
/* location                                                            */
/* ------------------------------------------------------------------ */
const DEMO_ME = { lat: 41.8827, lng: -87.6290 }; // Chicago Loop
let me = null, meIsDemo = false, meMarker = null;

function locate(fromButton) {
  return new Promise((resolve) => {
    const fallback = (why) => {
      me = { ...DEMO_ME }; meIsDemo = true;
      if (fromButton || why) showBanner("Location isn't available in this preview, so you're placed in downtown Chicago to try it out.");
      resolve(me);
    };
    if (!navigator.geolocation) return fallback(true);
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; fallback(true); } }, 6000);
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => { if (done) return; done = true; clearTimeout(timer); me = { lat: pos.coords.latitude, lng: pos.coords.longitude }; meIsDemo = false; resolve(me); },
        () => { if (done) return; done = true; clearTimeout(timer); fallback(true); },
        { enableHighAccuracy: true, timeout: 5500, maximumAge: 60000 }
      );
    } catch { done = true; clearTimeout(timer); fallback(true); }
  });
}

$("#perm-allow").addEventListener("click", async () => {
  store.set("loc", true);
  show("map");
  await locate(true);
  placeMe(true);
});
$("#perm-skip").addEventListener("click", () => {
  store.set("loc", false);
  show("map");
  me = null;
  map.setView([DEMO_ME.lat, DEMO_ME.lng], 15);
  showBanner("Location is off. Search for a city, state or ZIP to look around.");
});

function showBanner(text) {
  $("#banner-text").textContent = text;
  $("#banner").hidden = false;
}
$("#banner-btn").addEventListener("click", () => { $("#banner").hidden = true; });

/* ------------------------------------------------------------------ */
/* map                                                                 */
/* ------------------------------------------------------------------ */
let map = null;
const markers = new Map();
let filters = new Set();
let selectedId = null;

function initMap() {
  if (map) return;
  map = L.map("map", { zoomControl: false, worldCopyJump: true, minZoom: 2, maxZoom: 19, attributionControl: true })
    .setView([39.5, -98.35], 4);
  map.attributionControl.setPrefix(false);

  // hand-drawn world: Natural Earth outlines, inked on white paper
  map.createPane("world");
  map.getPane("world").classList.add("leaflet-world-pane");
  if (window.WORLD && window.topojson) {
    const w = window.WORLD;
    const land = topojson.merge(w, w.objects.countries.geometries);
    const borders = topojson.mesh(w, w.objects.countries, (a, b) => a !== b);
    const r = L.svg({ pane: "world", padding: 0.6 });
    L.geoJSON(land, { pane: "world", renderer: r, interactive: false,
      style: { color: "#111", weight: 1.4, fillColor: "url(#dotgrid)", fillOpacity: 1, lineJoin: "round" } }).addTo(map);
    L.geoJSON(borders, { pane: "world", renderer: r, interactive: false,
      style: { color: "#8c8c88", weight: 1, dashArray: "4 4", fill: false } }).addTo(map);
    // dot-grid notebook paper on land, so zoomed-in streets don't look empty
    const svg = map.getPane("world").querySelector("svg");
    if (svg) {
      const ns = "http://www.w3.org/2000/svg";
      const defs = document.createElementNS(ns, "defs");
      defs.innerHTML = '<pattern id="dotgrid" width="22" height="22" patternUnits="userSpaceOnUse"><rect width="22" height="22" fill="#ffffff"/><circle cx="11" cy="11" r="1.2" fill="#c3c6cc"/></pattern>';
      svg.insertBefore(defs, svg.firstChild);
    }
    map.attributionControl.addAttribution("Outlines: Natural Earth");
  }

  // real street tiles where the host allows them (the shipped app uses a real map SDK)
  const tiles = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd", maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  });
  let tileOk = false;
  tiles.on("tileload", () => { tileOk = true; });
  tiles.on("tileerror", () => { if (!tileOk && map.hasLayer(tiles)) map.removeLayer(tiles); });
  tiles.addTo(map);

  // keep the ruled "water" lines moving with the map
  const pane = map.getPane("mapPane"), el = $("#map");
  const syncPaper = () => { const p = L.DomUtil.getPosition(pane); el.style.backgroundPosition = `${p.x}px ${p.y}px`; };
  map.on("move", syncPaper);

  map.on("zoomend", () => { el.classList.toggle("hide-labels", map.getZoom() < 15); updateNearby(); });
  map.on("moveend", updateNearby);
  map.on("click", onMapClick);
  el.classList.toggle("hide-labels", map.getZoom() < 15);

  renderMarkers();
}

function current(p) { return p.codes[0] || null; }
function freshness(code) {
  if (!code) return null;
  const age = now() - Math.max(code.at, code.confirmedAt || 0);
  const ratio = code.fails / Math.max(1, code.confirms + code.fails);
  if (age > 30 * D || (code.fails >= 2 && ratio > 0.3)) return { cls: "stale", text: "May have changed" };
  if (age > 7 * D) return { cls: "check", text: "Check before you go" };
  return { cls: "good", text: "Recently confirmed" };
}

function pinSvg(has, stale) {
  const fill = has ? (stale ? "#f2a3ad" : "#d7263d") : "#ffffff";
  const stroke = "#111";
  const inner = has
    ? `<rect x="12" y="11" width="10" height="8" rx="1.5" fill="#fff"/><path d="M14 11V9a3 3 0 0 1 6 0v2" fill="none" stroke="#fff" stroke-width="2"/>`
    : `<circle cx="17" cy="14" r="3.2" fill="none" stroke="#8c8c88" stroke-width="2"/>`;
  return `<svg viewBox="0 0 34 42" aria-hidden="true"><path d="M17 2C9 2 3 8 3 15.5 3 26 17 40 17 40s14-14 14-24.5C31 8 25 2 17 2z" fill="${fill}" stroke="${stroke}" stroke-width="2.4"/>${inner}</svg>`;
}

function visible(p) {
  const cur = current(p);
  if (filters.has("codes") && !cur) return false;
  if (filters.has("fresh") && (!cur || now() - cur.at > 7 * D)) return false;
  if (filters.has("food") && !FOOD.has(p.type)) return false;
  if (filters.has("shops") && FOOD.has(p.type)) return false;
  return true;
}

function renderMarkers() {
  markers.forEach((m) => m.remove());
  markers.clear();
  places.forEach((p) => {
    if (!visible(p)) return;
    const cur = current(p);
    const stale = cur && freshness(cur).cls === "stale";
    const icon = L.divIcon({
      className: "",
      html: `<div class="pin${p.id === selectedId ? " selected" : ""}">${pinSvg(!!cur, stale)}<span class="pin-label">${esc(p.name)}</span></div>`,
      iconSize: [34, 42], iconAnchor: [17, 40],
    });
    const m = L.marker([p.lat, p.lng], {
      icon, keyboard: true, zIndexOffset: cur ? 500 : 0,
      title: `${p.name}: ${cur ? "has a code" : "no code yet"}`, alt: p.name,
    }).addTo(map);
    m.on("click", () => openPlace(p.id));
    markers.set(p.id, m);
  });
  updateNearby();
}

function placeMe(fly) {
  if (!me || !map) return;
  if (meMarker) meMarker.remove();
  meMarker = L.marker([me.lat, me.lng], {
    icon: L.divIcon({ className: "", html: '<div class="me-dot"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
    interactive: false, keyboard: false, zIndexOffset: 1000,
  }).addTo(map);
  if (fly) map.setView([me.lat, me.lng], 16);
  updateNearby();
}

function updateNearby() {
  const box = $("#nearby");
  if (!map) return;
  const ref = me && map.getBounds().pad(0.2).contains([me.lat, me.lng]) ? me : null;
  const center = ref || map.getCenter();
  if (map.getZoom() < 11) { box.hidden = true; return; }
  let best = null;
  places.forEach((p) => {
    if (!current(p) || !visible(p)) return;
    const d = distM(center, p);
    if (!best || d < best.d) best = { p, d };
  });
  if (!best || best.d > 8000) { box.hidden = true; return; }
  box.hidden = false;
  box.dataset.id = best.p.id;
  $("#nearby-label").textContent = ref ? "Closest code to you" : "Closest code to the map centre";
  $("#nearby-name").textContent = best.p.name;
  const cur = current(best.p);
  $("#nearby-sub").textContent = `${fmtDist(best.d)} away · added ${ago(cur.at)}`;
}
$("#nearby").addEventListener("click", (e) => openPlace(e.currentTarget.dataset.id));

$("#locate").addEventListener("click", async () => {
  if (!me) await locate(true);
  placeMe(true);
});

$$("#chips .chip").forEach((ch) => ch.addEventListener("click", () => {
  const f = ch.dataset.filter;
  if (filters.has(f)) filters.delete(f); else {
    filters.add(f);
    if (f === "food") filters.delete("shops");
    if (f === "shops") filters.delete("food");
  }
  $$("#chips .chip").forEach((c2) => c2.setAttribute("aria-pressed", filters.has(c2.dataset.filter)));
  renderMarkers();
}));

/* ------------------------------------------------------------------ */
/* search                                                              */
/* ------------------------------------------------------------------ */
const q = $("#q"), results = $("#results");
let geoAbort = null;

function searchLocal(text) {
  const t = text.trim().toLowerCase();
  if (!t) return [];
  const out = [];
  const isZip = /^\d{3,5}$/.test(t);
  if (isZip) ZIPS.forEach((z) => { if (z.name.startsWith(t)) out.push(z); });
  places.forEach((p) => {
    if (p.name.toLowerCase().includes(t) || p.addr.toLowerCase().includes(t)) out.push({ kind: "place", name: p.name, sub: p.addr, lat: p.lat, lng: p.lng, z: 17, id: p.id, has: !!current(p) });
  });
  GAZ.forEach((g) => { const full = `${g.name}, ${g.sub}`.toLowerCase(); if (full.includes(t)) out.push(g); });
  STATES.forEach((s) => { if (s.name.toLowerCase().startsWith(t) || s.abbr.toLowerCase() === t) out.push(s); });
  // places first when the user typed a place; otherwise cities and states first
  return out.slice(0, 12);
}

const ICONS = {
  place: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>',
  city: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 21h18M5 21V9l5-3v15M10 21V4l9 4v13"/></svg>',
  state: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/></svg>',
  zip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  web: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
};

function renderResults(list, text) {
  results.hidden = false;
  if (!list.length) {
    results.innerHTML = `<p class="empty">Nothing found for “${esc(text)}” in the sample data. Try Chicago, 60601, Texas, London or Corner Bean.</p>`;
    return;
  }
  results.innerHTML = list.map((r, i) => `
    <button class="result" data-i="${i}">
      ${ICONS[r.kind] || ICONS.web}
      <span><span style="font-weight:700">${esc(r.name)}</span><br><span class="r-sub">${esc(r.sub)}</span></span>
      ${r.kind === "place" ? `<span class="r-tag${r.has ? " red" : ""}">${r.has ? "Code" : "No code"}</span>` : ""}
    </button>`).join("");
  $$(".result", results).forEach((b) => b.addEventListener("click", () => pick(list[+b.dataset.i])));
}

function pick(r) {
  results.hidden = true;
  q.value = r.kind === "zip" ? `${r.name} · ${r.sub}` : r.name;
  $("#q-clear").hidden = false;
  q.blur();
  map.flyTo([r.lat, r.lng], r.z, { duration: 1.2 });
  if (r.kind === "place") setTimeout(() => openPlace(r.id), 900);
}

q.addEventListener("input", () => {
  const t = q.value;
  $("#q-clear").hidden = !t;
  if (!t.trim()) { results.hidden = true; return; }
  renderResults(searchLocal(t), t);
});
q.addEventListener("focus", () => { if (q.value.trim()) renderResults(searchLocal(q.value), q.value); });
$("#q-clear").addEventListener("click", () => { q.value = ""; results.hidden = true; $("#q-clear").hidden = true; q.focus(); });
$("#search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const t = q.value.trim(); if (!t) return;
  const local = searchLocal(t);
  if (local.length) return pick(local[0]);
  // try a real geocoder where the host allows it
  try {
    if (geoAbort) geoAbort.abort();
    geoAbort = new AbortController();
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(t)}`, { signal: geoAbort.signal });
    const rows = await res.json();
    if (rows.length) {
      return renderResults(rows.map((r) => ({ kind: "web", name: r.display_name.split(",")[0], sub: r.display_name.split(",").slice(1, 3).join(",").trim(), lat: +r.lat, lng: +r.lon, z: 14 })), t);
    }
  } catch { /* offline or blocked */ }
  renderResults([], t);
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".topbar")) results.hidden = true;
});

/* ------------------------------------------------------------------ */
/* sheets                                                              */
/* ------------------------------------------------------------------ */
const layer = $("#layer");
function closeSheet() {
  layer.innerHTML = "";
  if (selectedId) { selectedId = null; renderMarkers(); }
}
function openSheet(html, onMount) {
  layer.innerHTML = `<div class="scrim"></div><div class="sheet ruled" role="dialog" aria-modal="true"><div class="grab"></div><div class="sheet-body">${html}</div></div>`;
  $(".scrim", layer).addEventListener("click", closeSheet);
  $$("[data-close]", layer).forEach((b) => b.addEventListener("click", closeSheet));
  if (onMount) onMount($(".sheet", layer));
  const first = $(".sheet [data-close]", layer); if (first) first.focus({ preventScroll: true });
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { if ($(".modal")) $(".modal").remove(); else closeSheet(); }
});

const X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>';
const USER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';

function openPlace(id) {
  const p = places.find((x) => x.id === id); if (!p) return;
  selectedId = id; renderMarkers();
  const cur = current(p);
  const dist = me ? `${fmtDist(distM(me, p))} away · ` : "";
  const votes = store.get("votes", {});
  const myVote = cur ? votes[`${p.id}:${cur.at}`] : null;

  let body;
  if (cur) {
    const f = freshness(cur);
    const isText = cur.kind !== "keypad";
    body = `
      <div class="codecard">
        <div class="code-row">
          <div>
            <p class="label">${cur.kind === "keypad" ? "Restroom code" : cur.kind === "receipt" ? "Where to find it" : cur.kind === "ask" ? "How to get in" : "Access"}</p>
            <p class="code${isText ? " text" : ""}" id="the-code">${esc(cur.code)}</p>
          </div>
          ${cur.kind === "keypad" ? `<button class="btn flat" id="copy" style="flex:none">Copy</button>` : ""}
        </div>
        <span class="fresh ${f.cls}">${f.text}</span>
      </div>
      ${cur.note ? `<p>“${esc(cur.note)}”</p>` : ""}
      <div class="meta">
        <div>${CLOCK}<span><strong>Added ${ago(cur.at)}</strong> · ${fmtDate(cur.at)}</span></div>
        <div>${CHECK}<span>Last confirmed working ${ago(cur.confirmedAt)}</span></div>
        <div>${USER}<span>Shared by <strong>${cur.anon ? "Anonymous" : "@" + esc(cur.by)}</strong> · ${cur.confirms} worked, ${cur.fails} didn't</span></div>
      </div>
      <div>
        <p class="label" style="margin-bottom:8px">Did it work for you?</p>
        <div class="row">
          <button class="btn flat" data-vote="yes" ${myVote ? "disabled" : ""}>${myVote === "yes" ? "Thanks!" : "Worked"}</button>
          <button class="btn flat" data-vote="no" ${myVote ? "disabled" : ""}>${myVote === "no" ? "Noted" : "Didn't work"}</button>
        </div>
      </div>
      ${p.codes.length > 1 ? `
      <div>
        <p class="label" style="margin-bottom:6px">Older codes</p>
        <ul class="history">${p.codes.slice(1).map((o) => `<li><s>${esc(o.code)}</s><span class="tiny">${fmtDate(o.at)}</span></li>`).join("")}</ul>
      </div>` : ""}
      <div class="row">
        <button class="btn ink" data-update>Update code</button>
        <a class="btn" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}" target="_blank" rel="noopener">Directions</a>
      </div>`;
  } else {
    body = `
      <div class="nocode">
        <h3>No code yet</h3>
        <p class="small muted">Been here? If staff gave you the code or it's on your receipt, add it for the next person.</p>
        <button class="btn red" data-update>Add the code</button>
      </div>`;
  }

  openSheet(`
    <div class="sheet-head">
      <div>
        <h2>${esc(p.name)}</h2>
        <p class="small muted">${TYPES[p.type] || "Place"} · ${dist}${esc(p.addr)}</p>
      </div>
      <button class="close" data-close aria-label="Close">${X}</button>
    </div>
    ${body}
    <button class="btn ghost" data-report style="justify-self:start;padding:0">Report a problem</button>
    <div class="adslot" aria-label="Ad space">AD SPACE · 320 × 50</div>
  `, (sheet) => {
    const cp = $("#copy", sheet);
    if (cp) cp.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(cur.code); toast("Code copied"); }
      catch { const r = document.createRange(); r.selectNodeContents($("#the-code", sheet)); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Code selected"); }
    });
    $$("[data-vote]", sheet).forEach((b) => b.addEventListener("click", () => {
      const yes = b.dataset.vote === "yes";
      if (yes) { cur.confirms++; cur.confirmedAt = now(); } else cur.fails++;
      const v = store.get("votes", {}); v[`${p.id}:${cur.at}`] = yes ? "yes" : "no"; store.set("votes", v);
      if (session) { session.confirmed = (session.confirmed || 0) + 1; store.set("session", session); }
      savePlace(p);
      toast(yes ? "Thanks! Marked as working." : "Thanks. We'll ask others to check it.");
      openPlace(p.id);
    }));
    $("[data-update]", sheet).addEventListener("click", () => openAdd(p.id));
    $("[data-report]", sheet).addEventListener("click", () => openReport(p));
  });
}

/* ---------- add / update a code ---------- */
let pendingPin = null;
function openAdd(placeId, droppedAt) {
  const ref = me || map.getCenter();
  const near = places
    .map((p) => ({ p, d: distM(ref, p) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 5);
  const chosen = placeId || (droppedAt ? "new" : near[0] && near[0].p.id);
  const opts = near.map(({ p, d }) => `
    <label class="place-opt">
      <input type="radio" name="place" value="${p.id}" ${p.id === chosen ? "checked" : ""}>
      <span><strong>${esc(p.name)}</strong><br><span class="po-sub">${esc(p.addr)}</span></span>
      <span class="tiny">${fmtDist(d)}</span>
    </label>`).join("");
  const fixed = placeId && !near.some((n) => n.p.id === placeId) ? places.find((p) => p.id === placeId) : null;

  openSheet(`
    <div class="sheet-head">
      <div><h2>${placeId ? "Update the code" : "Add a code"}</h2><p class="small muted">Thanks for helping the next person out.</p></div>
      <button class="close" data-close aria-label="Close">${X}</button>
    </div>
    <form id="add-form" novalidate style="display:grid;gap:18px">
      <fieldset style="border:0;padding:0;margin:0;display:grid;gap:8px">
        <legend class="label" style="margin-bottom:8px">Where?</legend>
        <div class="places">
          ${fixed ? `<label class="place-opt"><input type="radio" name="place" value="${fixed.id}" checked><span><strong>${esc(fixed.name)}</strong><br><span class="po-sub">${esc(fixed.addr)}</span></span><span></span></label>` : ""}
          ${opts}
          <label class="place-opt">
            <input type="radio" name="place" value="new" ${chosen === "new" ? "checked" : ""}>
            <span><strong>${droppedAt ? "The spot you dropped" : "Somewhere else"}</strong><br><span class="po-sub">${droppedAt ? `${droppedAt.lat.toFixed(4)}, ${droppedAt.lng.toFixed(4)}` : "Drop a pin on the map"}</span></span>
            <span></span>
          </label>
        </div>
        <div class="field" id="new-name-wrap" ${chosen === "new" && droppedAt ? "" : "hidden"}>
          <label class="label" for="new-name">Name of the place</label>
          <input class="input" id="new-name" placeholder="e.g. Elm Street Bakery" maxlength="60">
        </div>
      </fieldset>

      <fieldset style="border:0;padding:0;margin:0">
        <legend class="label" style="margin-bottom:8px">What kind of access?</legend>
        <div class="seg">
          <label><input type="radio" name="kind" value="keypad" checked><span>Keypad code</span></label>
          <label><input type="radio" name="kind" value="receipt"><span>On the receipt</span></label>
          <label><input type="radio" name="kind" value="ask"><span>Ask staff / key</span></label>
          <label><input type="radio" name="kind" value="open"><span>No code needed</span></label>
        </div>
      </fieldset>

      <div class="field" id="code-wrap">
        <label class="label" for="new-code">Code</label>
        <input class="input code" id="new-code" inputmode="text" autocomplete="off" placeholder="1234#" maxlength="12">
      </div>

      <div class="field">
        <label class="label" for="new-note">Tip (optional)</label>
        <textarea class="input" id="new-note" maxlength="140" placeholder="e.g. Door is past the kitchen, on the left."></textarea>
      </div>

      <label class="check">
        <input type="checkbox" id="new-anon">
        <span><strong>Post anonymously.</strong> Other people won't see your name on this code. LooBook keeps a private record of who posted it, only to stop spam and abuse.</span>
      </label>
      <label class="check">
        <input type="checkbox" id="new-ok">
        <span>Staff gave me this code, or it's printed on a receipt or posted in public. It's not an employee-only or private code.</span>
      </label>
      <p class="form-error" id="add-error" role="alert" hidden></p>
      <button class="btn red block" type="submit">Post code</button>
      <p class="tiny">Your display name and the time will show next to the code.</p>
    </form>
  `, (sheet) => {
    const kindInputs = $$('input[name="kind"]', sheet);
    const syncKind = () => {
      const k = $('input[name="kind"]:checked', sheet).value;
      $("#code-wrap", sheet).hidden = k !== "keypad";
    };
    kindInputs.forEach((i) => i.addEventListener("change", syncKind));
    $$('input[name="place"]', sheet).forEach((i) => i.addEventListener("change", () => {
      if (i.value === "new" && i.checked && !droppedAt) {
        closeSheet(); startDrop(); return;
      }
      $("#new-name-wrap", sheet).hidden = !(i.value === "new" && droppedAt);
    }));
    const err = (m) => { const e = $("#add-error", sheet); e.textContent = m; e.hidden = false; };
    $("#add-form", sheet).addEventListener("submit", (e) => {
      e.preventDefault();
      const where = ($('input[name="place"]:checked', sheet) || {}).value;
      const kind = $('input[name="kind"]:checked', sheet).value;
      const raw = $("#new-code", sheet).value.trim().toUpperCase();
      const note = $("#new-note", sheet).value.trim();
      if (!where) return err("Pick the place this code is for.");
      if (where === "new" && !droppedAt) return err("Drop a pin on the map first.");
      if (where === "new" && $("#new-name", sheet).value.trim().length < 2) return err("Add the name of the place.");
      if (kind === "keypad" && !/^[0-9A-Z#*]{3,12}$/.test(raw)) return err("Codes are 3 to 12 numbers or letters. # and * are fine.");
      if (!$("#new-ok", sheet).checked) return err("Please confirm the code was given to customers or posted publicly.");

      const code = {
        code: kind === "keypad" ? raw : kind === "receipt" ? "On your receipt" : kind === "ask" ? "Ask staff for key" : "No code needed",
        kind, note, by: session ? session.name : "you", anon: $("#new-anon", sheet).checked, at: now(), confirms: 0, fails: 0, confirmedAt: now(),
      };
      let p;
      if (where === "new") {
        p = { id: "u" + now().toString(36), name: $("#new-name", sheet).value.trim(), type: "retail", addr: "Added by you", lat: droppedAt.lat, lng: droppedAt.lng, codes: [code] };
        places.push(p);
      } else {
        p = places.find((x) => x.id === where);
        p.codes.unshift(code);
      }
      savePlace(p);
      if (session) { session.added = (session.added || 0) + 1; store.set("session", session); }
      closeSheet();
      renderMarkers();
      map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 16), { duration: 0.8 });
      toast("Code posted. Thanks for sharing!");
      setTimeout(() => openPlace(p.id), 850);
    });
  });
}

function startDrop() {
  pendingPin = true;
  showBanner("Tap the map where the restroom is.");
  $("#banner-btn").textContent = "Cancel";
}
function onMapClick(e) {
  if (!pendingPin) return;
  pendingPin = null;
  $("#banner").hidden = true; $("#banner-btn").textContent = "OK";
  openAdd(null, { lat: e.latlng.lat, lng: e.latlng.lng });
}
$("#banner-btn").addEventListener("click", () => { if (pendingPin) { pendingPin = null; $("#banner-btn").textContent = "OK"; } });
$("#fab").addEventListener("click", () => {
  if (!session) { show("welcome"); return; }
  openAdd(null);
});

/* ---------- report ---------- */
function openReport(p) {
  openSheet(`
    <div class="sheet-head">
      <div><h2>Report a problem</h2><p class="small muted">${esc(p.name)}</p></div>
      <button class="close" data-close aria-label="Close">${X}</button>
    </div>
    <form id="report-form" style="display:grid;gap:10px">
      ${[
        ["wrong", "The code is wrong or out of date"],
        ["private", "It's an employee-only or private code"],
        ["closed", "This place has closed or moved"],
        ["abuse", "Rude, offensive or spam content"],
        ["business", "I own this business and want it removed"],
      ].map(([v, t], i) => `<label class="place-opt" style="grid-template-columns:24px 1fr"><input type="radio" name="why" value="${v}" ${i === 0 ? "checked" : ""}><span>${t}</span></label>`).join("")}
      <button class="btn ink block" type="submit" style="margin-top:6px">Send report</button>
      <p class="tiny">Our team reviews reports within 24 hours.</p>
    </form>
  `, (sheet) => {
    $("#report-form", sheet).addEventListener("submit", (e) => {
      e.preventDefault();
      closeSheet();
      toast("Report sent. Thanks for keeping LooBook accurate.");
    });
  });
}

/* ------------------------------------------------------------------ */
/* profile                                                             */
/* ------------------------------------------------------------------ */
function initials(n) { return (n || "?").replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?"; }
function renderAvatar() { $("#avatar").textContent = initials(session && session.name); }
function renderProfile() {
  const s = session || { name: "guest", via: "-", since: now() };
  $("#p-avatar").textContent = initials(s.name);
  $("#p-name").textContent = "@" + s.name;
  $("#p-sub").textContent = `Signed in with ${s.via === "email" ? "email" : s.via} · joined ${fmtDate(s.since)}`;
  $("#st-added").textContent = s.added || 0;
  $("#st-confirm").textContent = s.confirmed || 0;
  $("#set-loc").checked = !!store.get("loc", false);
}
$("#open-profile").addEventListener("click", () => { closeSheet(); results.hidden = true; show("profile"); });
$("[data-close-page]").addEventListener("click", () => show("map"));
$("#set-loc").addEventListener("change", async (e) => {
  store.set("loc", e.target.checked);
  if (e.target.checked) { show("map"); await locate(true); placeMe(true); }
  else { me = null; if (meMarker) { meMarker.remove(); meMarker = null; } toast("Location turned off"); }
});
$("#set-notif").addEventListener("change", (e) => toast(e.target.checked ? "We'll let you know." : "Notifications off"));
$("#ad-choices").addEventListener("click", () => toast("In the app this opens Google's ad privacy form."));
$("#open-tips").addEventListener("click", () => {
  openSheet(`
    <div class="sheet-head">
      <div><h2>Keep LooBook free</h2><p class="small muted">Tips are optional and don't unlock anything.</p></div>
      <button class="close" data-close aria-label="Close">${X}</button>
    </div>
    <p>LooBook is built by the people who use it. Tips cover servers and map costs, so there can be fewer ads.</p>
    <div style="display:grid;gap:10px">
      ${["$0.99", "$2.99", "$4.99", "$9.99"].map((p) => `<button class="btn" data-tip="${p}">Tip ${p}</button>`).join("")}
    </div>
    <p class="tiny">Payment is handled by the App Store or Google Play. Tips aren't tax-deductible.</p>
  `, (sheet) => {
    $$("[data-tip]", sheet).forEach((b) => b.addEventListener("click", () => { closeSheet(); toast(`Thank you! (${b.dataset.tip} tip, preview only)`); }));
  });
});
$("#support").addEventListener("click", () => toast("Support email goes here, e.g. help@yourdomain.com"));

function modal(html, onMount) {
  const m = document.createElement("div");
  m.className = "modal"; m.setAttribute("role", "alertdialog"); m.setAttribute("aria-modal", "true");
  m.innerHTML = `<div class="modal-card">${html}</div>`;
  $("#app").appendChild(m);
  m.addEventListener("click", (e) => { if (e.target === m) m.remove(); });
  onMount(m);
}
function signOut(msg) {
  session = null; store.del("session"); renderAvatar();
  closeSheet(); setMode("signin"); show("welcome"); toast(msg);
}
$("#signout").addEventListener("click", () => signOut("Signed out"));
$("#delete-acct").addEventListener("click", () => {
  modal(`
    <h2>Delete your account?</h2>
    <p class="small">This removes your email, display name and settings within 30 days. Codes you shared stay on the map without your name so others can still use them.</p>
    <label class="check"><input type="checkbox" id="del-ok"><span>I understand this can't be undone.</span></label>
    <div class="row"><button class="btn flat" id="del-cancel">Keep account</button><button class="btn red flat" id="del-go" disabled>Delete</button></div>
  `, (m) => {
    $("#del-ok", m).addEventListener("change", (e) => { $("#del-go", m).disabled = !e.target.checked; });
    $("#del-cancel", m).addEventListener("click", () => m.remove());
    $("#del-go", m).addEventListener("click", () => {
      m.remove();
      store.del("places"); store.del("patches"); store.del("votes"); store.del("loc");
      places = JSON.parse(JSON.stringify(SEED));
      if (map) renderMarkers();
      setMode("signup");
      signOut("Account deleted");
    });
  });
});

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */
setMode("signup");
if (session) {
  renderAvatar();
  show("map");
  if (store.get("loc", false)) { locate(false).then(() => placeMe(true)); }
  else map.setView([DEMO_ME.lat, DEMO_ME.lng], 15);
} else {
  show("welcome");
}
})();
