import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { buildRoute, initialNav, takeShortcut, updateNav, type NavInternal, type NavRoute, type NavStatus } from '@/core/reverseNav';
import type { TrackPoint } from '@/core/types';
import { useApp } from '@/store';
import { haptic } from './device';

/**
 * Drives reverse navigation from live fixes. The route is the stored breadcrumb trail; nothing is
 * fetched. Runs as a store subscription so guidance keeps updating whichever tab is visible.
 */

let route: NavRoute | null = null;
let internal: NavInternal = initialNav();
let speed: number | null = null;
let unsubscribe: (() => void) | null = null;
let lastStatus: NavStatus | null = null;
let lastFixT = 0;

export const KEEP_AWAKE_TAG = 'trailx-return';

export function activeRoute(): NavRoute | null {
  return route;
}

function step() {
  const s = useApp.getState();
  if (!route || !s.fix || s.fix.t === lastFixT) return;
  // Guidance is only advanced with fixes that carry a usable accuracy estimate.
  if (s.fix.acc == null || s.fix.acc > 80) return;
  lastFixT = s.fix.t;
  const r = updateNav(route, internal, s.fix, s.fix.acc, speed);
  internal = r.nav;
  if (lastStatus && r.state.status !== lastStatus) {
    if (r.state.status === 'off_route') haptic('warning');
    else if (r.state.status === 'arrived') haptic('success');
    else haptic('light');
  }
  lastStatus = r.state.status;
  s.set({ nav: r.state });
}

/**
 * @param points  the full recorded trail, in recorded order
 * @param avgSpeed  the user's own moving speed on this trek (m/s), for the ETA estimate
 * @param trekId  finished trek being retraced, or null for the trek in progress
 */
export function startReturn(points: TrackPoint[], avgSpeed: number | null, trekId: number | null) {
  stopReturn();
  if (points.length === 0) return;
  route = buildRoute(points);
  internal = initialNav();
  speed = avgSpeed && avgSpeed > 0.2 ? avgSpeed : null;
  lastStatus = null;
  lastFixT = 0;
  useApp.getState().set({ returnTrekId: trekId ?? -1, nav: null });
  unsubscribe = useApp.subscribe((s, prev) => {
    if (s.fix !== prev.fix) step();
  });
  step();
  void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
}

export function stopReturn() {
  unsubscribe?.();
  unsubscribe = null;
  route = null;
  useApp.getState().set({ returnTrekId: null, nav: null });
  void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
}

/** User-initiated only: skip a loop and join an earlier part of the trail that passes close by. */
export function takeRouteShortcut() {
  const s = useApp.getState();
  if (!route || !s.fix) return;
  internal = takeShortcut(route, internal, s.fix, s.fix.acc ?? 30);
  lastFixT = 0;
  step();
}
