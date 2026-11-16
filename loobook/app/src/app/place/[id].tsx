import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Linking, Platform, Text, View } from "react-native";
import { AdBanner } from "../../components/AdBanner";
import { Sheet } from "../../components/Sheet";
import { Body, B, Button, ErrorText, Label } from "../../components/ui";
import { api } from "../../lib/api";
import { accessLabel, ago, freshness, shortDate } from "../../lib/format";
import { colors, fonts } from "../../lib/theme";
import { CATEGORY_LABEL, type PlaceDetail } from "../../lib/types";

const FRESH_COLOR = { good: colors.ok, check: colors.warn, stale: colors.margin };

export default function PlaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [place, setPlace] = useState<PlaceDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [voting, setVoting] = useState(false);

  const load = useCallback(() => {
    api.getPlace(id).then(setPlace).catch((e) => { setError((e as Error).message); setPlace(null); });
  }, [id]);
  useFocusEffect(load);

  if (place === undefined) {
    return <Sheet title="Loading…"><ActivityIndicator color={colors.ink} /></Sheet>;
  }
  if (!place) {
    return <Sheet title="Place not found"><Body muted>{error ?? "It may have been removed."}</Body></Sheet>;
  }

  const cur = place.current;
  const fresh = cur ? freshness(cur) : null;
  const access = cur ? accessLabel(cur) : null;
  const isOpen = cur?.kind === "open";
  const visit = () => router.push({ pathname: "/add", params: { placeId: place.id, placeName: place.name, mode: "open" } });

  const copy = async () => {
    if (!cur?.code) return;
    await Clipboard.setStringAsync(cur.code);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const vote = async (worked: boolean) => {
    if (!cur) return;
    setVoting(true);
    try { await api.vote(cur.id, worked); load(); }
    catch (e) { setError((e as Error).message); }
    finally { setVoting(false); }
  };

  const directions = () => {
    const q = `${place.lat},${place.lng}`;
    const url = Platform.OS === "ios"
      ? `http://maps.apple.com/?daddr=${q}`
      : `https://www.google.com/maps/dir/?api=1&destination=${q}`;
    Linking.openURL(url).catch(() => {});
  };

  return (
    <Sheet title={place.name} subtitle={[CATEGORY_LABEL[place.category], place.address].filter(Boolean).join(" · ")}>
      {cur && access && fresh ? (
        <>
          <View>
            <View style={{ position: "absolute", left: 4, top: 4, right: -4, bottom: -4, backgroundColor: isOpen ? colors.open : colors.margin, borderRadius: 14 }} />
            <View style={{ borderWidth: 2.5, borderColor: colors.ink, borderRadius: 14, backgroundColor: isOpen ? colors.openTint : colors.paper, padding: 16, gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Label>{access.title}</Label>
                  <Text
                    selectable
                    style={access.isCode
                      ? { fontFamily: fonts.code, fontSize: 36, letterSpacing: 5, color: colors.ink }
                      : { fontFamily: fonts.hand, fontSize: 26, lineHeight: 32, color: colors.ink }}
                  >
                    {access.value}
                  </Text>
                </View>
                {access.isCode && <Button small title={copied ? "Copied" : "Copy"} onPress={copy} />}
              </View>
              <Text style={{
                alignSelf: "flex-start", fontFamily: fonts.bodyBold, fontSize: 13, color: FRESH_COLOR[fresh.level],
                borderWidth: 1.5, borderColor: FRESH_COLOR[fresh.level], borderRadius: 99, paddingHorizontal: 10, paddingVertical: 2,
              }}>
                {fresh.label}
              </Text>
            </View>
          </View>

          {cur.note ? <Body>“{cur.note}”</Body> : null}

          <View style={{ gap: 4 }}>
            <Body><B>Added {ago(cur.addedAt)}</B> · {shortDate(cur.addedAt)}</Body>
            <Body>Last confirmed {isOpen ? "open" : "working"} {ago(cur.lastConfirmed)}</Body>
            <Body>Shared by <B>{cur.anonymous ? "Anonymous" : cur.addedBy ? `@${cur.addedBy}` : "a former member"}</B> · {cur.worked} {isOpen ? "said still open" : "worked"}, {cur.failed} {isOpen ? "found it locked" : "didn't"}</Body>
          </View>

          <View style={{ gap: 8 }}>
            <Label>{isOpen ? "Was it still open?" : "Did it work for you?"}</Label>
            {place.myVote !== null ? (
              <Body><B>Thanks!</B> You said {isOpen ? (place.myVote ? "it was still open" : "it was locked") : (place.myVote ? "it worked" : "it didn't work")}.</Body>
            ) : (
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Button small title={isOpen ? "Still open" : "Worked"} disabled={voting} onPress={() => vote(true)} style={{ flex: 1 }} />
                <Button small title={isOpen ? "Locked now" : "Didn't work"} disabled={voting} onPress={() => vote(false)} style={{ flex: 1 }} />
              </View>
            )}
          </View>

          {place.history.length > 0 && (
            <View style={{ gap: 6 }}>
              <Label>Older codes</Label>
              {place.history.map((h, i) => (
                <View key={i} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontFamily: fonts.code, color: colors.ink3, textDecorationLine: "line-through" }}>
                    {h.kind === "keypad" ? h.code : accessLabel({ ...cur, kind: h.kind }).value}
                  </Text>
                  <Text style={{ fontFamily: fonts.body, color: colors.ink3, fontSize: 13 }}>{shortDate(h.addedAt)}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button variant="ink" title={isOpen ? "It has a code now" : "Update code"} style={{ flex: 1 }} onPress={() => router.push({ pathname: "/add", params: { placeId: place.id, placeName: place.name } })} />
            <Button title="Directions" style={{ flex: 1 }} onPress={directions} />
          </View>
        </>
      ) : place.locked ? (
        <View style={{ borderWidth: 2, borderStyle: "dashed", borderColor: colors.ink3, borderRadius: 14, padding: 18, gap: 8, alignItems: "center" }}>
          <Text style={{ fontFamily: fonts.hand, fontSize: 22, color: colors.ink2 }}>Code removed</Text>
          <Body small muted style={{ textAlign: "center" }}>This business asked us not to list its restroom code. Please ask staff.</Body>
        </View>
      ) : (
        <View style={{ borderWidth: 2, borderStyle: "dashed", borderColor: colors.ink3, borderRadius: 14, padding: 18, gap: 12, alignItems: "center" }}>
          <Text style={{ fontFamily: fonts.hand, fontSize: 22, color: colors.ink2 }}>Nothing logged yet</Text>
          <Body small muted style={{ textAlign: "center" }}>Been here? Add the code if there was one, or let people know they can walk right in.</Body>
          <Button variant="red" title="Add the code" onPress={() => router.push({ pathname: "/add", params: { placeId: place.id, placeName: place.name } })} />
          <Button variant="green" title="No code needed" onPress={visit} />
        </View>
      )}

      {error && <ErrorText>{error}</ErrorText>}
      <Button variant="ghost" title="Report a problem" onPress={() => router.push({ pathname: "/report", params: { placeId: place.id, codeId: cur?.id ?? "", name: place.name } })} style={{ alignSelf: "flex-start" }} />
      <AdBanner />
    </Sheet>
  );
}
