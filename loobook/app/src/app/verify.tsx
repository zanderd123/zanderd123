import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CodeInput } from "../components/CodeInput";
import { B, Body, Button, ErrorText, H1, Paper, t } from "../components/ui";
import { useAuth } from "../lib/auth";
import { DEMO } from "../lib/config";
import { fonts, MARGIN_X } from "../lib/theme";

const RESEND_WAIT = 60;

/** Step 2 of email sign-up: type the 6-digit code we emailed. */
export default function VerifyEmail() {
  const { email = "" } = useLocalSearchParams<{ email: string }>();
  const { verifyEmailCode, resendEmailCode } = useAuth();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(RESEND_WAIT);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const submit = async (value = code) => {
    setError(null); setInfo(null); setBusy(true);
    try { await verifyEmailCode(email, value); }       // success: the app moves on to profile setup
    catch (e) { setError((e as Error).message); setCode(""); }
    finally { setBusy(false); }
  };

  const resend = async () => {
    setError(null);
    try { await resendEmailCode(email); setInfo("New code sent. Check your inbox and spam folder."); setWait(RESEND_WAIT); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <Paper>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingLeft: MARGIN_X + 16, paddingRight: 24, paddingVertical: 16, gap: 20 }} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12}>
            <Text style={[t.body, { fontFamily: fonts.bodyBold }]}>‹ Back</Text>
          </Pressable>
          <H1>Check your email</H1>
          <Body>We sent a 6-digit code to <B>{email}</B>. Enter it below to finish creating your account.</Body>
          {DEMO && <Body small muted>Demo mode: any 6 digits work.</Body>}
          <CodeInput value={code} onChange={setCode} onDone={submit} />
          {error && <ErrorText>{error}</ErrorText>}
          {info && <Body small style={{ fontFamily: fonts.bodyBold }}>{info}</Body>}
          <Button variant="red" title="Confirm email" busy={busy} disabled={code.length < 6} onPress={() => submit()} />
          <View style={{ gap: 8 }}>
            <Button variant="ghost" title={wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"} disabled={wait > 0} onPress={resend} />
            <Body small muted>Can't find it? Check your spam or junk folder. The code works for 1 hour.</Body>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Paper>
  );
}
