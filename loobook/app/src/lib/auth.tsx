import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import { api } from "./api";
import { supabase } from "./supabase";
import type { Profile } from "./types";

WebBrowser.maybeCompleteAuthSession();

// "offline": signed in, but we couldn't reach the server to load the profile.
type Status = "loading" | "signedOut" | "needsProfile" | "ready" | "offline";

interface AuthState {
  status: Status;
  profile: Profile | null;
  signInEmail(email: string, password: string): Promise<void>;
  /** Creates the account and emails a 6-digit code. Nothing works until the code is entered. */
  signUpEmail(email: string, password: string): Promise<{ needsConfirm: boolean }>;
  verifyEmailCode(email: string, code: string): Promise<void>;
  resendEmailCode(email: string): Promise<void>;
  signInApple(): Promise<void>;
  signInGoogle(): Promise<void>;
  /** Emails a 6-digit code for choosing a new password. */
  sendResetCode(email: string): Promise<void>;
  resetWithCode(email: string, code: string, newPassword: string): Promise<void>;
  completeProfile(displayName: string): Promise<void>;
  refreshProfile(): Promise<void>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}

/** Thrown when someone logs in before entering the code from their email. */
export class EmailNotConfirmedError extends Error {
  constructor() { super("Please confirm your email first. We've sent you a new code."); }
}

/** Plain-language versions of Supabase Auth errors. */
function friendly(error: { message: string; code?: string }): Error {
  switch (error.code) {
    case "invalid_credentials": return new Error("That email and password don't match.");
    case "weak_password": return new Error("That password is too easy to guess. Add a number and a special character.");
    case "otp_expired": return new Error("That code has expired or is wrong. Tap \"Send a new code\".");
    case "over_email_send_rate_limit":
    case "over_request_rate_limit": return new Error("Too many tries. Wait a minute, then try again.");
    case "user_already_exists":
    case "email_exists": return new Error("There's already an account with that email. Log in instead.");
    case "same_password": return new Error("Choose a password you haven't used here before.");
    default:
      if (error.message === "Invalid login credentials") return new Error("That email and password don't match.");
      return new Error(error.message);
  }
}

/** Turns a sign-in or email-link redirect (loobook://auth?code=...) into a session. */
export async function finishOAuth(url: string) {
  const { queryParams } = Linking.parse(url);
  const code = typeof queryParams?.code === "string" ? queryParams.code : null;
  const err = typeof queryParams?.error_description === "string" ? queryParams.error_description : null;
  if (err) throw new Error(err);
  if (!code) throw new Error("Sign-in was cancelled.");
  const { error } = await supabase!.auth.exchangeCodeForSession(code);
  if (error) throw new Error(error.message);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [profile, setProfile] = useState<Profile | null>(null);

  const loadProfile = useCallback(async () => {
    try {
      const p = await api.getProfile();
      setProfile(p);
      setStatus(p ? "ready" : "needsProfile");
    } catch {
      // A failed check isn't "no profile": keep a profile we already have, otherwise show a retry screen.
      setStatus((s) => (s === "ready" ? "ready" : "offline"));
    }
  }, []);

  useEffect(() => {
    if (!supabase) { setStatus("signedOut"); return; }
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) loadProfile(); else setStatus("signedOut");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) { setProfile(null); setStatus("signedOut"); }
      else if (event === "SIGNED_IN") loadProfile();
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  // demo mode: any sign-in works
  const demoIn = useCallback(async () => { await loadProfile(); }, [loadProfile]);

  const value = useMemo<AuthState>(() => ({
    status,
    profile,

    async signInEmail(email, password) {
      if (!supabase) return demoIn();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error?.code === "email_not_confirmed") {
        await supabase.auth.resend({ type: "signup", email }).catch(() => {});
        throw new EmailNotConfirmedError();
      }
      if (error) throw friendly(error);
    },

    async signUpEmail(email, password) {
      if (!supabase) return { needsConfirm: true };   // demo: show the code screen; any 6 digits work
      const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: Linking.createURL("auth") } });
      if (error) throw friendly(error);
      // An already-registered email comes back as a user with no identities (and no email is sent).
      if (data.user && data.user.identities?.length === 0) {
        throw new Error("There's already an account with that email. Log in, or tap \"Forgot password?\".");
      }
      return { needsConfirm: !data.session };
    },

    async verifyEmailCode(email, code) {
      if (!/^\d{6}$/.test(code)) throw new Error("Enter the 6-digit code from the email.");
      if (!supabase) return demoIn();
      const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
      if (error) throw friendly(error);
    },

    async resendEmailCode(email) {
      if (!supabase) return;
      const { error } = await supabase.auth.resend({ type: "signup", email });
      if (error) throw friendly(error);
    },

    async signInApple() {
      if (!supabase) return demoIn();
      if (Platform.OS === "ios") {
        const raw = Crypto.randomUUID() + Crypto.randomUUID();
        const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
        const cred = await AppleAuthentication.signInAsync({
          requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
          nonce: hashed,
        });
        if (!cred.identityToken) throw new Error("Apple didn't return a sign-in token. Try again.");
        const { error } = await supabase.auth.signInWithIdToken({ provider: "apple", token: cred.identityToken, nonce: raw });
        if (error) throw new Error(error.message);
        return;
      }
      await oauth("apple");
    },

    async signInGoogle() {
      if (!supabase) return demoIn();
      await oauth("google");
    },

    async sendResetCode(email) {
      if (!supabase) return;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: Linking.createURL("auth") });
      if (error) throw friendly(error);
    },

    async resetWithCode(email, code, newPassword) {
      if (!/^\d{6}$/.test(code)) throw new Error("Enter the 6-digit code from the email.");
      if (!supabase) return demoIn();
      // The code signs the person in; set the new password straight away.
      const v = await supabase.auth.verifyOtp({ email, token: code, type: "recovery" });
      if (v.error) throw friendly(v.error);
      const u = await supabase.auth.updateUser({ password: newPassword });
      if (u.error) throw friendly(u.error);
    },

    async completeProfile(displayName) {
      await api.createProfile(displayName);
      await loadProfile();
    },

    refreshProfile: loadProfile,

    async signOut() {
      if (supabase) await supabase.auth.signOut();
      setProfile(null); setStatus("signedOut");
    },

    async deleteAccount() {
      // Apple requires revoking Sign in with Apple tokens when an account is deleted.
      // A fresh authorization code from Apple lets the server do that.
      let appleAuthCode: string | undefined;
      if (supabase && Platform.OS === "ios") {
        const { data } = await supabase.auth.getSession();
        const providers = (data.session?.user.app_metadata?.providers as string[] | undefined) ?? [];
        if (providers.includes("apple")) {
          try {
            const cred = await AppleAuthentication.signInAsync({ requestedScopes: [] });
            appleAuthCode = cred.authorizationCode ?? undefined;
          } catch {
            throw new Error("To delete an account made with Apple, confirm with Apple when asked.");
          }
        }
      }
      await api.deleteAccount(appleAuthCode);
      setProfile(null); setStatus("signedOut");
    },
  }), [status, profile, loadProfile, demoIn]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

async function oauth(provider: "google" | "apple") {
  const redirectTo = Linking.createURL("auth");
  const { data, error } = await supabase!.auth.signInWithOAuth({ provider, options: { redirectTo, skipBrowserRedirect: true } });
  if (error || !data.url) throw new Error(error?.message ?? "Couldn't start sign-in.");
  const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (res.type !== "success") throw new Error("Sign-in was cancelled.");
  await finishOAuth(res.url);
}
