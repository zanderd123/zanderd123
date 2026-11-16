/** Demo mode: fictional places and made-up codes, kept in memory. */
import type { Api } from "./api";
import type { AccessKind, Category, CodeEntry, PlaceDetail, PlaceSummary, Profile } from "./types";

const H = 3600e3;
const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * H).toISOString();

interface DemoCode extends CodeEntry { votes: Map<string, boolean> }
interface DemoPlace { id: string; name: string; category: Category; address: string; lat: number; lng: number; codes: DemoCode[] }

let n = 0;
const code = (kind: AccessKind, value: string | null, hoursAgo: number, by: string, worked: number, failed: number, note = "", confirmedHoursAgo = hoursAgo): DemoCode => ({
  id: `c${++n}`, kind, code: value, note: note || null, addedAt: iso(hoursAgo), addedBy: by,
  worked, failed, lastConfirmed: iso(confirmedHoursAgo), votes: new Map(),
});
const place = (id: string, name: string, category: Category, address: string, lat: number, lng: number, codes: DemoCode[] = []): DemoPlace =>
  ({ id, name, category, address, lat, lng, codes });

const places: DemoPlace[] = [
  place("chi1", "Corner Bean Coffee", "coffee", "118 N Wells St, Chicago, IL", 41.8840, -87.6338,
    [code("keypad", "4512#", 50, "dana_eats", 14, 0, "Door at the back, past the pickup counter.", 2), code("keypad", "1290#", 960, "jmarq", 9, 4)]),
  place("chi2", "Maple & Rye Diner", "restaurant", "27 E Monroe St, Chicago, IL", 41.8807, -87.6263, [code("keypad", "2468", 5, "lakeview_lou", 3, 0, "", 1)]),
  place("chi3", "Lakeside Burrito Co.", "fastfood", "201 N Michigan Ave, Chicago, IL", 41.8858, -87.6245, [code("keypad", "1357*", 216, "ken_w", 6, 1, "", 30)]),
  place("chi4", "Quick Fuel Gas & Snacks", "gas", "400 S Wells St, Chicago, IL", 41.8763, -87.6339, [code("ask", null, 72, "roadtrip_ri", 5, 0, "Key is on a big wooden spoon.")]),
  place("chi5", "Wabash Books & Tea", "retail", "60 E Lake St, Chicago, IL", 41.8857, -87.6261),
  place("chi7", "Loop Noodle House", "restaurant", "175 W Lake St, Chicago, IL", 41.8857, -87.6330, [code("keypad", "7781", 1104, "noodlefan", 11, 3, "", 480)]),
  place("nyc1", "Herald Sq. Coffee Bar", "coffee", "W 34th St, New York, NY", 40.7496, -73.9880, [code("keypad", "8833", 30, "nyc_nomad", 22, 1, "", 3)]),
  place("nyc2", "Times Sq. Burger Stop", "fastfood", "W 45th St, New York, NY", 40.7580, -73.9855, [code("receipt", null, 96, "tourist_tina", 15, 0)]),
  place("la1", "Grand Park Tacos", "fastfood", "N Hill St, Los Angeles, CA", 34.0560, -118.2468, [code("keypad", "5150", 24, "dtla_dev", 6, 0)]),
  place("lon1", "Strand Tea Rooms", "coffee", "Strand, London WC2R", 51.5108, -0.1196, [code("keypad", "2580", 120, "mind_the_gap", 12, 0)]),
  place("par1", "Café du Pont", "coffee", "Quai du Louvre, Paris", 48.8590, 2.3410, [code("keypad", "1789", 192, "baguette_b", 5, 1, "Code changes on Mondays.")]),
  place("tok1", "Marunouchi Curry Stand", "fastfood", "Marunouchi, Tokyo", 35.6815, 139.7650, [code("open", null, 72, "ramen_rei", 8, 0, "Shared restroom on B1.")]),
  place("syd1", "Harbour Pie Co.", "bakery", "George St, Sydney NSW", -33.8610, 151.2080, [code("keypad", "4321", 40, "aussie_al", 4, 0)]),
];

const ME = "demo-user";
let profile: Profile | null = null;
let seeded = false;

