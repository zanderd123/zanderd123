import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CodeInput } from "../components/CodeInput";
import { PasswordChecklist } from "../components/PasswordChecklist";
import { B, Body, Button, ErrorText, Field, H1, Label, Paper, t } from "../components/ui";
import { useAuth } from "../lib/auth";
import { DEMO } from "../lib/config";
import { passwordProblem } from "../lib/password";
import { fonts, MARGIN_X } from "../lib/theme";

/** Forgot password: email → 6-digit code + new password. */
export default function ResetPassword() {
  const params = useLocalSearchParams<{ email?: string }>();
  const { sendResetCode, resetWithCode } = useAuth();
  const [email, setEmail] = useState(params.email ?? "");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setError(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError("Enter an email like name@example.com.");
    setBusy(true);
    try { await sendResetCode(email.trim()); setSent(true); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const save = async () => {
    setError(null);
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    setBusy(true);
    try { await resetWithCode(email.trim(), code, password); }   // success: signed in, the app moves on
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Paper>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ paddingLeft: MARGIN_X + 16, paddingRight: 24, paddingVertical: 16, gap: 18 }} keyboardShouldPersistTaps="handled">
            <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12}>
              <Text style={[t.body, { fontFamily: fonts.bodyBold }]}>‹ Back</Text>
            </Pressable>
            <H1>New password</H1>
            {!sent ? (
              <>
                <Body muted>Enter your email and we'll send you a 6-digit code.</Body>
                <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" placeholder="you@example.com" onSubmitEditing={send} />
                {error && <ErrorText>{error}</ErrorText>}
                <Button variant="ink" title="Send code" busy={busy} onPress={send} />
              </>
            ) : (
              <>
                <Body>If <B>{email.trim()}</B> has an account, a code is on its way.</Body>
                {DEMO && <Body small muted>Demo mode: any 6 digits work.</Body>}
                <Label>Code from the email</Label>
                <CodeInput value={code} onChange={setCode} />
                <Field label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
                <PasswordChecklist value={password} />
                {error && <ErrorText>{error}</ErrorText>}
                <Button variant="red" title="Save new password" busy={busy} disabled={code.length < 6} onPress={save} />
                <Button variant="ghost" title="Send a new code" onPress={send} />
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Paper>
  );
}
