import { useRouter } from 'expo-router';
import { Flag, MapPin, Pause, Play, Square, StickyNote, TriangleAlert, Undo2, X } from 'lucide-react-native';
import React, { useState } from 'react';
import { View } from 'react-native';
import { fmtDistance, fmtDuration, fmtSpeed } from '@/core/stats';
import type { SamplingMode } from '@/core/types';
import { getDb } from '@/db';
import { addNote, addWaypoint } from '@/db/repo';
import { haptic } from '@/services/device';
import { getRecorder, cancelTrek, changeSamplingMode, finishTrek, mockLocationSeen, pauseTrek, resumeTrek, SAMPLING_INFO, startTrek } from '@/services/tracking';
import { useApp } from '@/store';
import { StartButton } from '@/ui/Buttons';
import { Banner, Button, Enter, Field, Glass, Pill, Screen, T, Tap } from '@/ui/primitives';
import { RouteCanvas } from '@/ui/RouteCanvas';
import { Confirm, Sheet } from '@/ui/Sheet';
import { BigStat, Stat, useEased, useNow } from '@/ui/Stat';
import { LastKnown, StatusRow, useGps } from '@/ui/Status';
import { C, S } from '@/ui/theme';
import { defaultTrekName } from './index';

export default function Trek() {
  const router = useRouter();
  const trek = useApp((s) => s.trek);
  const trail = useApp((s) => s.trail);
  const heading = useApp((s) => s.heading);
  const warning = useApp((s) => s.trackingWarning);
  const backgroundActive = useApp((s) => s.backgroundActive);
  const user = useApp((s) => s.user);
  const gps = useGps();
  const now = useNow(1000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | 'finish' | 'cancel' | 'waypoint' | 'note' | 'mode'>(null);
  const [text, setText] = useState('');
  const [rec, setRec] = useState<Awaited<ReturnType<typeof getRecorder>> | null>(null);
  React.useEffect(() => { void getRecorder().then(setRec); }, []);

  const stats = trek && rec ? rec.liveStats(now) : null;
  const dist = useEased(stats?.distance ?? 0);

  if (!trek) {
    const start = async () => {
      setError(null);
      setBusy(true);
      const r = await startTrek(defaultTrekName(), user?.settings.samplingMode ?? 'balanced');
      setBusy(false);
      if (!r.ok) setError(r.message);
    };
    return (
      <Screen scroll>
        <T v="label" color={C.limeDim}>Active trek</T>
        <T v="title" style={{ marginTop: 4 }}>Nothing is recording.</T>
        <T style={{ marginTop: S.sm }}>Press start and TRAILX saves your starting point, then lays a breadcrumb trail from real GPS fixes — with or without signal.</T>
        <View style={{ marginVertical: S.lg }}><StatusRow /></View>
        <View style={{ alignItems: 'center' }}><StartButton onPress={start} busy={busy} sub={gps.live ? 'Records offline' : gps.label} /></View>
        {error ? <Banner icon={TriangleAlert} title="Trek not started" body={error} /> : null}
        {error ? <Tap onPress={() => router.push('/gps')} style={{ alignSelf: 'center', padding: S.md }}><T v="small" color={C.limeDim}>Open GPS diagnostics</T></Tap> : null}
      </Screen>
    );
  }

  const d = fmtDistance(dist);
  const paused = trek.status === 'paused';
  const cur = gps.fix ? { lat: gps.fix.lat, lon: gps.fix.lon, acc: gps.fix.acc } : null;
  const est = stats?.estimatedDistance ?? 0;

  const saveWaypoint = async () => {
    if (!gps.fix) return;
    await addWaypoint(await getDb(), { sessionId: trek.id, name: text || `Waypoint ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, lat: gps.fix.lat, lon: gps.fix.lon, alt: gps.fix.alt, acc: gps.fix.acc, t: Date.now(), note: null });
    haptic('success');
    setText('');
    setSheet(null);
    useApp.getState().touch();
  };
  const saveNote = async () => {
    if (!text.trim()) return;
    await addNote(await getDb(), { sessionId: trek.id, t: Date.now(), text: text.trim(), photoUri: null, lat: gps.fix?.lat ?? null, lon: gps.fix?.lon ?? null });
    haptic('success');
    setText('');
    setSheet(null);
  };
  const finish = async () => {
    const id = await finishTrek();
    if (id != null) router.push(`/history/${id}?finished=1`);
  };

  return (
    <Screen scroll>
      <Enter>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.md }}>
          <View style={{ flex: 1 }}>
            <T v="label" color={paused ? C.orange : C.lime}>{paused ? 'Paused — not counting time or distance' : 'Recording'}</T>
            <T v="h2" numberOfLines={1} style={{ marginTop: 2 }}>{trek.name}</T>
          </View>
          <Pill dot={paused ? C.orange : gps.color} text={gps.live && gps.fix?.acc != null ? `±${Math.round(gps.fix.acc)} m` : gps.label} color={gps.color} />
        </View>
      </Enter>

      <Enter delay={60} style={{ marginTop: S.lg }}>
        <BigStat label="Distance covered" value={d.value} unit={d.unit} size={76} color={paused ? C.text2 : C.text}
          note={est > 0 ? `includes ≈${Math.round(est)} m estimated across GPS gaps` : undefined} />
      </Enter>

      <Enter delay={120} style={{ marginTop: S.lg }}>
        <RouteCanvas points={trail} current={cur} stale={!gps.live} heading={heading ? heading.true ?? heading.mag : null} height={330} />
        <View style={{ marginTop: 8 }}><LastKnown /></View>
      </Enter>

      <Enter delay={180} style={{ marginTop: S.xl }}>
        <View style={{ flexDirection: 'row', gap: S.lg }}>
          <Stat label="Active time" value={fmtDuration(stats?.activeMs ?? 0)} />
          <Stat label="Avg speed" value={stats && stats.avgSpeed > 0 ? fmtSpeed(stats.avgSpeed) : '—'} unit="km/h" note="while moving" />
          <Stat label="Elev. gain" value={stats?.elevationGain != null ? String(Math.round(stats.elevationGain)) : '—'} unit={stats?.elevationGain != null ? 'm' : undefined} note={stats?.elevationGain != null ? 'GPS, approx.' : 'no altitude data'} />
        </View>
        <View style={{ flexDirection: 'row', gap: S.lg, marginTop: S.lg }}>
          <Stat label="Elapsed" value={fmtDuration(stats?.elapsedMs ?? 0)} />
          <Stat label="Altitude" value={gps.fix?.alt != null ? String(Math.round(gps.fix.alt)) : '—'} unit={gps.fix?.alt != null ? 'm' : undefined} />
          <Stat label="Breadcrumbs" value={String(stats?.pointCount ?? 0)} note={backgroundActive ? 'background on' : 'foreground only'} />
        </View>
      </Enter>

      <View style={{ gap: S.md, marginTop: S.xl }}>
        {warning ? <Banner icon={TriangleAlert} title="Recording may stop when the screen locks" body={warning} /> : null}
        {mockLocationSeen() ? <Banner icon={TriangleAlert} title="Mock location detected" body="The operating system reports that positions are being supplied by a mock-location app, not the GPS receiver. This trail is not real positioning." /> : null}
        {gps.status === 'lost' || gps.status === 'poor' ? <Banner icon={TriangleAlert} title={gps.status === 'lost' ? 'GPS signal lost — reacquiring' : 'GPS accuracy is weak'} body="Recording continues. Poor fixes are not added to your trail; if you move while the signal is gone, that stretch will be marked as an estimated gap." /> : null}
      </View>

      <Enter delay={240} style={{ marginTop: S.xl, gap: S.md }}>
        <View style={{ flexDirection: 'row', gap: S.md }}>
          {paused
            ? <Button title="Resume" icon={Play} onPress={resumeTrek} style={{ flex: 1 }} />
            : <Button title="Pause" icon={Pause} kind="ghost" onPress={pauseTrek} style={{ flex: 1 }} />}
          <Button title="Finish" icon={Square} kind={paused ? 'ghost' : 'primary'} onPress={() => setSheet('finish')} style={{ flex: 1 }} />
        </View>
        <Button title="RETURN TO START" icon={Undo2} kind="warn" onPress={() => router.navigate('/(tabs)/return')} />
        <View style={{ flexDirection: 'row', gap: S.md }}>
          <Button small title="Mark spot" icon={MapPin} kind="ghost" disabled={!gps.fix} onPress={() => { setText(''); setSheet('waypoint'); }} style={{ flex: 1 }} />
          <Button small title="Note" icon={StickyNote} kind="ghost" onPress={() => { setText(''); setSheet('note'); }} style={{ flex: 1 }} />
          <Button small title={SAMPLING_INFO[trek.mode].label} icon={Flag} kind="ghost" onPress={() => setSheet('mode')} style={{ flex: 1 }} />
        </View>
        <Tap onPress={() => setSheet('cancel')} style={{ alignSelf: 'center', flexDirection: 'row', gap: 6, alignItems: 'center', padding: S.md }}>
          <X size={15} color={C.muted} /><T v="small">Cancel and discard this trek</T>
        </Tap>
      </Enter>

      <Confirm visible={sheet === 'finish'} onClose={() => setSheet(null)} title="Finish this trek?" confirm="Finish and save" onConfirm={finish}
        body="Recording stops and the trek is saved to your history. You can still navigate back along it from History or the Return tab." />
      <Confirm visible={sheet === 'cancel'} onClose={() => setSheet(null)} title="Discard this trek?" confirm="Discard everything" danger onConfirm={cancelTrek}
        body="Every recorded point of this trek will be deleted from this phone. You will not be able to navigate back along it. This cannot be undone." />
      <Sheet visible={sheet === 'waypoint'} onClose={() => setSheet(null)} title="Mark this spot">
        <T v="small" style={{ marginBottom: S.lg }}>Saved at your current GPS position{gps.fix?.acc != null ? ` (±${Math.round(gps.fix.acc)} m)` : ''}.</T>
        <Field label="Name" value={text} onChangeText={setText} placeholder="Water source, junction, camp…" autoFocus />
        <Button title="Save waypoint" onPress={saveWaypoint} />
      </Sheet>
      <Sheet visible={sheet === 'note'} onClose={() => setSheet(null)} title="Add a note">
        <Field label="Note" value={text} onChangeText={setText} placeholder="What do you want to remember?" multiline autoFocus />
        <Button title="Save note" onPress={saveNote} disabled={!text.trim()} />
      </Sheet>
      <Sheet visible={sheet === 'mode'} onClose={() => setSheet(null)} title="GPS sampling">
        <T v="small" style={{ marginBottom: S.lg }}>Changing mode restarts the location service; recording itself never stops.</T>
        {(Object.keys(SAMPLING_INFO) as SamplingMode[]).map((m) => (
          <Tap key={m} onPress={() => { void changeSamplingMode(m); setSheet(null); }}>
            <Glass tone={trek.mode === m ? 'lime' : undefined} style={{ padding: S.lg, marginBottom: S.md }}>
              <T v="h3">{SAMPLING_INFO[m].label}</T>
              <T v="small" color={C.text2}>{SAMPLING_INFO[m].detail}</T>
            </Glass>
          </Tap>
        ))}
      </Sheet>
    </Screen>
  );
}
