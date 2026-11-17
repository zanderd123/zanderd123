/**
 * Ads (Google AdMob) and donations (in-app "tips" via RevenueCat).
 *
 * Both need native code that Expo Go doesn't include, so the libraries are
 * loaded lazily and everything here quietly does nothing inside Expo Go.
 *
 * Store rules this follows:
 * - Apple 3.1.1 / Google Play payments: donations to an app that isn't a
 *   registered charity must go through in-app purchase, so tips are
 *   consumable IAP products, not a PayPal/Stripe link.
 * - Ads only start after the Google consent form (needed for the EU/UK) and,
 *   on iPhone, the App Tracking Transparency prompt.
 */
import { Platform } from "react-native";
import { requestTrackingPermissionsAsync } from "expo-tracking-transparency";
import { config, IN_EXPO_GO } from "./config";

type AdsModule = typeof import("react-native-google-mobile-ads");
type PurchasesModule = typeof import("react-native-purchases");

let ads: AdsModule | null = null;
let adsReady = false;
let personalized = false;

// AdBanner subscribes, so banners appear as soon as ads finish starting up.
const listeners = new Set<() => void>();
function setAdsReady(v: boolean) {
  if (adsReady === v) return;
  adsReady = v;
  listeners.forEach((fn) => fn());
}
export function subscribeAds(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

function loadAds(): AdsModule | null {
  if (IN_EXPO_GO) return null;
  if (!ads) {
    try { ads = require("react-native-google-mobile-ads") as AdsModule; } catch { ads = null; }
  }
  return ads;
}

/** Call once at start-up. Shows the consent form where the law requires it. */
export async function startAds(): Promise<void> {
  const m = loadAds();
  if (!m || adsReady) return;
  try {
    const consent = await m.AdsConsent.gatherConsent();
    if (!consent.canRequestAds) return;
    if (Platform.OS === "ios") {
      const att = await requestTrackingPermissionsAsync();
      personalized = att.granted;
    } else {
      personalized = true;
    }
    await m.default().initialize();
    setAdsReady(true);
  } catch {
    setAdsReady(false);
  }
}

export function adsAvailable() { return adsReady && !!ads; }
export function adsModule() { return ads; }
export function adsPersonalized() { return personalized; }
export function bannerUnitId(): string {
  return config.bannerUnitId || (ads ? ads.TestIds.BANNER : "");
}

/** Opens Google's privacy options form so people can change their ad choices (required in the EU/UK). */
export async function openAdPrivacyOptions(): Promise<boolean> {
  const m = loadAds();
  if (!m) return false;
  try { await m.AdsConsent.showPrivacyOptionsForm(); return true; } catch { return false; }
}

/* ---------------- donations ---------------- */

let purchases: PurchasesModule | null = null;
let purchasesReady = false;

function loadPurchases(): PurchasesModule | null {
  if (IN_EXPO_GO || !config.revenueCatKey) return null;
  if (!purchases) {
    try { purchases = require("react-native-purchases") as PurchasesModule; } catch { purchases = null; }
  }
  return purchases;
}

export interface Tip { id: string; title: string; price: string; buy(): Promise<"thanks" | "cancelled"> }

/** The tip options set up in RevenueCat (an offering called "tips"). Empty when unavailable. */
export async function loadTips(userId?: string): Promise<Tip[]> {
  const m = loadPurchases();
  if (!m) return [];
  const P = m.default;
  if (!purchasesReady) {
    P.configure({ apiKey: config.revenueCatKey, appUserID: userId ?? null });
    purchasesReady = true;
  }
  const offerings = await P.getOfferings();
  const offering = offerings.all["tips"] ?? offerings.current;
  if (!offering) return [];
  return offering.availablePackages
    .slice()
    .sort((a, b) => a.product.price - b.product.price)
    .map((pkg) => ({
      id: pkg.identifier,
      title: pkg.product.title,
      price: pkg.product.priceString,
      async buy() {
        try { await P.purchasePackage(pkg); return "thanks" as const; }
        catch (e) {
          if ((e as { userCancelled?: boolean | null }).userCancelled) return "cancelled" as const;
          throw e;
        }
      },
    }));
}
