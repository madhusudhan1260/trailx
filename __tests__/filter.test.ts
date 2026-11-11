import { destination, haversine } from '@/core/geo';
import { FILTER_PRESETS, filterFix, initialFilterState, openNewSegment } from '@/core/filter';
import { computeStats } from '@/core/stats';
import { fix, ORIGIN, record, walk } from './helpers';

const T0 = 1_700_000_000_000;
const cfg = FILTER_PRESETS.balanced;

describe('GPS filter', () => {
  it('records a straight 1 km walk as ~1 km', () => {
    const { points } = record(walk(ORIGIN, [[45, 1000]]));
    const s = computeStats(points, T0, points[points.length - 1].t, 0);
    expect(s.distance).toBeGreaterThan(995);
    expect(s.distance).toBeLessThan(1005);
    expect(s.estimatedDistance).toBe(0);
  });

  it('rejects fixes with no or poor accuracy', () => {
    let s = initialFilterState();
    expect(filterFix(s, fix(ORIGIN, T0, null), cfg).result).toEqual({ accepted: false, reason: 'no_accuracy' });
    expect(filterFix(s, fix(ORIGIN, T0, 120), cfg).result).toEqual({ accepted: false, reason: 'poor_accuracy' });
    s = filterFix(s, fix(ORIGIN, T0, 8), cfg).state;
    expect(s.last).not.toBeNull();
  });

  it('adds no distance while standing still with drifting fixes', () => {
    // 20 minutes stationary; every fix wanders up to 6 m in a random direction with 12 m accuracy.
    const fixes = [fix(ORIGIN, T0, 12)];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 1; i <= 240; i++) fixes.push(fix(destination(ORIGIN, rnd() * 360, rnd() * 6), T0 + i * 5000, 12));
    const { points, reasons } = record(fixes);
    expect(points).toHaveLength(1);
    expect(computeStats(points, T0, T0 + 1_200_000, 0).distance).toBe(0);
    expect(reasons.every((r) => r === 'stationary' || r === 'duplicate')).toBe(true);
  });

  it('drops duplicates and out-of-order fixes', () => {
    const a = fix(ORIGIN, T0);
    const b = fix(destination(ORIGIN, 0, 20), T0 + 15000);
    const { points, reasons } = record([a, b, { ...b }, { ...a, t: T0 + 1000 }, fix(b, T0 + 20000)]);
    expect(points).toHaveLength(2);
    expect(reasons).toEqual(['out_of_order', 'out_of_order', 'duplicate']);
  });

  it('ignores a single teleporting fix', () => {
    const fixes = walk(ORIGIN, [[90, 100]]);
    const last = fixes[fixes.length - 1];
    const spike = fix(destination(last, 0, 800), last.t + 5000);
    const next = fix(destination(last, 90, 10), last.t + 10000);
    const { points, reasons } = record([...fixes, spike, next]);
    expect(reasons).toContain('jump');
    const d = computeStats(points, T0, next.t, 0).distance;
    expect(d).toBeGreaterThan(105);
    expect(d).toBeLessThan(115);
  });

  it('accepts a persistent relocation, but labels the bridged distance as estimated', () => {
    const fixes = walk(ORIGIN, [[90, 50]]);
    const last = fixes[fixes.length - 1];
    const far = destination(last, 0, 600);
    const extra = [0, 1, 2].map((i) => fix(destination(far, 0, i * 6), last.t + 5000 * (i + 1)));
    const { points } = record([...fixes, ...extra]);
    const p = points[points.length - 1];
    expect(p.gap).toBe(true);
    const s = computeStats(points, T0, p.t, 0);
    expect(s.estimatedDistance).toBeGreaterThan(590);
    expect(s.gapCount).toBe(1);
  });

  it('flags signal loss: the first point after a long silence is a gap', () => {
    const a = walk(ORIGIN, [[0, 100]]);
    const last = a[a.length - 1];
    // 5 minutes with nothing usable (only bad fixes), 300 m further on.
    const bad = fix(destination(last, 0, 150), last.t + 150_000, 400);
    const after = fix(destination(last, 0, 300), last.t + 300_000, 8);
    const { points, reasons } = record([...a, bad, after]);
    expect(reasons).toContain('poor_accuracy');
    expect(points[points.length - 1].gap).toBe(true);
    const s = computeStats(points, T0, after.t, 0);
    expect(s.distance).toBeCloseTo(400, -1);
    expect(s.estimatedDistance).toBeCloseTo(300, -1);
  });

  it('standing still with good signal and then moving is NOT a gap', () => {
    const fixes = [fix(ORIGIN, T0)];
    for (let i = 1; i <= 60; i++) fixes.push(fix(destination(ORIGIN, 10, 1), T0 + i * 5000));
    fixes.push(fix(destination(ORIGIN, 0, 20), T0 + 61 * 5000));
    const { points } = record(fixes);
    expect(points).toHaveLength(2);
    expect(points[1].gap).toBe(false);
  });

  it('pause/resume: movement while paused adds no distance and starts a new segment', () => {
    const first = record(walk(ORIGIN, [[0, 200]]));
    const end = first.points[first.points.length - 1];
    // user is carried 500 m while paused, then resumes and walks 100 m
    const resumed = openNewSegment(first.state);
    const second = record(walk(destination(end, 90, 500), [[90, 100]], 10, end.t + 600_000), resumed);
    const all = [...first.points, ...second.points];
    expect(second.points[0].seg).toBe(1);
    expect(second.points[0].dist).toBe(0);
    const s = computeStats(all, T0, all[all.length - 1].t, 600_000);
    expect(s.distance).toBeGreaterThan(295);
    expect(s.distance).toBeLessThan(305);
    expect(haversine(end, second.points[0])).toBeGreaterThan(490);
  });

  it('filter state survives a JSON round trip (app restart mid-trek)', () => {
    const fixes = walk(ORIGIN, [[0, 300]]);
    const whole = record(fixes);
    const half = record(fixes.slice(0, 15));
    const restored = JSON.parse(JSON.stringify(half.state));
    const rest = record(fixes.slice(15), restored);
    expect([...half.points, ...rest.points]).toEqual(whole.points);
  });
});

