import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import MapView, { Marker, type Region } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MeDot, Pin } from "../components/Pin";
import { Chip } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { DEMO } from "../lib/config";
import { ago, distanceMeters, formatDistance, freshness } from "../lib/format";
import { geocode, useMyLocation } from "../lib/location";
import { colors, fonts, mapStyle } from "../lib/theme";
import { FOOD, type PlaceSummary } from "../lib/types";

type Filter = "codes" | "fresh" | "food" | "shops";
type Result =
  | { kind: "place"; place: PlaceSummary }
  | { kind: "area"; label: string; lat: number; lng: number };

const WORLD: Region = { latitude: 25, longitude: -40, latitudeDelta: 110, longitudeDelta: 140 };
const DEMO_START: Region = { latitude: 41.8827, longitude: -87.629, latitudeDelta: 0.02, longitudeDelta: 0.02 };
const WEEK = 7 * 24 * 3600e3;

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const { me, perm, ask } = useMyLocation();
  const mapRef = useRef<MapView>(null);
  const [region, setRegion] = useState<Region>(DEMO ? DEMO_START : WORLD);
  const [places, setPlaces] = useState<PlaceSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<Set<Filter>>(new Set());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [track, setTrack] = useState(true);
  const centred = useRef(false);
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---------- load places for the visible area ---------- */
  const load = useCallback(async (r: Region) => {
    if (r.latitudeDelta > 30) { setPlaces([]); return; }   // too far out to be useful
    setLoading(true);
    try {
      const list = await api.placesInView({
        minLat: r.latitude - r.latitudeDelta / 2, maxLat: r.latitude + r.latitudeDelta / 2,
        minLng: r.longitude - r.longitudeDelta / 2, maxLng: r.longitude + r.longitudeDelta / 2,
      });
      setPlaces(list);
      setTrack(true);
      setTimeout(() => setTrack(false), 700);
    } catch {
      // keep what we have; the next pan retries
    } finally {
      setLoading(false);
    }
  }, []);

  const regionRef = useRef(region);
  const onRegion = (r: Region) => {
    regionRef.current = r;
    setRegion(r);
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    fetchTimer.current = setTimeout(() => load(r), 300);
  };

  // refresh whenever the map comes back into view (e.g. after adding a code)
  useFocusEffect(useCallback(() => { load(regionRef.current); }, [load]));

  /* ---------- follow the person once, the first time we know where they are ---------- */
  useEffect(() => {
    if (!me || centred.current) return;
    centred.current = true;
    api.seedAround?.(me.lat, me.lng);
    mapRef.current?.animateToRegion({ latitude: me.lat, longitude: me.lng, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 600);
  }, [me]);

  const goToMe = async () => {
    if (perm !== "granted") { const ok = await ask(); if (!ok) return; }
    if (me) mapRef.current?.animateToRegion({ latitude: me.lat, longitude: me.lng, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 500);
  };

  /* ---------- filters ---------- */
  const shown = useMemo(() => places.filter((p) => {
    if (filters.has("codes") && !p.current) return false;
    if (filters.has("fresh") && (!p.current || Date.now() - new Date(p.current.addedAt).getTime() > WEEK)) return false;
    if (filters.has("food") && !FOOD.includes(p.category)) return false;
    if (filters.has("shops") && FOOD.includes(p.category)) return false;
    return true;
  }), [places, filters]);

  const toggle = (f: Filter) => setFilters((old) => {
    const s = new Set(old);
    if (s.has(f)) s.delete(f); else { s.add(f); if (f === "food") s.delete("shops"); if (f === "shops") s.delete("food"); }
    return s;
  });

  /* ---------- closest code ---------- */
  const nearest = useMemo(() => {
    const ref = me ?? { lat: region.latitude, lng: region.longitude };
    if (region.latitudeDelta > 0.5) return null;
    let best: { p: PlaceSummary; d: number } | null = null;
    for (const p of shown) {
      if (!p.current) continue;
      const d = distanceMeters(ref, p);
      if (!best || d < best.d) best = { p, d };
    }
    return best && best.d < 8000 ? { ...best, fromMe: !!me } : null;
  }, [shown, me, region]);

  /* ---------- search ---------- */
  const search = async () => {
    const q = query.trim();
    if (!q) { setResults(null); return; }
    setSearching(true);
    try {
      const near = me ?? { lat: region.latitude, lng: region.longitude };
      const [spots, areas] = await Promise.all([api.searchPlaces(q, near).catch(() => []), geocode(q)]);
      setResults([
        ...areas.map((a) => ({ kind: "area" as const, label: a.label, lat: a.lat, lng: a.lng })).slice(0, 1),
        ...spots.map((p) => ({ kind: "place" as const, place: p })),
      ]);
    } finally { setSearching(false); }
  };

  const pick = (r: Result) => {
    Keyboard.dismiss();
    setResults(null);
    if (r.kind === "area") {
      mapRef.current?.animateToRegion({ latitude: r.lat, longitude: r.lng, latitudeDelta: 0.05, longitudeDelta: 0.05 }, 700);
    } else {
      mapRef.current?.animateToRegion({ latitude: r.place.lat, longitude: r.place.lng, latitudeDelta: 0.006, longitudeDelta: 0.006 }, 600);
      router.push(`/place/${r.place.id}`);
    }
  };

  const initials = (profile?.displayName ?? "?").replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase();

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper2 }}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        onRegionChangeComplete={onRegion}
        customMapStyle={Platform.OS === "android" ? mapStyle : undefined}
        mapType={Platform.OS === "ios" ? "mutedStandard" : "standard"}
        showsPointsOfInterests={false}
        showsCompass={false}
        toolbarEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        onPress={() => { Keyboard.dismiss(); setResults(null); }}
      >
        {shown.map((p) => (
          <Marker
            key={p.id}
            coordinate={{ latitude: p.lat, longitude: p.lng }}
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={track}
            zIndex={p.current ? 2 : 1}
            accessibilityLabel={`${p.name}, ${p.current ? "has a code" : "no code yet"}`}
            onPress={() => router.push(`/place/${p.id}`)}
          >
            <Pin state={!p.current ? "none" : freshness(p.current).level === "stale" ? "stale" : "code"} />
          </Marker>
        ))}
        {me && (
          <Marker coordinate={{ latitude: me.lat, longitude: me.lng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} zIndex={10}>
            <MeDot />
          </Marker>
        )}
      </MapView>

      {/* ---------- search bar + filters ---------- */}
      <View style={[s.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <View>
          <View style={s.shadow} />
          <View style={s.search}>
            <Text style={{ fontSize: 18 }} accessibilityElementsHidden>⌕</Text>
            <TextInput
              value={query}
              onChangeText={(v) => { setQuery(v); if (!v) setResults(null); }}
              onSubmitEditing={search}
              returnKeyType="search"
              placeholder="City, state, ZIP or place"
              placeholderTextColor={colors.ink3}
              accessibilityLabel="Search"
              style={s.input}
            />
            {searching && <ActivityIndicator color={colors.ink} />}
            <Pressable onPress={() => router.push("/profile")} accessibilityLabel="Your profile" style={s.avatar}>
              <Text style={{ fontFamily: fonts.hand, fontSize: 17 }}>{initials}</Text>
            </Pressable>
          </View>
        </View>

        {results && (
          <View style={s.results}>
            {results.length === 0 ? (
              <Text style={[s.resultSub, { padding: 14 }]}>Nothing found for “{query}”. Try a city, state or ZIP code.</Text>
            ) : (
              <FlatList
                data={results}
                keyboardShouldPersistTaps="handled"
                keyExtractor={(r, i) => (r.kind === "place" ? r.place.id : `a${i}`)}
                renderItem={({ item }) => (
                  <Pressable onPress={() => pick(item)} style={s.result} accessibilityRole="button">
                    <View style={{ flex: 1 }}>
                      <Text style={s.resultTitle}>{item.kind === "place" ? item.place.name : `Go to “${item.label}”`}</Text>
                      <Text style={s.resultSub} numberOfLines={1}>{item.kind === "place" ? item.place.address : "Area on the map"}</Text>
                    </View>
                    {item.kind === "place" && (
                      <Text style={[s.tag, item.place.current && { backgroundColor: colors.margin, color: "#fff", borderColor: colors.margin }]}>
                        {item.place.current ? "Code" : "No code"}
                      </Text>
                    )}
                  </Pressable>
                )}
              />
            )}
          </View>
        )}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
          <Chip title="Has a code" dot selected={filters.has("codes")} onPress={() => toggle("codes")} />
          <Chip title="Added this week" selected={filters.has("fresh")} onPress={() => toggle("fresh")} />
          <Chip title="Food & coffee" selected={filters.has("food")} onPress={() => toggle("food")} />
          <Chip title="Stores & gas" selected={filters.has("shops")} onPress={() => toggle("shops")} />
        </ScrollView>
        {region.latitudeDelta > 30 && (
          <Text style={s.hint}>Zoom in or search to see codes</Text>
        )}
        {loading && region.latitudeDelta <= 30 && <ActivityIndicator color={colors.ink} style={{ alignSelf: "flex-start" }} />}
      </View>

      {/* ---------- bottom controls ---------- */}
      {nearest && (
        <Pressable
          onPress={() => router.push(`/place/${nearest.p.id}`)}
          style={[s.nearby, { bottom: insets.bottom + 20 }]}
          accessibilityRole="button"
        >
          <Text style={s.nearLabel}>{nearest.fromMe ? "CLOSEST CODE TO YOU" : "CLOSEST CODE HERE"}</Text>
          <Text style={s.nearName} numberOfLines={1}>{nearest.p.name}</Text>
          <Text style={s.resultSub}>{formatDistance(nearest.d)} away · added {ago(nearest.p.current!.addedAt)}</Text>
        </Pressable>
      )}
      <Pressable onPress={goToMe} style={[s.round, { bottom: insets.bottom + 100 }]} accessibilityLabel="Show my location">
        <Text style={{ fontSize: 22 }}>◎</Text>
      </Pressable>
      <Pressable
        onPress={() => router.push({ pathname: "/add", params: { lat: String(me?.lat ?? region.latitude), lng: String(me?.lng ?? region.longitude) } })}
        style={[s.fab, { bottom: insets.bottom + 18 }]}
        accessibilityLabel="Add a code"
      >
        <Text style={{ color: "#fff", fontSize: 34, lineHeight: 38, fontFamily: fonts.bodyBold }}>+</Text>
      </Pressable>
      {DEMO && <Text style={[s.demo, { bottom: insets.bottom + 120 }]}>DEMO DATA</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  top: { position: "absolute", left: 12, right: 12, top: 0, gap: 8 },
  shadow: { position: "absolute", left: 3, top: 3, right: -3, bottom: -3, backgroundColor: colors.ink, borderRadius: 14 },
  search: {
    flexDirection: "row", alignItems: "center", gap: 8, minHeight: 54, paddingLeft: 14, paddingRight: 6,
    backgroundColor: colors.paper, borderWidth: 2, borderColor: colors.ink, borderRadius: 14,
  },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 17, color: colors.ink, paddingVertical: 10 },
  avatar: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: colors.ink,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.marginSoft,
  },
  results: { maxHeight: 320, backgroundColor: colors.paper, borderWidth: 2, borderColor: colors.ink, borderRadius: 14, overflow: "hidden" },
  result: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.rule },
  resultTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  resultSub: { fontFamily: fonts.body, fontSize: 13, color: colors.ink2 },
  tag: { fontFamily: fonts.bodyBold, fontSize: 12, borderWidth: 1.5, borderColor: colors.ink, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden", color: colors.ink },
  hint: { alignSelf: "flex-start", fontFamily: fonts.bodyBold, fontSize: 13, backgroundColor: colors.ink, color: colors.paper, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99, overflow: "hidden" },
  nearby: {
    position: "absolute", left: 12, right: 92, backgroundColor: colors.paper, borderWidth: 2, borderColor: colors.ink,
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10,
    shadowColor: colors.ink, shadowOffset: { width: 3, height: 3 }, shadowOpacity: 1, shadowRadius: 0, elevation: 4,
  },
  nearLabel: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1, color: colors.margin },
  nearName: { fontFamily: fonts.hand, fontSize: 20, lineHeight: 26, color: colors.ink },
  round: {
    position: "absolute", right: 20, width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: colors.ink,
    backgroundColor: colors.paper, alignItems: "center", justifyContent: "center",
    shadowColor: colors.ink, shadowOffset: { width: 3, height: 3 }, shadowOpacity: 1, shadowRadius: 0, elevation: 4,
  },
  fab: {
    position: "absolute", right: 16, width: 64, height: 64, borderRadius: 32, borderWidth: 2.5, borderColor: colors.ink,
    backgroundColor: colors.margin, alignItems: "center", justifyContent: "center",
    shadowColor: colors.ink, shadowOffset: { width: 3, height: 3 }, shadowOpacity: 1, shadowRadius: 0, elevation: 6,
  },
  demo: {
    position: "absolute", left: 12, fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1, color: colors.ink2,
    backgroundColor: colors.paper, borderWidth: 1, borderStyle: "dashed", borderColor: colors.ink2, paddingHorizontal: 6, paddingVertical: 2,
  },
});
