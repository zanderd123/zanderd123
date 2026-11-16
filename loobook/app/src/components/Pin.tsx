import { memo } from "react";
import { View } from "react-native";
import { colors } from "../lib/theme";

/** Teardrop pin: red = has a code, pale red = may have changed, white = no code yet. */
export const Pin = memo(function Pin({ state, selected }: { state: "code" | "stale" | "none"; selected?: boolean }) {
  const s = selected ? 40 : 32;
  const fill = state === "code" ? colors.margin : state === "stale" ? colors.stalePin : colors.paper;
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
