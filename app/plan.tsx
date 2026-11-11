import { useRouter } from 'expo-router';
import { Clock } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { getDb } from '@/db';
import { getDraftPlan, getPlanForSession, saveDraftPlan, setDestination, updatePlan } from '@/db/repo';
import { cancelOverdueNotification, notificationsAllowed, scheduleOverdueNotification } from '@/services/notify';
import { useApp } from '@/store';
import { Banner, Button, Field, Header, Pill, Screen, T } from '@/ui/primitives';
import { C, S } from '@/ui/theme';

const pad = (n: number) => String(n).padStart(2, '0');

export default function Plan() {
  const router = useRouter();
  const trek = useApp((s) => s.trek);
  const active = useApp((s) => s.plan);
  const [ret, setRet] = useState<number | null>(null);
  const [hhmm, setHhmm] = useState('');
  const [destination, setDest] = useState('');
  const [notes, setNotes] = useState('');
  const [notif, setNotif] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const p = trek ? active : await getDraftPlan(await getDb());
      if (p) {
        setRet(p.expectedReturnAt);
        setDest(p.destination ?? '');
        setNotes(p.notes ?? '');
        if (p.expectedReturnAt) { const d = new Date(p.expectedReturnAt); setHhmm(`${pad(d.getHours())}:${pad(d.getMinutes())}`); }
      }
      setNotif(await notificationsAllowed());
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const quick = (h: number) => {
    const t = Date.now() + h * 3600_000;
    setRet(t);
    const d = new Date(t);
    setHhmm(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
    setErr(null);
  };
  const typed = (v: string) => {
    setHhmm(v);
    const m = v.match(/^(\d{1,2}):(\d{2})$/);
    if (!m || +m[1] > 23 || +m[2] > 59) return setRet(null);
    const d = new Date();
    d.setHours(+m[1], +m[2], 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1); // a time already past means tomorrow
    setRet(d.getTime());
  };

  const save = async () => {
    if (hhmm && ret == null) return setErr('Enter the time as HH:MM (24-hour), or clear it.');
    const db = await getDb();
    if (trek) {
      if (active) {
        await cancelOverdueNotification(active);
        await db.run('UPDATE safety_plans SET destination = ?, notes = ? WHERE id = ?', [destination.trim() || null, notes.trim() || null, active.id]);
        // A new return time re-arms the overdue warning.
        await updatePlan(db, active.id, { expectedReturnAt: ret, overdueEventId: null, notificationId: null });
      } else {
        await saveDraftPlan(db, { expectedReturnAt: ret, destination, notes }, Date.now());
        await db.run('UPDATE safety_plans SET session_id = ? WHERE session_id IS NULL', [trek.id]);
      }
      await setDestination(db, trek.id, destination);
      const p = await getPlanForSession(db, trek.id);
      if (p?.expectedReturnAt) await scheduleOverdueNotification(p);
      useApp.getState().set({ plan: await getPlanForSession(db, trek.id) });
    } else {
      await saveDraftPlan(db, { expectedReturnAt: ret, destination, notes }, Date.now());
    }
    useApp.getState().touch();
    router.back();
  };

  return (
    <Screen scroll bottom={60}>
      <Header title="Safety plan" eyebrow={trek ? 'For the trek in progress' : 'For your next trek'} onBack={() => router.back()} />
      <T v="label" style={{ marginBottom: S.sm }}>Expected return</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: S.md }}>
        {[2, 4, 6, 8, 12].map((h) => <Pill key={h} icon={Clock} text={`in ${h} h`} onPress={() => quick(h)} />)}
        <Pill text="Clear" onPress={() => { setRet(null); setHhmm(''); }} />
      </View>
      <Field label="Return time (24-hour HH:MM)" value={hhmm} onChangeText={typed} placeholder="17:30" keyboardType="numbers-and-punctuation"
        hint={ret ? `Overdue warning at ${new Date(ret).toLocaleString([], { weekday: 'long', hour: '2-digit', minute: '2-digit' })}` : 'Leave empty for no overdue warning.'} />
      <Field label="Planned destination" value={destination} onChangeText={setDest} placeholder="Summit, lake, campsite…" />
      <Field label="Notes for rescuers (optional)" value={notes} onChangeText={setNotes} placeholder="Route plan, group size, vehicle parked at…" multiline />
      {err ? <T v="small" color={C.orange} style={{ marginBottom: S.md }}>{err}</T> : null}
      {ret && !notif ? <View style={{ marginBottom: S.lg }}><Banner title="Notifications are off" body="The overdue warning will only appear while TRAILX is open. Allow notifications in Profile to be warned with the screen locked." /></View> : null}
      <Banner tone="info" title="What happens if you are overdue" body="TRAILX warns you on this phone and prepares an emergency message with your position. It does not contact anyone by itself — with no signal it cannot, and it will never claim it did. Tell someone your plan before you leave." />
      <Button title="Save plan" onPress={save} style={{ marginTop: S.xl }} />
    </Screen>
  );
}
