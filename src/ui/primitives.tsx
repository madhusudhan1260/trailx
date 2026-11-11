import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft, type LucideIcon } from 'lucide-react-native';
import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type TextProps, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptic } from '@/services/device';
import { C, F, R, S, TOUCH } from './theme';

type Variant = 'hero' | 'title' | 'h2' | 'h3' | 'body' | 'small' | 'label' | 'mono';

const TEXT: Record<Variant, TextStyle> = {
  hero: { fontFamily: F.display, fontSize: 38, lineHeight: 42, letterSpacing: -1, color: C.text },
  title: { fontFamily: F.display, fontSize: 28, lineHeight: 33, letterSpacing: -0.6, color: C.text },
  h2: { fontFamily: F.display, fontSize: 21, lineHeight: 26, letterSpacing: -0.3, color: C.text },
  h3: { fontFamily: F.bodyBold, fontSize: 16, lineHeight: 22, color: C.text },
  body: { fontFamily: F.body, fontSize: 15, lineHeight: 22, color: C.text2 },
  small: { fontFamily: F.body, fontSize: 13, lineHeight: 18, color: C.muted },
  label: { fontFamily: F.bodyBold, fontSize: 11, lineHeight: 14, letterSpacing: 1.6, color: C.muted, textTransform: 'uppercase' },
  mono: { fontFamily: F.displayMedium, fontSize: 14, lineHeight: 20, color: C.text2, fontVariant: ['tabular-nums'] },
};

export function T({ v = 'body', color, center, style, ...p }: TextProps & { v?: Variant; color?: string; center?: boolean }) {
  return <Text {...p} style={[TEXT[v], color ? { color } : null, center ? { textAlign: 'center' } : null, style]} />;
}

/** Full-bleed screen with the forest gradient. `scroll` adds a scroll view with tab-bar clearance. */
export function Screen({ children, scroll, pad = true, bottom = 120, style }: { children: React.ReactNode; scroll?: boolean; pad?: boolean; bottom?: number; style?: StyleProp<ViewStyle> }) {
  const insets = useSafeAreaInsets();
  const inner: ViewStyle = { paddingTop: insets.top + S.md, paddingHorizontal: pad ? S.xl : 0 };
  return (
    <View style={styles.screen}>
      <LinearGradient colors={[C.forest, C.bg2, C.bg]} locations={[0, 0.42, 1]} style={StyleSheet.absoluteFill} />
      {scroll ? (
        <ScrollView contentContainerStyle={[inner, { paddingBottom: insets.bottom + bottom }, style]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.maxWidth}>{children}</View>
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, inner, style]}>{children}</View>
      )}
    </View>
  );
}

export function Glass({ children, style, strong, tone }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; strong?: boolean; tone?: 'warn' | 'lime' }) {
  return (
    <View
      style={[
        styles.glass,
        strong && { backgroundColor: C.glassStrong },
        tone === 'warn' && { backgroundColor: C.orangeDim, borderColor: 'rgba(255,106,31,0.4)' },
        tone === 'lime' && { backgroundColor: 'rgba(198,255,61,0.07)', borderColor: 'rgba(198,255,61,0.3)' },
        style,
      ]}>
      {children}
    </View>
  );
}

export function Enter({ children, delay = 0, style }: { children: React.ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(520).springify().damping(18)} style={style}>
      {children}
    </Animated.View>
  );
}

const APressable = Animated.createAnimatedComponent(Pressable);

/** Pressable with a spring scale and a haptic tick. */
export function Tap({ children, onPress, onLongPress, style, disabled, feedback = 'light', label, hitSlop = 6 }: {
  children: React.ReactNode; onPress?: () => void; onLongPress?: () => void; style?: StyleProp<ViewStyle>; disabled?: boolean;
  feedback?: 'light' | 'medium' | 'heavy' | 'none'; label?: string; hitSlop?: number;
}) {
  const s = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <APressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={hitSlop}
      onPressIn={() => (s.value = withSpring(0.96, { damping: 18, stiffness: 420 }))}
      onPressOut={() => (s.value = withSpring(1, { damping: 14, stiffness: 300 }))}
      onPress={() => {
        if (feedback !== 'none') haptic(feedback);
        onPress?.();
      }}
      onLongPress={onLongPress}
      style={[a, disabled && { opacity: 0.4 }, style]}>
      {children}
    </APressable>
  );
}

export function Button({ title, onPress, icon: Icon, kind = 'primary', loading, disabled, style, small }: {
  title: string; onPress?: () => void; icon?: LucideIcon; kind?: 'primary' | 'ghost' | 'danger' | 'warn'; loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; small?: boolean;
}) {
  const fg = kind === 'primary' ? C.bg : kind === 'danger' ? '#fff' : kind === 'warn' ? C.bg : C.text;
  const bg = kind === 'primary' ? C.lime : kind === 'danger' ? C.red : kind === 'warn' ? C.orange : C.glassStrong;
  return (
    <Tap onPress={onPress} disabled={disabled || loading} feedback={kind === 'ghost' ? 'light' : 'medium'} label={title}
      style={[styles.button, small && { minHeight: 42, paddingHorizontal: S.lg }, { backgroundColor: bg, borderColor: kind === 'ghost' ? C.line : 'transparent' }, style]}>
      {loading ? <ActivityIndicator color={fg} /> : Icon ? <Icon size={small ? 16 : 19} color={fg} strokeWidth={2.4} /> : null}
      <Text style={{ fontFamily: F.bodyBold, fontSize: small ? 14 : 16, color: fg }} numberOfLines={1}>{title}</Text>
    </Tap>
  );
}

