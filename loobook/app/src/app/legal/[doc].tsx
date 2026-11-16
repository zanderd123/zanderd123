import { useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { Sheet } from "../../components/Sheet";
import { Body } from "../../components/ui";
import { LEGAL } from "../../content/legal";
import { colors, fonts } from "../../lib/theme";

export default function LegalDoc() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const blocks = LEGAL[(doc as keyof typeof LEGAL)] ?? [];
  const [title, ...rest] = blocks;
  return (
    <Sheet title={title?.text ?? "Not found"}>
      <View style={{ gap: 10 }}>
        {rest.map((b, i) => {
          if (b.t === "h2" || b.t === "h1") {
            return <Text key={i} accessibilityRole="header" style={{ fontFamily: fonts.hand, fontSize: 21, lineHeight: 26, color: colors.ink, marginTop: 10 }}>{b.text}</Text>;
          }
          if (b.t === "li") {
            return (
              <View key={i} style={{ flexDirection: "row", gap: 8, paddingLeft: 4 }}>
                <Text style={{ fontFamily: fonts.bodyBold, color: colors.ink }}>•</Text>
                <Body style={{ flex: 1, fontSize: 15 }}>{b.text}</Body>
              </View>
            );
          }
          return <Body key={i} style={{ fontSize: 15 }}>{b.text}</Body>;
        })}
      </View>
    </Sheet>
  );
}
