import type { FeatureCollection } from '@/core/mapGeo';
import type { BBox } from '@/core/tiles';
import { C } from './theme';

/** Props shared by the web (maplibre-gl) and native (MapLibre Native) map renderers. */
export interface TrailMapProps {
  geo: FeatureCollection;
  /** Where to keep the camera while following (usually the live position). */
  focus: { lat: number; lon: number } | null;
  /** Bounds to show when not following (whole trail). */
  fit: BBox | null;
  follow: boolean;
  height: number;
  /** The map could not load (no network and nothing saved for this area). */
  onFailed?: (message: string) => void;
  /** The user dragged or zoomed the map — stop following. */
  onUserMove?: () => void;
}

/** Layer definitions in plain MapLibre style-spec form; each renderer converts as needed. */
export const TRAIL_LAYERS = [
  { id: 'tx-accuracy', type: 'fill', filter: ['==', ['get', 'kind'], 'accuracy'], paint: { 'fill-color': C.lime, 'fill-opacity': 0.12, 'fill-outline-color': C.lime } },
  { id: 'tx-trail-casing', type: 'line', filter: ['==', ['get', 'kind'], 'trail'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#06170C', 'line-width': 7.5, 'line-opacity': 0.9 } },
  { id: 'tx-trail', type: 'line', filter: ['==', ['get', 'kind'], 'trail'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': C.lime, 'line-width': 4.5 } },
  { id: 'tx-gap', type: 'line', filter: ['==', ['get', 'kind'], 'gap'], layout: { 'line-cap': 'round' }, paint: { 'line-color': C.orange, 'line-width': 3.5, 'line-dasharray': [1.2, 1.6] } },
  { id: 'tx-start', type: 'circle', filter: ['==', ['get', 'kind'], 'start'], paint: { 'circle-radius': 8, 'circle-color': '#FFFFFF', 'circle-stroke-color': C.lime, 'circle-stroke-width': 4 } },
  { id: 'tx-target', type: 'circle', filter: ['==', ['get', 'kind'], 'target'], paint: { 'circle-radius': 9, 'circle-color': 'rgba(255,106,31,0.25)', 'circle-stroke-color': C.orange, 'circle-stroke-width': 3 } },
  { id: 'tx-waypoint', type: 'circle', filter: ['==', ['get', 'kind'], 'waypoint'], paint: { 'circle-radius': 7, 'circle-color': '#FFD54A', 'circle-stroke-color': '#06170C', 'circle-stroke-width': 2.5 } },
  {
    id: 'tx-label', type: 'symbol', filter: ['any', ['==', ['get', 'kind'], 'waypoint'], ['==', ['get', 'kind'], 'start']],
    layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 12.5, 'text-offset': [0, 1.35], 'text-anchor': 'top', 'text-optional': true },
    paint: { 'text-color': '#FFFFFF', 'text-halo-color': '#06170C', 'text-halo-width': 1.6 },
  },
  { id: 'tx-position', type: 'circle', filter: ['==', ['get', 'kind'], 'position'], paint: { 'circle-radius': 8, 'circle-color': ['case', ['get', 'stale'], '#77857A', C.lime], 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 3 } },
] as const;

/** "line-color" → "lineColor", for MapLibre React Native's camelCase layer styles. */
export function toRNStyle(l: (typeof TRAIL_LAYERS)[number]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const block of [('layout' in l ? l.layout : {}) as Record<string, unknown>, l.paint as Record<string, unknown>])
    for (const [k, v] of Object.entries(block)) out[k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  return out;
}