export function IconButton({ icon: Icon, onPress, label, color = C.text, size = 46, tone }: { icon: LucideIcon; onPress?: () => void; label: string; color?: string; size?: number; tone?: 'warn' }) {
  return (
    <Tap onPress={onPress} label={label} style={[styles.iconButton, { width: size, height: size, borderRadius: size / 2 }, tone === 'warn' && { backgroundColor: C.orangeDim, borderColor: 'rgba(255,106,31,0.5)' }]}>
      <Icon size={size * 0.44} color={color} strokeWidth={2.2} />
    </Tap>
  );
}

export function Pill({ icon: Icon, text, color = C.text2, dot, onPress }: { icon?: LucideIcon; text: string; color?: string; dot?: string; onPress?: () => void }) {
  const body = (
    <View style={styles.pill}>
      {dot ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dot }} /> : null}
      {Icon ? <Icon size={13} color={color} strokeWidth={2.4} /> : null}
      <Text style={{ fontFamily: F.bodyMedium, fontSize: 12.5, color }} numberOfLines={1}>{text}</Text>
    </View>
  );
  return onPress ? <Tap onPress={onPress}>{body}</Tap> : body;
}

export function Field({ label, hint, style, ...p }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={{ marginBottom: S.lg }}>
      <T v="label" style={{ marginBottom: S.sm }}>{label}</T>
      <TextInput placeholderTextColor={C.faint} selectionColor={C.lime} {...p} style={[styles.input, p.multiline && { minHeight: 88, textAlignVertical: 'top', paddingTop: 14 }, style]} />
      {hint ? <T v="small" style={{ marginTop: 6 }}>{hint}</T> : null}
    </View>
  );
}

export function Banner({ icon: Icon, title, body, tone = 'warn', action, onAction }: { icon?: LucideIcon; title: string; body?: string; tone?: 'warn' | 'lime' | 'info'; action?: string; onAction?: () => void }) {
  const color = tone === 'warn' ? C.orange : tone === 'lime' ? C.lime : C.text2;
  return (
    <Glass tone={tone === 'info' ? undefined : tone} style={{ flexDirection: 'row', gap: S.md, padding: S.lg, alignItems: 'flex-start' }}>
      {Icon ? <Icon size={20} color={color} strokeWidth={2.3} style={{ marginTop: 1 }} /> : null}
      <View style={{ flex: 1 }}>
        <T v="h3" color={color} style={{ fontSize: 14.5, lineHeight: 20 }}>{title}</T>
        {body ? <T v="small" color={C.text2} style={{ marginTop: 3 }}>{body}</T> : null}
        {action ? (
          <Tap onPress={onAction} style={{ marginTop: S.sm, alignSelf: 'flex-start' }}>
            <T v="h3" color={color} style={{ fontSize: 13.5, textDecorationLine: 'underline' }}>{action}</T>
          </Tap>
        ) : null}
      </View>
    </Glass>
  );
}

export function Header({ title, eyebrow, right, onBack }: { title: string; eyebrow?: string; right?: React.ReactNode; onBack?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, marginBottom: S.xl }}>
      {onBack ? <IconButton icon={ChevronLeft} onPress={onBack} label="Back" size={42} /> : null}
      <View style={{ flex: 1 }}>
        {eyebrow ? <T v="label" color={C.limeDim}>{eyebrow}</T> : null}
        <T v="title" numberOfLines={1}>{title}</T>
      </View>
      {right}
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: C.line, marginVertical: S.lg }, style]} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  maxWidth: { width: '100%', maxWidth: 560, alignSelf: 'center' },
  glass: { backgroundColor: C.glass, borderRadius: R.lg, borderWidth: 1, borderColor: C.line, overflow: 'hidden' },
  button: { minHeight: TOUCH, borderRadius: R.pill, paddingHorizontal: S.xl, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: S.sm, borderWidth: 1 },
  iconButton: { alignItems: 'center', justifyContent: 'center', backgroundColor: C.glassStrong, borderWidth: 1, borderColor: C.line },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, height: 30, borderRadius: R.pill, backgroundColor: C.glass, borderWidth: 1, borderColor: C.line },
  input: { minHeight: TOUCH, borderRadius: R.md, borderWidth: 1, borderColor: C.line, backgroundColor: C.glass, paddingHorizontal: S.lg, color: C.text, fontFamily: F.body, fontSize: 16 },
});
