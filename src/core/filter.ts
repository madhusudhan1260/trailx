import { haversine } from './geo';
import type { RawFix, SamplingMode, TrackPoint } from './types';

export interface FilterConfig {
  /** Fixes with a worse accuracy radius than this are never recorded. */
  maxAccuracy: number;
  /** Minimum movement in metres before a new breadcrumb is laid. */
  minDistance: number;
  /** Movement must also exceed this multiple of the accuracy radius — the anti-drift gate. */
  accuracyFactor: number;
  /** Implied speed above this (m/s) is treated as a GPS jump, not movement. */
  maxSpeed: number;
  /** Provider silence longer than this (ms) marks the next point as a signal gap. */
  gapMs: number;
}

export const FILTER_PRESETS: Record<SamplingMode, FilterConfig> = {
  precise: { maxAccuracy: 30, minDistance: 3, accuracyFactor: 0.5, maxSpeed: 12, gapMs: 30_000 },
  balanced: { maxAccuracy: 40, minDistance: 5, accuracyFactor: 0.5, maxSpeed: 12, gapMs: 45_000 },
  saver: { maxAccuracy: 60, minDistance: 12, accuracyFactor: 0.5, maxSpeed: 12, gapMs: 90_000 },
};

/** Bridged distances shorter than this are never labelled as a gap. */
export const GAP_MIN_DISTANCE = 40;

export type RejectReason = 'no_accuracy' | 'poor_accuracy' | 'out_of_order' | 'duplicate' | 'stationary' | 'jump';

export type FilterResult =
  | { accepted: true; point: TrackPoint }
  | { accepted: false; reason: RejectReason };

/** Everything needed to resume filtering after the process is killed. Stored as JSON in SQLite. */
export interface FilterState {
  last: TrackPoint | null;
  /** Time of the most recent fix with usable accuracy, whether or not it became a breadcrumb. */
  lastSeenT: number;
  nextSeq: number;
  seg: number;
  /** True right after start/resume: the next accepted point opens a segment with dist 0. */
  segOpen: boolean;
  /** Consecutive "jump" rejections; a persistent jump is a real relocation, not a glitch. */
  jumpStreak: number;
}

export function initialFilterState(): FilterState {
  return { last: null, lastSeenT: 0, nextSeq: 0, seg: 0, segOpen: true, jumpStreak: 0 };
}

/** Call on resume so the paused stretch contributes neither distance nor a drawn line. */
export function openNewSegment(s: FilterState): FilterState {
  return { ...s, seg: s.last ? s.seg + 1 : s.seg, segOpen: true, jumpStreak: 0 };
}

/**
 * Decides whether a raw fix becomes a breadcrumb.
 *
 * - Fixes without an accuracy estimate, or with a poor one, are dropped.
 * - Movement smaller than the accuracy radius is treated as drift, so standing still adds no distance.
 * - Implausible speeds are dropped as jumps unless three in a row agree (then the device really moved).
 * - A long provider silence flags the next point as a gap so the bridged distance is labelled estimated.
 */
export function filterFix(state: FilterState, fix: RawFix, cfg: FilterConfig): { state: FilterState; result: FilterResult } {
  const seen = Math.max(state.lastSeenT, fix.t);
  // Only trustworthy fixes count as "the provider was alive"; a stretch of bad fixes is a gap.
  const trusted: RejectReason[] = ['stationary', 'duplicate'];
  const reject = (reason: RejectReason, extra: Partial<FilterState> = {}) => ({
    state: { ...state, lastSeenT: trusted.includes(reason) ? seen : state.lastSeenT, ...extra },
    result: { accepted: false as const, reason },
  });

  if (fix.acc == null || !Number.isFinite(fix.acc) || fix.acc <= 0) return reject('no_accuracy');
  if (fix.acc > cfg.maxAccuracy) return reject('poor_accuracy');

  const last = state.last;
  if (last && fix.t <= last.t) return reject('out_of_order');

  const accept = (dist: number, gap: boolean) => {
    const point: TrackPoint = { ...fix, seq: state.nextSeq, seg: state.seg, dist, gap };
    return {
      state: { ...state, last: point, lastSeenT: seen, nextSeq: state.nextSeq + 1, segOpen: false, jumpStreak: 0 },
      result: { accepted: true as const, point },
    };
  };

  if (!last) return accept(0, false);

  const d = haversine(last, fix);
  if (d === 0) return reject('duplicate');

  if (state.segOpen) {
    // First point after a resume: start a fresh segment where the user is now.
    const threshold = Math.max(cfg.minDistance, cfg.accuracyFactor * Math.max(fix.acc, last.acc ?? 0));
    if (d < threshold) {
      // Resumed in the same spot — keep the existing breadcrumb and just reopen the segment on it.
      return reject('stationary');
    }
    return accept(0, false);
  }

  const dt = (fix.t - last.t) / 1000;
  const threshold = Math.max(cfg.minDistance, cfg.accuracyFactor * Math.max(fix.acc, last.acc ?? 0));
  if (d < threshold) return reject('stationary');

  if (d / dt > cfg.maxSpeed) {
    if (state.jumpStreak < 2) return reject('jump', { jumpStreak: state.jumpStreak + 1 });
    // Three consecutive fixes agree the device is far away: accept, but as an unrecorded gap.
    return accept(d, true);
  }

  // A silence only matters if real ground was covered during it. Providers legitimately go quiet
  // while the user stands still (distance-based updates), which must not be reported as signal loss.
  const gap = fix.t - Math.max(last.t, state.lastSeenT) > cfg.gapMs && d > GAP_MIN_DISTANCE;
  return accept(d, gap);
}
