import { router } from "expo-router";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Body, Button, H1, H2, Paper } from "../components/ui";
import { DEMO } from "../lib/config";
import { colors, fonts, MARGIN_X } from "../lib/theme";

const STEPS = [
  ["Look at the map.", "Red pins have a code."],
  ["Tap a pin", "to see the code and when it was added."],
  ["Tap +", "to add a code you were given."],
];

export default function Welcome() {
  return (
    <Paper>
      <SafeAreaView style={{ flex: 1, paddingLeft: MARGIN_X + 16, paddingRight: 24, paddingVertical: 24, justifyContent: "space-between" }}>
        <H2>LooBook</H2>
        <View style={{ gap: 18 }}>
          <H1 style={{ fontSize: 46, lineHeight: 52 }}>
            Find the code.{"\n"}<Text style={{ color: colors.margin }}>Skip the ask.</Text>
          </H1>
          <Body muted>Restroom codes for restaurants, cafés and stores, shared by people like you, all over the world.</Body>
          <View style={{ gap: 12 }}>
            {STEPS.map(([bold, rest], i) => (
              <View key={i} style={{ flexDirection: "row", gap: 10 }}>
                <Text style={{ fontFamily: fonts.hand, fontSize: 20, width: 26 }}>{i + 1}.</Text>
                <Body style={{ flex: 1 }}><Text style={{ fontFamily: fonts.bodyBold }}>{bold}</Text> {rest}</Body>
              </View>
            ))}
          </View>
        </View>
        <View style={{ gap: 14 }}>
          {DEMO && <Body small muted>Demo mode: sample data, and any sign-in works.</Body>}
          <Button variant="ink" title="Create an account" onPress={() => router.push({ pathname: "/sign-in", params: { mode: "signup" } })} />
          <Button title="I already have an account" onPress={() => router.push({ pathname: "/sign-in", params: { mode: "signin" } })} />
        </View>
      </SafeAreaView>
    </Paper>
  );
}
