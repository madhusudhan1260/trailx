import { destination, haversine } from '@/core/geo';
import { buildRoute, initialNav, reversedWaypoints, takeShortcut, updateNav, type NavInternal, type NavState } from '@/core/reverseNav';
import type { LatLon } from '@/core/types';
import { ORIGIN, record, walk } from './helpers';

/** A → B → C → D → E: north 400 m, east 300 m, north 200 m, east 200 m. */
const LEGS: [number, number][] = [[0, 400], [90, 300], [0, 200], [90, 200]];
const trail = record(walk(ORIGIN, LEGS)).points;
const route = buildRoute(trail);

function follow(positions: LatLon[], nav: NavInternal = initialNav(), acc = 6) {
  const states: NavState[] = [];
  for (const p of positions) {
    const r = updateNav(route, nav, p, acc, 1.2);
    nav = r.nav;
    states.push(r.state);
  }
  return { nav, states };
}

describe('route reversal', () => {
  it('reverses the waypoint order exactly: A B C D E → E D C B A', () => {
    expect(reversedWaypoints(['A', 'B', 'C', 'D', 'E'])).toEqual(['E', 'D', 'C', 'B', 'A']);
    const rev = reversedWaypoints(trail);
    expect(rev[0]).toBe(trail[trail.length - 1]);
    expect(rev[rev.length - 1]).toBe(trail[0]);
    expect(rev.map((p) => p.seq)).toEqual(trail.map((p) => p.seq).reverse());
  });

  it('builds a route whose length equals the recorded distance', () => {
    expect(route.length).toBeGreaterThan(1095);
    expect(route.length).toBeLessThan(1105);
  });
});

describe('return navigation', () => {
  it('starts at the end of the trail with the full distance remaining', () => {
    const end = trail[trail.length - 1];
    const { states } = follow([end]);
    expect(states[0].status).toBe('on_route');
    expect(states[0].remaining).toBeCloseTo(route.length, -1);
    // first instruction heads back west along the last leg
    expect(states[0].bearingToTarget).toBeGreaterThan(265);
    expect(states[0].bearingToTarget).toBeLessThan(275);
  });

  it('walking the trail backwards visits breadcrumbs in descending order and arrives', () => {
    const back = reversedWaypoints(trail);
    const { states } = follow(back);
    for (let i = 1; i < states.length; i++) {
      expect(states[i].remaining).toBeLessThanOrEqual(states[i - 1].remaining + 0.01);
      expect(states[i].nextIndex).toBeLessThanOrEqual(states[i - 1].nextIndex);
    }
    expect(states.every((s) => s.status !== 'off_route')).toBe(true);
    const last = states[states.length - 1];
    expect(last.status).toBe('arrived');
    expect(last.remaining).toBe(0);
  });

  it('guides around the corners instead of cutting straight to the start', () => {
    // At the end, the start is to the south-west, but guidance must follow the trail (west).
    const end = trail[trail.length - 1];
    const s = follow([end]).states[0];
    expect(s.bearingToStart).toBeGreaterThan(210);
    expect(s.bearingToStart).toBeLessThan(230);
    expect(Math.abs(s.bearingToTarget - s.bearingToStart)).toBeGreaterThan(30);
    expect(s.remaining).toBeGreaterThan(s.distanceToStart + 250);
  });

  it('tolerates GPS noise near the trail without declaring a deviation', () => {
    const back = reversedWaypoints(trail).map((p, i) => destination(p, (i * 97) % 360, 12));
    const { states } = follow(back, initialNav(), 10);
    expect(states.filter((s) => s.status === 'off_route')).toHaveLength(0);
  });

  it('detects a deviation, points back to the trail, then recovers', () => {
    const back = reversedWaypoints(trail);
    const onTrail = back.slice(0, 10);
    const here = onTrail[onTrail.length - 1];
    // wander 150 m north of the east-west leg
    const astray = [40, 80, 120, 150, 150].map((d) => destination(here, 0, d));
    const { nav, states } = follow([...onTrail, ...astray]);
    const lost = states[states.length - 1];
    expect(lost.status).toBe('off_route');
    expect(lost.offBy).toBeGreaterThan(140);
    // rejoin point is back south, on the trail
    expect(lost.bearingToTarget).toBeGreaterThan(150);
    expect(lost.bearingToTarget).toBeLessThan(210);
    expect(lost.distanceToTarget).toBeCloseTo(lost.offBy, 0);
    expect(haversine(lost.target, here)).toBeLessThan(40);

    const recovered = follow([destination(here, 0, 60), destination(here, 0, 10), here], nav);
    expect(recovered.states[recovered.states.length - 1].status).toBe('on_route');
  });

  it('a single stray fix does not trigger the off-route warning', () => {
    const back = reversedWaypoints(trail).slice(0, 8);
    const stray = destination(back[7], 0, 120);
    const { states } = follow([...back, stray, back[7]]);
    expect(states.every((s) => s.status === 'on_route')).toBe(true);
  });

  it('does not report arrival just because the start is nearby in a straight line', () => {
    // Out-and-back style trail that returns close to the start: A → north 300 → east 30 → south 290.
    const loop = record(walk(ORIGIN, [[0, 300], [90, 30], [180, 290]])).points;
    const r = buildRoute(loop);
    const end = loop[loop.length - 1];
    expect(haversine(end, ORIGIN)).toBeLessThan(35);
    const { state } = updateNav(r, initialNav(), end, 6, 1.2);
    expect(state.status).toBe('on_route');
    expect(state.remaining).toBeGreaterThan(600);
    expect(state.shortcutAvailable).toBe(true);
    // ...and the user may explicitly choose the shortcut
    const first = updateNav(r, initialNav(), end, 6, 1.2);
    const short = updateNav(r, takeShortcut(r, first.nav, end, 6), end, 6, 1.2).state;
    expect(short.remaining).toBeLessThan(60);
  });

  it('warns about a stretch that was never recorded (signal gap / pause)', () => {
    const withGap = trail.map((p, i) => (i === 30 ? { ...p, gap: true } : p));
    const r = buildRoute(withGap);
    const at = withGap[36];
    const s = updateNav(r, initialNav(), at, 6, 1.2).state;
    expect(s.unverifiedAhead).not.toBeNull();
    expect(s.progress).toBeCloseTo(360, 0);
    expect(s.unverifiedAhead!.inMetres).toBeCloseTo(60, 0);
    expect(s.unverifiedAhead!.length).toBeCloseTo(10, 0);
  });

  it('handles a one-point trail (trek finished where it started)', () => {
    const r = buildRoute([trail[0]]);
    const s = updateNav(r, initialNav(), destination(ORIGIN, 90, 80), 6, 1.2).state;
    expect(s.distanceToStart).toBeCloseTo(80, 0);
    expect(s.bearingToTarget).toBeCloseTo(270, 0);
    expect(updateNav(r, initialNav(), ORIGIN, 6, 1.2).state.status).toBe('arrived');
  });

  it('ETA is remaining distance over the given speed, and null without a speed', () => {
    const end = trail[trail.length - 1];
    const s = updateNav(route, initialNav(), end, 6, 1.0).state;
    expect(s.etaMs! / 1000).toBeCloseTo(s.remaining, 0);
    expect(updateNav(route, initialNav(), end, 6, null).state.etaMs).toBeNull();
  });
});
