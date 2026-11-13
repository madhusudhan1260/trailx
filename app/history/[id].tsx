import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Camera, CircleCheck, Download, Pause, Pencil, Play, RotateCcw, StickyNote, Trash2, Undo2 } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, View } from 'react-native';
import { formatCoord } from '@/core/geo';
import { elevationProfile, fmtDistance, fmtDuration, fmtSpeed } from '@/core/stats';
import type { TrackPoint } from '@/core/types';
import { getDb } from '@/db';
import { addNote, deleteNote, deleteTrek, getPoints, getTrek, listEvents, listNotes, listWaypoints, renameTrek, type Note, type StoredEvent, type TrekSummary, type Waypoint } from '@/db/repo';
import { exportTrek } from '@/services/exportTrek';
import { startReturn } from '@/services/returnNav';
import { useApp } from '@/store';
import { ElevationChart } from '@/ui/ElevationChart';
import { Banner, Button, Enter, Field, Glass, Header, IconButton, Screen, T, Tap } from '@/ui/primitives';
import { TrekMap } from '@/ui/TrekMap';
import { Confirm, Sheet } from '@/ui/Sheet';
import { BigStat, Stat } from '@/ui/Stat';
import { C, S } from '@/ui/theme';

const PLAYBACK_MS = 14_000;

