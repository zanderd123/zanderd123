import { getLocales } from "expo-localization";
import type { CodeEntry } from "./types";

const HOUR = 3600e3;
const DAY = 24 * HOUR;

export function ago(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const unit = (n: number, w: string) => `${Math.round(n)} ${w}${Math.round(n) === 1 ? "" : "s"} ago`;
  const m = s / 60; if (m < 60) return unit(m, "min").replace("mins", "min");
  const h = m / 60; if (h < 24) return unit(h, "hour");
  const d = h / 24; if (d < 30) return unit(d, "day");
  const mo = d / 30; if (mo < 12) return unit(mo, "month");
  return unit(mo / 12, "year");
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Miles for the US, UK, Liberia and Myanmar; kilometres everywhere else. */
function usesMiles(): boolean {
  const loc = getLocales()[0];
  if (loc?.measurementSystem) return loc.measurementSystem !== "metric";
  return ["US", "GB", "LR", "MM"].includes(loc?.regionCode ?? "");
}

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371e3, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function formatDistance(m: number): string {
  if (usesMiles()) {
    const mi = m / 1609.34;
    if (mi < 0.1) return `${Math.round(m * 3.281)} ft`;
    return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi).toLocaleString()} mi`;
  }
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return m < 10000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 1000).toLocaleString()} km`;
}

export type Freshness = { level: "good" | "check" | "stale"; label: string };

export function freshness(c: CodeEntry): Freshness {
  const latest = Math.max(new Date(c.addedAt).getTime(), c.lastConfirmed ? new Date(c.lastConfirmed).getTime() : 0);
  const age = Date.now() - latest;
  const failRatio = c.failed / Math.max(1, c.worked + c.failed);
  if (age > 30 * DAY || (c.failed >= 2 && failRatio > 0.3)) return { level: "stale", label: "May have changed" };
  if (age > 7 * DAY) return { level: "check", label: "Check before you go" };
  return { level: "good", label: "Recently confirmed" };
}

export function accessLabel(c: CodeEntry): { title: string; value: string; isCode: boolean } {
  switch (c.kind) {
    case "keypad": return { title: "Restroom code", value: c.code ?? "", isCode: true };
    case "receipt": return { title: "Where to find it", value: "On your receipt", isCode: false };
    case "ask": return { title: "How to get in", value: "Ask staff for the key", isCode: false };
    case "open": return { title: "Access", value: "No code needed", isCode: false };
  }
}

export const CODE_PATTERN = /^[0-9A-Z#*]{3,12}$/;
