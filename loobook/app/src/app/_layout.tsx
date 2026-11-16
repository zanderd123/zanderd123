import { AtkinsonHyperlegible_400Regular, AtkinsonHyperlegible_700Bold } from "@expo-google-fonts/atkinson-hyperlegible";
import { JetBrainsMono_700Bold } from "@expo-google-fonts/jetbrains-mono";
import { Kalam_700Bold } from "@expo-google-fonts/kalam";
import { useFonts } from "expo-font";
import { Stack, router, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../lib/auth";
import { locationAsked } from "../lib/location";
import { startAds } from "../lib/monetization";
import { colors } from "../lib/theme";

SplashScreen.preventAutoHideAsync().catch(() => {});

const PUBLIC = new Set(["welcome", "sign-in", "legal"]);

/** Sends people to the right place: signed out → welcome, new account → profile setup, else the map. */
function Gate() {
  const { status } = useAuth();
  const segments = useSegments();
  const first = (segments[0] as string | undefined) ?? "";

  useEffect(() => {
    if (status === "loading") return;
    SplashScreen.hideAsync().catch(() => {});
    if (status === "signedOut" && !PUBLIC.has(first)) router.replace("/welcome");
    else if (status === "needsProfile" && first !== "profile-setup" && first !== "legal") router.replace("/profile-setup");
    else if (status === "ready" && (PUBLIC.has(first) && first !== "legal" || first === "profile-setup" || first === "")) {
      locationAsked().then((asked) => router.replace(asked ? "/map" : "/location"));
    }
  }, [status, first]);

  useEffect(() => { if (status === "ready") startAds(); }, [status]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="welcome" />
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="profile-setup" />
      <Stack.Screen name="location" />
      <Stack.Screen name="map" />
      <Stack.Screen name="place/[id]" options={{ presentation: "modal" }} />
      <Stack.Screen name="add" options={{ presentation: "modal" }} />
      <Stack.Screen name="report" options={{ presentation: "modal" }} />
      <Stack.Screen name="profile" />
      <Stack.Screen name="support" options={{ presentation: "modal" }} />
      <Stack.Screen name="legal/[doc]" options={{ presentation: "modal" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [loaded] = useFonts({ Kalam_700Bold, AtkinsonHyperlegible_400Regular, AtkinsonHyperlegible_700Bold, JetBrainsMono_700Bold });
  if (!loaded) return null;
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
