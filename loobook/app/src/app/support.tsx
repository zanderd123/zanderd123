import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Sheet } from "../components/Sheet";
import { Body, Button, ErrorText } from "../components/ui";
import { useAuth } from "../lib/auth";
import { DEMO, IN_EXPO_GO } from "../lib/config";
import { loadTips, type Tip } from "../lib/monetization";
import { colors } from "../lib/theme";

// What the tip jar looks like before the store products exist.
const PREVIEW = ["$0.99", "$2.99", "$4.99", "$9.99"];

export default function Support() {
  const { profile } = useAuth();
  const [tips, setTips] = useState<Tip[] | null>(null);
  const [thanks, setThanks] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    loadTips(profile?.id).then(setTips).catch(() => setTips([]));
  }, [profile?.id]);

  const buy = async (t: Tip) => {
    setBusy(t.id); setError(null);
    try { if ((await t.buy()) === "thanks") setThanks(true); }
    catch (e) { setError((e as Error).message || "The purchase didn't go through. You weren't charged."); }
    finally { setBusy(null); }
  };

  return (
    <Sheet title="Keep LooBook free" subtitle="Tips are optional and don't unlock anything.">
      {thanks ? (
        <Body>Thank you! Every tip helps pay for the map and keeps ads to a minimum.</Body>
      ) : (
        <>
          <Body>LooBook is built by the people who use it. Tips cover servers and map costs, so there can be fewer ads.</Body>
          {tips === null ? (
            <ActivityIndicator color={colors.ink} />
          ) : tips.length > 0 ? (
            <View style={{ gap: 10 }}>
              {tips.map((t) => <Button key={t.id} title={`${t.title} · ${t.price}`} busy={busy === t.id} onPress={() => buy(t)} />)}
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {PREVIEW.map((p) => <Button key={p} title={`Tip ${p}`} disabled />)}
              <Body small muted>
                {IN_EXPO_GO || DEMO
                  ? "Preview only. Tips work in the full app once the store products are set up."
                  : "Tips aren't available right now. Try again later."}
              </Body>
            </View>
          )}
          {error && <ErrorText>{error}</ErrorText>}
          <Body small muted>Payment is handled by the App Store or Google Play. Tips aren't tax-deductible.</Body>
        </>
      )}
    </Sheet>
  );
}
