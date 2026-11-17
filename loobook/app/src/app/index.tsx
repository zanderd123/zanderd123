import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Body, Button, H2, Paper } from "../components/ui";
import { useAuth } from "../lib/auth";
import { colors, MARGIN_X } from "../lib/theme";

/** Spinner while the session loads; a retry screen if the server can't be reached. The gate in _layout picks the next screen. */
export default function Index() {
  const { status, refreshProfile, signOut } = useAuth();
  const [busy, setBusy] = useState(false);

  if (status !== "offline") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.paper }}>
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  }

  return (
    <Paper>
      <View style={{ flex: 1, justifyContent: "center", paddingLeft: MARGIN_X + 16, paddingRight: 24, gap: 16 }}>
        <H2>Can't reach LooBook</H2>
        <Body muted>Check that you're online, then try again.</Body>
        <Button variant="ink" title="Try again" busy={busy} onPress={async () => { setBusy(true); await refreshProfile(); setBusy(false); }} />
        <Button variant="ghost" title="Sign out" onPress={signOut} />
      </View>
    </Paper>
  );
}
