import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { gpsMessage, reduceGps } from '@/core/gpsMachine';
import { fmtAge } from '@/core/stats';
import { getWebGps, GPS_BACKEND, refreshPermissions, requestForeground, startLiveWatch, stopLiveWatch } from '@/services/tracking';
import { useApp } from '@/store';
import { Button, Glass, Header, Screen, T } from '@/ui/primitives';
import { useNow } from '@/ui/Stat';
import { useGps } from '@/ui/Status';
import { C, S } from '@/ui/theme';

/**
 * GPS diagnostics. Everything shown is read from this device only; nothing here is logged or sent
 * anywhere. Coordinates are hidden until the user taps "Show coordinates".
 */
export default function GpsDiagnostics() {
  const router = useRouter();
  const now = useNow(1000);
  const gps = useGps();
  const permission = useApp((s) => s.permission);
  const servicesEnabled = useApp((s) => s.servicesEnabled);
  const geo = useApp((s) => s.geo);
  const trek = useApp((s) => s.trek);
  const [showCoords, setShowCoords] = useState(false);
  useEffect(() => { void refreshPermissions(); }, []);

  // Apply the passage of time so a silent receiver shows up as reacquiring here too.
  const m = reduceGps(geo, { type: 'TICK', now });
  const web = GPS_BACKEND === 'browser' ? getWebGps() : null;
  const secure = Platform.OS === 'web' ? (globalThis as { isSecureContext?: boolean }).isSecureContext !== false : null;
  const f = gps.fix;

  const rows: [string, string][] = [
    ['Platform', `${Platform.OS} · ${GPS_BACKEND === 'browser' ? 'browser Geolocation API' : 'Expo Location'}`],
    ...(secure != null ? [['Secure page (https)', secure ? 'yes' : 'NO — browsers block GPS on http://'] as [string, string]] : []),
    ['Permission', permission],
    ['Location services', servicesEnabled == null ? 'unknown' : servicesEnabled ? 'on' : 'off'],
    ['Acquisition state', `${m.phase} — ${gpsMessage(m)}`],
    ['Displayed status', gps.label],
    ['Recording', trek ? trek.status : 'no trek'],
    ['Latitude', f ? (showCoords ? f.lat.toFixed(6) : 'hidden') : '—'],
    ['Longitude', f ? (showCoords ? f.lon.toFixed(6) : 'hidden') : '—'],
    ['Accuracy', f?.acc != null ? `±${Math.round(f.acc)} m` : '—'],
    ['Altitude', f?.alt != null ? `${Math.round(f.alt)} m` : '—'],
    ['Fix timestamp', f ? new Date(f.t).toLocaleTimeString() : '—'],
    ['Since last update', gps.ageMs != null ? fmtAge(gps.ageMs) : '—'],
    ['Fixes this session', String(m.fixCount)],
    ['Searching for', m.searchingSince != null ? fmtAge(now - m.searchingSince).replace(' ago', '') : '—'],
    ['Last error', m.lastError ? `${m.lastError.kind}${m.lastError.code != null ? ` (code ${m.lastError.code})` : ''} ${m.lastError.message} · ${fmtAge(now - m.lastError.at)}` : 'none'],
  ];
  if (web) rows.push(['Browser watcher', `${web.active ? 'running' : 'stopped'} · started ${web.stats.watchesStarted}× · restarts ${web.stats.restarts} · probes ${web.stats.probes} · errors ${web.stats.errors}`]);

  return (
    <Screen scroll bottom={60}>
      <Header title="GPS diagnostics" eyebrow="Read from this device only" onBack={() => router.back()} />
      <Glass style={{ padding: S.lg }}>
        {rows.map(([k, v]) => (
          <View key={k} style={{ flexDirection: 'row', gap: S.md, paddingVertical: 7, borderTopWidth: 1, borderTopColor: C.line }}>
            <T v="small" style={{ width: 130 }}>{k}</T>
            <T v="small" color={C.text} style={{ flex: 1 }} selectable>{v}</T>
          </View>
        ))}
      </Glass>
      <View style={{ gap: S.md, marginTop: S.lg }}>
        <Button small kind="ghost" title={showCoords ? 'Hide coordinates' : 'Show coordinates'} onPress={() => setShowCoords(!showCoords)} />
        <Button small title="Request location / retry GPS" onPress={async () => { stopLiveWatch(); if (permission !== 'granted') await requestForeground(); else await startLiveWatch(); }} />
      </View>
      <T v="small" style={{ marginTop: S.lg }}>
        {Platform.OS === 'web'
          ? 'In a browser, GPS only runs while this tab is open and the screen is on. Browsers cannot record in the background — use the installed app for that.'
          : 'Background recording uses the system location service; this screen shows the live foreground readings.'}
      </T>
    </Screen>
  );
}
