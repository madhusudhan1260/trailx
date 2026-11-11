import { safeFileName, toGPX, toJSON } from '@/core/exporter';
import { openNewSegment } from '@/core/filter';
import { computeStats } from '@/core/stats';
import { destination } from '@/core/geo';
import { ORIGIN, record, walk } from './helpers';

const a = record(walk(ORIGIN, [[0, 100]]));
const b = record(walk(destination(ORIGIN, 0, 400), [[90, 50]], 10, 1_700_000_900_000), openNewSegment(a.state));
const points = [...a.points, ...b.points];
const trek = { id: 3, name: 'Ridge <loop> & back', startedAt: points[0].t, endedAt: points[points.length - 1].t, destination: null, stats: computeStats(points, points[0].t, points[points.length - 1].t, 0) };

describe('export', () => {
  it('GPX has one trkseg per recording segment and every point', () => {
    const gpx = toGPX(trek, points, [{ name: 'Water', lat: 12.97, lon: 77.59, alt: null, t: points[0].t, note: null }]);
    expect(gpx.match(/<trkseg>/g)).toHaveLength(2);
    expect(gpx.match(/<trkpt /g)).toHaveLength(points.length);
    expect(gpx).toContain('<wpt lat="12.9700000" lon="77.5900000">');
    expect(gpx).toContain('Ridge &lt;loop&gt; &amp; back');
    expect(gpx).toContain(`lat="${points[0].lat.toFixed(7)}"`);
  });
  it('JSON round-trips coordinates and stats losslessly', () => {
    const j = JSON.parse(toJSON(trek, points));
    expect(j.points).toHaveLength(points.length);
    expect(j.points[5].lat).toBe(points[5].lat);
    expect(j.stats.distance).toBe(trek.stats.distance);
    expect(j.points[a.points.length].seg).toBe(1);
  });
  it('file names are filesystem safe', () => {
    expect(safeFileName('Ridge <loop> & back/2')).toBe('Ridge-loop-back2');
    expect(safeFileName('///')).toBe('trek');
  });
});
