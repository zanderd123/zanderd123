import { memo } from "react";
import { View } from "react-native";
import type { PinState } from "../lib/format";
import { colors } from "../lib/theme";

/** Teardrop pin: red = has a code, green = no code needed, pale = may be out of date, white = nothing logged yet. */
export const Pin = memo(function Pin({ state, selected }: { state: PinState; selected?: boolean }) {
  const s = selected ? 40 : 32;
  const fill = { code: colors.margin, stale: colors.stalePin, open: colors.open, openStale: colors.openSoft, none: colors.paper }[state];
  return (
    <View style={{ width: s + 4, height: s + 8, alignItems: "center" }}>
      {/* ink shadow */}
      <View style={{
        position: "absolute", left: 3, top: 3, width: s, height: s, backgroundColor: colors.ink,
        borderTopLeftRadius: s / 2, borderTopRightRadius: s / 2, borderBottomLeftRadius: s / 2, borderBottomRightRadius: 2,
        transform: [{ rotate: "45deg" }],
      }} />
      <View style={{
        width: s, height: s, backgroundColor: fill, borderWidth: 2.5, borderColor: colors.ink,
        borderTopLeftRadius: s / 2, borderTopRightRadius: s / 2, borderBottomLeftRadius: s / 2, borderBottomRightRadius: 2,
        transform: [{ rotate: "45deg" }], alignItems: "center", justifyContent: "center",
      }}>
        <View style={{
          width: s * 0.32, height: s * 0.32, borderRadius: s, transform: [{ rotate: "-45deg" }],
          backgroundColor: state === "none" ? colors.paper : "#fff",
          borderWidth: state === "none" ? 2 : 0, borderColor: colors.ink3,
        }} />
      </View>
    </View>
  );
});

export function MeDot() {
  return (
    <View style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: "rgba(17,17,17,.35)", alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: colors.ink, borderWidth: 4, borderColor: "#fff" }} />
    </View>
  );
}
