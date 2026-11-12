/**
 * GPS acquisition state machine, shared by every platform adapter (browser Geolocation API,
 * Expo Location on iOS/Android). Pure: no timers, no platform APIs — time is passed in, which is
 * what lets the tests drive it through timeouts, interruptions and recovery.
 *
 * The key rule: waiting for the FIRST fix is never "lost". Only a receiver that has produced a fix
 * and then gone quiet is reported as lost, and even then the adapter keeps trying (reacquiring).
 */

export type GpsPhase =
  | 'idle'
  | 'requesting_permission'
  | 'acquiring_fix'
  | 'gps_ready'
  | 'tracking'
  | 'gps_weak'
  | 'gps_lost'
  | 'error';

export type GeoErrorKind = 'denied' | 'unsupported' | 'insecure' | 'timeout' | 'unavailable' | 'unknown';

export interface GeoError {
  kind: GeoErrorKind;
  /** W3C GeolocationPositionError code (1 denied, 2 unavailable, 3 timeout) when there is one. */
  code: number | null;
  message: string;
  at: number;
}

export interface GpsMachine {
  phase: GpsPhase;
  tracking: boolean;
  /** Wall-clock time the most recent fix was received. */
  lastFixAt: number | null;
  lastAcc: number | null;
  /** When the current acquisition attempt began (used to report how long we have been searching). */
  searchingSince: number | null;
  /** Most recent error. Kept for diagnostics even after the GPS recovers. */
  lastError: GeoError | null;
  fixCount: number;
}

export interface GpsMachineConfig {
  /** Fixes with a worse (larger) accuracy than this are reported as weak. */
  weakAccuracy: number;
  /** No fix for this long after having had one → gps_lost (reacquiring). */
  staleMs: number;
}

export const GPS_MACHINE_DEFAULTS: GpsMachineConfig = { weakAccuracy: 30, staleMs: 30_000 };

export type GpsEvent =
  | { type: 'REQUEST_PERMISSION'; now: number }
  | { type: 'PERMISSION_GRANTED'; now: number }
  | { type: 'FIX'; now: number; acc: number | null }
  | { type: 'ERROR'; now: number; kind: GeoErrorKind; code?: number | null; message?: string }
  | { type: 'TICK'; now: number }
  | { type: 'TRACKING_START'; now: number }
  | { type: 'TRACKING_STOP'; now: number };

export function initialGpsMachine(): GpsMachine {
  return { phase: 'idle', tracking: false, lastFixAt: null, lastAcc: null, searchingSince: null, lastError: null, fixCount: 0 };
}

/** Errors the user (or the platform) must fix; retrying on our own will not help. */
const FATAL: GeoErrorKind[] = ['denied', 'unsupported', 'insecure'];
export const isFatal = (k: GeoErrorKind) => FATAL.includes(k);

function phaseForFix(m: GpsMachine, cfg: GpsMachineConfig): GpsPhase {
  if (m.lastAcc == null || m.lastAcc > cfg.weakAccuracy) return 'gps_weak';
  return m.tracking ? 'tracking' : 'gps_ready';
}

export function reduceGps(m: GpsMachine, e: GpsEvent, cfg: GpsMachineConfig = GPS_MACHINE_DEFAULTS): GpsMachine {
  switch (e.type) {
    case 'REQUEST_PERMISSION':
      if (m.lastFixAt != null && m.phase !== 'error') return m;
      return { ...m, phase: 'requesting_permission', searchingSince: m.searchingSince ?? e.now };
    case 'PERMISSION_GRANTED':
      if (m.lastFixAt != null && m.phase !== 'error') return m;
      return { ...m, phase: 'acquiring_fix', searchingSince: m.phase === 'acquiring_fix' ? m.searchingSince : e.now };
    case 'FIX': {
      const n = { ...m, lastFixAt: e.now, lastAcc: e.acc, fixCount: m.fixCount + 1, searchingSince: null };
      return { ...n, phase: phaseForFix(n, cfg) };
    }
    case 'ERROR': {
      const err: GeoError = { kind: e.kind, code: e.code ?? null, message: e.message ?? '', at: e.now };
      if (isFatal(e.kind)) return { ...m, phase: 'error', lastError: err, searchingSince: null };
      // Timeout / unavailable are temporary: before a first fix we keep searching, after one we reacquire.
      if (m.lastFixAt == null) return { ...m, phase: 'acquiring_fix', lastError: err, searchingSince: m.searchingSince ?? e.now };
      return { ...m, phase: 'gps_lost', lastError: err };
    }
    case 'TICK': {
      if (m.lastFixAt == null || m.phase === 'error') return m;
      const stale = e.now - m.lastFixAt > cfg.staleMs;
      if (stale) return m.phase === 'gps_lost' ? m : { ...m, phase: 'gps_lost' };
      return m.phase === 'gps_lost' ? { ...m, phase: phaseForFix(m, cfg) } : m;
    }
    case 'TRACKING_START': {
      const n = { ...m, tracking: true };
      return n.phase === 'gps_ready' ? { ...n, phase: 'tracking' } : n;
    }
    case 'TRACKING_STOP': {
      const n = { ...m, tracking: false };
      return n.phase === 'tracking' ? { ...n, phase: 'gps_ready' } : n;
    }
  }
}

export const GPS_PHASE_MESSAGE: Record<GpsPhase, string> = {
  idle: 'GPS idle',
  requesting_permission: 'Acquiring GPS signal…',
  acquiring_fix: 'Searching for satellites…',
  gps_ready: 'GPS Ready',
  tracking: 'Tracking',
  gps_weak: 'GPS accuracy is weak',
  gps_lost: 'Reacquiring GPS…',
  error: 'GPS error',
};

export const GEO_ERROR_MESSAGE: Record<GeoErrorKind, string> = {
  denied: 'Enable location permission',
  unsupported: 'GPS is not supported here',
  insecure: 'GPS needs a secure (https://) page',
  timeout: 'GPS timed out — still trying',
  unavailable: 'Position unavailable — still trying',
  unknown: 'GPS error — still trying',
};

/** One human-readable line for the current state. */
export function gpsMessage(m: GpsMachine): string {
  if (m.phase === 'error' && m.lastError) return GEO_ERROR_MESSAGE[m.lastError.kind];
  return GPS_PHASE_MESSAGE[m.phase];
}
