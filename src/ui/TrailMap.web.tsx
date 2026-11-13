import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import React, { useEffect, useRef } from 'react';
import { zoomForSpan } from '@/core/mapGeo';
import { loadStyle, registerMapProtocol } from '@/services/mapEngine.web';
import { TRAIL_LAYERS, type TrailMapProps } from './trailMapStyle';

/** Browser renderer (maplibre-gl). Map resources come through the offline cache. */
export default function TrailMap({ geo, focus, fit, follow, height, onFailed, onUserMove }: TrailMapProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const ready = useRef(false);
  const latest = useRef({ geo, focus, fit, follow });
  latest.current = { geo, focus, fit, follow };
  const cb = useRef({ onFailed, onUserMove });
  cb.current = { onFailed, onUserMove };

  useEffect(() => {
    let disposed = false;
    registerMapProtocol(maplibregl as never);
    // Served from /public (see scripts/copy-map-worker.js); the bundled default path does not survive Metro.
    if (maplibregl.getWorkerUrl() !== '/maplibre-gl-worker.js') maplibregl.setWorkerUrl('/maplibre-gl-worker.js');
    (async () => {
      let style;
      try {
        style = await loadStyle();
      } catch (e) {
        if (!disposed) cb.current.onFailed?.(`Map not available offline here: ${(e as Error).message}`);
        return;
      }
      if (disposed || !host.current) return;
      const { focus: f, fit: b } = latest.current;
      const m = new maplibregl.Map({
        container: host.current,
        style: style as never,
        center: f ? [f.lon, f.lat] : b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : [0, 20],
        zoom: f ? 16 : 13,
        attributionControl: { compact: true }, // the style's sources carry the OpenFreeMap / OpenMapTiles / OSM credits
        maxZoom: 19,
      });
      map.current = m;
      m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
      m.on('dragstart', () => cb.current.onUserMove?.());
      m.on('wheel', () => cb.current.onUserMove?.());
      m.on('error', (e) => {
        // Missing individual tiles offline are expected; only a broken style is fatal.
        if (!ready.current && !m.isStyleLoaded()) cb.current.onFailed?.(`Map failed to load: ${e.error?.message ?? 'unknown error'}`);
      });
      m.on('load', () => {
        m.addSource('trek', { type: 'geojson', data: latest.current.geo as never });
        for (const l of TRAIL_LAYERS) m.addLayer({ ...(l as object), source: 'trek' } as never);
        ready.current = true;
        if (!latest.current.follow && latest.current.fit) m.fitBounds(latest.current.fit as never, { padding: 40, maxZoom: 17, duration: 0 });
      });
    })();
    return () => {
      disposed = true;
      ready.current = false;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    (m.getSource('trek') as maplibregl.GeoJSONSource | undefined)?.setData(geo as never);
  }, [geo]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (follow && focus) m.easeTo({ center: [focus.lon, focus.lat], zoom: Math.max(m.getZoom(), 15), duration: 700 });
    else if (!follow && fit && ready.current) m.fitBounds(fit as never, { padding: 40, maxZoom: 17, duration: 600 });
  }, [follow, focus?.lat, focus?.lon, fit?.[0], fit?.[1], fit?.[2], fit?.[3]]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { map.current?.resize(); }, [height]);

  return <div ref={host} style={{ width: '100%', height, borderRadius: 24, overflow: 'hidden', background: '#0b1a12' }} />;
}

// Unused on web, kept so both renderers export the same helpers.
export { zoomForSpan };