export default function TrekDetail() {
  const { id: idParam, finished } = useLocalSearchParams<{ id: string; finished?: string }>();
  const id = Number(idParam);
  const router = useRouter();
  const [trek, setTrek] = useState<TrekSummary | null>(null);
  const [points, setPoints] = useState<TrackPoint[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [wps, setWps] = useState<Waypoint[]>([]);
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [sheet, setSheet] = useState<null | 'rename' | 'note' | 'delete'>(null);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  // playback: fraction 0..1 of the trail, or null when not playing back
  const [play, setPlay] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const raf = useRef(0);

  const load = useCallback(async () => {
    const db = await getDb();
    setTrek(await getTrek(db, id));
    setPoints(await getPoints(db, id));
    setNotes(await listNotes(db, id));
    setWps(await listWaypoints(db, id));
    setEvents(await listEvents(db, id));
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!running) return;
    const from = play ?? 0;
    const t0 = Date.now();
    const tick = () => {
      const f = Math.min(1, from + (Date.now() - t0) / PLAYBACK_MS);
      setPlay(f);
      if (f < 1) raf.current = requestAnimationFrame(tick);
      else setRunning(false);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const profile = useMemo(() => elevationProfile(points), [points]);
  const cum = useMemo(() => {
    const c: number[] = [];
    let d = 0;
    points.forEach((p, i) => { if (i && p.seg === points[i - 1].seg) d += p.dist; c.push(d); });
    return c;
  }, [points]);

  if (!trek) return <Screen><Header title="Trek" onBack={() => router.back()} /></Screen>;
  const s = trek.stats;
  const d = fmtDistance(s?.distance ?? 0);
  const idx = play != null && points.length ? Math.min(points.length - 1, Math.floor(play * (points.length - 1))) : null;
  const ghost = idx != null ? points[idx] : null;

  const pickPhoto = async (camera: boolean) => {
    setMsg(null);
    try {
      const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return setMsg('Permission not granted.');
      const r = camera ? await ImagePicker.launchCameraAsync({ quality: 0.7 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
      if (r.canceled || !r.assets[0]) return;
      await addNote(await getDb(), { sessionId: id, t: Date.now(), text: null, photoUri: r.assets[0].uri, lat: null, lon: null });
      void load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <Screen scroll bottom={60}>
      <Header title={trek.name} eyebrow={new Date(trek.startedAt).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        onBack={() => (finished ? router.replace('/(tabs)') : router.back())} right={<IconButton icon={Pencil} label="Rename trek" size={42} onPress={() => { setText(trek.name); setSheet('rename'); }} />} />

      {finished ? <Enter style={{ marginBottom: S.lg }}><Banner tone="lime" icon={CircleCheck} title="Trek saved" body="Your route, statistics and notes are stored on this phone. You can retrace it at any time, online or not." /></Enter> : null}

      <BigStat label="Total distance" value={d.value} unit={d.unit} size={68} note={s && s.estimatedDistance > 0 ? `≈${Math.round(s.estimatedDistance)} m of this is estimated across ${s.gapCount} GPS gap${s.gapCount > 1 ? 's' : ''}` : undefined} />

      <View style={{ marginTop: S.lg }}>
        <TrekMap points={points} waypoints={wps} litUntil={idx != null ? idx + 1 : undefined} ghost={ghost} height={340} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, marginTop: S.md }}>
          <IconButton icon={running ? Pause : Play} label={running ? 'Pause playback' : 'Play route'} onPress={() => { if (!running && (play == null || play >= 1)) setPlay(0); setRunning(!running); }} />
          <View style={{ flex: 1 }}>
            <View style={{ height: 4, borderRadius: 2, backgroundColor: C.faint, overflow: 'hidden' }}><View style={{ width: `${(play ?? 0) * 100}%`, height: 4, backgroundColor: C.lime }} /></View>
            <T v="small" style={{ marginTop: 5 }}>
              {idx != null && ghost ? `${fmtDistance(cum[idx]).value} ${fmtDistance(cum[idx]).unit} · ${new Date(ghost.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${ghost.alt != null ? ` · ${Math.round(ghost.alt)} m` : ''}` : 'Replay your journey'}
            </T>
          </View>
          {play != null ? <IconButton icon={RotateCcw} label="Reset playback" size={40} onPress={() => { setRunning(false); setPlay(null); }} /> : null}
        </View>
      </View>

      {s ? (
        <Glass style={{ padding: S.xl, marginTop: S.xl, gap: S.lg }}>
          <View style={{ flexDirection: 'row', gap: S.lg }}>
            <Stat label="Moving" value={fmtDuration(s.movingMs)} />
            <Stat label="Active time" value={fmtDuration(s.activeMs)} note="pauses excluded" />
            <Stat label="Elapsed" value={fmtDuration(s.elapsedMs)} />
          </View>
          <View style={{ flexDirection: 'row', gap: S.lg }}>
            <Stat label="Avg speed" value={s.avgSpeed > 0 ? fmtSpeed(s.avgSpeed) : '—'} unit="km/h" note="while moving" />
            <Stat label="Max speed" value={s.maxSpeed > 0 ? fmtSpeed(s.maxSpeed) : '—'} unit="km/h" />
            <Stat label="Points" value={String(s.pointCount)} />
          </View>
          <View style={{ flexDirection: 'row', gap: S.lg }}>
            <Stat label="Elev. gained" value={s.elevationGain != null ? String(Math.round(s.elevationGain)) : '—'} unit={s.elevationGain != null ? 'm' : undefined} />
            <Stat label="Elev. lost" value={s.elevationLoss != null ? String(Math.round(s.elevationLoss)) : '—'} unit={s.elevationLoss != null ? 'm' : undefined} />
            <Stat label="Highest" value={s.maxAltitude != null ? String(Math.round(s.maxAltitude)) : '—'} unit={s.maxAltitude != null ? 'm' : undefined} note={s.minAltitude != null ? `lowest ${Math.round(s.minAltitude)} m` : undefined} />
          </View>
          <T v="small">
            {s.elevationGain == null ? 'Elevation unavailable: the device reported no usable GPS altitude.' : `Elevation comes from GPS altitude (smoothed, ${Math.round(s.altitudeCoverage * 100)}% of points). Treat it as an estimate — GPS altitude is typically 2–3× less accurate than horizontal position.`}
          </T>
        </Glass>
      ) : null}

      <T v="label" style={{ marginTop: S.xl, marginBottom: S.sm }}>Elevation profile</T>
      <Glass style={{ padding: S.md }}><ElevationChart data={profile} marker={idx != null ? cum[idx] : null} /></Glass>

      <T v="label" style={{ marginTop: S.xl, marginBottom: S.sm }}>Start & destination</T>
      <T selectable v="mono" color={C.text}>Start  {formatCoord(trek.start, 5)}</T>
      {points.length > 1 ? <T selectable v="mono" color={C.text}>End    {formatCoord(points[points.length - 1], 5)}</T> : null}
      {trek.destination ? <T v="small" color={C.text2}>Planned destination: {trek.destination}</T> : null}

      {events.length ? (
        <>
          <T v="label" style={{ marginTop: S.xl, marginBottom: S.sm }}>Safety events</T>
          {events.map((e) => (
            <Tap key={e.id} onPress={() => router.push(`/emergency/${e.id}`)}>
              <Banner title={`${e.kind === 'sos' ? 'SOS' : 'Overdue alert'} · ${e.id}`} body={`${new Date(e.createdAt).toLocaleString()}${e.resolvedAt ? ' · resolved' : ' · still open'}`} />
            </Tap>
          ))}
        </>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: S.xl, marginBottom: S.sm }}>
        <T v="label">Photos & notes</T>
        <View style={{ flexDirection: 'row', gap: S.sm }}>
          <IconButton icon={StickyNote} label="Add note" size={40} onPress={() => { setText(''); setSheet('note'); }} />
          <IconButton icon={Camera} label="Add photo" size={40} onPress={() => pickPhoto(false)} />
        </View>
      </View>
      {notes.length === 0 ? <T v="small">Nothing added yet.</T> : null}
      {notes.map((n) => (
        <Glass key={n.id} style={{ marginBottom: S.md }}>
          {n.photoUri ? <Image source={{ uri: n.photoUri }} style={{ width: '100%', height: 200 }} resizeMode="cover" /> : null}
          <View style={{ padding: S.lg, flexDirection: 'row', gap: S.md, alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              {n.text ? <T color={C.text}>{n.text}</T> : null}
              <T v="small">{new Date(n.t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</T>
            </View>
            <Tap onPress={async () => { await deleteNote(await getDb(), n.id); void load(); }} label="Delete" style={{ padding: 6 }}><Trash2 size={16} color={C.muted} /></Tap>
          </View>
        </Glass>
      ))}

      <View style={{ gap: S.md, marginTop: S.xl }}>
        <Button title="Navigate back along this route" icon={Undo2} kind="warn" disabled={points.length === 0}
          onPress={() => { startReturn(points, s?.avgSpeed ?? null, id); router.navigate('/(tabs)/return'); }} />
        <View style={{ flexDirection: 'row', gap: S.md }}>
          <Button small title="Export GPX" icon={Download} kind="ghost" style={{ flex: 1 }} onPress={async () => setMsg(await exportTrek(id, 'gpx').catch((e: Error) => e.message))} />
          <Button small title="Export JSON" icon={Download} kind="ghost" style={{ flex: 1 }} onPress={async () => setMsg(await exportTrek(id, 'json').catch((e: Error) => e.message))} />
        </View>
        {msg ? <T v="small" color={C.text2}>{msg}</T> : null}
        <Button small title="Delete trek" icon={Trash2} kind="ghost" onPress={() => setSheet('delete')} />
      </View>

      <Sheet visible={sheet === 'rename'} onClose={() => setSheet(null)} title="Rename trek">
        <Field label="Name" value={text} onChangeText={setText} autoFocus />
        <Button title="Save" onPress={async () => { await renameTrek(await getDb(), id, text); setSheet(null); useApp.getState().touch(); void load(); }} />
      </Sheet>
      <Sheet visible={sheet === 'note'} onClose={() => setSheet(null)} title="Add a note">
        <Field label="Note" value={text} onChangeText={setText} multiline autoFocus />
        <Button title="Save note" disabled={!text.trim()} onPress={async () => { await addNote(await getDb(), { sessionId: id, t: Date.now(), text: text.trim(), photoUri: null, lat: null, lon: null }); setSheet(null); void load(); }} />
        {Platform.OS !== 'web' ? <Button small title="Take a photo instead" icon={Camera} kind="ghost" style={{ marginTop: S.md }} onPress={() => { setSheet(null); void pickPhoto(true); }} /> : null}
      </Sheet>
      <Confirm visible={sheet === 'delete'} onClose={() => setSheet(null)} title="Delete this trek?" confirm="Delete permanently" danger
        body="The route, statistics and notes are removed from this phone. Export it first if you want a copy. This cannot be undone."
        onConfirm={async () => { await deleteTrek(await getDb(), id); useApp.getState().touch(); router.back(); }} />
    </Screen>
  );
}
