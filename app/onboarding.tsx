import * as Contacts from 'expo-contacts';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Bell, Bluetooth, Check, ChevronLeft, Compass, MapPin, Navigation, ShieldAlert, Undo2, Users, WifiOff } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeInUp, SlideInLeft, SlideInRight, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { greetingName } from '@/core/profile';
import { getDb } from '@/db';
import { listContacts } from '@/db/repo';
import { startBle, stopBle } from '@/services/ble';
import { requestNotifications } from '@/services/notify';
import { completeOnboarding, sensitiveEncrypted } from '@/services/profileStore';
import { requestBackground, requestForeground } from '@/services/tracking';
import { useApp } from '@/store';
import { Logo, MountainScene } from '@/ui/Brand';
import { Button, Glass, IconButton, T } from '@/ui/primitives';
import { applyDraft, checkEmergency, checkPersonal, checkTrekking, draftFromUser, EmergencySection, PersonalSection, TrekkingSection, type Draft, type DraftErrors } from '@/ui/ProfileForm';
import { C, S } from '@/ui/theme';

type PermKey = 'location' | 'background' | 'motion' | 'bluetooth' | 'notifications' | 'contacts';
type PermState = 'idle' | 'granted' | 'denied' | 'na';

const PERMS: { key: PermKey; icon: LucideIcon; title: string; why: string }[] = [
  { key: 'location', icon: MapPin, title: 'Location', why: 'Needed to record your route and guide you back. Without it TRAILX cannot work. Your coordinates stay on this phone.' },
  { key: 'background', icon: Navigation, title: 'Background location', why: 'Lets recording continue with the screen locked or the phone in your pocket. Choose "Allow all the time" / "Always".' },
  { key: 'motion', icon: Compass, title: 'Compass & motion', why: 'The compass points you to your next waypoint. Most phones need no prompt for this; it is covered by location access.' },
  { key: 'bluetooth', icon: Bluetooth, title: 'Bluetooth', why: 'Lets nearby TRAILX phones exchange encrypted emergency messages directly, with no network. Range is limited to tens of metres.' },
  { key: 'notifications', icon: Bell, title: 'Notifications', why: 'Warns you when you pass your planned return time, when the battery is low, or when a nearby trekker sends an SOS.' },
  { key: 'contacts', icon: Users, title: 'Import contacts', why: 'Only if you want to pick emergency contacts from your address book later. Typing them in works just as well.' },
];

const FEATURES: { icon: LucideIcon; text: string }[] = [
  { icon: WifiOff, text: 'GPS recording with no internet or map downloads' },
  { icon: Undo2, text: 'Guided back along the exact trail you walked' },
  { icon: ShieldAlert, text: 'SOS saved instantly, sent when any channel exists' },
];

const STEPS = ['welcome', 'personal', 'emergency', 'trekking', 'permissions'] as const;
type Step = (typeof STEPS)[number];
const TITLES: Record<Exclude<Step, 'welcome'>, { eyebrow: string; title: string; body: string }> = {
  personal: { eyebrow: 'About you', title: 'Let’s get to know you.', body: 'Entered once and kept only on this phone. Rescuers see it only if you raise an emergency.' },
  emergency: { eyebrow: 'Emergency', title: 'Who should know if something goes wrong?', body: 'Choose someone who is not trekking with you. They are contacted only when you send an alert.' },
  trekking: { eyebrow: 'Trekking profile', title: 'How do you like to trek?', body: 'Used to set sensible defaults. Everything can be changed later in Profile.' },
  permissions: { eyebrow: 'Before you set off', title: 'What TRAILX asks for, and why.', body: 'Only location is essential. Everything else can be skipped and enabled later.' },
};

function Progress({ index, total }: { index: number; total: number }) {
  const w = useSharedValue(0);
  useEffect(() => { w.value = withTiming(index / total, { duration: 420 }); }, [index, total, w]);
  const fill = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View style={{ height: 4, borderRadius: 2, backgroundColor: C.faint, overflow: 'hidden' }}>
      <Animated.View style={[{ height: 4, borderRadius: 2, backgroundColor: C.lime }, fill]} />
    </View>
  );
}