const summary = (p: DemoPlace): PlaceSummary => {
  const c = p.codes[0];
  return {
    id: p.id, name: p.name, category: p.category, address: p.address, lat: p.lat, lng: p.lng,
    current: c ? { id: c.id, kind: c.kind, code: c.code, note: c.note, addedAt: c.addedAt, addedBy: c.addedBy, worked: c.worked, failed: c.failed, lastConfirmed: c.lastConfirmed } : null,
  };
};

const wait = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 120));

export const demoApi: Api = {
  placesInView: (b) => wait(places
    .filter((p) => p.lat >= b.minLat && p.lat <= b.maxLat && (b.minLng <= b.maxLng ? p.lng >= b.minLng && p.lng <= b.maxLng : p.lng >= b.minLng || p.lng <= b.maxLng))
    .map(summary)),

  searchPlaces: (q) => {
    const t = q.trim().toLowerCase();
    return wait(places.filter((p) => p.name.toLowerCase().includes(t) || p.address.toLowerCase().includes(t)).slice(0, 20).map(summary));
  },

  getPlace: (id) => {
    const p = places.find((x) => x.id === id);
    if (!p) return wait(null);
    const detail: PlaceDetail = {
      ...summary(p),
      history: p.codes.slice(1).map((c) => ({ code: c.code, kind: c.kind, addedAt: c.addedAt })),
      myVote: p.codes[0]?.votes.get(ME) ?? null,
    };
    return wait(detail);
  },

  addCode: (c) => {
    let p = c.placeId ? places.find((x) => x.id === c.placeId) : undefined;
    if (!p && c.newPlace) {
      p = place(`u${Date.now()}`, c.newPlace.name, c.newPlace.category, c.newPlace.address ?? "Added by you", c.newPlace.lat, c.newPlace.lng);
      places.push(p);
    }
    if (!p) return Promise.reject(new Error("Pick a place first."));
    p.codes.unshift(code(c.kind, c.kind === "keypad" ? c.code ?? null : null, 0, profile?.displayName ?? "you", 0, 0, c.note));
    if (profile) profile.codesAdded++;
    return wait(p.id);
  },

  vote: (codeId, worked) => {
    for (const p of places) for (const c of p.codes) if (c.id === codeId && !c.votes.has(ME)) {
      c.votes.set(ME, worked);
      if (worked) { c.worked++; c.lastConfirmed = new Date().toISOString(); } else c.failed++;
      if (profile) profile.confirmations++;
    }
    return wait(undefined);
  },

  report: () => wait(undefined),
  getProfile: () => wait(profile),
  createProfile: (displayName) => { profile = { id: ME, displayName, createdAt: new Date().toISOString(), codesAdded: 0, confirmations: 0 }; return wait(undefined); },
  deleteAccount: () => { profile = null; return wait(undefined); },

  seedAround(lat, lng) {
    if (seeded) return;
    seeded = true;
    if (places.some((p) => Math.abs(p.lat - lat) < 0.05 && Math.abs(p.lng - lng) < 0.05)) return;
    const o = (dLat: number, dLng: number) => [lat + dLat, lng + dLng] as const;
    const near: [string, Category, readonly [number, number], DemoCode[]][] = [
      ["Sample: Corner Café", "coffee", o(0.0018, -0.0021), [code("keypad", "4512#", 20, "demo_dana", 6, 0, "Sample data for the demo.", 2)]],
      ["Sample: Main St. Diner", "restaurant", o(-0.0024, 0.0016), [code("keypad", "2468", 200, "demo_lou", 3, 1)]],
      ["Sample: Fuel Stop", "gas", o(0.0031, 0.0029), [code("ask", null, 60, "demo_ri", 2, 0)]],
      ["Sample: Book Nook", "retail", o(-0.0012, -0.0034), []],
      ["Sample: Burger Barn", "fastfood", o(0.0006, 0.0041), [code("receipt", null, 30, "demo_ken", 5, 0)]],
    ];
    near.forEach(([name, cat, [la, ln], codes], i) => places.push(place(`near${i}`, name, cat, "Demo place near you", la, ln, codes)));
  },
};
