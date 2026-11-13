import { destination, haversine } from '@/core/geo';
import { buildTrekGeoJSON, circlePolygon } from '@/core/mapGeo';
import { bboxAround, bboxContains, boundsOf, countTiles, lonLatToTile, MAX_TILE_ZOOM, OFM_LIMITS, planArea, tilesIn } from '@/core/tiles';
import { addMapArea, coveringArea, deleteMapArea, listMapAreas, updateMapArea } from '@/db/repo';
import { migrate } from '@/db/schema';
import { ORIGIN } from './helpers';
import { openNodeDb } from './nodeDb';

describe('tile maths', () => {
  it('matches the standard slippy-map tile numbers', () => {
    expect(lonLatToTile(0, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(lonLatToTile(0, 0, 1)).toEqual({ x: 1, y: 1 });
    // Bengaluru at z14 (cross-checked with Python asinh formula)
    expect(lonLatToTile(77.5946, 12.9716, 14)).toEqual({ x: 11723, y: 7596 });
    expect(lonLatToTile(-180, 85.06, 3)).toEqual({ x: 0, y: 0 });
  });

  it('counts exactly the tiles it lists', () => {
    const b = bboxAround(ORIGIN.lat, ORIGIN.lon, 3000);
    expect([...tilesIn(b, 8, 14)].length).toBe(countTiles(b, 8, 14));
  });

  it('builds a box of the requested radius', () => {
    const b = bboxAround(ORIGIN.lat, ORIGIN.lon, 5000);
    expect(haversine({ lat: b[1], lon: ORIGIN.lon }, { lat: b[3], lon: ORIGIN.lon })).toBeCloseTo(10_000, -1);
    expect(bboxContains(b, ORIGIN.lat, ORIGIN.lon)).toBe(true);
    expect(bboxContains(b, destination(ORIGIN, 0, 6000).lat, ORIGIN.lon)).toBe(false);
  });

  it('plans a 5 km trek area within OpenFreeMap’s offline limit, at full detail', () => {
    const p = planArea(ORIGIN.lat, ORIGIN.lon, 5000)!;
    expect(p.maxZoom).toBe(MAX_TILE_ZOOM);
    expect(p.tileCount).toBeLessThanOrEqual(OFM_LIMITS.maxTiles);
    expect(p.radiusM).toBe(5000);
  });

  it('shrinks an oversized area instead of exceeding the limit', () => {
    const p = planArea(ORIGIN.lat, ORIGIN.lon, 200_000)!;
    expect(p.tileCount).toBeLessThanOrEqual(OFM_LIMITS.maxTiles);
    expect(p.radiusM).toBeLessThan(200_000);
  });

  it('pads trail bounds', () => {
    const b = boundsOf([ORIGIN, destination(ORIGIN, 90, 1000)], 100)!;
    expect(b[0]).toBeLessThan(ORIGIN.lon);
    expect(boundsOf([])).toBeNull();
  });
});

describe('trek GeoJSON for the map', () => {
  const a = { ...ORIGIN, seg: 0, gap: false };
  const b = { ...destination(ORIGIN, 0, 50), seg: 0, gap: false };
  const c = { ...destination(ORIGIN, 0, 400), seg: 0, gap: true }; // reached after a GPS outage
  const d = { ...destination(ORIGIN, 0, 450), seg: 0, gap: false };
  const e = { ...destination(ORIGIN, 90, 100), seg: 1, gap: false }; // after a pause
  const f = { ...destination(ORIGIN, 90, 150), seg: 1, gap: false };

  it('draws only recorded points: measured lines, estimated gaps dashed, segments split', () => {
    const g = buildTrekGeoJSON({ trail: [a, b, c, d, e, f] });
    const kinds = g.features.map((x) => x.properties.kind);
    expect(kinds.filter((k) => k === 'trail')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'gap')).toHaveLength(1);
    const gap = g.features.find((x) => x.properties.kind === 'gap')!;
    expect(gap.geometry.coordinates).toEqual([[b.lon, b.lat], [c.lon, c.lat]]);
    // No line joins the two pause-separated segments.
    const lines = g.features.filter((x) => x.geometry.type === 'LineString').map((x) => JSON.stringify(x.geometry.coordinates));
    expect(lines.some((l) => l.includes(String(d.lon)) && l.includes(String(e.lon)))).toBe(false);
  });

  it('adds start, waypoints with names, position and an accuracy circle of the right size', () => {
    const g = buildTrekGeoJSON({ trail: [a, b], start: ORIGIN, waypoints: [{ ...b, name: 'Waterfall' }], current: { ...b, acc: 25 }, stale: true });
    expect(g.features.find((x) => x.properties.kind === 'waypoint')?.properties.name).toBe('Waterfall');
    expect(g.features.find((x) => x.properties.kind === 'position')?.properties.stale).toBe(true);
    const ring = circlePolygon(b, 25);
    expect(haversine(b, { lat: ring[10][1], lon: ring[10][0] })).toBeCloseTo(25, 0);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('omits the accuracy circle when accuracy is unknown', () => {
    const g = buildTrekGeoJSON({ trail: [], current: { ...ORIGIN, acc: null } });
    expect(g.features.map((x) => x.properties.kind)).toEqual(['position']);
  });
});

describe('offline map areas (real SQLite)', () => {
  it('records, completes, finds and deletes areas; interrupted downloads become failed', async () => {
    const db = openNodeDb();
    await migrate(db, 1);
    const p = planArea(ORIGIN.lat, ORIGIN.lon, 5000)!;
    const id = await addMapArea(db, { name: 'Start', bbox: p.bbox, minZoom: p.minZoom, maxZoom: p.maxZoom, tileCount: p.tileCount, sessionId: null, now: 1 });
    expect(coveringArea(await listMapAreas(db), ORIGIN.lat, ORIGIN.lon)).toBeNull(); // still downloading
    await updateMapArea(db, id, { status: 'complete', bytes: 1234, packId: 'pack-1', now: 2 });
    const areas = await listMapAreas(db);
    expect(coveringArea(areas, ORIGIN.lat, ORIGIN.lon)).toMatchObject({ id, bytes: 1234, packId: 'pack-1', status: 'complete' });
    const far = destination(ORIGIN, 45, 20_000);
    expect(coveringArea(areas, far.lat, far.lon)).toBeNull();

    const id2 = await addMapArea(db, { name: 'Half', bbox: p.bbox, minZoom: 6, maxZoom: 14, tileCount: 1, sessionId: null, now: 3 });
    await migrate(db, 4); // next app launch
    expect((await listMapAreas(db)).find((x) => x.id === id2)).toMatchObject({ status: 'failed', error: expect.stringMatching(/Interrupted/) });

    await deleteMapArea(db, id);
    expect((await listMapAreas(db)).map((x) => x.id)).toEqual([id2]);
  });
});
