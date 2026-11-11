import type { TrackPoint, TrekStats } from './types';

/** Altitude readings with a worse vertical accuracy than this are ignored for elevation maths. */
export const MAX_ALT_ACCURACY = 25;
/** Climb/descent is only counted once the smoothed altitude moves this far — suppresses GPS altitude noise. */
export const ELEVATION_HYSTERESIS = 4;
/** Below this speed between breadcrumbs the user is considered stopped. */
const MOVING_SPEED = 0.3;
/** Intervals longer than this between breadcrumbs are not counted as moving time. */
const MAX_MOVING_INTERVAL_MS = 120_000;

export function usableAltitude(p: { alt: number | null; altAcc: number | null }): number | null {
  if (p.alt == null || !Number.isFinite(p.alt)) return null;
  // Some providers report altitude with no accuracy estimate; we accept those but cannot vouch for them.
  if (p.altAcc != null && p.altAcc > MAX_ALT_ACCURACY) return null;
  return p.alt;
}

/** Incremental accumulator so stats can be updated per breadcrumb and persisted between app launches. */
export interface StatsAccumulator {
  distance: number;
  estimatedDistance: number;
  movingMs: number;
  maxSpeed: number;
  gain: number;
  loss: number;
  maxAlt: number | null;
  minAlt: number | null;
  /** Exponentially smoothed altitude. */
  smoothAlt: number | null;
  /** Altitude at which gain/loss was last committed. */
  refAlt: number | null;
  altPoints: number;
  pointCount: number;
  gapCount: number;
  lastT: number | null;
  lastSeg: number;
}

export function initialAccumulator(): StatsAccumulator {
  return {
    distance: 0, estimatedDistance: 0, movingMs: 0, maxSpeed: 0, gain: 0, loss: 0,
    maxAlt: null, minAlt: null, smoothAlt: null, refAlt: null, altPoints: 0,
    pointCount: 0, gapCount: 0, lastT: null, lastSeg: 0,
  };
}

export function accumulate(a: StatsAccumulator, p: TrackPoint): StatsAccumulator {
  const n = { ...a };
  n.pointCount++;
  const sameSeg = a.lastT != null && p.seg === a.lastSeg;
  if (sameSeg && p.dist > 0) {
    n.distance += p.dist;
    const dt = p.t - a.lastT!;
    if (p.gap) {
      n.estimatedDistance += p.dist;
      n.gapCount++;
    } else if (dt > 0 && dt <= MAX_MOVING_INTERVAL_MS) {
      const v = p.dist / (dt / 1000);
      if (v >= MOVING_SPEED) n.movingMs += dt;
      // Prefer the provider's Doppler speed for the maximum; fall back to the breadcrumb-derived speed.
      const s = p.speed != null && p.speed >= 0 ? Math.min(p.speed, v * 2 + 1) : v;
      if (s > n.maxSpeed) n.maxSpeed = s;
    }
  }
  const alt = usableAltitude(p);
  if (alt != null) {
    n.altPoints++;
    n.smoothAlt = a.smoothAlt == null || !sameSeg ? alt : a.smoothAlt + 0.3 * (alt - a.smoothAlt);
    n.maxAlt = n.maxAlt == null ? n.smoothAlt : Math.max(n.maxAlt, n.smoothAlt);
    n.minAlt = n.minAlt == null ? n.smoothAlt : Math.min(n.minAlt, n.smoothAlt);
    if (n.refAlt == null || !sameSeg) n.refAlt = n.smoothAlt;
    else {
      const d = n.smoothAlt - n.refAlt;
      if (d >= ELEVATION_HYSTERESIS) {
        n.gain += d;
        n.refAlt = n.smoothAlt;
      } else if (d <= -ELEVATION_HYSTERESIS) {
        n.loss += -d;
        n.refAlt = n.smoothAlt;
      }
    }
  }
  n.lastT = p.t;
  n.lastSeg = p.seg;
  return n;
}

export function toStats(a: StatsAccumulator, startedAt: number, endedAt: number, pausedMs: number): TrekStats {
  const elapsedMs = Math.max(0, endedAt - startedAt);
  const activeMs = Math.max(0, elapsedMs - pausedMs);
  const hasAlt = a.altPoints >= 2;
  const avgSpeed = a.movingMs > 0 ? (a.distance - a.estimatedDistance) / (a.movingMs / 1000) : 0;
  return {
    distance: a.distance,
    estimatedDistance: a.estimatedDistance,
    elapsedMs,
    activeMs,
    movingMs: Math.min(a.movingMs, activeMs),
    avgSpeed,
    // The provider's instantaneous speed can under-read; a maximum below the average would be nonsense.
    maxSpeed: Math.max(a.maxSpeed, avgSpeed),
    elevationGain: hasAlt ? a.gain : null,
    elevationLoss: hasAlt ? a.loss : null,
    maxAltitude: hasAlt ? a.maxAlt : null,
    minAltitude: hasAlt ? a.minAlt : null,
    altitudeCoverage: a.pointCount ? a.altPoints / a.pointCount : 0,
    pointCount: a.pointCount,
    gapCount: a.gapCount,
  };
}

export function computeStats(points: TrackPoint[], startedAt: number, endedAt: number, pausedMs: number): TrekStats {
  let a = initialAccumulator();
  for (const p of points) a = accumulate(a, p);
  return toStats(a, startedAt, endedAt, pausedMs);
}

/** Elevation profile for charting: cumulative distance vs altitude, only where altitude is usable. */
export function elevationProfile(points: TrackPoint[], maxSamples = 160): { d: number; alt: number }[] {
  const out: { d: number; alt: number }[] = [];
  let d = 0;
  let prevSeg = -1;
  for (const p of points) {
    if (p.seg === prevSeg) d += p.dist;
    prevSeg = p.seg;
    const alt = usableAltitude(p);
    if (alt != null) out.push({ d, alt });
  }
  if (out.length <= maxSamples) return out;
  const step = out.length / maxSamples;
  const sampled: { d: number; alt: number }[] = [];
  for (let i = 0; i < maxSamples; i++) sampled.push(out[Math.floor(i * step)]);
  sampled.push(out[out.length - 1]);
  return sampled;
}

// ---- formatting helpers shared by UI and exports ----

export function fmtDistance(m: number): { value: string; unit: string } {
  if (m < 1000) return { value: Math.round(m).toString(), unit: 'm' };
  return { value: (m / 1000).toFixed(m < 10_000 ? 2 : 1), unit: 'km' };
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function fmtSpeed(ms: number): string {
  return (ms * 3.6).toFixed(1);
}

export function fmtAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min ago`;
}
