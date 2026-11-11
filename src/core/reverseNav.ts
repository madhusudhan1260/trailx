import { bearing, fromLocal, haversine, projectOnSegment, toLocal, type XY } from './geo';
import type { LatLon, TrackPoint } from './types';

/**
 * Reverse breadcrumb navigation.
 *
 * The recorded trail A→B→C→D→E is treated as a polyline. "Progress" is the user's position
 * measured in metres along that line from A. Returning means driving progress down to zero, so the
 * user is always guided toward the previously recorded point: E→D→C→B→A. Nothing here needs a map
 * or a network — only the stored coordinates.
 */

export interface NavRoute {
  origin: LatLon;
  ll: LatLon[];
  xy: XY[];
  /** Cumulative metres from the start to each vertex. */
  cum: number[];
  /**
   * unverified[i] is true when the line from vertex i to i+1 was NOT actually recorded
   * (GPS gap, or the stretch walked while paused). It is a straight-line guess.
   */
  unverified: boolean[];
  length: number;
}

export function buildRoute(points: Pick<TrackPoint, 'lat' | 'lon' | 'seg' | 'gap'>[]): NavRoute {
  if (points.length === 0) throw new Error('Cannot navigate an empty route');
  const origin = { lat: points[0].lat, lon: points[0].lon };
  const ll = points.map((p) => ({ lat: p.lat, lon: p.lon }));
  const xy = ll.map((p) => toLocal(origin, p));
  const cum = [0];
  const unverified: boolean[] = [];
  for (let i = 1; i < xy.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(xy[i].x - xy[i - 1].x, xy[i].y - xy[i - 1].y));
    unverified.push(points[i].gap || points[i].seg !== points[i - 1].seg);
  }
  return { origin, ll, xy, cum, unverified, length: cum[cum.length - 1] };
}

/** The order in which waypoints are visited on the way back: last recorded first. */
export function reversedWaypoints<T>(points: T[]): T[] {
  return points.slice().reverse();
}

export type NavStatus = 'on_route' | 'off_route' | 'arrived';

export interface NavState {
  status: NavStatus;
  /** Metres along the recorded trail from the start to the user's snapped position. */
  progress: number;
  /** Metres left to walk: along-trail distance plus the distance back onto the trail. */
  remaining: number;
  /** Where to walk next. On route: a point slightly ahead on the trail. Off route: the rejoin point. */
  target: LatLon;
  /** Index of the next recorded breadcrumb in the direction of the start. */
  nextIndex: number;
  bearingToTarget: number;
  distanceToTarget: number;
  bearingToStart: number;
  /** Straight-line distance to the start. NOT a suggested path. */
  distanceToStart: number;
  /** Distance from the user to the nearest point of the trail being followed. */
  offBy: number;
  /** Upcoming stretch that was never recorded, if one lies within the look-ahead. */
  unverifiedAhead: { inMetres: number; length: number } | null;
  /** Rough time to the start at `speed`. Always an estimate. */
  etaMs: number | null;
  /** True when a much shorter way to rejoin an earlier part of the trail exists (the trail loops close by). */
  shortcutAvailable: boolean;
}

export interface NavInternal {
  s: number | null;
  offCount: number;
  arrived: boolean;
}

export const initialNav = (): NavInternal => ({ s: null, offCount: 0, arrived: false });

interface Snap {
  seg: number;
  s: number;
  dist: number;
  x: number;
  y: number;
}

function snap(route: NavRoute, p: XY, fromSeg: number, toSeg: number): Snap | null {
  let best: Snap | null = null;
  for (let i = Math.max(0, fromSeg); i <= Math.min(route.xy.length - 2, toSeg); i++) {
    const pr = projectOnSegment(p, route.xy[i], route.xy[i + 1]);
    if (!best || pr.dist < best.dist) {
      best = { seg: i, s: route.cum[i] + pr.t * (route.cum[i + 1] - route.cum[i]), dist: pr.dist, x: pr.x, y: pr.y };
    }
  }
  return best;
}

