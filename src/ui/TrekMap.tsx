import { Crosshair, Download, Map as MapIcon, Route } from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { buildTrekGeoJSON } from '@/core/mapGeo';
import { boundsOf } from '@/core/tiles';
import type { LatLon } from '@/core/types';
import { coveringArea } from '@/db/repo';
import { offlineMapsSupported } from '@/services/mapEngine';
import { downloadAround } from '@/services/offlineMaps';
import { useApp } from '@/store';
import { T, Tap } from './primitives';
import { RouteCanvas } from './RouteCanvas';
import { C, R, S } from './theme';
import TrailMap from './TrailMap';

type CanvasProps = React.ComponentProps<typeof RouteCanvas>;

const fmtMB = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

/**
 * The trek view: a real map (online, or from an area saved on this device) with the recorded trail,
 * start, waypoints and live position drawn on top. Without a map it shows the map-independent
 * breadcrumb view — the trail is always drawn from the user's own GPS points either way.
 */
export function TrekMap(props: CanvasProps & { start?: LatLon | null }) {
  const { points, current, stale, waypoints, target, height = 330, start } = props;
  const online = useApp((s) => s.online);
  const areas = useApp((s) => s.mapAreas);
  const dl = useApp((s) => s.mapDownload);
  const [mode, setMode] = useState<'map' | 'trail'>('map');
  const [failed, setFailed] = useState<string | null>(null);
  const [follow, setFollow] = useState(!!current);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const anchor = current ?? start ?? points[points.length - 1] ?? null;
  const covered = anchor ? coveringArea(areas, anchor.lat, anchor.lon) : null;
  const supported = offlineMapsSupported();
  const mapPossible = supported && !!anchor && (online !== false || !!covered);
  const showMap = mode === 'map' && mapPossible && !failed;

  // A failure while offline may clear once a saved area or the network becomes available.
  useEffect(() => { setFailed(null); }, [online, covered?.id]);

  // History playback passes a `ghost` marker instead of a live position.
  const ghost = props.ghost;
  const geo = useMemo(() => buildTrekGeoJSON({ trail: points, start: start ?? null, current: current ?? (ghost ? { ...ghost, acc: null } : null), stale, waypoints, target }), [points, start, current, ghost, stale, waypoints, target]);
  const fit = useMemo(() => boundsOf([...points, ...(start ? [start] : []), ...(current ? [current] : []), ...(waypoints ?? [])], 80), [points, start, current, waypoints]);
  const focus = current ? { lat: current.lat, lon: current.lon } : null;

  const saveHere = async () => {
    if (!anchor) return;
    setSaveErr(null);
    try {
      await downloadAround(anchor.lat, anchor.lon, { name: `Saved ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`, radiusM: 5000 });
    } catch (e) {
      setSaveErr((e as Error).message);
    }
  };

  let status: { text: string; tone: 'ok' | 'warn' | 'info'; action?: 'save' } | null = null;
  if (dl) status = { text: `Saving offline map (~${(dl.radiusM / 1000).toFixed(1)} km around you) · ${Math.round(dl.fraction * 100)}% · ${fmtMB(dl.bytes)}`, tone: 'info' };
  else if (!supported) status = { text: 'Maps need an https:// page in this browser — showing your recorded trail.', tone: 'warn' };
  else if (failed) status = { text: `${failed} Showing your recorded trail instead.`, tone: 'warn' };
  else if (covered) status = { text: `Offline map saved for this area (${fmtMB(covered.bytes)}). Works with no signal.`, tone: 'ok' };
  else if (anchor && online !== false) status = { text: 'Map is loading over the network. Save it so it still works when the signal drops.', tone: 'info', action: 'save' };
  else if (anchor) status = { text: 'No signal and no saved map for this area — showing your recorded trail.', tone: 'warn' };

  return (
    <View>
      <View>
        {showMap ? (
          <TrailMap geo={geo} focus={focus} fit={fit} follow={follow && !!focus} height={height} onFailed={setFailed} onUserMove={() => setFollow(false)} />
        ) : (
          <RouteCanvas {...props} height={height} />
        )}
        {mapPossible ? (
          <View style={{ position: 'absolute', top: 12, right: 12, flexDirection: 'row', borderRadius: R.pill, backgroundColor: 'rgba(4,7,5,0.82)', borderWidth: 1, borderColor: C.line, padding: 3 }}>
            {(['map', 'trail'] as const).map((m) => (
              <Tap key={m} onPress={() => setMode(m)} label={m === 'map' ? 'Show map' : 'Show trail only'}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, height: 30, borderRadius: R.pill, backgroundColor: mode === m ? C.lime : 'transparent' }}>
                {m === 'map' ? <MapIcon size={14} color={mode === m ? C.bg : C.text2} /> : <Route size={14} color={mode === m ? C.bg : C.text2} />}
                <T style={{ fontSize: 12.5, fontFamily: 'Inter_600SemiBold', color: mode === m ? C.bg : C.text2 }}>{m === 'map' ? 'Map' : 'Trail'}</T>
              </Tap>
            ))}
          </View>
        ) : null}
        {showMap && focus && !follow ? (
          <Tap onPress={() => setFollow(true)} label="Centre on my position"
            style={{ position: 'absolute', right: 12, bottom: 34, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(4,7,5,0.85)', borderWidth: 1, borderColor: C.line }}>
            <Crosshair size={20} color={C.lime} />
          </Tap>
        ) : null}
      </View>
      {status ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, marginTop: 8 }}>
          <T v="small" style={{ flex: 1 }} color={status.tone === 'ok' ? C.limeDim : status.tone === 'warn' ? C.orange : C.text2}>{status.text}</T>
          {status.action === 'save' ? (
            <Tap onPress={saveHere} label="Save map for offline" style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 30, borderRadius: R.pill, borderWidth: 1, borderColor: C.lime }}>
              <Download size={14} color={C.lime} />
              <T style={{ fontSize: 12.5, fontFamily: 'Inter_600SemiBold', color: C.lime }}>Save offline</T>
            </Tap>
          ) : null}
        </View>
      ) : null}
      {saveErr ? <T v="small" color={C.orange} style={{ marginTop: 4 }}>Could not save the map: {saveErr}</T> : null}
    </View>
  );
}
