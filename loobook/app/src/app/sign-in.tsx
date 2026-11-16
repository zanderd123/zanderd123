import * as AppleAuthentication from "expo-apple-authentication";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Body, Button, ErrorText, Field, Paper, t } from "../components/ui";
import { useAuth } from "../lib/auth";
import { colors, fonts, MARGIN_X } from "../lib/theme";

export default function SignIn() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<"signup" | "signin">(params.mode === "signin" ? "signin" : "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const auth = useAuth();

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setError(null); setInfo(null); setBusy(key);
    try { await fn(); }
    catch (e) {
      const msg = (e as Error).message ?? "Something went wrong.";
      if (!/cancel/i.test(msg) && (e as { code?: string }).code !== "ERR_REQUEST_CANCELED") setError(msg);
    } finally { setBusy(null); }
  };

  const submit = () => run("email", async () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) throw new Error("Enter an email like name@example.com.");
    if (password.length < 8) throw new Error("Passwords need at least 8 characters.");
    if (mode === "signin") return auth.signInEmail(email.trim(), password);
    const { needsConfirm } = await auth.signUpEmail(email.trim(), password);
    if (needsConfirm) setInfo(`We sent a link to ${email.trim()}. Open it on this phone to finish signing up.`);
  });

  return (
    <Paper>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ paddingLeft: MARGIN_X + 16, paddingRight: 24, paddingVertical: 16, gap: 18 }} keyboardShouldPersistTaps="handled">
            <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12}>
              <Text style={[t.body, { fontFamily: fonts.bodyBold }]}>‹ Back</Text>
            </Pressable>

            <View style={{ flexDirection: "row", gap: 24 }} accessibilityRole="tablist">
              {(["signup", "signin"] as const).map((m) => (
                <Pressable key={m} onPress={() => { setMode(m); setError(null); setInfo(null); }} accessibilityRole="tab" accessibilityState={{ selected: mode === m }}>
                  <Text style={{
                    fontFamily: fonts.hand, fontSize: 28, color: mode === m ? colors.ink : colors.ink3,
                    textDecorationLine: mode === m ? "underline" : "none", textDecorationColor: colors.margin,
                  }}>{m === "signup" ? "Sign up" : "Log in"}</Text>
                </Pressable>
              ))}
            </View>

            {Platform.OS === "ios" ? (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={mode === "signup" ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={14}
                style={{ height: 52 }}
                onPress={() => run("apple", auth.signInApple)}
              />
            ) : (
              <Button variant="ink" title="Continue with Apple" busy={busy === "apple"} onPress={() => run("apple", auth.signInApple)} />
            )}
            <Button title="Continue with Google" busy={busy === "google"} onPress={() => run("google", auth.signInGoogle)} />

            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.rule }} />
              <Body small muted>or use email</Body>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.rule }} />
            </View>

            <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" placeholder="you@example.com" />
            <Field
              label="Password" value={password} onChangeText={setPassword} secureTextEntry
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              textContentType={mode === "signup" ? "newPassword" : "password"}
              placeholder="At least 8 characters" onSubmitEditing={submit}
            />
            {mode === "signin" && (
              <Pressable onPress={() => run("reset", async () => {
                if (!email.includes("@")) throw new Error("Type your email above first.");
                await auth.resetPassword(email.trim());
                setInfo("If that email has an account, a reset link is on its way.");
              })}>
                <Text style={t.link}>Forgot password?</Text>
              </Pressable>
            )}
            {error && <ErrorText>{error}</ErrorText>}
            {info && <Body style={{ fontFamily: fonts.bodyBold }}>{info}</Body>}
            <Button variant="red" title={mode === "signup" ? "Create account" : "Log in"} busy={busy === "email"} onPress={submit} />
            <Body small muted>
              You'll pick a display name and agree to the{" "}
              <Text style={t.link} onPress={() => router.push("/legal/terms")}>Terms</Text> and{" "}
              <Text style={t.link} onPress={() => router.push("/legal/privacy")}>Privacy Policy</Text> on the next step.
            </Body>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Paper>
  );
}
