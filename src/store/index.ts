import { create } from 'zustand';
import { initialGpsMachine, type GpsMachine } from '@/core/gpsMachine';
import type { NavState } from '@/core/reverseNav';
import type { GpsStatus, RawFix, TrackPoint } from '@/core/types';
import type { MapArea, SafetyPlan, User } from '@/db/repo';
import type { ActiveTrek } from '@/services/recorder';

export interface Heading {
  /** Degrees from magnetic north. */
  mag: number;
  /** Degrees from true north, or null when the OS could not compute it. */
  true: number | null;
  /** 0 (uncalibrated) … 3 (high). */
  accuracy: number;
}

export interface AppState {
  ready: boolean;
  user: User | null;

  permission: 'unknown' | 'granted' | 'denied';
  backgroundPermission: boolean | null;
  servicesEnabled: boolean | null;
  fix: RawFix | null;
  /** Wall-clock time the last fix arrived (used for "age of location"). */
  fixAt: number | null;
  recentFixes: RawFix[];
  acquiring: boolean;
  /** GPS acquisition state machine (see core/gpsMachine). */
  geo: GpsMachine;

  heading: Heading | null;
  compassAvailable: boolean | null;

  battery: number | null;
  charging: boolean;
  lowPowerMode: boolean;
  online: boolean | null;

  trek: ActiveTrek | null;
  trail: TrackPoint[];
  backgroundActive: boolean | null;
  trackingWarning: string | null;
  plan: SafetyPlan | null;

  returnTrekId: number | null;
  nav: NavState | null;

  /** Offline map areas saved on this device, and the download in progress (if any). */
  mapAreas: MapArea[];
  mapDownload: { areaId: number; fraction: number; bytes: number; radiusM: number } | null;

  /** Bumped whenever stored history/safety data changes, so lists reload. */
  dataVersion: number;
  set: (p: Partial<AppState>) => void;
  touch: () => void;
}

export const useApp = create<AppState>((set) => ({
  ready: false,
  user: null,
  permission: 'unknown',
  backgroundPermission: null,
  servicesEnabled: null,
  fix: null,
  fixAt: null,
  recentFixes: [],
  acquiring: false,
  geo: initialGpsMachine(),
  heading: null,
  compassAvailable: null,
  battery: null,
  charging: false,
  lowPowerMode: false,
  online: null,
  trek: null,
  trail: [],
  backgroundActive: null,
  trackingWarning: null,
  plan: null,
  returnTrekId: null,
  nav: null,
  mapAreas: [],
  mapDownload: null,
  dataVersion: 0,
  set: (p) => set(p),
  touch: () => set((s) => ({ dataVersion: s.dataVersion + 1 })),
}));

/** After this long without a fix, positioning is reported as lost rather than live. */
export const FIX_STALE_MS = 30_000;

export function gpsStatus(s: Pick<AppState, 'permission' | 'servicesEnabled' | 'fix' | 'fixAt'> & { geo?: GpsMachine }, now: number): GpsStatus {
  const err = s.geo?.phase === 'error' ? s.geo.lastError : null;
  if (err?.kind === 'denied') return 'no_permission';
  if (err?.kind === 'unsupported' || err?.kind === 'insecure') return 'unsupported';
  if (s.permission !== 'granted' && !s.fix) return s.geo?.phase === 'requesting_permission' ? 'requesting' : 'no_permission';
  if (s.servicesEnabled === false) return 'off';
  if (!s.fix || s.fixAt == null) return s.geo?.phase === 'requesting_permission' ? 'requesting' : 'acquiring';
  // A receiver that has gone quiet is reacquiring, not dead: the adapters keep asking for fixes.
  if (now - s.fixAt > FIX_STALE_MS) return 'lost';
  const a = s.fix.acc;
  if (a == null) return 'poor';
  return a <= 12 ? 'good' : a <= 30 ? 'fair' : 'poor';
}

export const GPS_LABEL: Record<GpsStatus, string> = {
  off: 'Location is off',
  no_permission: 'Enable location permission',
  unsupported: 'GPS is not supported here',
  requesting: 'Acquiring GPS signal…',
  acquiring: 'Searching for satellites…',
  good: 'GPS strong',
  fair: 'GPS fair',
  poor: 'GPS accuracy is weak',
  lost: 'Reacquiring GPS…',
};
