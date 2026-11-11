import { BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, BatteryWarning, Satellite, Wifi, WifiOff } from 'lucide-react-native';
import React from 'react';
import { View } from 'react-native';
import { fmtAge } from '@/core/stats';
import { gpsStatus, GPS_LABEL, useApp } from '@/store';
import { Pill, T } from './primitives';
import { useNow } from './Stat';
import { C } from './theme';

export function useGps() {
  const now = useNow(2000);
  const permission = useApp((s) => s.permission);
  const servicesEnabled = useApp((s) => s.servicesEnabled);
  const fix = useApp((s) => s.fix);
  const fixAt = useApp((s) => s.fixAt);
  const status = gpsStatus({ permission, servicesEnabled, fix, fixAt }, now);
  const color = status === 'good' ? C.lime : status === 'fair' ? '#E6D34A' : status === 'acquiring' ? C.text2 : C.orange;
  return { status, color, label: GPS_LABEL[status], fix, fixAt, ageMs: fixAt != null ? now - fixAt : null, live: status === 'good' || status === 'fair' || status === 'poor' };
}

export function SignalBars({ level, color }: { level: 0 | 1 | 2 | 3; color: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2.5, height: 16 }}>
      {[1, 2, 3].map((i) => <View key={i} style={{ width: 4, height: 5 + i * 3.5, borderRadius: 1.5, backgroundColor: i <= level ? color : C.faint }} />)}
    </View>
  );
}

export function batteryIcon(level: number | null, charging: boolean) {
  if (charging) return BatteryCharging;
  if (level == null) return BatteryWarning;
  return level > 0.6 ? BatteryFull : level > 0.25 ? BatteryMedium : BatteryLow;
}

/** Row of real-time device readings. Every value is measured; unknown values say "unknown". */
export function StatusRow() {
  const gps = useGps();
  const battery = useApp((s) => s.battery);
  const charging = useApp((s) => s.charging);
  const online = useApp((s) => s.online);
  const low = battery != null && battery <= 0.2 && !charging;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      <Pill icon={Satellite} color={gps.color} text={gps.live && gps.fix?.acc != null ? `GPS ±${Math.round(gps.fix.acc)} m` : gps.label} />
      <Pill icon={batteryIcon(battery, charging)} color={low ? C.orange : C.text2} text={battery != null ? `${Math.round(battery * 100)}%${charging ? ' charging' : ''}` : 'Battery unknown'} />
      <Pill icon={online ? Wifi : WifiOff} color={C.text2} text={online == null ? 'Network unknown' : online ? 'Online' : 'Offline — fine'} />
    </View>
  );
}

/** Shown wherever a position is displayed that is not live. */
export function LastKnown() {
  const gps = useGps();
  if (gps.status !== 'lost' || !gps.fix || gps.ageMs == null) return null;
  return (
    <T v="small" color={C.orange}>
      Live positioning lost. Showing last known location from {fmtAge(gps.ageMs)} (±{gps.fix.acc != null ? Math.round(gps.fix.acc) : '?'} m). Still searching for GPS…
    </T>
  );
}
