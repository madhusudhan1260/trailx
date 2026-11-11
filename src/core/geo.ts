import type { LatLon } from './types';

const R = 6371008.8; // mean Earth radius, metres
const RAD = Math.PI / 180;

/** Great-circle distance in metres (Haversine). */
export function haversine(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing from a to b in degrees, 0 = true north, clockwise. */
export function bearing(a: LatLon, b: LatLon): number {
  const p1 = a.lat * RAD;
  const p2 = b.lat * RAD;
  const dl = (b.lon - a.lon) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return norm360(Math.atan2(y, x) / RAD);
}

export function norm360(d: number): number {
  return ((d % 360) + 360) % 360;
}

/** Signed smallest difference to - from, in (-180, 180]. Positive = clockwise (turn right). */
export function angleDiff(from: number, to: number): number {
  let d = norm360(to - from);
  if (d > 180) d -= 360;
  return d;
}

/** Point reached by travelling `dist` metres from `p` on `brg` degrees. */
export function destination(p: LatLon, brg: number, dist: number): LatLon {
  const d = dist / R;
  const t = brg * RAD;
  const p1 = p.lat * RAD;
  const l1 = p.lon * RAD;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 / RAD, lon: l2 / RAD };
}

export interface XY {
  x: number;
  y: number;
}

/**
 * Local tangent-plane projection in metres (x east, y north) around `origin`.
 * Accurate to well under a metre across the few tens of kilometres a trek covers.
 */
export function toLocal(origin: LatLon, p: LatLon): XY {
  return {
    x: (p.lon - origin.lon) * RAD * R * Math.cos(origin.lat * RAD),
    y: (p.lat - origin.lat) * RAD * R,
  };
}

export function fromLocal(origin: LatLon, p: XY): LatLon {
  return {
    lat: origin.lat + p.y / R / RAD,
    lon: origin.lon + p.x / (R * Math.cos(origin.lat * RAD)) / RAD,
  };
}

/** Closest point to `p` on segment a→b. `t` is the fraction along the segment, 0..1. */
export function projectOnSegment(p: XY, a: XY, b: XY): { t: number; x: number; y: number; dist: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return { t, x, y, dist: Math.hypot(p.x - x, p.y - y) };
}

/** Ramer–Douglas–Peucker. Returns indices of the points to keep. Used for drawing only, never for navigation. */
export function simplifyIndices(pts: XY[], tolerance: number): number[] {
  if (pts.length <= 2) return pts.map((_, i) => i);
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let max = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = projectOnSegment(pts[i], pts[s], pts[e]).dist;
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (idx !== -1 && max > tolerance) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(i);
  return out;
}

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function cardinal(deg: number): string {
  return CARDINALS[Math.round(norm360(deg) / 45) % 8];
}

export function formatCoord(p: LatLon, digits = 5): string {
  return `${p.lat.toFixed(digits)}, ${p.lon.toFixed(digits)}`;
}
