import { useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatCoord } from '@/core/geo';
import { fmtAge } from '@/core/stats';
import { triggerEmergency } from '@/services/sos';
import { useApp } from '@/store';
import { HoldButton } from '@/ui/Buttons';
import { IconButton, T } from '@/ui/primitives';
import { useGps } from '@/ui/Status';
import { C, S } from '@/ui/theme';

export default function Sos() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const hold = useApp((s) => s.user?.settings.sosHoldSeconds ?? 2);
  const battery = useApp((s) => s.battery);
  const gps = useGps();
  const [raising, setRaising] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const glow = useSharedValue(0);
  useEffect(() => {
    glow.value = withRepeat(withTiming(1, { duration: raising ? 420 : 2200, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [glow, raising]);
  const bg = useAnimatedStyle(() => ({ opacity: (raising ? 0.35 : 0.12) + glow.value * (raising ? 0.4 : 0.14) }));

  const fire = async () => {
    setRaising(true);
    setError(null);
    try {
      const e = await triggerEmergency('sos');
      router.replace(`/emergency/${e.id}?fresh=1`);
    } catch (err) {
      setRaising(false);
      setError(`The emergency record could not be saved: ${(err as Error).message}`);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + S.md, paddingBottom: insets.bottom + S.xl, paddingHorizontal: S.xl }}>
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: C.orange }, bg]} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <T v="label" color={C.orange}>Emergency SOS</T>
        <IconButton icon={X} onPress={() => router.back()} label="Close without raising an SOS" />
      </View>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: S.xl }}>
        {raising ? (
          <>
            <ActivityIndicator size="large" color="#fff" />
            <T v="title" center>Saving your emergency record…</T>
          </>
        ) : (
          <>
            <T v="title" center>Hold to raise an SOS</T>
            <HoldButton seconds={hold} onComplete={fire} title="SOS" caption={`HOLD ${hold}s`} />
            <T center style={{ maxWidth: 330 }}>Release early to cancel. On activation your position, recent track, battery level and contacts are saved to this phone immediately.</T>
          </>
        )}
        {error ? <T center color={C.orange}>{error}</T> : null}
      </View>
      <View style={{ gap: 4 }}>
        <T v="small" center color={C.text2}>
          {gps.fix ? `${gps.live ? 'Live position' : `Last known position (${gps.ageMs != null ? fmtAge(gps.ageMs) : 'age unknown'})`}: ${formatCoord(gps.fix, 5)} ±${gps.fix.acc != null ? Math.round(gps.fix.acc) : '?'} m` : 'No GPS position yet — the SOS will be saved without one and say so.'}
        </T>
        <T v="small" center>Battery {battery != null ? `${Math.round(battery * 100)}%` : 'unknown'} · Nothing is sent until a channel is available and you choose it.</T>
      </View>
    </View>
  );
}
