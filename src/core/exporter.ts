import type { TrackPoint, TrekStats } from './types';

export interface ExportTrek {
  id: number;
  name: string;
  startedAt: number;
  endedAt: number | null;
  destination: string | null;
  stats: TrekStats | null;
}

export interface ExportWaypoint {
  name: string;
  lat: number;
  lon: number;
  alt: number | null;
  t: number;
  note: string | null;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * GPX 1.1. Each recording segment becomes its own <trkseg>, so apps that import the file do not
 * draw a line across a pause. Accuracy is exported as <hdop>-free <extensions> to avoid implying a
 * DOP value the phone never reported.
 */
export function toGPX(trek: ExportTrek, points: TrackPoint[], waypoints: ExportWaypoint[] = []): string {
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<gpx version="1.1" creator="TRAILX" xmlns="http://www.topografix.com/GPX/1/1" xmlns:trailx="https://trailx.app/gpx/1">');
  out.push(`  <metadata><name>${esc(trek.name)}</name><time>${new Date(trek.startedAt).toISOString()}</time></metadata>`);
  for (const w of waypoints) {
    out.push(`  <wpt lat="${w.lat.toFixed(7)}" lon="${w.lon.toFixed(7)}">${w.alt != null ? `<ele>${w.alt.toFixed(1)}</ele>` : ''}<time>${new Date(w.t).toISOString()}</time><name>${esc(w.name)}</name>${w.note ? `<desc>${esc(w.note)}</desc>` : ''}</wpt>`);
  }
  out.push(`  <trk><name>${esc(trek.name)}</name>`);
  let seg = -1;
  for (const p of points) {
    if (p.seg !== seg) {
      if (seg !== -1) out.push('    </trkseg>');
      out.push('    <trkseg>');
      seg = p.seg;
    }
    out.push(
      `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">` +
        (p.alt != null ? `<ele>${p.alt.toFixed(1)}</ele>` : '') +
        `<time>${new Date(p.t).toISOString()}</time>` +
        `<extensions>${p.acc != null ? `<trailx:accuracy>${p.acc.toFixed(1)}</trailx:accuracy>` : ''}${p.gap ? '<trailx:gap>true</trailx:gap>' : ''}</extensions>` +
        '</trkpt>',
    );
  }
  if (seg !== -1) out.push('    </trkseg>');
  out.push('  </trk>');
  out.push('</gpx>');
  return out.join('\n');
}

export function toJSON(trek: ExportTrek, points: TrackPoint[], waypoints: ExportWaypoint[] = [], extra: Record<string, unknown> = {}): string {
  return JSON.stringify(
    {
      format: 'trailx.trek',
      version: 1,
      exportedAt: new Date().toISOString(),
      trek: {
        id: trek.id,
        name: trek.name,
        startedAt: new Date(trek.startedAt).toISOString(),
        endedAt: trek.endedAt ? new Date(trek.endedAt).toISOString() : null,
        destination: trek.destination,
      },
      stats: trek.stats,
      units: { distance: 'm', speed: 'm/s', altitude: 'm (GPS, above ellipsoid or MSL depending on device)', accuracy: 'm' },
      waypoints,
      points: points.map((p) => ({
        seq: p.seq, seg: p.seg, lat: p.lat, lon: p.lon, time: new Date(p.t).toISOString(),
        accuracy: p.acc, altitude: p.alt, altitudeAccuracy: p.altAcc, speed: p.speed, course: p.course,
        distFromPrev: p.dist, gap: p.gap,
      })),
      ...extra,
    },
    null,
    2,
  );
}

export function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_ ]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'trek';
}
