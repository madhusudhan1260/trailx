import { useFocusEffect, useRouter } from 'expo-router';
import { CircleCheck, Route, TriangleAlert, Undo2 } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { angleDiff, cardinal } from '@/core/geo';
import { fmtDistance, fmtDuration } from '@/core/stats';
import type { TrackPoint } from '@/core/types';
import { getDb } from '@/db';
import { getPoints, listTreks, type TrekSummary } from '@/db/repo';
import { retainCompass } from '@/services/device';
import { getRecorder } from '@/services/tracking';
import { startReturn, stopReturn, takeRouteShortcut } from '@/services/returnNav';
import { useApp } from '@/store';
import { Compass, DirectionArrow } from '@/ui/Compass';
import { Banner, Button, Enter, Glass, Screen, T } from '@/ui/primitives';
import { TrekMap } from '@/ui/TrekMap';
import { BigStat, Stat, useEased } from '@/ui/Stat';
import { LastKnown, useGps } from '@/ui/Status';
import { C, S } from '@/ui/theme';

const SAFETY =
  'TRAILX retraces where you walked. It cannot know whether that ground is still safe — rivers rise, light fades, slopes change. Anything you crossed on the way out is your decision on the way back.';

export default function Return() {
  const router = useRouter();
  const trek = useApp((s) => s.trek);
  const trail = useApp((s) => s.trail);
  const nav = useApp((s) => s.nav);
  const returnTrekId = useApp((s) => s.returnTrekId);
  const heading = useApp((s) => s.heading);
  const compassAvailable = useApp((s) => s.compassAvailable);
  const dataVersion = useApp((s) => s.dataVersion);
  const gps = useGps();
  const [last, setLast] = useState<TrekSummary | null>(null);
  const [points, setPoints] = useState<TrackPoint[]>([]);
  const active = returnTrekId != null;

  useEffect(() => {
    let release: (() => void) | undefined;
    void retainCompass().then((r) => (release = r));
    return () => release?.();
  }, []);

  useFocusEffect(useCallback(() => {
    void (async () => setLast((await listTreks(await getDb(), 1))[0] ?? null))();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]));

  // Retracing a finished trek uses its stored points; retracing the live trek uses the live trail.
  useEffect(() => {
    if (returnTrekId != null && returnTrekId > 0) void (async () => setPoints(await getPoints(await getDb(), returnTrekId)))();
  }, [returnTrekId]);
  const shown = points;

  const begin = async (finishedId: number | null) => {
    if (finishedId == null) {
      // Freeze the outbound trail as it is now. Recording continues, so the walk back is saved too.
      const rec = await getRecorder();
      const st = rec.liveStats(Date.now());
      const frozen = useApp.getState().trail.slice();
      setPoints(frozen);
      startReturn(frozen, st && st.avgSpeed > 0 ? st.avgSpeed : null, null);
    } else {
      const db = await getDb();
      const pts = await getPoints(db, finishedId);
      setPoints(pts);
      startReturn(pts, last?.id === finishedId ? last.stats?.avgSpeed ?? null : null, finishedId);
    }
  };

  const remaining = useEased(nav?.remaining ?? 0);

  if (!active) {
    return (
      <Screen scroll>
        <T v="label" color={C.limeDim}>Return to start</T>
        <T v="title" style={{ marginTop: 4 }}>Follow your own trail home.</T>
        <T style={{ marginTop: S.sm }}>TRAILX reverses the breadcrumbs it stored on this phone and guides you from the last one back to the first. No internet, no map.</T>
        <View style={{ gap: S.md, marginTop: S.xl }}>
          {trek ? (
            <Enter>
              <Glass tone="lime" style={{ padding: S.xl }}>
                <T v="label" color={C.lime}>Trek in progress</T>
                <T v="h2" style={{ marginTop: 4 }}>{trek.name}</T>
                <T v="small" color={C.text2} style={{ marginTop: 4 }}>{trail.length} breadcrumbs recorded. Recording keeps running while you walk back.</T>
                <Button title="RETURN TO START" icon={Undo2} kind="warn" onPress={() => begin(null)} disabled={trail.length === 0} style={{ marginTop: S.lg }} />
              </Glass>
            </Enter>
          ) : null}
          {last ? (
            <Enter delay={80}>
              <Glass style={{ padding: S.xl }}>
                <T v="label">Most recent saved trek</T>
                <T v="h2" style={{ marginTop: 4 }}>{last.name}</T>
                <T v="small" color={C.text2} style={{ marginTop: 4 }}>{fmtDistance(last.stats?.distance ?? 0).value} {fmtDistance(last.stats?.distance ?? 0).unit} · {new Date(last.startedAt).toLocaleDateString()}</T>
                <Button title="Retrace this trek" icon={Route} kind="ghost" onPress={() => begin(last.id)} style={{ marginTop: S.lg }} />
                <Button small title="Choose another from history" kind="ghost" onPress={() => router.push('/history')} style={{ marginTop: S.md }} />
              </Glass>
            </Enter>
          ) : null}
          {!trek && !last ? <Banner tone="info" icon={Route} title="No trail to follow yet" body="Record a trek first. As soon as there is a starting point and at least one breadcrumb, you can navigate back." /> : null}
          <Banner icon={TriangleAlert} title="Use your judgement" body={SAFETY} />
        </View>
      </Screen>
    );
  }

  const h = heading ? heading.true ?? heading.mag : null;
  // Without a compass, GPS course over ground is the only direction reference — and only while moving.
  const course = h == null && gps.fix?.course != null && (gps.fix.speed ?? 0) > 0.7 ? gps.fix.course : null;
  const facing = h ?? course;
  const rel = nav && facing != null ? angleDiff(facing, nav.bearingToTarget) : null;
  const rem = fmtDistance(remaining);
  const cur = gps.fix ? { lat: gps.fix.lat, lon: gps.fix.lon, acc: gps.fix.acc } : null;
  const turn = rel == null ? null : Math.abs(rel) < 20 ? 'Straight ahead' : Math.abs(rel) > 150 ? 'Behind you — turn around' : `${Math.abs(rel) < 60 ? 'Slight' : 'Turn'} ${rel > 0 ? 'right' : 'left'}`;

  return (
    <Screen scroll>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View>
          <T v="label" color={nav?.status === 'off_route' ? C.orange : C.lime}>{nav?.status === 'arrived' ? 'Arrived' : nav?.status === 'off_route' ? 'Off your trail' : 'Returning to start'}</T>
          <T v="h2" style={{ marginTop: 2 }}>{nav ? 'Follow the arrow' : 'Waiting for GPS…'}</T>
        </View>
        <Button small title="End" kind="ghost" onPress={stopReturn} />
      </View>

      {nav?.status === 'arrived' ? (
        <Enter style={{ marginTop: S.xl }}>
          <Glass tone="lime" style={{ padding: S.xl, alignItems: 'center', gap: S.sm }}>
            <CircleCheck size={54} color={C.lime} strokeWidth={1.8} />
            <T v="title" center>You are back at the start.</T>
            <T center>GPS places you within about {Math.round(Math.max(nav.distanceToStart, gps.fix?.acc ?? 0))} m of where this trek began.</T>
            <Button title="Done" onPress={stopReturn} style={{ alignSelf: 'stretch', marginTop: S.md }} />
          </Glass>
        </Enter>
      ) : (
        <>
          <View style={{ alignItems: 'center', marginTop: S.md }}>
            <DirectionArrow relative={rel} dim={rel == null} color={nav?.status === 'off_route' ? C.orange : C.lime} />
            <T v="h2" center color={nav?.status === 'off_route' ? C.orange : C.text}>
              {nav ? (turn ?? `Walk toward ${Math.round(nav.bearingToTarget)}° ${cardinal(nav.bearingToTarget)}`) : '—'}
            </T>
            <T v="small" center style={{ marginTop: 4, maxWidth: 320 }}>
              {!nav ? 'Guidance starts with the next usable GPS fix.'
                : h != null ? `Next point ${Math.round(nav.distanceToTarget)} m · bearing ${Math.round(nav.bearingToTarget)}° ${cardinal(nav.bearingToTarget)}`
                : course != null ? 'No compass: arrow uses your GPS direction of travel, which is only valid while you keep walking.'
                : compassAvailable === false ? 'No compass on this device. Walk a few steps so GPS can tell which way you are moving, or use the bearing above with a physical compass.'
                : 'Reading compass…'}
            </T>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: S.xl, gap: S.lg }}>
            <View style={{ flex: 1.4 }}><BigStat label="Distance remaining" value={nav ? rem.value : '—'} unit={nav ? rem.unit : undefined} size={58} /></View>
            <Stat label="Est. time" value={nav?.etaMs != null ? fmtDuration(nav.etaMs) : '—'} note={nav?.etaMs != null ? 'at your pace' : 'pace unknown'} />
          </View>

          <View style={{ gap: S.md, marginTop: S.lg }}>
            {nav?.status === 'off_route' ? <Banner icon={TriangleAlert} title={`You are about ${Math.round(nav.offBy)} m from your recorded trail`} body={`The arrow now points to the nearest part of the trail you walked (${Math.round(nav.distanceToTarget)} m). The ground between you and it was never recorded — check it is passable before heading across.`} /> : null}
            {nav?.unverifiedAhead ? <Banner icon={TriangleAlert} title={`Unrecorded stretch ${nav.unverifiedAhead.inMetres < 15 ? 'here' : `in ${Math.round(nav.unverifiedAhead.inMetres)} m`}`} body={`About ${Math.round(nav.unverifiedAhead.length)} m of this trail has no GPS record (signal gap or pause). It is drawn as a dashed straight line, which is NOT the path you walked. Find your own way across it.`} /> : null}
            {nav?.shortcutAvailable ? <Banner tone="info" icon={Route} title="Your trail passes close by here" body="An earlier part of your trail is nearby. You can skip the loop in between — but the ground between the two was not recorded." action="Skip to the nearer part" onAction={takeRouteShortcut} /> : null}
            {!gps.live ? <Banner icon={TriangleAlert} title="No live GPS" body="Guidance is paused until a fix arrives. Do not rely on the arrow." /> : null}
          </View>

          <View style={{ marginTop: S.lg }}>
            <TrekMap points={shown} current={cur} stale={!gps.live} heading={h} target={nav?.target ?? null} direction="reverse" litUntil={nav ? nav.nextIndex + 2 : undefined} height={320} />
            <View style={{ marginTop: 8 }}><LastKnown /></View>
          </View>

          <View style={{ flexDirection: 'row', gap: S.lg, marginTop: S.xl }}>
            <Stat label="Straight line to start" value={nav ? fmtDistance(nav.distanceToStart).value : '—'} unit={nav ? fmtDistance(nav.distanceToStart).unit : undefined} note="not a route" />
            <Stat label="GPS accuracy" value={gps.fix?.acc != null ? `±${Math.round(gps.fix.acc)}` : '—'} unit="m" color={gps.color} />
            <Stat label="Off trail by" value={nav ? String(Math.round(nav.offBy)) : '—'} unit="m" />
          </View>

          <View style={{ marginTop: S.xl }}>
            <Compass heading={h} accuracy={heading?.accuracy ?? 0} trueNorth={heading?.true != null} toTarget={nav?.bearingToTarget ?? null} toStart={nav?.bearingToStart ?? null} size={230} />
          </View>
          <T v="small" center style={{ marginTop: S.xl }}>{SAFETY}</T>
        </>
      )}
    </Screen>
  );
}
