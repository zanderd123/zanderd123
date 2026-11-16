import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Body, Button, H1, Paper } from "../components/ui";
import { finishOAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { colors, MARGIN_X } from "../lib/theme";

/**
 * Opens when someone taps a link in a LooBook email (loobook://auth?code=...).
 * The app normally uses 6-digit codes instead, but links still work as a fallback.
 */
export default function AuthLink() {
  const url = Linking.useLinkingURL();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!url || !supabase) return;
    finishOAuth(url).catch(() => setFailed(true));   // on success the app moves on by itself
  }, [url]);

  return (
    <Paper>
      <View style={{ flex: 1, justifyContent: "center", paddingLeft: MARGIN_X + 16, paddingRight: 24, gap: 16 }}>
        {failed ? (
          <>
            <H1>Email confirmed?</H1>
            <Body>If you opened the link on a different device, your email may already be confirmed. Log in to carry on.</Body>
            <Button variant="ink" title="Log in" onPress={() => router.replace({ pathname: "/sign-in", params: { mode: "signin" } })} />
          </>
        ) : (
          <ActivityIndicator color={colors.ink} />
        )}
      </View>
    </Paper>
  );
}
