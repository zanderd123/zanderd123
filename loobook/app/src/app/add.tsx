import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Sheet } from "../components/Sheet";
import { Body, Button, Checkbox, ErrorText, Field, Label } from "../components/ui";
import { api } from "../lib/api";
import { CODE_PATTERN, distanceMeters, formatDistance } from "../lib/format";
import { colors, fonts } from "../lib/theme";
import { CATEGORY_LABEL, type AccessKind, type Category, type PlaceSummary } from "../lib/types";

const KINDS: [AccessKind, string][] = [["keypad", "Keypad code"], ["receipt", "On the receipt"], ["ask", "Ask staff / key"], ["open", "No code needed"]];
const NEW_CATS: Category[] = ["coffee", "restaurant", "fastfood", "grocery", "gas", "retail", "bar", "other"];

function Option({ selected, onPress, title, sub, right }: { selected: boolean; onPress: () => void; title: string; sub?: string | null; right?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={{
        flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, backgroundColor: colors.paper,
        borderWidth: selected ? 2.5 : 1.5, borderColor: colors.ink,
      }}
    >
      <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.ink, alignItems: "center", justifyContent: "center" }}>
        {selected && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.ink }} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink }}>{title}</Text>
        {sub ? <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.ink2 }} numberOfLines={1}>{sub}</Text> : null}
      </View>
      {right ? <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.ink3 }}>{right}</Text> : null}
    </Pressable>
  );
}

export default function AddCode() {
  const params = useLocalSearchParams<{ placeId?: string; placeName?: string; lat?: string; lng?: string }>();
  const fixedId = params.placeId || null;
  const here = { lat: Number(params.lat ?? 0), lng: Number(params.lng ?? 0) };
  const [nearby, setNearby] = useState<(PlaceSummary & { d: number })[]>([]);
  const [where, setWhere] = useState<string | null>(fixedId);
  const [newName, setNewName] = useState("");
  const [newCat, setNewCat] = useState<Category>("restaurant");
  const [kind, setKind] = useState<AccessKind>("keypad");
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [ok, setOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (fixedId) return;
    const pad = 0.01;
    api.placesInView({ minLat: here.lat - pad, maxLat: here.lat + pad, minLng: here.lng - pad, maxLng: here.lng + pad })
      .then((list) => {
        const sorted = list.map((p) => ({ ...p, d: distanceMeters(here, p) })).sort((a, b) => a.d - b.d).slice(0, 6);
        setNearby(sorted);
        if (sorted[0]) setWhere(sorted[0].id);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixedId]);

  const submit = async () => {
    setError(null);
    const value = code.trim().toUpperCase();
    if (!where) return setError("Pick the place this code is for.");
    if (where === "new" && newName.trim().length < 2) return setError("Add the name of the place.");
    if (kind === "keypad" && !CODE_PATTERN.test(value)) return setError("Codes are 3 to 12 numbers or letters. # and * are fine.");
    if (!ok) return setError("Please confirm the code was given to customers or posted publicly.");
    setBusy(true);
    try {
      const placeId = await api.addCode({
        placeId: where === "new" ? undefined : where,
        newPlace: where === "new" ? { name: newName.trim(), category: newCat, lat: here.lat, lng: here.lng } : undefined,
        kind, code: value, note: note.trim(),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.dismissAll();
      router.push(`/place/${placeId}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={fixedId ? "Update the code" : "Add a code"} subtitle={fixedId ? params.placeName : "Thanks for helping the next person out."}>
      {!fixedId && (
        <View style={{ gap: 8 }}>
          <Label>Where?</Label>
          {nearby.map((p) => (
            <Option key={p.id} selected={where === p.id} onPress={() => setWhere(p.id)} title={p.name} sub={p.address} right={formatDistance(p.d)} />
          ))}
          <Option selected={where === "new"} onPress={() => setWhere("new")} title="Somewhere else" sub="A new place where you are now" />
          {where === "new" && (
            <View style={{ gap: 10 }}>
              <Field label="Name of the place" value={newName} onChangeText={setNewName} maxLength={80} placeholder="e.g. Elm Street Bakery" />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {NEW_CATS.map((c) => (
                  <Pressable key={c} onPress={() => setNewCat(c)} accessibilityRole="radio" accessibilityState={{ selected: newCat === c }}
                    style={{ borderWidth: 1.5, borderColor: colors.ink, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: newCat === c ? colors.ink : colors.paper }}>
                    <Text style={{ fontFamily: fonts.bodyBold, fontSize: 13, color: newCat === c ? colors.paper : colors.ink }}>{CATEGORY_LABEL[c]}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </View>
      )}

      <View style={{ gap: 8 }}>
        <Label>What kind of access?</Label>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {KINDS.map(([k, label]) => (
            <Pressable key={k} onPress={() => setKind(k)} accessibilityRole="radio" accessibilityState={{ selected: kind === k }}
              style={{ flexBasis: "47%", flexGrow: 1, minHeight: 46, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.ink, borderRadius: 12, backgroundColor: kind === k ? colors.ink : colors.paper }}>
              <Text style={{ fontFamily: fonts.bodyBold, fontSize: 14, color: kind === k ? colors.paper : colors.ink }}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {kind === "keypad" && (
        <Field
          label="Code" value={code} onChangeText={(v) => setCode(v.toUpperCase())} autoCapitalize="characters" autoCorrect={false}
          maxLength={12} placeholder="1234#" keyboardType={undefined}
          style={{ fontFamily: fonts.code, fontSize: 26, letterSpacing: 4, textAlign: "center" }}
        />
      )}
      <Field label="Tip (optional)" value={note} onChangeText={setNote} maxLength={140} multiline placeholder="e.g. Door is past the kitchen, on the left." style={{ minHeight: 76, paddingTop: 12, textAlignVertical: "top" }} />

      <Checkbox checked={ok} onChange={setOk}>
        <Body small>Staff gave me this code, or it's printed on a receipt or posted in public. It's not an employee-only or private code.</Body>
      </Checkbox>
      {error && <ErrorText>{error}</ErrorText>}
      <Button variant="red" title="Post code" busy={busy} onPress={submit} />
      <Body small muted>Your display name and the time will show next to the code.</Body>
    </Sheet>
  );
}
