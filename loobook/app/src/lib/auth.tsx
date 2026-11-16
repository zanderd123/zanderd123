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

type Status = "loading" | "signedOut" | "needsProfile" | "ready";

interface AuthState {
  status: Status;
  profile: Profile | null;
  signInEmail(email: string, password: string): Promise<void>;
  signUpEmail(email: string, password: string): Promise<{ needsConfirm: boolean }>;
  signInApple(): Promise<void>;
  signInGoogle(): Promise<void>;
  resetPassword(email: string): Promise<void>;
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

/** Turns an OAuth redirect (loobook://auth?code=...) into a session. */
async function finishOAuth(url: string) {
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
      setStatus("needsProfile");
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
      if (error) throw new Error(error.message === "Invalid login credentials" ? "That email and password don't match." : error.message);
    },

    async signUpEmail(email, password) {
      if (!supabase) { await demoIn(); return { needsConfirm: false }; }
      const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: Linking.createURL("auth") } });
      if (error) throw new Error(error.message);
      return { needsConfirm: !data.session };
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

    async resetPassword(email) {
      if (!supabase) return;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: Linking.createURL("auth") });
      if (error) throw new Error(error.message);
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
      await api.deleteAccount();
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
