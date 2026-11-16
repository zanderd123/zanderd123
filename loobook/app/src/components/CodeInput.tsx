import { useRef, type ComponentRef } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { colors, fonts } from "../lib/theme";

/** Six boxes for an emailed code. One hidden input underneath, so paste and autofill work. */
export function CodeInput({ value, onChange, onDone }: { value: string; onChange: (v: string) => void; onDone?: (v: string) => void }) {
  const ref = useRef<ComponentRef<typeof TextInput>>(null);
  return (
    <Pressable onPress={() => ref.current?.focus()} accessibilityLabel="6-digit code" accessibilityHint="Enter the code from the email">
      <View style={{ flexDirection: "row", gap: 8, justifyContent: "space-between" }}>
        {Array.from({ length: 6 }, (_, i) => {
          const active = i === Math.min(value.length, 5);
          return (
            <View key={i} style={{
              flex: 1, maxWidth: 52, aspectRatio: 0.85, borderWidth: active ? 2.5 : 2, borderRadius: 10,
              borderColor: active ? colors.margin : colors.ink, backgroundColor: colors.paper, alignItems: "center", justifyContent: "center",
            }}>
              <Text style={{ fontFamily: fonts.code, fontSize: 26, color: colors.ink }}>{value[i] ?? ""}</Text>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={(t) => {
          const v = t.replace(/\D/g, "").slice(0, 6);
          onChange(v);
          if (v.length === 6) onDone?.(v);
        }}
        autoFocus
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={6}
        style={{ position: "absolute", opacity: 0, width: 1, height: 1 }}
      />
    </Pressable>
  );
}
