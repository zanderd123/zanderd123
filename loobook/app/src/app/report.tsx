import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Sheet } from "../components/Sheet";
import { Body, Button, ErrorText, Field } from "../components/ui";
import { api } from "../lib/api";
import { colors, fonts } from "../lib/theme";
import type { ReportReason } from "../lib/types";

const REASONS: [ReportReason, string][] = [
  ["wrong", "The code is wrong or out of date"],
  ["private", "It's an employee-only or private code"],
  ["closed", "This place has closed or moved"],
  ["abuse", "Rude, offensive or spam content"],
  ["business", "I own this business and want the code removed"],
];

export default function Report() {
  const { placeId, codeId, name } = useLocalSearchParams<{ placeId: string; codeId?: string; name?: string }>();
  const [reason, setReason] = useState<ReportReason>("wrong");
  const [details, setDetails] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (reason === "business" && details.trim().length < 5) return setError("Tell us your role and how we can reach you, so we can confirm it's your business.");
    setBusy(true); setError(null);
    try { await api.report(placeId, codeId || null, reason, details.trim()); setSent(true); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  if (sent) {
    return (
      <Sheet title="Report sent">
        <Body>Thanks for keeping LooBook accurate. Our team reviews reports within 24 hours.</Body>
        {reason === "business" && <Body muted>We'll contact you to confirm you're with the business, then remove the code and block new ones for this location.</Body>}
        <Button variant="ink" title="Done" onPress={() => router.back()} />
      </Sheet>
    );
  }

  return (
    <Sheet title="Report a problem" subtitle={name}>
      <View style={{ gap: 8 }}>
        {REASONS.map(([r, label]) => (
          <Pressable key={r} onPress={() => setReason(r)} accessibilityRole="radio" accessibilityState={{ selected: reason === r }}
            style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: reason === r ? 2.5 : 1.5, borderColor: colors.ink, backgroundColor: colors.paper }}>
            <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.ink, alignItems: "center", justifyContent: "center" }}>
              {reason === r && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.ink }} />}
            </View>
            <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.ink }}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Field
        label={reason === "business" ? "Your role and contact (required)" : "Anything else? (optional)"}
        value={details} onChangeText={setDetails} multiline maxLength={500}
        placeholder={reason === "business" ? "e.g. Store manager, manager@mybakery.com" : ""}
        style={{ minHeight: 76, paddingTop: 12, textAlignVertical: "top" }}
      />
      {error && <ErrorText>{error}</ErrorText>}
      <Button variant="ink" title="Send report" busy={busy} onPress={send} />
    </Sheet>
  );
}
