/** Shared domain types. Everything in src/core is pure TypeScript with no device dependencies. */

export interface LatLon {
  lat: number;
  lon: number;
}

/** A raw fix exactly as the OS location provider reported it. Nulls mean "not reported". */
export interface RawFix extends LatLon {
  /** Unix epoch milliseconds of the fix (provider time). */
  t: number;
  /** Estimated horizontal accuracy radius in metres (68% confidence), or null when unknown. */
  acc: number | null;
  alt: number | null;
  altAcc: number | null;
  /** Ground speed in m/s from the provider (Doppler), or null. */
  speed: number | null;
  /** GPS course over ground in degrees. This is NOT the compass heading. */
  course: number | null;
}

/** A fix that passed filtering and was written to the breadcrumb trail. */
export interface TrackPoint extends RawFix {
  /** Order within the trek, starting at 0. */
  seq: number;
  /** Recording segment. Increments on every resume so no distance is drawn across a pause. */
  seg: number;
  /** Metres from the previous point in the same segment (0 for the first point of a segment). */
  dist: number;
  /**
   * True when the provider went silent for a long time before this point. The straight line
   * from the previous point is an estimate, not a recorded path.
   */
  gap: boolean;
}

export type SamplingMode = 'precise' | 'balanced' | 'saver';

export type GpsStatus = 'off' | 'no_permission' | 'unsupported' | 'requesting' | 'acquiring' | 'good' | 'fair' | 'poor' | 'lost';

export type TrekStatus = 'recording' | 'paused' | 'finished';

export interface TrekStats {
  /** Total metres along the recorded trail (measured + estimated). */
  distance: number;
  /** Portion of `distance` that bridges signal gaps and is therefore estimated. */
  estimatedDistance: number;
  /** Wall-clock ms between start and end (or now). */
  elapsedMs: number;
  /** Elapsed minus paused time. */
  activeMs: number;
  /** Time spent actually moving. */
  movingMs: number;
  avgSpeed: number;
  maxSpeed: number;
  /** Null when the device reported no usable altitude. */
  elevationGain: number | null;
  elevationLoss: number | null;
  maxAltitude: number | null;
  minAltitude: number | null;
  /** Share of points that carried a usable altitude, 0..1. */
  altitudeCoverage: number;
  pointCount: number;
  gapCount: number;
}
