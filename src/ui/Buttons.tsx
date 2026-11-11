import { Play } from 'lucide-react-native';
import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { haptic } from '@/services/device';
import { T } from './primitives';
import { C, F } from './theme';

const ACircle = Animated.createAnimatedComponent(Circle);

function Ring({ delay, size, color }: { delay: number; size: number; color: string }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2800, easing: Easing.out(Easing.quad) }), -1));
  }, [delay, p]);
  const a = useAnimatedStyle(() => ({ opacity: 0.38 * (1 - p.value), transform: [{ scale: 1 + p.value * 0.55 }] }));
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 1.5, borderColor: color }, a]} />;
}

/** The hero START TREK control: breathing rings, press depth, and a spinner state while GPS is acquired. */
export function StartButton({ onPress, busy, label = 'START TREK', sub, size = 208 }: { onPress: () => void; busy?: boolean; label?: string; sub?: string; size?: number }) {
  const press = useSharedValue(0);
  const spin = useSharedValue(0);
  useEffect(() => {
    if (busy) spin.value = withRepeat(withTiming(1, { duration: 1300, easing: Easing.linear }), -1);
    else {
      cancelAnimation(spin);
      spin.value = 0;
    }
  }, [busy, spin]);
  const body = useAnimatedStyle(() => ({ transform: [{ scale: 1 - press.value * 0.06 }, { perspective: 600 }, { rotateX: `${press.value * 8}deg` }] }));
  const arc = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }], opacity: busy ? 1 : 0 }));
  return (
    <View style={{ width: size * 1.55, height: size * 1.55, alignItems: 'center', justifyContent: 'center' }}>
      {!busy ? <><Ring delay={0} size={size} color={C.lime} /><Ring delay={930} size={size} color={C.lime} /><Ring delay={1860} size={size} color={C.lime} /></> : null}
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size + 26, height: size + 26 }, arc]}>
        <Svg width={size + 26} height={size + 26}>
          <Circle cx={(size + 26) / 2} cy={(size + 26) / 2} r={size / 2 + 9} stroke={C.lime} strokeWidth={3} strokeLinecap="round" strokeDasharray={`${size * 0.9} ${size * 3}`} fill="none" />
        </Svg>
      </Animated.View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={busy}
        onPressIn={() => (press.value = withSpring(1, { damping: 16, stiffness: 380 }))}
        onPressOut={() => (press.value = withSpring(0, { damping: 12, stiffness: 260 }))}
        onPress={() => {
          haptic('heavy');
          onPress();
        }}>
        <Animated.View style={[{ width: size, height: size, borderRadius: size / 2 }, styles.start, body]}>
          <View style={[styles.startInner, { borderRadius: size / 2 }]} />
          {busy ? null : <Play size={30} color={C.bg} fill={C.bg} strokeWidth={2} style={{ marginBottom: 6, marginLeft: 4 }} />}
          <T style={{ fontFamily: F.display, fontSize: busy ? 17 : 22, letterSpacing: 2.4, color: C.bg }}>{busy ? 'FINDING GPS' : label}</T>
          {sub ? <T style={{ fontFamily: F.bodyMedium, fontSize: 12, color: 'rgba(4,7,5,0.66)', marginTop: 4 }}>{sub}</T> : null}
        </Animated.View>
      </Pressable>
    </View>
  );
}

/**
 * Hold-to-activate control. Used for SOS so a pocket press cannot trigger it, while a deliberate
 * hold of `seconds` (configurable, default 2) is still fast in a real emergency.
 */
export function HoldButton({ seconds, onComplete, size = 220, color = C.orange, title, caption }: { seconds: number; onComplete: () => void; size?: number; color?: string; title: string; caption: string }) {
  const p = useSharedValue(0);
  const done = useRef(false);
  // Activation is driven by a plain timer, not by the animation finishing, so a dropped or
  // throttled frame can never stop an SOS from firing. The ring is only the visual.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const R0 = size / 2 - 8;
  const CIRC = 2 * Math.PI * R0;
  const ring = useAnimatedProps(() => ({ strokeDashoffset: CIRC * (1 - p.value) }));
  const body = useAnimatedStyle(() => ({ transform: [{ scale: 1 - p.value * 0.05 }] }));
  const fire = () => {
    if (done.current) return;
    done.current = true;
    haptic('heavy');
    onComplete();
    setTimeout(() => (done.current = false), 1500);
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. Hold for ${seconds} seconds.`}
      onPressIn={() => {
        haptic('medium');
        p.value = withTiming(1, { duration: seconds * 1000, easing: Easing.linear });
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(fire, seconds * 1000);
      }}
      onPressOut={() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        cancelAnimation(p);
        p.value = withTiming(0, { duration: 220 });
      }}
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Ring delay={0} size={size - 16} color={color} />
      <Ring delay={1400} size={size - 16} color={color} />
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={R0} stroke="rgba(255,255,255,0.1)" strokeWidth={6} fill="none" />
        <ACircle cx={size / 2} cy={size / 2} r={R0} stroke={C.text} strokeWidth={6} strokeLinecap="round" fill="none" strokeDasharray={CIRC} animatedProps={ring} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </Svg>
      <Animated.View style={[{ width: size - 44, height: size - 44, borderRadius: size, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }, body]}>
        <T style={{ fontFamily: F.display, fontSize: 44, letterSpacing: 4, color: '#fff' }}>{title}</T>
        <T style={{ fontFamily: F.bodyBold, fontSize: 12, letterSpacing: 1.2, color: 'rgba(255,255,255,0.85)' }}>{caption}</T>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  start: {
    backgroundColor: C.lime, alignItems: 'center', justifyContent: 'center',
    shadowColor: C.lime, shadowOpacity: 0.55, shadowRadius: 34, shadowOffset: { width: 0, height: 10 }, elevation: 18,
  },
  startInner: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderWidth: 6, borderColor: 'rgba(255,255,255,0.28)' },
});
