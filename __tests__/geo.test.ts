import { angleDiff, bearing, destination, fromLocal, haversine, simplifyIndices, toLocal } from '@/core/geo';
import { ORIGIN } from './helpers';

describe('distance', () => {
  it('matches a published great-circle distance (London → Paris ≈ 343.6 km)', () => {
    const d = haversine({ lat: 51.5074, lon: -0.1278 }, { lat: 48.8566, lon: 2.3522 });
    expect(d / 1000).toBeGreaterThan(343);
    expect(d / 1000).toBeLessThan(344.5);
  });
  it('one degree of latitude is ~111.2 km', () => {
    expect(haversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111195, -2);
  });
  it('is zero for identical points and symmetric', () => {
    const b = destination(ORIGIN, 70, 500);
    expect(haversine(ORIGIN, ORIGIN)).toBe(0);
    expect(haversine(ORIGIN, b)).toBeCloseTo(haversine(b, ORIGIN), 9);
  });
  it('destination + haversine round-trip within a centimetre', () => {
    for (const brg of [0, 45, 133, 270]) expect(haversine(ORIGIN, destination(ORIGIN, brg, 1234))).toBeCloseTo(1234, 1);
  });
});

describe('bearing', () => {
  it('points along cardinal directions', () => {
    expect(bearing(ORIGIN, destination(ORIGIN, 0, 100))).toBeCloseTo(0, 1);
    expect(bearing(ORIGIN, destination(ORIGIN, 90, 100))).toBeCloseTo(90, 1);
    expect(bearing(ORIGIN, destination(ORIGIN, 225, 100))).toBeCloseTo(225, 1);
  });
  it('angleDiff takes the short way round', () => {
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(-20);
    expect(angleDiff(0, 180)).toBe(180);
  });
});

describe('local projection', () => {
  it('agrees with haversine to <0.1% over 5 km and round-trips', () => {
    const p = destination(ORIGIN, 37, 5000);
    const xy = toLocal(ORIGIN, p);
    expect(Math.abs(Math.hypot(xy.x, xy.y) - 5000)).toBeLessThan(5);
    const back = fromLocal(ORIGIN, xy);
    expect(haversine(back, p)).toBeLessThan(0.01);
  });
  it('simplify keeps corners and drops collinear points', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0.1 }, { x: 20, y: 0 }, { x: 20, y: 30 }];
    expect(simplifyIndices(pts, 1)).toEqual([0, 2, 3]);
  });
});
