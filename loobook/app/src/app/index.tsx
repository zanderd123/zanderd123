import { ActivityIndicator, View } from "react-native";
import { colors } from "../lib/theme";

/** Blank while the session loads; the gate in _layout picks the next screen. */
export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.paper }}>
      <ActivityIndicator color={colors.ink} />
    </View>
  );
}
