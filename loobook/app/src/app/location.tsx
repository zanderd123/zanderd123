import { router } from "expo-router";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Body, B, Button, H1, Paper } from "../components/ui";
import { MeDot, Pin } from "../components/Pin";
import { markLocationAsked, requestLocation } from "../lib/location";
import { MARGIN_X } from "../lib/theme";

/** Explains why before the system prompt appears (both stores expect this). */
export default function LocationPrimer() {
  return (
    <Paper>
      <SafeAreaView style={{ flex: 1, paddingLeft: MARGIN_X + 16, paddingRight: 24, paddingVertical: 24, justifyContent: "space-between" }}>
        <View style={{ gap: 18 }}>
          <View style={{ height: 140, alignItems: "center", justifyContent: "center" }}>
            <View style={{ position: "absolute", left: 30, top: 20 }}><Pin state="code" /></View>
            <View style={{ position: "absolute", right: 40, top: 50 }}><Pin state="code" /></View>
            <View style={{ position: "absolute", left: 120, bottom: 4 }}><Pin state="none" /></View>
            <MeDot />
          </View>
          <H1>See codes near you</H1>
          <Body muted>
            LooBook uses your location <B>only while the app is open</B> to centre the map and show the closest restroom codes.
            We never track you in the background or keep a history of where you've been.
          </Body>
          <Body small muted>You can always search by city, state or ZIP code instead.</Body>
        </View>
        <View style={{ gap: 12 }}>
          <Button variant="ink" title="Allow location" onPress={async () => { await requestLocation(); router.replace("/map"); }} />
          <Button variant="ghost" title="Not now" onPress={async () => { await markLocationAsked(); router.replace("/map"); }} />
        </View>
      </SafeAreaView>
    </Paper>
  );
}