function segAt(route: NavRoute, s: number): number {
  // Binary search: last vertex whose cumulative distance is <= s.
  let lo = 0;
  let hi = route.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (route.cum[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  return Math.min(lo, Math.max(0, route.xy.length - 2));
}

function pointAt(route: NavRoute, s: number): XY {
  if (route.xy.length === 1) return route.xy[0];
  const c = Math.max(0, Math.min(route.length, s));
  const i = segAt(route, c);
  const len = route.cum[i + 1] - route.cum[i];
  const t = len === 0 ? 0 : (c - route.cum[i]) / len;
  return { x: route.xy[i].x + t * (route.xy[i + 1].x - route.xy[i].x), y: route.xy[i].y + t * (route.xy[i + 1].y - route.xy[i].y) };
}

const LOOK_BACK = 150; // metres of trail toward the start that are searched each update
const LOOK_FWD = 40; // metres of trail away from the start (user briefly backtracks)
const SEPARATE_PASS = 100; // trail metres that distinguish "another pass nearby" from "the same stretch"
const SHORTCUT_MIN_SAVING = 200;
const OFF_COUNT = 3; // consecutive off-trail fixes before a deviation is declared

export function offRouteThreshold(acc: number): number {
  return Math.max(30, 2.5 * acc);
}

/**
 * Advance the navigator with a new position.
 * @param acc  horizontal accuracy of `pos` in metres
 * @param speed  the user's typical walking speed in m/s, used only for the ETA estimate
 */
export function updateNav(route: NavRoute, nav: NavInternal, pos: LatLon, acc: number, speed: number | null): { nav: NavInternal; state: NavState } {
  const p = toLocal(route.origin, pos);
  const lastSeg = route.xy.length - 2;
  const thr = offRouteThreshold(acc);
  let s = nav.s;
  let offCount = nav.offCount;
  let offBy = 0;
  let rejoin: Snap | null = null;
  let shortcut = false;

  if (route.xy.length === 1) {
    s = 0;
    offBy = Math.hypot(p.x, p.y);
  } else if (s == null) {
    // First fix: pick the nearest part of the trail, but when several parts are about equally
    // near (loops, out-and-back) prefer the one furthest along, so the whole trail is retraced.
    const nearest = snap(route, p, 0, lastSeg)!;
    const tol = Math.max(25, 2 * acc);
    let chosen = nearest;
    // Only a genuinely separate, later pass of the trail (>100 m further along) may override the nearest point.
    const laterFrom = segAt(route, nearest.s + SEPARATE_PASS) + 1;
    for (let i = lastSeg; i >= laterFrom; i--) {
      const c = snap(route, p, i, i)!;
      if (c.dist <= nearest.dist + tol) {
        chosen = snap(route, p, Math.max(laterFrom, segAt(route, c.s - 60)), i)!;
        break;
      }
    }
    s = chosen.s;
    offBy = chosen.dist;
    if (offBy > thr) {
      offCount = OFF_COUNT;
      rejoin = chosen;
    }
  } else {
    const local = snap(route, p, segAt(route, s - LOOK_BACK), segAt(route, s + LOOK_FWD))!;
    if (local.dist <= thr) {
      s = local.s;
      offBy = local.dist;
      offCount = 0;
    } else {
      offCount++;
      offBy = local.dist;
      // Look for the best place to rejoin anywhere between here and the start. Never jump to a
      // part of the trail further from the start than the user already is.
      const global = snap(route, p, 0, segAt(route, s + LOOK_FWD))!;
      if (global.dist <= thr) {
        // The user cut across and met an earlier part of their own trail.
        s = global.s;
        offBy = global.dist;
        offCount = 0;
      } else if (offCount >= OFF_COUNT) {
        rejoin = global;
        offBy = global.dist;
      }
    }
  }
  if (route.xy.length > 1 && offCount === 0) shortcut = findShortcut(route, p, s!, acc) != null;

  const off = offCount >= OFF_COUNT;
  const distanceToStart = haversine(pos, route.ll[0]);
  const arrived = nav.arrived || (!off && s! <= Math.max(15, acc) && distanceToStart <= Math.max(15, 1.5 * acc));

  // Aim a little ahead along the trail rather than at the very next breadcrumb. Breadcrumbs can be
  // only a few metres apart, closer than GPS error, and aiming at them makes the arrow swing wildly.
  const lookahead = Math.max(15, 1.5 * acc);
  const targetXY: XY = arrived ? route.xy[0] : off && rejoin ? { x: rejoin.x, y: rejoin.y } : pointAt(route, s! - lookahead);
  const target = fromLocal(route.origin, targetXY);
  const distanceToTarget = Math.hypot(targetXY.x - p.x, targetXY.y - p.y);
  const anchorS = off && rejoin ? rejoin.s : s!;
  const remaining = arrived ? 0 : anchorS + offBy;

  let unverifiedAhead: NavState['unverifiedAhead'] = null;
  if (route.xy.length > 1 && !arrived) {
    const cur = segAt(route, anchorS);
    for (let i = cur; i >= 0 && anchorS - route.cum[i + 1] < 200; i--) {
      if (route.unverified[i]) {
        unverifiedAhead = { inMetres: Math.max(0, anchorS - route.cum[i + 1]), length: route.cum[i + 1] - route.cum[i] };
        break;
      }
    }
  }

  // nextIndex: the breadcrumb the user will pass next on the way to the start.
  let nextIndex = 0;
  if (route.xy.length > 1) {
    const i = segAt(route, anchorS);
    nextIndex = anchorS - route.cum[i] < 1 ? Math.max(0, i - 1) : i;
    if (anchorS >= route.length) nextIndex = route.xy.length - 2;
  }

  const state: NavState = {
    status: arrived ? 'arrived' : off ? 'off_route' : 'on_route',
    progress: s!,
    remaining,
    target,
    nextIndex,
    bearingToTarget: distanceToTarget < 0.5 ? bearing(pos, route.ll[0]) : bearing(pos, target),
    distanceToTarget,
    bearingToStart: bearing(pos, route.ll[0]),
    distanceToStart,
    offBy,
    unverifiedAhead,
    etaMs: speed && speed > 0.2 ? (remaining / speed) * 1000 : null,
    shortcutAvailable: shortcut,
  };
  return { nav: { s, offCount, arrived }, state };
}

function findShortcut(route: NavRoute, p: XY, s: number, acc: number): Snap | null {
  if (s < SHORTCUT_MIN_SAVING) return null;
  const c = snap(route, p, 0, segAt(route, s - SHORTCUT_MIN_SAVING) - 1);
  return c && c.dist <= Math.max(50, 3 * acc) && s - c.s >= SHORTCUT_MIN_SAVING ? c : null;
}

/**
 * The user explicitly chose to skip a loop and join an earlier part of their trail that passes
 * close by. Never taken automatically: the ground between the two passes was not recorded.
 */
export function takeShortcut(route: NavRoute, nav: NavInternal, pos: LatLon, acc: number): NavInternal {
  if (nav.s == null || route.xy.length < 2) return nav;
  const c = findShortcut(route, toLocal(route.origin, pos), nav.s, acc);
  return c ? { s: c.s, offCount: 0, arrived: false } : nav;
}
