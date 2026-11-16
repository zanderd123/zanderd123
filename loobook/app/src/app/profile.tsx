import * as Clipboard from "expo-clipboard";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState, type ReactNode } from "react";
import { Linking, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AdBanner } from "../components/AdBanner";
import { Body, Button, Checkbox, ErrorText, H2, Label, Paper } from "../components/ui";
import { useAuth } from "../lib/auth";
import { config } from "../lib/config";
import { shortDate } from "../lib/format";
import { openAdPrivacyOptions } from "../lib/monetization";
import { colors, fonts, MARGIN_X } from "../lib/theme";

function Row({ title, onPress, danger, right }: { title: string; onPress: () => void; danger?: boolean; right?: ReactNode }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={{ minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: colors.rule }}>
      <Text style={{ fontFamily: danger ? fonts.bodyBold : fonts.body, fontSize: 16, color: danger ? colors.margin : colors.ink }}>{title}</Text>
      {right ?? <Text style={{ fontSize: 18, color: colors.ink2 }}>›</Text>}
    </Pressable>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <View style={{ flex: 1, borderWidth: 2, borderColor: colors.ink, borderRadius: 12, paddingVertical: 10, alignItems: "center", backgroundColor: colors.paper }}>
      <Text style={{ fontFamily: fonts.hand, fontSize: 30, lineHeight: 34, color: colors.ink }}>{n}</Text>
      <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.ink2 }}>{label}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const { profile, refreshProfile, signOut, deleteAccount } = useAuth();
  const [confirm, setConfirm] = useState(false);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useFocusEffect(useCallback(() => { refreshProfile(); }, [refreshProfile]));

  const doDelete = async () => {
    setBusy(true); setError(null);
    try { await deleteAccount(); setConfirm(false); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const initials = (profile?.displayName ?? "?").replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase();

  return (
    <Paper>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: colors.ink, backgroundColor: colors.paper }}>
          <Pressable onPress={() => router.back()} accessibilityLabel="Back to map" hitSlop={10}
            style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: colors.ink, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontFamily: fonts.bodyBold, fontSize: 20 }}>‹</Text>
          </Pressable>
          <H2>Profile</H2>
        </View>
        <ScrollView contentContainerStyle={{ paddingLeft: MARGIN_X + 14, paddingRight: 20, paddingVertical: 20, gap: 22 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.marginSoft, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontFamily: fonts.hand, fontSize: 26 }}>{initials}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.hand, fontSize: 24, color: colors.ink }}>@{profile?.displayName}</Text>
              {profile && <Body small muted>Joined {shortDate(profile.createdAt)}</Body>}
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: 8 }}>
            <Stat n={profile?.codesAdded ?? 0} label="codes added" />
            <Stat n={profile?.confirmations ?? 0} label="confirmed" />
          </View>

          <Pressable onPress={() => router.push("/support")} accessibilityRole="button">
            <View style={{ position: "absolute", left: 4, top: 4, right: -4, bottom: -4, backgroundColor: colors.ink, borderRadius: 14 }} />
            <View style={{ borderWidth: 2, borderColor: colors.ink, borderRadius: 14, padding: 14, backgroundColor: colors.marginSoft, gap: 4 }}>
              <Text style={{ fontFamily: fonts.hand, fontSize: 22, color: colors.ink }}>Keep LooBook free</Text>
              <Body small>Leave a tip to help pay for servers and keep ads to a minimum.</Body>
            </View>
          </Pressable>

          <View>
            <Label style={{ marginBottom: 6 }}>Settings & info</Label>
            <View style={{ borderTopWidth: 1.5, borderTopColor: colors.ink }}>
              <Row title="Location access" onPress={() => Linking.openSettings()} />
              <Row title="Ad privacy choices" onPress={async () => { if (!(await openAdPrivacyOptions())) setNote("Ad choices appear here once ads are running in the full app."); }} />
              <Row title="Community Guidelines" onPress={() => router.push("/legal/guidelines")} />
              <Row title="Terms of Service" onPress={() => router.push("/legal/terms")} />
              <Row title="Privacy Policy" onPress={() => router.push("/legal/privacy")} />
              <Row title="Help & contact" onPress={async () => {
                const url = `mailto:${config.supportEmail}?subject=LooBook%20help`;
                if (await Linking.canOpenURL(url)) Linking.openURL(url);
                else { await Clipboard.setStringAsync(config.supportEmail); setNote(`Copied ${config.supportEmail}`); }
              }} />
              <Row title="Sign out" onPress={signOut} right={<View />} />
              <Row title="Delete account" danger onPress={() => { setSure(false); setConfirm(true); }} right={<View />} />
            </View>
          </View>
          {note && <Body small style={{ fontFamily: fonts.bodyBold }}>{note}</Body>}
          <AdBanner />
          <Body small muted>LooBook v0.1</Body>
        </ScrollView>
      </SafeAreaView>

      <Modal visible={confirm} transparent animationType="fade" onRequestClose={() => setConfirm(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(17,17,17,.4)", justifyContent: "center", padding: 20 }}>
          <View style={{ backgroundColor: colors.paper, borderWidth: 2.5, borderColor: colors.ink, borderRadius: 16, padding: 20, gap: 14 }}>
            <H2>Delete your account?</H2>
            <Body small>This removes your email, display name and settings within 30 days. Codes you shared stay on the map without your name so others can still use them.</Body>
            <Checkbox checked={sure} onChange={setSure}><Body small>I understand this can't be undone.</Body></Checkbox>
            {error && <ErrorText>{error}</ErrorText>}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Button small title="Keep account" style={{ flex: 1 }} onPress={() => setConfirm(false)} />
              <Button small variant="red" title="Delete" style={{ flex: 1 }} disabled={!sure} busy={busy} onPress={doDelete} />
            </View>
          </View>
        </View>
      </Modal>
    </Paper>
  );
}
