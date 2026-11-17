/**
 * Everything the screens need from the backend, behind one interface.
 * With Supabase configured it talks to the database; without it, it runs on
 * sample data in memory (demo mode).
 */
import { supabase } from "./supabase";
import { demoApi } from "./demo";
import type {
  Bounds, CodeEntry, NewCode, PlaceDetail, PlaceSummary, Profile, ReportReason, Category, AccessKind,
} from "./types";

export interface Api {
  placesInView(b: Bounds): Promise<PlaceSummary[]>;
  searchPlaces(q: string, near?: { lat: number; lng: number }): Promise<PlaceSummary[]>;
  getPlace(id: string): Promise<PlaceDetail | null>;
  addCode(c: NewCode): Promise<string>;
  vote(codeId: string, worked: boolean): Promise<void>;
  report(placeId: string, codeId: string | null, reason: ReportReason, details?: string): Promise<void>;
  getProfile(): Promise<Profile | null>;
  createProfile(displayName: string): Promise<void>;
  /** appleAuthCode: a fresh Sign in with Apple code, so the server can revoke Apple's tokens. */
  deleteAccount(appleAuthCode?: string): Promise<void>;
  /** demo only: put a few sample places around the person so the map isn't empty */
  seedAround?(lat: number, lng: number): void;
}

/* ---------------- Supabase implementation ---------------- */

interface PlaceRow {
  id: string; name: string; category: Category; address: string | null; lat: number; lng: number;
  code_id: string | null; kind: AccessKind | null; code: string | null; note: string | null;
  added_at: string | null; added_by: string | null; worked: number | null; failed: number | null;
  last_confirmed: string | null; locked: boolean | null; anonymous: boolean | null;
}

function toSummary(r: PlaceRow): PlaceSummary {
  const current: CodeEntry | null = r.code_id && r.kind && r.added_at
    ? {
        id: r.code_id, kind: r.kind, code: r.code, note: r.note, addedAt: r.added_at,
        addedBy: r.added_by, anonymous: !!r.anonymous, worked: Number(r.worked ?? 0), failed: Number(r.failed ?? 0),
        lastConfirmed: r.last_confirmed,
      }
    : null;
  return { id: r.id, name: r.name, category: r.category, address: r.address, lat: r.lat, lng: r.lng, current, locked: !!r.locked };
}

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

const supabaseApi = (): Api => {
  const db = supabase!;
  // The signed-in person's id from the locally stored session: no network call,
  // and a dropped connection can't be mistaken for "signed out".
  const myId = async () => (await db.auth.getSession()).data.session?.user.id ?? null;
  return {
    async placesInView(b) {
      const rows = must<PlaceRow[]>(await db.rpc("places_in_view", {
        min_lng: b.minLng, min_lat: b.minLat, max_lng: b.maxLng, max_lat: b.maxLat,
      }));
      return rows.map(toSummary);
    },

    async searchPlaces(q, near) {
      const rows = must<PlaceRow[]>(await db.rpc("search_places", {
        q, near_lat: near?.lat ?? null, near_lng: near?.lng ?? null,
      }));
      return rows.map(toSummary);
    },

    async getPlace(id) {
      // Place and history in parallel; history uses the same visibility rules as the current code.
      const [placeRes, historyRes, me] = await Promise.all([
        db.rpc("place_by_id", { pid: id }),
        db.rpc("place_history", { pid: id }),
        myId(),
      ]);
      const rows = must<PlaceRow[]>(placeRes);
      if (!rows.length) return null;
      const base = toSummary(rows[0]);
      const history = must<{ code: string | null; kind: AccessKind; created_at: string }[]>(historyRes);
      let myVote: boolean | null = null;
      if (base.current && me) {
        const v = await db.from("confirmations").select("worked")
          .eq("code_id", base.current.id).eq("user_id", me).maybeSingle();
        myVote = v.data ? v.data.worked : null;
      }
      return { ...base, history: history.map((h) => ({ code: h.code, kind: h.kind, addedAt: h.created_at })), myVote };
    },

    async addCode(c) {
      return must<string>(await db.rpc("add_code", {
        p_place_id: c.placeId ?? null,
        p_name: c.newPlace?.name ?? null,
        p_category: c.newPlace?.category ?? null,
        p_lat: c.newPlace?.lat ?? null,
        p_lng: c.newPlace?.lng ?? null,
        p_address: c.newPlace?.address ?? null,
        p_kind: c.kind,
        p_code: c.kind === "keypad" ? c.code ?? null : null,
        p_note: c.note || null,
        p_anonymous: !!c.anonymous,
      }));
    },

    async vote(codeId, worked) {
      const me = await myId();
      if (!me) throw new Error("Sign in to vote.");
      must(await db.from("confirmations").upsert({ code_id: codeId, user_id: me, worked }));
    },

    async report(placeId, codeId, reason, details) {
      const me = await myId();
      must(await db.from("reports").insert({
        place_id: placeId, code_id: codeId, reason, details: details || null, user_id: me,
      }));
    },

    async getProfile() {
      const me = await myId();
      if (!me) return null;
      // Any failure here throws, so callers can tell "no profile yet" from "couldn't check".
      const [p, statsRes] = await Promise.all([
        db.from("profiles").select("id, display_name, created_at").eq("id", me).maybeSingle(),
        db.rpc("my_stats"),
      ]);
      if (p.error) throw new Error(p.error.message);
      if (!p.data) return null;
      const stats = must<{ codes_added: number; confirmations: number }[]>(statsRes);
      return {
        id: p.data.id, displayName: p.data.display_name, createdAt: p.data.created_at,
        codesAdded: Number(stats[0]?.codes_added ?? 0), confirmations: Number(stats[0]?.confirmations ?? 0),
      };
    },

    async createProfile(displayName) {
      const me = await myId();
      if (!me) throw new Error("Not signed in.");
      const res = await db.from("profiles").insert({ id: me, display_name: displayName, terms_accepted_at: new Date().toISOString() });
      if (res.error?.code === "23505") {
        if (res.error.message.includes("profiles_pkey")) return;   // profile already exists: nothing to do
        throw new Error("That display name is taken. Try another.");
      }
      must(res);
    },

    async deleteAccount(appleAuthCode) {
      must(await db.functions.invoke("delete-account", {
        method: "POST",
        body: appleAuthCode ? { apple_authorization_code: appleAuthCode } : {},
      }));
      await db.auth.signOut();
    },
  };
};

export const api: Api = supabase ? supabaseApi() : demoApi;
