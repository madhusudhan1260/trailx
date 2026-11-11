import type { BottomTabBarProps } from 'expo-router/tabs';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import { Compass, Home, Navigation, ShieldAlert, Undo2 } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import React, { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '@/store';
import { T, Tap } from './primitives';
import { C, F } from './theme';

const ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  index: { icon: Home, label: 'Home' },
  explore: { icon: Compass, label: 'Explore' },
  trek: { icon: Navigation, label: 'Trek' },
  return: { icon: Undo2, label: 'Return' },
  safety: { icon: ShieldAlert, label: 'Safety' },
};

function Item({ name, focused, onPress }: { name: string; focused: boolean; onPress: () => void }) {
  const { icon: Icon, label } = ICONS[name];
  const k = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    k.value = withSpring(focused ? 1 : 0, { damping: 16, stiffness: 220 });
  }, [focused, k]);
  const dot = useAnimatedStyle(() => ({ opacity: k.value, transform: [{ scaleX: 0.3 + k.value * 0.7 }] }));
  const lift = useAnimatedStyle(() => ({ transform: [{ translateY: -k.value * 2 }] }));
  return (
    <Tap onPress={onPress} label={label} style={styles.item}>
      <Animated.View style={[{ alignItems: 'center', gap: 3 }, lift]}>
        <Icon size={22} color={focused ? C.lime : C.muted} strokeWidth={focused ? 2.5 : 2} />
        <T style={{ fontFamily: focused ? F.bodyBold : F.bodyMedium, fontSize: 10.5, color: focused ? C.text : C.muted }}>{label}</T>
      </Animated.View>
      <Animated.View style={[styles.dot, dot]} />
    </Tap>
  );
}

/** Floating glass tab bar. The centre control becomes a live recording indicator during a trek. */
export function TabBar({ state, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const trek = useApp((s) => s.trek);
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = trek?.status === 'recording' ? withRepeat(withTiming(1, { duration: 1300 }), -1, true) : withTiming(0);
  }, [trek?.status, pulse]);
  const halo = useAnimatedStyle(() => ({ opacity: 0.25 + pulse.value * 0.45, transform: [{ scale: 1 + pulse.value * 0.16 }] }));
  const current = state.routes[state.index].name;
  const go = (name: string) => {
    const route = state.routes.find((r) => r.name === name);
    if (route) navigateToTab(route.key);
  };
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: Math.max(insets.bottom, 10) + 6 }]}>
      {/* SOS stays one tap away from every tab while a trek is running */}
      {trek && current !== 'safety' ? (
        <Tap onPress={() => router.push('/sos')} feedback="medium" label="Emergency SOS" style={styles.sos}>
          <T style={{ fontFamily: F.display, fontSize: 14, letterSpacing: 1.5, color: '#fff' }}>SOS</T>
        </Tap>
      ) : null}
      <View style={styles.bar}>
        {Platform.OS === 'ios' ? <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} /> : null}
        <Item name="index" focused={current === 'index'} onPress={() => go('index')} />
        <Item name="explore" focused={current === 'explore'} onPress={() => go('explore')} />
        <View style={{ width: 76, alignItems: 'center' }}>
          <Tap onPress={() => go('trek')} feedback="medium" label="Active trek" style={{ marginTop: -30 }}>
            <Animated.View pointerEvents="none" style={[styles.halo, halo, { backgroundColor: trek?.status === 'paused' ? C.orange : C.lime }]} />
            <View style={[styles.center, { backgroundColor: trek?.status === 'paused' ? C.orange : C.lime }, current === 'trek' && { borderColor: C.text }]}>
              <Navigation size={25} color={C.bg} fill={trek ? C.bg : 'transparent'} strokeWidth={2.4} />
            </View>
          </Tap>
          <T style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: current === 'trek' ? C.text : C.muted, marginTop: 3 }}>{trek ? (trek.status === 'paused' ? 'Paused' : 'Recording') : 'Trek'}</T>
        </View>
        <Item name="return" focused={current === 'return'} onPress={() => go('return')} />
        <Item name="safety" focused={current === 'safety'} onPress={() => go('safety')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 14, right: 14, alignItems: 'center' },
  bar: {
    width: '100%', maxWidth: 520, height: 70, borderRadius: 35, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6,
    backgroundColor: Platform.OS === 'ios' ? 'rgba(8,16,11,0.6)' : 'rgba(9,18,13,0.96)', borderWidth: 1, borderColor: C.lineStrong, overflow: 'visible',
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 22, shadowOffset: { width: 0, height: 12 }, elevation: 14,
  },
  item: { flex: 1, height: 70, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', bottom: 7, width: 16, height: 3, borderRadius: 2, backgroundColor: C.lime },
  center: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: C.bg },
  halo: { position: 'absolute', width: 62, height: 62, borderRadius: 31 },
  sos: {
    alignSelf: 'flex-end', marginBottom: 12, marginRight: 4, width: 62, height: 62, borderRadius: 31, backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)', shadowColor: C.orange, shadowOpacity: 0.6, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 12,
  },
});
