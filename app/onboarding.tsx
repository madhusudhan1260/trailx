import * as Contacts from 'expo-contacts';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Bell, Bluetooth, Check, Compass, MapPin, Navigation, ShieldAlert, Undo2, Users, WifiOff } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import React, { useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { startBle, stopBle } from '@/services/ble';
import { updateUser } from '@/services/boot';
import { requestNotifications } from '@/services/notify';
import { requestBackground, requestForeground } from '@/services/tracking';
import { useApp } from '@/store';
import { Logo, MountainScene } from '@/ui/Brand';
import { Button, Glass, T, Tap } from '@/ui/primitives';
import { C, S } from '@/ui/theme';

const SLIDES: { icon: LucideIcon | null; eyebrow: string; headline: string; body: string }[] = [
  { icon: null, eyebrow: 'Explore without limits. Find your way back.', headline: 'Adventure has no boundaries.', body: 'TRAILX is a trekking companion built for places where your phone has no signal at all.' },
  { icon: WifiOff, eyebrow: 'Offline GPS tracking', headline: 'Your journey is always remembered.', body: 'GPS works without the internet. Every step is recorded straight to this phone — no account, no map downloads, no data plan.' },
  { icon: Undo2, eyebrow: 'Reverse route navigation', headline: 'Never lose the path you travelled.', body: 'Press RETURN TO START and TRAILX guides you back along the exact trail you walked, breadcrumb by breadcrumb.' },
  { icon: ShieldAlert, eyebrow: 'Emergency safety', headline: 'Your safety travels with you.', body: 'One hold of the SOS button saves your position and an emergency message on the phone, ready to send the moment any channel is available.' },
];

type PermKey = 'location' | 'background' | 'motion' | 'bluetooth' | 'notifications' | 'contacts';
type PermState = 'idle' | 'granted' | 'denied' | 'na';

const PERMS: { key: PermKey; icon: LucideIcon; title: string; why: string }[] = [
  { key: 'location', icon: MapPin, title: 'Location', why: 'Needed to record your route and guide you back. Without it TRAILX cannot work. Your coordinates stay on this phone.' },
  { key: 'background', icon: Navigation, title: 'Background location', why: 'Lets recording continue with the screen locked or the phone in your pocket. Choose "Allow all the time" / "Always".' },
  { key: 'motion', icon: Compass, title: 'Compass & motion', why: 'The compass points you to your next waypoint. Most phones need no prompt for this; it is covered by location access.' },
  { key: 'bluetooth', icon: Bluetooth, title: 'Bluetooth', why: 'Lets nearby TRAILX phones exchange encrypted emergency messages directly, with no network. Range is limited to tens of metres.' },
  { key: 'notifications', icon: Bell, title: 'Notifications', why: 'Warns you when you pass your planned return time, when the battery is low, or when a nearby trekker sends an SOS.' },
  { key: 'contacts', icon: Users, title: 'Emergency contacts', why: 'Lets you pick trusted contacts from your address book instead of typing numbers. You can also add them by hand later.' },
];

export default function Onboarding() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [page, setPage] = useState(0);
  const [perm, setPerm] = useState<Record<PermKey, PermState>>({
    location: useApp.getState().permission === 'granted' ? 'granted' : 'idle',
    background: Platform.OS === 'web' ? 'na' : useApp.getState().backgroundPermission ? 'granted' : 'idle',
    motion: 'na', bluetooth: Platform.OS === 'web' ? 'na' : 'idle', notifications: Platform.OS === 'web' ? 'na' : 'idle', contacts: Platform.OS === 'web' ? 'na' : 'idle',
  });
  const total = SLIDES.length + 1;

  const go = (i: number) => scroller.current?.scrollTo({ x: i * width, animated: true });
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setPage(Math.round(e.nativeEvent.contentOffset.x / width));

  const ask = async (k: PermKey) => {
    let ok = false;
    try {
      if (k === 'location') ok = await requestForeground();
      else if (k === 'background') ok = await requestBackground();
      else if (k === 'notifications') ok = await requestNotifications();
      else if (k === 'contacts') ok = (await Contacts.requestPermissionsAsync()).granted;
      else if (k === 'bluetooth') {
        ok = await startBle();
        await stopBle(); // only asking for permission here; the radio is started when it is needed
      }
    } catch {
      ok = false;
    }
    setPerm((p) => ({ ...p, [k]: ok ? 'granted' : 'denied' }));
  };

  const finish = async () => {
    await updateUser({ onboarded: true });
    router.replace('/(tabs)');
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={StyleSheet.absoluteFill}>
        <View style={{ flex: 1, backgroundColor: C.forest }} />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}><MountainScene height={Math.min(height * 0.72, 640)} /></View>
        <LinearGradient colors={['rgba(4,7,5,0)', 'rgba(4,7,5,0.82)', C.bg]} locations={[0, 0.5, 1]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: height * 0.62 }} />
      </View>

      <ScrollView ref={scroller} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={onScroll} scrollEventThrottle={16} bounces={false}>
        {SLIDES.map((s, i) => (
          <View key={i} style={{ width, height, paddingHorizontal: S.xl, paddingTop: insets.top + 48, paddingBottom: insets.bottom + 150 }}>
            <View style={{ flex: 1, maxWidth: 520, width: '100%', alignSelf: 'center' }}>
              {i === 0 ? (
                <Animated.View entering={FadeIn.duration(900)} style={{ alignItems: 'center', marginTop: height * 0.04 }}>
                  <Logo size={112} />
                  <Animated.View entering={FadeInUp.delay(900).duration(800)}>
                    <T style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 44, letterSpacing: 9, color: C.text, marginTop: 22 }}>TRAIL<T style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 44, color: C.lime }}>X</T></T>
                  </Animated.View>
                </Animated.View>
              ) : (
                page === i && s.icon ? (
                  <Animated.View entering={FadeInDown.duration(500)} style={styles.badge}><s.icon size={30} color={C.lime} strokeWidth={2} /></Animated.View>
                ) : <View style={{ height: 72 }} />
              )}
              <View style={{ flex: 1 }} />
              {page === i ? (
                <>
                  <Animated.View entering={FadeInDown.delay(80).duration(520)}><T v="label" color={C.lime}>{s.eyebrow}</T></Animated.View>
                  <Animated.View entering={FadeInDown.delay(160).duration(560)}><T v="hero" style={{ marginTop: 10 }}>{s.headline}</T></Animated.View>
                  <Animated.View entering={FadeInDown.delay(260).duration(560)}><T style={{ marginTop: 14, fontSize: 16, lineHeight: 24 }}>{s.body}</T></Animated.View>
                </>
              ) : <View style={{ height: 190 }} />}
            </View>
          </View>
        ))}

        <View style={{ width, height, paddingTop: insets.top + 24 }}>
          <ScrollView contentContainerStyle={{ paddingHorizontal: S.xl, paddingBottom: 190 }} showsVerticalScrollIndicator={false}>
            <View style={{ maxWidth: 520, width: '100%', alignSelf: 'center' }}>
              <T v="label" color={C.lime}>Before you set off</T>
              <T v="title" style={{ marginTop: 8 }}>What TRAILX asks for, and why.</T>
              <T style={{ marginTop: 8, marginBottom: S.xl }}>Only location is essential. Everything else can be skipped and enabled later in Profile.</T>
              {PERMS.map((p) => {
                const st = perm[p.key];
                return (
                  <Glass key={p.key} style={{ padding: S.lg, marginBottom: S.md, backgroundColor: 'rgba(4,7,5,0.72)' }}>
                    <View style={{ flexDirection: 'row', gap: S.md, alignItems: 'center' }}>
                      <p.icon size={20} color={st === 'granted' ? C.lime : C.text} strokeWidth={2.2} />
                      <T v="h3" style={{ flex: 1 }}>{p.title}</T>
                      {st === 'granted' ? <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}><Check size={15} color={C.lime} strokeWidth={3} /><T v="small" color={C.lime}>Allowed</T></View>
                        : st === 'na' ? <T v="small">{p.key === 'motion' ? 'No prompt needed' : 'Not available here'}</T>
                        : <Button small title={st === 'denied' ? 'Ask again' : 'Allow'} kind={p.key === 'location' ? 'primary' : 'ghost'} onPress={() => ask(p.key)} />}
                    </View>
                    <T v="small" color={C.text2} style={{ marginTop: 8 }}>{p.why}</T>
                    {st === 'denied' ? <T v="small" color={C.orange} style={{ marginTop: 6 }}>Not allowed. {p.key === 'location' ? 'TRAILX cannot record without it — you can enable it in system settings.' : p.key === 'background' ? 'Recording will stop when the screen locks.' : 'You can enable it later in system settings.'}</T> : null}
                  </Glass>
                );
              })}
            </View>
          </ScrollView>
        </View>
      </ScrollView>

      <LinearGradient pointerEvents="none" colors={['rgba(4,7,5,0)', C.bg, C.bg]} locations={[0, 0.45, 1]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: insets.bottom + 170 }} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 26, paddingHorizontal: S.xl }}>
        <View style={{ maxWidth: 520, width: '100%', alignSelf: 'center' }}>
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: S.lg }}>
            {Array.from({ length: total }, (_, i) => <View key={i} style={{ height: 4, flex: i === page ? 2.4 : 1, borderRadius: 2, backgroundColor: i === page ? C.lime : C.faint }} />)}
          </View>
          {page < total - 1 ? (
            <View style={{ flexDirection: 'row', gap: S.md, alignItems: 'center' }}>
              <Tap onPress={() => go(total - 1)} style={{ paddingVertical: 14, paddingRight: S.lg }}><T v="h3" color={C.muted}>Skip</T></Tap>
              <Button title={page === 0 ? 'Begin' : 'Next'} onPress={() => go(page + 1)} style={{ flex: 1 }} />
            </View>
          ) : (
            <Button title={perm.location === 'granted' ? 'Enter TRAILX' : 'Continue without location for now'} kind={perm.location === 'granted' ? 'primary' : 'ghost'} onPress={finish} />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { width: 72, height: 72, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(198,255,61,0.1)', borderWidth: 1, borderColor: 'rgba(198,255,61,0.35)' },
});
