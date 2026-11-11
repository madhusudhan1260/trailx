import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronRight, ClipboardList, History, ShieldAlert, TriangleAlert, User } from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { fmtDistance, fmtDuration } from '@/core/stats';
import { getDb } from '@/db';
import { getDraftPlan, listContacts, listTreks, totals, type SafetyPlan, type TrekSummary } from '@/db/repo';
import { startTrek } from '@/services/tracking';
import { useApp } from '@/store';
import { Logo, MountainScene } from '@/ui/Brand';
import { StartButton } from '@/ui/Buttons';
import { Banner, Enter, Glass, IconButton, Screen, T, Tap } from '@/ui/primitives';
import { Stat } from '@/ui/Stat';
import { StatusRow, useGps } from '@/ui/Status';
import { C, S } from '@/ui/theme';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Up early' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function defaultTrekName() {
  return `Trek · ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}

export default function Home() {
  const router = useRouter();
  const user = useApp((s) => s.user);
  const trek = useApp((s) => s.trek);
  const dataVersion = useApp((s) => s.dataVersion);
  const gps = useGps();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<TrekSummary[]>([]);
  const [sum, setSum] = useState({ treks: 0, distance: 0, activeMs: 0, gain: 0 });
  const [plan, setPlan] = useState<SafetyPlan | null>(null);
  const [contacts, setContacts] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const db = await getDb();
        const [r, t, p, c] = await Promise.all([listTreks(db, 3), totals(db), getDraftPlan(db), listContacts(db)]);
        if (alive) { setRecent(r); setSum(t); setPlan(p); setContacts(c.length); }
      })();
      return () => { alive = false; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dataVersion]),
  );

  const start = async () => {
    setError(null);
    setBusy(true);
    const r = await startTrek(defaultTrekName(), user?.settings.samplingMode ?? 'balanced');
    setBusy(false);
    if (r.ok) router.navigate('/(tabs)/trek');
    else setError(r.message);
  };

  const total = fmtDistance(sum.distance);
  return (
    <Screen scroll pad={false}>
      <View style={{ position: 'absolute', top: -40, left: 0, right: 0, opacity: 0.9 }}><MountainScene height={430} /></View>
      <View style={{ paddingHorizontal: S.xl }}>
        <Enter>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Logo size={38} wordmark />
            <IconButton icon={User} onPress={() => router.push('/profile')} label="Profile" />
          </View>
        </Enter>
        <Enter delay={80} style={{ marginTop: S.xl }}>
          <T v="label" color={C.limeDim}>{greeting()}</T>
          <T v="title" style={{ marginTop: 4 }}>{user?.name ? `${user.name.split(' ')[0]}, where to today?` : 'Where to today?'}</T>
        </Enter>
        <Enter delay={140} style={{ marginTop: S.lg }}><StatusRow /></Enter>

        <Enter delay={220} style={{ alignItems: 'center', marginTop: S.md }}>
          {trek ? (
            <StartButton onPress={() => router.navigate('/(tabs)/trek')} label="OPEN TREK" sub={trek.status === 'paused' ? 'Paused' : 'Recording now'} />
          ) : (
            <StartButton onPress={start} busy={busy} sub={gps.live ? 'Records offline' : gps.label} />
          )}
        </Enter>

        {busy ? <T v="small" center color={C.text2} style={{ marginTop: -S.md, marginBottom: S.lg }}>Waiting for a real GPS fix to use as your starting point…</T> : null}
        {error ? <View style={{ marginBottom: S.lg }}><Banner icon={TriangleAlert} title="Trek not started" body={error} /></View> : null}
        {gps.status === 'no_permission' ? <View style={{ marginBottom: S.lg }}><Banner icon={TriangleAlert} title="Location permission is off" body="TRAILX cannot record a route without it. Enable location for TRAILX in your system settings." /></View> : null}

        <Enter delay={300}>
          <Tap onPress={() => router.push('/plan')}>
            <Glass style={{ padding: S.lg, flexDirection: 'row', alignItems: 'center', gap: S.md }}>
              <ClipboardList size={20} color={plan ? C.lime : C.text2} />
              <View style={{ flex: 1 }}>
                <T v="h3">{plan ? 'Safety plan ready' : 'Add a safety plan'}</T>
                <T v="small" color={C.text2}>
                  {plan
                    ? [plan.destination, plan.expectedReturnAt ? `back by ${new Date(plan.expectedReturnAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : null].filter(Boolean).join(' · ') || 'Notes saved'
                    : 'Expected return time, destination, and who to alert.'}
                </T>
              </View>
              <ChevronRight size={18} color={C.muted} />
            </Glass>
          </Tap>
        </Enter>

        <Enter delay={360} style={{ marginTop: S.md }}>
          <Tap onPress={() => router.navigate('/(tabs)/safety')}>
            <Glass tone={contacts === 0 ? 'warn' : undefined} style={{ padding: S.lg, flexDirection: 'row', alignItems: 'center', gap: S.md }}>
              <ShieldAlert size={20} color={contacts === 0 ? C.orange : C.text2} />
              <View style={{ flex: 1 }}>
                <T v="h3">Emergency settings</T>
                <T v="small" color={C.text2}>{contacts === 0 ? 'No emergency contacts yet. Add one before you leave signal.' : `${contacts} emergency contact${contacts > 1 ? 's' : ''} · SOS ready offline`}</T>
              </View>
              <ChevronRight size={18} color={C.muted} />
            </Glass>
          </Tap>
        </Enter>

        <Enter delay={420} style={{ marginTop: S.xxl }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: S.md }}>
            <T v="label">Recent treks</T>
            <Tap onPress={() => router.push('/history')} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <History size={14} color={C.lime} /><T v="h3" color={C.lime} style={{ fontSize: 13.5 }}>All history</T>
            </Tap>
          </View>
          {recent.length === 0 ? (
            <T v="small">No treks saved yet. Your first recording will appear here.</T>
          ) : (
            <>
              <View style={{ flexDirection: 'row', marginBottom: S.lg }}>
                <Stat label="Treks" value={String(sum.treks)} />
                <Stat label="Total distance" value={total.value} unit={total.unit} />
                <Stat label="Time on trail" value={fmtDuration(sum.activeMs)} />
              </View>
              {recent.map((t) => {
                const d = fmtDistance(t.stats?.distance ?? 0);
                return (
                  <Tap key={t.id} onPress={() => router.push(`/history/${t.id}`)}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderTopWidth: 1, borderTopColor: C.line, gap: S.md }}>
                      <View style={{ flex: 1 }}>
                        <T v="h3" numberOfLines={1}>{t.name}</T>
                        <T v="small">{new Date(t.startedAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</T>
                      </View>
                      <T v="mono" color={C.text}>{d.value} {d.unit}</T>
                      <T v="mono">{fmtDuration(t.stats?.activeMs ?? 0)}</T>
                      <ChevronRight size={16} color={C.muted} />
                    </View>
                  </Tap>
                );
              })}
            </>
          )}
        </Enter>

        <T v="label" center color={C.faint} style={{ marginTop: S.xxxl, letterSpacing: 2.2 }}>NO SIGNAL · NO MAP DOWNLOADS · NO LOST TRAILS</T>
      </View>
    </Screen>
  );
}
