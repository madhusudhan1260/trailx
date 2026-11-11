import { destination } from '@/core/geo';
import { FILTER_PRESETS, filterFix, initialFilterState, type FilterState } from '@/core/filter';
import type { LatLon, RawFix, TrackPoint } from '@/core/types';

export const ORIGIN: LatLon = { lat: 12.9716, lon: 77.5946 };

export function fix(p: LatLon, t: number, acc: number | null = 5, alt: number | null = null): RawFix {
  return { lat: p.lat, lon: p.lon, t, acc, alt, altAcc: alt == null ? null : 5, speed: null, course: null };
}

/** Walk a list of [bearing, metres] legs, emitting a fix every `step` metres at 1.2 m/s. */
export function walk(start: LatLon, legs: [number, number][], step = 10, t0 = 1_700_000_000_000): RawFix[] {
  const out: RawFix[] = [fix(start, t0)];
  let p = start;
  let t = t0;
  for (const [brg, dist] of legs) {
    for (let d = step; d <= dist + 1e-6; d += step) {
      p = destination(p, brg, step);
      t += (step / 1.2) * 1000;
      out.push(fix(p, t));
    }
  }
  return out;
}

export function record(fixes: RawFix[], state: FilterState = initialFilterState(), cfg = FILTER_PRESETS.balanced) {
  const points: TrackPoint[] = [];
  const reasons: string[] = [];
  for (const f of fixes) {
    const r = filterFix(state, f, cfg);
    state = r.state;
    if (r.result.accepted) points.push(r.result.point);
    else reasons.push(r.result.reason);
  }
  return { points, reasons, state };
}
