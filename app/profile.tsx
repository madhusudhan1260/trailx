import { useRouter } from 'expo-router';
import { Check, History } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import type { SamplingMode } from '@/core/types';
import { updateUser } from '@/services/boot';
import { notificationsAllowed, requestNotifications } from '@/services/notify';
import { refreshPermissions, requestBackground, requestForeground, SAMPLING_INFO } from '@/services/tracking';
import { useApp } from '@/store';
import { Logo } from '@/ui/Brand';
import { Button, Field, Glass, Header, Pill, Screen, T, Tap } from '@/ui/primitives';
import { C, S } from '@/ui/theme';

export default function Profile() {
  const router = useRouter();
  const user = useApp((s) => s.user)!;
  const permission = useApp((s) => s.permission);
  const bg = useApp((s) => s.backgroundPermission);
  const [f, setF] = useState({ name: user.name ?? '', bloodGroup: user.bloodGroup ?? '', medical: user.medical ?? '', allergies: user.allergies ?? '' });
  const [saved, setSaved] = useState(false);
  const [notif, setNotif] = useState<boolean | null>(null);
  useEffect(() => { void refreshPermissions(); void notificationsAllowed().then(setNotif); }, []);
  const set = (k: keyof typeof f) => (v: string) => { setF({ ...f, [k]: v }); setSaved(false); };
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
      <Header title="Profile" eyebrow="Stored only on this phone" onBack={() => router.back()} />
      <T v="small" style={{ marginBottom: S.lg }}>No account is needed. Everything here is optional and is included in an emergency message only when you raise one.</T>
      <Field label="Name" value={f.name} onChangeText={set('name')} placeholder="How rescuers should address you" />
      <Field label="Blood group" value={f.bloodGroup} onChangeText={set('bloodGroup')} placeholder="e.g. O+" autoCapitalize="characters" />
      <Field label="Medical conditions" value={f.medical} onChangeText={set('medical')} placeholder="Asthma, diabetes, medication…" multiline />
      <Field label="Allergies" value={f.allergies} onChangeText={set('allergies')} placeholder="Penicillin, bee stings…" />
      <Button title={saved ? 'Saved' : 'Save profile'} icon={saved ? Check : undefined} onPress={async () => { await updateUser({ name: f.name.trim() || null, bloodGroup: f.bloodGroup.trim() || null, medical: f.medical.trim() || null, allergies: f.allergies.trim() || null }); setSaved(true); }} />

      <Tap onPress={() => router.push('/history')} style={{ marginTop: S.xl }}>
        <Glass style={{ padding: S.lg, flexDirection: 'row', gap: S.md, alignItems: 'center' }}><History size={20} color={C.lime} /><T v="h3" style={{ flex: 1 }}>Trek history</T></Glass>
      </Tap>

      <T v="label" style={{ marginTop: S.xxl, marginBottom: S.sm }}>Default GPS sampling</T>
      {(Object.keys(SAMPLING_INFO) as SamplingMode[]).map((m) => (
        <Tap key={m} onPress={() => updateUser({ settings: { ...st, samplingMode: m } })}>
          <Glass tone={st.samplingMode === m ? 'lime' : undefined} style={{ padding: S.lg, marginBottom: S.sm }}>
            <T v="h3">{SAMPLING_INFO[m].label}</T>
            <T v="small" color={C.text2}>{SAMPLING_INFO[m].detail}</T>
          </Glass>
        </Tap>
      ))}

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
