import { Text, View } from "react-native";
import { PASSWORD_RULES } from "../lib/password";
import { colors, fonts } from "../lib/theme";

/** Ticks off each password rule as it's met. */
export function PasswordChecklist({ value }: { value: string }) {
  return (
    <View style={{ gap: 4 }} accessibilityLabel="Password requirements">
      {PASSWORD_RULES.map((r) => {
        const met = r.test(value);
        return (
          <View key={r.id} style={{ flexDirection: "row", gap: 8, alignItems: "center" }} accessibilityState={{ checked: met }}>
            <View style={{
              width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: "center", justifyContent: "center",
              borderColor: met ? colors.ok : colors.ink3, backgroundColor: met ? colors.ok : "transparent",
            }}>
              {met && <Text style={{ color: "#fff", fontSize: 11, lineHeight: 13, fontFamily: fonts.bodyBold }}>✓</Text>}
            </View>
            <Text style={{ fontFamily: met ? fonts.bodyBold : fonts.body, fontSize: 14, color: met ? colors.ok : colors.ink2 }}>
              {r.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
