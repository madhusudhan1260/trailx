import { useFocusEffect } from 'expo-router';
import { MapPin, Trash2 } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { bearing, cardinal, formatCoord, haversine } from '@/core/geo';
import { fmtDistance } from '@/core/stats';
import { getDb } from '@/db';
import { addWaypoint, deleteWaypoint, listWaypoints, type Waypoint } from '@/db/repo';
import { haptic, retainCompass } from '@/services/device';
import { useApp } from '@/store';
import { Compass } from '@/ui/Compass';
import { Button, Enter, Field, Glass, Screen, T, Tap } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';
import { Stat } from '@/ui/Stat';
import { LastKnown, StatusRow, useGps } from '@/ui/Status';
import { C, S } from '@/ui/theme';

export default function Explore() {
  const heading = useApp((s) => s.heading);
  const trek = useApp((s) => s.trek);
  const dataVersion = useApp((s) => s.dataVersion);
  const gps = useGps();
  const [wps, setWps] = useState<Waypoint[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    let release: (() => void) | undefined;
    void retainCompass().then((r) => (release = r));
    return () => release?.();
  }, []);
  const load = useCallback(async () => setWps(await listWaypoints(await getDb())), []);
  useFocusEffect(useCallback(() => { void load(); }, [load, dataVersion]));

  const fix = gps.fix;
  const target = wps.find((w) => w.id === sel) ?? null;
  const start = trek ? trek.start : null;
  const h = heading ? heading.true ?? heading.mag : null;

  const save = async () => {
    if (!fix) return;
    await addWaypoint(await getDb(), { sessionId: trek?.id ?? null, name: name || `Spot ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, lat: fix.lat, lon: fix.lon, alt: fix.alt, acc: fix.acc, t: Date.now(), note: null });
    haptic('success');
    setName('');
    setOpen(false);
    void load();
  };

  return (
    <Screen scroll>
      <T v="label" color={C.limeDim}>Explore</T>
      <T v="title" style={{ marginTop: 4 }}>Compass & waypoints</T>
      <View style={{ marginTop: S.lg }}><StatusRow /></View>

      <Enter style={{ marginTop: S.xl }}>
        <Compass heading={h} accuracy={heading?.accuracy ?? 0} trueNorth={heading?.true != null}
          toTarget={target && fix ? bearing(fix, target) : null} toStart={start && fix ? bearing(fix, start) : null} size={280} />
        {target && fix ? (
          <T v="h3" center style={{ marginTop: S.md }}>{target.name}: {fmtDistance(haversine(fix, target)).value} {fmtDistance(haversine(fix, target)).unit} at {Math.round(bearing(fix, target))}° {cardinal(bearing(fix, target))} <T v="small">(straight line)</T></T>
        ) : null}
      </Enter>

      <Enter delay={80} style={{ marginTop: S.xl }}>
        <Glass style={{ padding: S.xl }}>
          <T v="label">{gps.live ? 'Current position' : 'Last known position'}</T>
          <T selectable style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 24, color: C.text, marginTop: 6 }}>{fix ? formatCoord(fix, 5) : '—'}</T>
          <LastKnown />
          <View style={{ flexDirection: 'row', gap: S.lg, marginTop: S.lg }}>
            <Stat label="Accuracy" value={fix?.acc != null ? `±${Math.round(fix.acc)}` : '—'} unit="m" color={gps.color} />
            <Stat label="Altitude" value={fix?.alt != null ? String(Math.round(fix.alt)) : '—'} unit={fix?.alt != null ? 'm' : undefined} note={fix?.alt != null ? 'GPS, approx.' : 'not reported'} />
            <Stat label="GPS course" value={fix?.course != null && (fix.speed ?? 0) > 0.7 ? `${Math.round(fix.course)}°` : '—'} note="only while moving" />
          </View>
          <Button title="Mark this spot" icon={MapPin} onPress={() => setOpen(true)} disabled={!fix || !gps.live} style={{ marginTop: S.lg }} />
        </Glass>
      </Enter>

      <T v="label" style={{ marginTop: S.xxl, marginBottom: S.sm }}>Saved waypoints</T>
      {wps.length === 0 ? <T v="small">None yet. Mark a spot and the compass can point you back to it.</T> : null}
      {wps.map((w) => {
        const d = fix ? fmtDistance(haversine(fix, w)) : null;
        return (
          <Tap key={w.id} onPress={() => setSel(sel === w.id ? null : w.id)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: 14, borderTopWidth: 1, borderTopColor: C.line }}>
              <MapPin size={18} color={sel === w.id ? C.lime : C.muted} />
              <View style={{ flex: 1 }}>
                <T v="h3" color={sel === w.id ? C.lime : C.text} numberOfLines={1}>{w.name}</T>
                <T v="small">{formatCoord(w, 5)}{w.acc != null ? ` · ±${Math.round(w.acc)} m` : ''}</T>
              </View>
              {d ? <T v="mono" color={C.text}>{d.value} {d.unit}</T> : null}
              <Tap onPress={async () => { await deleteWaypoint(await getDb(), w.id); void load(); }} label={`Delete ${w.name}`} style={{ padding: 8 }}><Trash2 size={16} color={C.muted} /></Tap>
            </View>
          </Tap>
        );
      })}

      <Sheet visible={open} onClose={() => setOpen(false)} title="Mark this spot">
        <T v="small" style={{ marginBottom: S.lg }}>{fix ? `${formatCoord(fix, 5)}${fix.acc != null ? ` · ±${Math.round(fix.acc)} m` : ''}` : ''}</T>
        <Field label="Name" value={name} onChangeText={setName} placeholder="Viewpoint, water, camp…" autoFocus />
        <Button title="Save waypoint" onPress={save} />
      </Sheet>
    </Screen>
  );
}
