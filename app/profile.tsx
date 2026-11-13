import { useRouter } from 'expo-router';
import { Check, History, Satellite, TriangleAlert } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { updateUser } from '@/services/boot';
import { notificationsAllowed, requestNotifications } from '@/services/notify';
import { persistUser, sensitiveEncrypted } from '@/services/profileStore';
import { refreshPermissions, requestBackground, requestForeground } from '@/services/tracking';
import { useApp } from '@/store';
import { Logo } from '@/ui/Brand';
import { Banner, Button, Glass, Header, Pill, Screen, T, Tap } from '@/ui/primitives';
import { applyDraft, checkPersonal, checkTrekking, draftFromUser, EmergencySection, PersonalSection, TrekkingSection, type Draft, type DraftErrors } from '@/ui/ProfileForm';
import { C, S } from '@/ui/theme';

export default function Profile() {
  const router = useRouter();
  const user = useApp((s) => s.user)!;
  const permission = useApp((s) => s.permission);
  const bg = useApp((s) => s.backgroundPermission);
  const [d, setD] = useState<Draft>(() => draftFromUser(user));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notif, setNotif] = useState<boolean | null>(null);
  useEffect(() => { void refreshPermissions(); void notificationsAllowed().then(setNotif); }, []);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setD((cur) => ({ ...cur, [k]: v })); setSaved(false); };
  const save = async () => {
    setSaveError(null);
    const personal = checkPersonal(d, Date.now());
    const e = { ...personal.errors, ...checkTrekking(d).errors };
    setErrors(e);
    if (!personal.value || Object.keys(e).length) return;
    try {
      useApp.getState().set({ user: await persistUser(applyDraft(user, d, personal.value)) });
      setSaved(true);
    } catch (err) {
      setSaveError(`Not saved: ${(err as Error).message}`);
    }
  };
  const st = user.settings;

  const Row = ({ label, ok, action, onPress }: { label: string; ok: boolean | null; action: string; onPress: () => void }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.line, gap: S.md }}>
      <T v="h3" style={{ flex: 1, fontSize: 15 }}>{label}</T>
      {ok ? <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}><Check size={15} color={C.lime} strokeWidth={3} /><T v="small" color={C.lime}>Allowed</T></View>
        : ok == null ? <T v="small">Not available</T> : <Button small title={action} kind="ghost" onPress={onPress} />}
    </View>
  );

  return (
    <Screen scroll bottom={60}>
      <Header title="Edit profile" eyebrow="Stored only on this phone" onBack={() => router.back()} />
      {user.unreadable.length ? <View style={{ marginBottom: S.lg }}><Banner icon={TriangleAlert} title="Some private details could not be unlocked" body="The key that protects your medical details is missing on this device (for example after restoring the phone). They are kept as they were; type them again to replace them." /></View> : null}
      <PersonalSection d={d} set={set} errors={errors} />
      <EmergencySection d={d} set={set} errors={errors} showContacts={false} encrypted={sensitiveEncrypted()} />
      <T v="small" style={{ marginBottom: S.xl }}>Emergency contacts are managed on the Safety tab.</T>
      <TrekkingSection d={d} set={set} errors={errors} />
      {Object.keys(errors).length ? <T v="small" color={C.orange} style={{ marginTop: S.lg }}>Some fields need attention: {Object.values(errors).join(' ')}</T> : null}
      {saveError ? <T v="small" color={C.orange} style={{ marginTop: S.sm }}>{saveError}</T> : null}
      <Button title={saved ? 'Saved' : 'Save profile'} icon={saved ? Check : undefined} onPress={save} style={{ marginTop: S.xl }} />

      <Tap onPress={() => router.push('/history')} style={{ marginTop: S.xl }}>
        <Glass style={{ padding: S.lg, flexDirection: 'row', gap: S.md, alignItems: 'center' }}><History size={20} color={C.lime} /><T v="h3" style={{ flex: 1 }}>Trek history</T></Glass>
      </Tap>
      <Tap onPress={() => router.push('/gps')} style={{ marginTop: S.sm }}>
        <Glass style={{ padding: S.lg, flexDirection: 'row', gap: S.md, alignItems: 'center' }}><Satellite size={20} color={C.lime} /><T v="h3" style={{ flex: 1 }}>GPS diagnostics</T></Glass>
      </Tap>

      <T v="label" style={{ marginTop: S.xl, marginBottom: S.sm }}>SOS hold time</T>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[1, 2, 3, 5].map((n) => <Pill key={n} text={`${n} s`} color={st.sosHoldSeconds === n ? C.lime : C.text2} dot={st.sosHoldSeconds === n ? C.lime : undefined} onPress={() => updateUser({ settings: { ...st, sosHoldSeconds: n } })} />)}
      </View>
      <T v="small" style={{ marginTop: 6 }}>Shorter is faster in an emergency; longer guards against accidental presses.</T>

      <T v="label" style={{ marginTop: S.xl, marginBottom: S.sm }}>Low-battery warning</T>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[0.1, 0.2, 0.3].map((n) => <Pill key={n} text={`${n * 100}%`} color={st.lowBatteryWarn === n ? C.lime : C.text2} dot={st.lowBatteryWarn === n ? C.lime : undefined} onPress={() => updateUser({ settings: { ...st, lowBatteryWarn: n } })} />)}
        <Pill text={st.haptics ? 'Haptics on' : 'Haptics off'} color={st.haptics ? C.lime : C.text2} onPress={() => updateUser({ settings: { ...st, haptics: !st.haptics } })} />
      </View>

      <T v="label" style={{ marginTop: S.xxl, marginBottom: S.sm }}>Permissions</T>
      <Row label="Location" ok={permission === 'granted'} action={permission === 'denied' ? 'Open settings' : 'Allow'} onPress={() => (permission === 'denied' ? Linking.openSettings() : requestForeground())} />
      <Row label="Background location" ok={Platform.OS === 'web' ? null : !!bg} action="Allow" onPress={async () => { if (!(await requestBackground())) void Linking.openSettings(); }} />
      <Row label="Notifications" ok={Platform.OS === 'web' ? null : notif} action="Allow" onPress={async () => setNotif(await requestNotifications())} />
      <T v="small" style={{ marginTop: S.sm }}>On some Android phones, battery optimisation can still stop background recording. If your trail has gaps after locking the screen, set TRAILX to “Unrestricted” in the system battery settings.</T>

      <View style={{ alignItems: 'center', marginTop: S.xxxl, gap: S.sm }}>
        <Logo size={40} wordmark animate={false} />
        <T v="small" center>Explore without limits. Find your way back.</T>
        <T v="small" center color={C.faint}>Version 1.0.0 · no account · no tracking · no paid services</T>
      </View>
    </Screen>
  );
}
