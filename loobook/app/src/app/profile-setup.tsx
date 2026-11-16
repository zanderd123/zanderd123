import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Body, Button, Checkbox, ErrorText, Field, H1, Paper, t } from "../components/ui";
import { useAuth } from "../lib/auth";
import { MARGIN_X } from "../lib/theme";

const NAME = /^[A-Za-z0-9_.]{3,24}$/;

export default function ProfileSetup() {
  const { completeProfile, signOut } = useAuth();
  const [name, setName] = useState("");
  const [age, setAge] = useState(false);
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!NAME.test(name)) return setError("Use 3 to 24 letters, numbers, dots or underscores.");
    if (!age) return setError("You need to be 13 or older to use LooBook.");
    if (!terms) return setError("Please agree to the Terms to continue.");
    setBusy(true);
    try { await completeProfile(name); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Paper>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ paddingLeft: MARGIN_X + 16, paddingRight: 24, paddingVertical: 24, gap: 20 }} keyboardShouldPersistTaps="handled">
            <H1>One last thing</H1>
            <Body muted>This name shows next to codes you share. Don't use your real full name.</Body>
            <Field label="Display name" value={name} onChangeText={(v) => setName(v.replace(/\s/g, "_"))} autoCapitalize="none" autoCorrect={false} maxLength={24} placeholder="e.g. dana_eats" />
            <Checkbox checked={age} onChange={setAge}>
              <Body>I'm 13 or older (or the minimum age for online services where I live).</Body>
            </Checkbox>
            <Checkbox checked={terms} onChange={setTerms}>
              <Body>
                I agree to the{" "}
                <Text style={t.link} onPress={() => router.push("/legal/terms")}>Terms of Service</Text>,{" "}
                <Text style={t.link} onPress={() => router.push("/legal/privacy")}>Privacy Policy</Text> and{" "}
                <Text style={t.link} onPress={() => router.push("/legal/guidelines")}>Community Guidelines</Text>.
              </Body>
            </Checkbox>
            {error && <ErrorText>{error}</ErrorText>}
            <Button variant="red" title="Start using LooBook" busy={busy} onPress={submit} />
            <Button variant="ghost" title="Cancel and sign out" onPress={signOut} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Paper>
  );
}
