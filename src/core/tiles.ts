import { destination } from './geo';

/**
 * Slippy-map tile maths for offline areas. Pure — shared by the browser tile cache, the native
 * offline packs and the tests.
 */

/** [west, south, east, north] in degrees. */
export type BBox = [number, number, number, number];

/**
 * OpenFreeMap's published rules for offline downloads in apps: at most 3,000 tiles or 50 MB per
 * download, at most 4 parallel requests, and an identifying User-Agent.
 */
export const OFM_LIMITS = { maxTiles: 3000, maxBytes: 50 * 1024 * 1024, parallel: 4 } as const;

/** Vector tiles exist up to z14; the renderer over-zooms them for closer views. */
export const MAX_TILE_ZOOM = 14;

const clampLat = (lat: number) => Math.max(-85.05112878, Math.min(85.05112878, lat));

export function lonLatToTile(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (clampLat(lat) * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return { x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}

export function bboxAround(lat: number, lon: number, radiusM: number): BBox {
  const n = destination({ lat, lon }, 0, radiusM);
  const s = destination({ lat, lon }, 180, radiusM);
  const e = destination({ lat, lon }, 90, radiusM);
  const w = destination({ lat, lon }, 270, radiusM);
  return [w.lon, s.lat, e.lon, n.lat];
}

export function tileRange(b: BBox, z: number) {
  const a = lonLatToTile(b[0], b[3], z); // north-west
  const c = lonLatToTile(b[2], b[1], z); // south-east
  return { minX: a.x, maxX: c.x, minY: a.y, maxY: c.y };
}

export function countTiles(b: BBox, minZ: number, maxZ: number): number {
  let n = 0;
  for (let z = minZ; z <= maxZ; z++) {
    const r = tileRange(b, z);
    n += (r.maxX - r.minX + 1) * (r.maxY - r.minY + 1);
  }
  return n;
}

export function* tilesIn(b: BBox, minZ: number, maxZ: number): Generator<{ z: number; x: number; y: number }> {
  for (let z = minZ; z <= maxZ; z++) {
    const r = tileRange(b, z);
    for (let x = r.minX; x <= r.maxX; x++) for (let y = r.minY; y <= r.maxY; y++) yield { z, x, y };
  }
}

export interface AreaPlan {
  bbox: BBox;
  minZoom: number;
  maxZoom: number;
  tileCount: number;
  radiusM: number;
}

/**
 * Plans a download around a point that stays within the provider's tile limit, shrinking the
 * radius rather than silently dropping detail. Returns null if not even a small area fits.
 */
export function planArea(lat: number, lon: number, radiusM: number, opts: { minZoom?: number; maxZoom?: number; maxTiles?: number } = {}): AreaPlan | null {
  const minZoom = opts.minZoom ?? 6;
  const maxZoom = Math.min(opts.maxZoom ?? MAX_TILE_ZOOM, MAX_TILE_ZOOM);
  const maxTiles = opts.maxTiles ?? OFM_LIMITS.maxTiles;
  for (let r = radiusM; r >= 500; r *= 0.8) {
    const bbox = bboxAround(lat, lon, r);
    const tileCount = countTiles(bbox, minZoom, maxZoom);
    if (tileCount <= maxTiles) return { bbox, minZoom, maxZoom, tileCount, radiusM: Math.round(r) };
  }
  return null;
}

export function bboxContains(b: BBox, lat: number, lon: number): boolean {
  return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
}

/** Bounds of a set of points, padded by `padM` metres; null for an empty set. */
export function boundsOf(points: { lat: number; lon: number }[], padM = 0): BBox | null {
  if (!points.length) return null;
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of points) {
    w = Math.min(w, p.lon); e = Math.max(e, p.lon);
    s = Math.min(s, p.lat); n = Math.max(n, p.lat);
  }
  if (!padM) return [w, s, e, n];
  const sw = destination(destination({ lat: s, lon: w }, 180, padM), 270, padM);
  const ne = destination(destination({ lat: n, lon: e }, 0, padM), 90, padM);
  return [sw.lon, sw.lat, ne.lon, ne.lat];
}
