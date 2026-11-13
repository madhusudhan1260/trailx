import { destination } from './geo';
import type { LatLon } from './types';

/**
 * Turns a recorded trek into GeoJSON for the map. Every coordinate comes from stored GPS fixes or
 * waypoints the user marked — the map style is only a background, never a source of route data.
 * Pure: identical on web and native, and tested.
 */

export interface MapTrailPoint extends LatLon { seg: number; gap: boolean }

export type Kind = 'trail' | 'gap' | 'start' | 'waypoint' | 'accuracy' | 'position' | 'target';

type Feature = {
  type: 'Feature';
  properties: { kind: Kind; name?: string; stale?: boolean };
  geometry: { type: 'Point'; coordinates: [number, number] } | { type: 'LineString'; coordinates: [number, number][] } | { type: 'Polygon'; coordinates: [number, number][][] };
};
export interface FeatureCollection { type: 'FeatureCollection'; features: Feature[] }

const ll = (p: LatLon): [number, number] => [p.lon, p.lat];

export function circlePolygon(c: LatLon, radiusM: number, steps = 48): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) ring.push(ll(destination(c, (i / steps) * 360, radiusM)));
  return ring;
}

export function buildTrekGeoJSON(input: {
  trail: MapTrailPoint[];
  start?: LatLon | null;
  current?: (LatLon & { acc: number | null }) | null;
  stale?: boolean;
  waypoints?: (LatLon & { name: string })[];
  target?: LatLon | null;
}): FeatureCollection {
  const f: Feature[] = [];
  // Measured stretches: consecutive breadcrumbs in one segment. A point flagged `gap` was reached
  // after a GPS outage, so the line leading to it is drawn separately (dashed) as an estimate.
  let run: [number, number][] = [];
  const flush = () => {
    if (run.length > 1) f.push({ type: 'Feature', properties: { kind: 'trail' }, geometry: { type: 'LineString', coordinates: run } });
    run = [];
  };
  for (let i = 0; i < input.trail.length; i++) {
    const p = input.trail[i];
    const prev = input.trail[i - 1];
    if (prev && prev.seg !== p.seg) flush();
    else if (prev && p.gap) {
      flush();
      f.push({ type: 'Feature', properties: { kind: 'gap' }, geometry: { type: 'LineString', coordinates: [ll(prev), ll(p)] } });
    }
    run.push(ll(p));
  }
  flush();

  const start = input.start ?? input.trail[0] ?? null;
  if (start) f.push({ type: 'Feature', properties: { kind: 'start', name: 'Start' }, geometry: { type: 'Point', coordinates: ll(start) } });
  for (const w of input.waypoints ?? []) f.push({ type: 'Feature', properties: { kind: 'waypoint', name: w.name }, geometry: { type: 'Point', coordinates: ll(w) } });
  if (input.target) f.push({ type: 'Feature', properties: { kind: 'target' }, geometry: { type: 'Point', coordinates: ll(input.target) } });
  if (input.current) {
    if (input.current.acc != null && input.current.acc > 0)
      f.push({ type: 'Feature', properties: { kind: 'accuracy', stale: !!input.stale }, geometry: { type: 'Polygon', coordinates: [circlePolygon(input.current, input.current.acc)] } });
    f.push({ type: 'Feature', properties: { kind: 'position', stale: !!input.stale }, geometry: { type: 'Point', coordinates: ll(input.current) } });
  }
  return { type: 'FeatureCollection', features: f };
}

/** Zoom that shows roughly `metres` across `px` pixels at this latitude (Web Mercator, 512 px tiles). */
export function zoomForSpan(metres: number, px: number, lat: number): number {
  const mPerPxAtZ0 = (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / 512;
  return Math.max(2, Math.min(18, Math.log2((mPerPxAtZ0 * px) / Math.max(metres, 30))));
}
