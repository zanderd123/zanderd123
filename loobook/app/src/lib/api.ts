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
  deleteAccount(): Promise<void>;
  /** demo only: put a few sample places around the person so the map isn't empty */
  seedAround?(lat: number, lng: number): void;
}

/* ---------------- Supabase implementation ---------------- */

interface PlaceRow {
  id: string; name: string; category: Category; address: string | null; lat: number; lng: number;
  code_id: string | null; kind: AccessKind | null; code: string | null; note: string | null;
  added_at: string | null; added_by: string | null; worked: number | null; failed: number | null;
  last_confirmed: string | null; locked: boolean | null;
}

function toSummary(r: PlaceRow): PlaceSummary {
  const current: CodeEntry | null = r.code_id && r.kind && r.added_at
    ? {
        id: r.code_id, kind: r.kind, code: r.code, note: r.note, addedAt: r.added_at,
        addedBy: r.added_by, worked: Number(r.worked ?? 0), failed: Number(r.failed ?? 0),
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
      const rows = must<PlaceRow[]>(await db.rpc("place_by_id", { pid: id }));
      if (!rows.length) return null;
      const base = toSummary(rows[0]);
      const history = must<{ code: string | null; kind: AccessKind; created_at: string }[]>(
        await db.from("codes").select("code, kind, created_at").eq("place_id", id)
          .order("created_at", { ascending: false }).range(1, 10),
      );
      let myVote: boolean | null = null;
      const { data: user } = await db.auth.getUser();
      if (base.current && user.user) {
        const v = await db.from("confirmations").select("worked")
          .eq("code_id", base.current.id).eq("user_id", user.user.id).maybeSingle();
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
      }));
    },

    async vote(codeId, worked) {
      const { data } = await db.auth.getUser();
      if (!data.user) throw new Error("Sign in to vote.");
      must(await db.from("confirmations").upsert({ code_id: codeId, user_id: data.user.id, worked }));
    },

    async report(placeId, codeId, reason, details) {
      const { data } = await db.auth.getUser();
      must(await db.from("reports").insert({
        place_id: placeId, code_id: codeId, reason, details: details || null, user_id: data.user?.id,
      }));
    },

    async getProfile() {
      const { data } = await db.auth.getUser();
      if (!data.user) return null;
      const p = await db.from("profiles").select("id, display_name, created_at").eq("id", data.user.id).maybeSingle();
      if (p.error) throw new Error(p.error.message);
      if (!p.data) return null;
      const stats = must<{ codes_added: number; confirmations: number }[]>(await db.rpc("my_stats"));
      return {
        id: p.data.id, displayName: p.data.display_name, createdAt: p.data.created_at,
        codesAdded: Number(stats[0]?.codes_added ?? 0), confirmations: Number(stats[0]?.confirmations ?? 0),
      };
    },

    async createProfile(displayName) {
      const { data } = await db.auth.getUser();
      if (!data.user) throw new Error("Not signed in.");
      const res = await db.from("profiles").insert({ id: data.user.id, display_name: displayName, terms_accepted_at: new Date().toISOString() });
      if (res.error?.code === "23505") throw new Error("That display name is taken. Try another.");
      must(res);
    },

    async deleteAccount() {
      must(await db.functions.invoke("delete-account", { method: "POST" }));
      await db.auth.signOut();
    },
  };
};

export const api: Api = supabase ? supabaseApi() : demoApi;