export default function Onboarding() {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useApp((s) => s.user);
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [step, setStep] = useState<Step>('welcome');
  const [dir, setDir] = useState<1 | -1>(1);
  const [d, setD] = useState<Draft>(() => draftFromUser(user));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [perm, setPerm] = useState<Record<PermKey, PermState>>({
    location: useApp.getState().permission === 'granted' ? 'granted' : 'idle',
    background: Platform.OS === 'web' ? 'na' : useApp.getState().backgroundPermission ? 'granted' : 'idle',
    motion: 'na', bluetooth: Platform.OS === 'web' ? 'na' : 'idle', notifications: Platform.OS === 'web' ? 'na' : 'idle', contacts: Platform.OS === 'web' ? 'na' : 'idle',
  });

  // Contacts added earlier (e.g. from the Safety tab before a reinstall of the onboarding flag) pre-fill the form.
  useEffect(() => {
    void (async () => {
      const cs = await listContacts(await getDb());
      if (cs.length) setD((cur) => ({ ...draftFromUser(user, cs), ...pickTyped(cur) }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((cur) => ({ ...cur, [k]: v }));
  const index = STEPS.indexOf(step);
  const goto = (s: Step) => {
    setDir(STEPS.indexOf(s) > index ? 1 : -1);
    setErrors({});
    setStep(s);
    scroller.current?.scrollTo({ y: 0, animated: false });
  };

  const next = () => {
    const now = Date.now();
    let e: DraftErrors = {};
    if (step === 'personal') e = checkPersonal(d, now).errors;
    if (step === 'emergency') e = checkEmergency(d, checkPersonal(d, now).value?.phone ?? null).errors;
    if (step === 'trekking') e = checkTrekking(d).errors;
    if (Object.keys(e).length) {
      setErrors(e);
      scroller.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    goto(STEPS[index + 1]);
  };

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
    if (!user) return;
    const now = Date.now();
    const personal = checkPersonal(d, now);
    const emergency = checkEmergency(d, personal.value?.phone ?? null);
    // Re-validate everything: the user may have gone back and edited an earlier step.
    if (!personal.value) return goto('personal');
    if (Object.keys(emergency.errors).length) return goto('emergency');
    if (Object.keys(checkTrekking(d).errors).length) return goto('trekking');
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await completeOnboarding(applyDraft(user, d, personal.value), emergency.contacts);
      useApp.getState().set({ user: saved });
      useApp.getState().touch();
      router.replace('/(tabs)');
    } catch (e) {
      setSaveError(`Could not save your profile: ${(e as Error).message}. Nothing was lost — try again.`);
    } finally {
      setSaving(false);
    }
  };

  const enter = dir === 1 ? SlideInRight.duration(380) : SlideInLeft.duration(380);

  if (step === 'welcome') {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <View style={StyleSheet.absoluteFill}>
          <View style={{ flex: 1, backgroundColor: C.forest }} />
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}><MountainScene height={Math.min(height * 0.72, 640)} /></View>
          <LinearGradient colors={['rgba(4,7,5,0)', 'rgba(4,7,5,0.85)', C.bg]} locations={[0, 0.5, 1]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: height * 0.66 }} />
        </View>
        <View style={{ flex: 1, paddingHorizontal: S.xl, paddingTop: insets.top + 56, paddingBottom: insets.bottom + 28 }}>
          <View style={{ flex: 1, maxWidth: 520, width: '100%', alignSelf: 'center' }}>
            <Animated.View entering={FadeIn.duration(900)} style={{ alignItems: 'center' }}>
              <Logo size={108} />
              <Animated.View entering={FadeInUp.delay(700).duration(800)}>
                <T style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 44, letterSpacing: 9, color: C.text, marginTop: 22 }}>TRAIL<T style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 44, color: C.lime }}>X</T></T>
              </Animated.View>
            </Animated.View>
            <View style={{ flex: 1 }} />
            <Animated.View entering={FadeInDown.delay(1000).duration(600)}>
              <T v="label" color={C.lime}>Explore without limits.</T>
              <T v="label" color={C.text}>Return with confidence.</T>
            </Animated.View>
            <View style={{ marginTop: S.xl, gap: S.md }}>
              {FEATURES.map((f, i) => (
                <Animated.View key={f.text} entering={FadeInDown.delay(1200 + i * 140).duration(520)} style={{ flexDirection: 'row', gap: S.md, alignItems: 'center' }}>
                  <View style={styles.dot}><f.icon size={16} color={C.lime} strokeWidth={2.2} /></View>
                  <T style={{ flex: 1, fontSize: 15 }}>{f.text}</T>
                </Animated.View>
              ))}
            </View>
            <Animated.View entering={FadeInUp.delay(1600).duration(600)} style={{ marginTop: S.xxl }}>
              <Button title="Get Started" onPress={() => goto('personal')} />
              <T v="small" center style={{ marginTop: S.md }}>No account needed. Your details never leave this phone unless you send an alert.</T>
            </Animated.View>
          </View>
        </View>
      </View>
    );
  }

  const head = TITLES[step];
  const formSteps = STEPS.length - 1;
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ paddingTop: insets.top + S.md, paddingHorizontal: S.xl }}>
        <View style={{ maxWidth: 560, width: '100%', alignSelf: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, marginBottom: S.md }}>
            <IconButton icon={ChevronLeft} label="Back" size={40} onPress={() => goto(STEPS[index - 1])} />
            <T v="small" style={{ flex: 1 }}>Step {index} of {formSteps}</T>
          </View>
          <Progress index={index} total={formSteps} />
        </View>
      </View>
      <ScrollView ref={scroller} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: S.xl, paddingTop: S.xl, paddingBottom: insets.bottom + 140 }}>
        <Animated.View key={step} entering={enter} style={{ maxWidth: 560, width: '100%', alignSelf: 'center' }}>
          <T v="label" color={C.lime}>{head.eyebrow}</T>
          <T v="title" style={{ marginTop: 8 }}>{head.title}</T>
          <T style={{ marginTop: 8, marginBottom: S.xl }}>{head.body}</T>
          {Object.keys(errors).length ? <T v="small" color={C.orange} style={{ marginBottom: S.lg }}>Please fix the highlighted fields.</T> : null}

          {step === 'personal' ? <PersonalSection d={d} set={set} errors={errors} /> : null}
          {step === 'emergency' ? <EmergencySection d={d} set={set} errors={errors} encrypted={sensitiveEncrypted()} /> : null}
          {step === 'trekking' ? <TrekkingSection d={d} set={set} errors={errors} /> : null}
          {step === 'permissions' ? (
            <>
              {PERMS.map((p) => {
                const st = perm[p.key];
                return (
                  <Glass key={p.key} style={{ padding: S.lg, marginBottom: S.md }}>
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
              {saveError ? <T v="small" color={C.orange} style={{ marginTop: S.md }}>{saveError}</T> : null}
            </>
          ) : null}
        </Animated.View>
      </ScrollView>

      <LinearGradient pointerEvents="none" colors={['rgba(4,7,5,0)', C.bg, C.bg]} locations={[0, 0.4, 1]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: insets.bottom + 120 }} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 22, paddingHorizontal: S.xl }}>
        <View style={{ maxWidth: 560, width: '100%', alignSelf: 'center' }}>
          {step === 'permissions' ? (
            <Button loading={saving} title={perm.location === 'granted' ? `Enter TRAILX${greetingName({ preferredName: d.preferredName, fullName: d.fullName }) ? `, ${greetingName({ preferredName: d.preferredName, fullName: d.fullName })}` : ''}` : 'Finish without location for now'} kind={perm.location === 'granted' ? 'primary' : 'ghost'} onPress={finish} />
          ) : (
            <Button title="Continue" onPress={next} />
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

/** Keeps whatever the user already typed when pre-filled data arrives. */
function pickTyped(d: Draft): Partial<Draft> {
  const out: Partial<Draft> = {};
  for (const [k, v] of Object.entries(d) as [keyof Draft, Draft[keyof Draft]][]) if (typeof v === 'string' && v.trim()) (out as Record<string, unknown>)[k] = v;
  return out;
}

const styles = StyleSheet.create({
  dot: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(198,255,61,0.1)', borderWidth: 1, borderColor: 'rgba(198,255,61,0.3)' },
});