describe('statistics', () => {
  it('computes moving time, average and max speed', () => {
    const { points } = record(walk(ORIGIN, [[0, 600]]));
    const end = points[points.length - 1].t;
    const s = computeStats(points, T0, end + 300_000, 120_000);
    expect(s.avgSpeed).toBeCloseTo(1.2, 1);
    expect(s.maxSpeed).toBeCloseTo(1.2, 1);
    expect(s.movingMs).toBeCloseTo(500_000, -4);
    expect(s.activeMs).toBe(s.elapsedMs - 120_000);
  });

  it('elevation: counts a real climb, ignores jitter, reports null without altitude', () => {
    const flat = record(walk(ORIGIN, [[0, 300]]));
    expect(computeStats(flat.points, T0, T0 + 1, 0).elevationGain).toBeNull();

    const fixes = walk(ORIGIN, [[0, 1000]]);
    // climb 100 m over the first half, descend 40 m over the second, with ±1.5 m noise
    const climb = fixes.map((f, i) => {
      const frac = i / (fixes.length - 1);
      const base = frac < 0.5 ? 900 + 200 * frac : 1000 - 80 * (frac - 0.5);
      return { ...f, alt: base + (i % 2 ? 1.5 : -1.5), altAcc: 6 };
    });
    const s = computeStats(record(climb).points, T0, T0 + 1, 0);
    expect(s.elevationGain!).toBeGreaterThan(85);
    expect(s.elevationGain!).toBeLessThan(110);
    expect(s.elevationLoss!).toBeGreaterThan(28);
    expect(s.elevationLoss!).toBeLessThan(48);
    expect(s.maxAltitude!).toBeGreaterThan(990);

    const jitter = fixes.map((f, i) => ({ ...f, alt: 500 + (i % 2 ? 2 : -2), altAcc: 6 }));
    expect(computeStats(record(jitter).points, T0, T0 + 1, 0).elevationGain).toBe(0);
  });

  it('ignores altitude readings with poor vertical accuracy', () => {
    const fixes = walk(ORIGIN, [[0, 200]]).map((f, i) => ({ ...f, alt: 100 + i * 30, altAcc: 80 }));
    const s = computeStats(record(fixes).points, T0, T0 + 1, 0);
    expect(s.elevationGain).toBeNull();
    expect(s.altitudeCoverage).toBe(0);
  });
});
