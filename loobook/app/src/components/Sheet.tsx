import { router } from "expo-router";
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts, MARGIN_X } from "../lib/theme";
import { H2, Paper } from "./ui";

/** Notebook-page modal with a title and a close button. */
export function Sheet({ title, subtitle, children }: { title: string; subtitle?: string | null; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Paper>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingLeft: MARGIN_X + 14, paddingRight: 20, paddingTop: Platform.OS === "android" ? insets.top + 16 : 20, paddingBottom: insets.bottom + 32, gap: 18 }}
        >
          <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
            <View style={{ flex: 1 }}>
              <H2>{title}</H2>
              {subtitle ? <Text style={{ fontFamily: fonts.body, fontSize: 14, color: colors.ink2, marginTop: 2 }}>{subtitle}</Text> : null}
            </View>
            <Pressable
              onPress={() => router.back()}
              accessibilityLabel="Close"
              hitSlop={8}
              style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: colors.ink, alignItems: "center", justifyContent: "center", backgroundColor: colors.paper }}
            >
              <Text style={{ fontFamily: fonts.bodyBold, fontSize: 18 }}>✕</Text>
            </Pressable>
          </View>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </Paper>
  );
}
