import { View, Text } from "react-native";
import { adsAvailable, adsModule, adsPersonalized, bannerUnitId } from "../lib/monetization";
import { DEMO } from "../lib/config";
import { colors, fonts } from "../lib/theme";

/**
 * One small banner, never on the map itself. Renders nothing when ads
 * aren't set up (Expo Go, no consent, or no network).
 * In demo mode a placeholder shows where the ad would sit.
 */
export function AdBanner() {
  const m = adsModule();
  if (!adsAvailable() || !m) {
    if (!DEMO) return null;
    return (
      <View style={{ height: 56, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.ink3, borderRadius: 10, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontFamily: fonts.bodyBold, fontSize: 12, color: colors.ink3, letterSpacing: 1 }}>AD SPACE (320 × 50)</Text>
      </View>
    );
  }
  const { BannerAd, BannerAdSize } = m;
  return (
    <View style={{ alignItems: "center", gap: 4 }}>
      <Text style={{ fontFamily: fonts.bodyBold, fontSize: 10, color: colors.ink3, letterSpacing: 1 }}>ADVERTISEMENT</Text>
      <BannerAd
        unitId={bannerUnitId()}
        size={BannerAdSize.BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: !adsPersonalized() }}
      />
    </View>
  );
}
