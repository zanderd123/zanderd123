import { useState, type ReactNode } from "react";
import {
  ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from "react-native";
import { colors, fonts, MARGIN_X, RULE_GAP } from "../lib/theme";

/* ---------- ruled notebook paper ---------- */
export function Paper({ children, style, lines = 60 }: { children?: ReactNode; style?: StyleProp<ViewStyle>; lines?: number }) {
  return (
    <View style={[{ flex: 1, backgroundColor: colors.paper }, style]}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {Array.from({ length: lines }, (_, i) => (
          <View key={i} style={{ position: "absolute", left: 0, right: 0, top: (i + 1) * RULE_GAP, height: 1, backgroundColor: colors.rule }} />
        ))}
        <View style={{ position: "absolute", top: 0, bottom: 0, left: MARGIN_X - 1, width: 1.5, backgroundColor: colors.margin }} />
      </View>
      {children}
    </View>
  );
}

/* ---------- text ---------- */
export function H1({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[t.h1, style]} accessibilityRole="header">{children}</Text>;
}
export function H2({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[t.h2, style]} accessibilityRole="header">{children}</Text>;
}
export function Body({ children, style, muted, small }: { children: ReactNode; style?: StyleProp<TextStyle>; muted?: boolean; small?: boolean }) {
  return <Text style={[t.body, muted && { color: colors.ink2 }, small && { fontSize: 14 }, style]}>{children}</Text>;
}
export function Label({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[t.label, style]}>{children}</Text>;
}
export function B({ children }: { children: ReactNode }) {
  return <Text style={{ fontFamily: fonts.bodyBold }}>{children}</Text>;
}

/* ---------- hand-drawn button with an ink shadow ---------- */
type Variant = "paper" | "ink" | "red" | "ghost";
export function Button({
  title, onPress, variant = "paper", icon, disabled, busy, small, style, accessibilityLabel,
}: {
  title: string; onPress?: () => void; variant?: Variant; icon?: ReactNode; disabled?: boolean;
  busy?: boolean; small?: boolean; style?: StyleProp<ViewStyle>; accessibilityLabel?: string;
}) {
  const bg = variant === "ink" ? colors.ink : variant === "red" ? colors.margin : variant === "ghost" ? "transparent" : colors.paper;
  const fg = variant === "ink" || variant === "red" ? "#fff" : colors.ink;
  const shadow = variant !== "ghost" && !small;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!(disabled || busy) }}
      style={[{ opacity: disabled ? 0.45 : 1 }, style]}
    >
      {({ pressed }) => (
        <View>
          {shadow && <View style={[b.shadow, { borderRadius: small ? 10 : 14 }]} />}
          <View style={[
            b.btn,
            small && b.small,
            { backgroundColor: bg, borderColor: variant === "ghost" ? "transparent" : colors.ink },
            pressed && shadow && { transform: [{ translateX: 2 }, { translateY: 2 }] },
          ]}>
            {busy ? <ActivityIndicator color={fg} /> : icon}
            <Text style={[b.text, { color: fg }, variant === "ghost" && { textDecorationLine: "underline" }]}>{title}</Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}

/* ---------- inputs ---------- */
export function Field({ label, error, style, ...rest }: TextInputProps & { label: string; error?: string | null }) {
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Label>{label}</Label>
      <TextInput
        {...rest}
        accessibilityLabel={label}
        placeholderTextColor={colors.ink3}
        onFocus={(e) => { setFocus(true); rest.onFocus?.(e); }}
        onBlur={(e) => { setFocus(false); rest.onBlur?.(e); }}
        style={[i.input, focus && { borderColor: colors.margin }, style]}
      />
      {error ? <Text style={t.error}>{error}</Text> : null}
    </View>
  );
}

export function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}
    >
      <View style={[i.box, checked && { backgroundColor: colors.ink }]}>
        {checked && <Text style={{ color: "#fff", fontFamily: fonts.bodyBold, fontSize: 16, lineHeight: 18 }}>✓</Text>}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </Pressable>
  );
}

export function Chip({ title, selected, onPress, dot }: { title: string; selected?: boolean; onPress: () => void; dot?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={[c.chip, selected && { backgroundColor: colors.ink }]}
    >
      {dot && <View style={c.dot} />}
      <Text style={[c.text, selected && { color: colors.paper }]}>{title}</Text>
    </Pressable>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <Text style={t.error} accessibilityLiveRegion="polite">{children}</Text>;
}

export const t = StyleSheet.create({
  h1: { fontFamily: fonts.hand, fontSize: 40, lineHeight: 46, color: colors.ink },
  h2: { fontFamily: fonts.hand, fontSize: 28, lineHeight: 34, color: colors.ink },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: colors.ink },
  label: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: colors.ink2 },
  error: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.margin },
  link: { fontFamily: fonts.bodyBold, textDecorationLine: "underline", color: colors.ink },
});

const b = StyleSheet.create({
  shadow: { position: "absolute", left: 3, top: 3, right: -3, bottom: -3, backgroundColor: colors.ink },
  btn: {
    minHeight: 52, paddingHorizontal: 20, borderWidth: 2, borderRadius: 14,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
  },
  small: { minHeight: 44, borderWidth: 1.5, borderRadius: 10 },
  text: { fontFamily: fonts.bodyBold, fontSize: 16 },
});

const i = StyleSheet.create({
  input: {
    minHeight: 52, borderWidth: 2, borderColor: colors.ink, borderRadius: 12, paddingHorizontal: 14,
    fontFamily: fonts.body, fontSize: 17, color: colors.ink, backgroundColor: colors.paper,
  },
  box: { width: 24, height: 24, borderWidth: 2, borderColor: colors.ink, borderRadius: 4, alignItems: "center", justifyContent: "center", marginTop: 1 },
});

const c = StyleSheet.create({
  chip: {
    flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, paddingHorizontal: 12,
    borderWidth: 1.5, borderColor: colors.ink, borderRadius: 99, backgroundColor: colors.paper,
  },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.margin },
  text: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
});
