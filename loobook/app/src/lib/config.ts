import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";

const env = (k: string) => (process.env[k] ?? "").trim();

export const config = {
  supabaseUrl: env("EXPO_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: env("EXPO_PUBLIC_SUPABASE_ANON_KEY"),
  revenueCatKey: Platform.OS === "ios" ? env("EXPO_PUBLIC_REVENUECAT_IOS_KEY") : env("EXPO_PUBLIC_REVENUECAT_ANDROID_KEY"),
  bannerUnitId: Platform.OS === "ios" ? env("EXPO_PUBLIC_ADMOB_BANNER_IOS") : env("EXPO_PUBLIC_ADMOB_BANNER_ANDROID"),
  supportEmail: env("EXPO_PUBLIC_SUPPORT_EMAIL") || "help@example.com",
};

/** No backend configured: run on sample data so the app can be tried right away. */
export const DEMO = !config.supabaseUrl || !config.supabaseAnonKey;

/** Expo Go can't load ads or in-app purchase native code. */
export const IN_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
