import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

export type LatLng = { lat: number; lng: number };
type Perm = "unknown" | "granted" | "denied";

const ASKED_KEY = "loobook:location-asked";
export const locationAsked = async () => (await AsyncStorage.getItem(ASKED_KEY)) === "1";
export const markLocationAsked = () => AsyncStorage.setItem(ASKED_KEY, "1");

export async function requestLocation(): Promise<boolean> {
  await markLocationAsked();
  const res = await Location.requestForegroundPermissionsAsync();
  return res.granted;
}

/**
 * Foreground-only location: follows the person while the app is open and
 * stops the moment it goes to the background. Nothing is stored or sent.
 */
export function useMyLocation() {
  const [perm, setPerm] = useState<Perm>("unknown");
  const [me, setMe] = useState<LatLng | null>(null);
  const sub = useRef<Location.LocationSubscription | null>(null);

  const stop = () => { sub.current?.remove(); sub.current = null; };

  const start = useCallback(async () => {
    const p = await Location.getForegroundPermissionsAsync();
    setPerm(p.granted ? "granted" : p.canAskAgain ? "unknown" : "denied");
    if (!p.granted || sub.current) return;
    const last = await Location.getLastKnownPositionAsync();
    if (last) setMe({ lat: last.coords.latitude, lng: last.coords.longitude });
    sub.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, distanceInterval: 25, timeInterval: 10000 },
      (pos) => setMe({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
    );
  }, []);

  useEffect(() => {
    start();
    const s = AppState.addEventListener("change", (st) => (st === "active" ? start() : stop()));
    return () => { s.remove(); stop(); };
  }, [start]);

  const ask = useCallback(async () => {
    const ok = await requestLocation();
    setPerm(ok ? "granted" : "denied");
    if (ok) await start();
    return ok;
  }, [start]);

  return { perm, me, ask };
}

/** City, state, ZIP or address → coordinates, using the phone's own geocoder. */
export async function geocode(q: string): Promise<{ lat: number; lng: number; label: string }[]> {
  try {
    const hits = await Location.geocodeAsync(q);
    return hits.slice(0, 5).map((h) => ({ lat: h.latitude, lng: h.longitude, label: q }));
  } catch {
    return [];
  }
}
