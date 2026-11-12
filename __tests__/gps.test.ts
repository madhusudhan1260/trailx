import { destination } from '@/core/geo';
import { FILTER_PRESETS, filterFix, initialFilterState } from '@/core/filter';
import { gpsMessage, initialGpsMachine, reduceGps, type GpsEvent, type GpsMachine } from '@/core/gpsMachine';
import { migrate } from '@/db/schema';
import { TrekRecorder } from '@/services/recorder';
import { chooseGpsBackend, classifyGeoError, positionToFix, WebGps, WEB_GPS_DEFAULTS, type GeoErrorLike, type GeoPositionLike, type GeolocationLike } from '@/services/webGps';
import { gpsStatus } from '@/store';
import { ORIGIN } from './helpers';
import { openNodeDb } from './nodeDb';

/** Test double for navigator.geolocation. Positions are pushed by the test — nothing is invented by the app. */
class FakeGeolocation implements GeolocationLike {
  watches = new Map<number, { ok: (p: GeoPositionLike) => void; err?: (e: GeoErrorLike) => void; opts?: PositionOptions }>();
  pending: { ok: (p: GeoPositionLike) => void; err?: (e: GeoErrorLike) => void; opts?: PositionOptions }[] = [];
  cleared: number[] = [];
  private next = 1;
  getCurrentPosition(ok: (p: GeoPositionLike) => void, err?: (e: GeoErrorLike) => void, opts?: PositionOptions) { this.pending.push({ ok, err, opts }); }
  watchPosition(ok: (p: GeoPositionLike) => void, err?: (e: GeoErrorLike) => void, opts?: PositionOptions) { const id = this.next++; this.watches.set(id, { ok, err, opts }); return id; }
  clearWatch(id: number) { this.cleared.push(id); this.watches.delete(id); }
  emit(p: GeoPositionLike) { for (const w of [...this.watches.values()]) w.ok(p); }
  emitError(code: number) { for (const w of [...this.watches.values()]) w.err?.({ code, message: `code ${code}` }); }
  resolveCurrent(p: GeoPositionLike) { const q = this.pending.splice(0); q.forEach((r) => r.ok(p)); }
  rejectCurrent(code: number) { const q = this.pending.splice(0); q.forEach((r) => r.err?.({ code, message: `code ${code}` })); }
}

const pos = (t: number, acc = 5, metresNorth = 0): GeoPositionLike => {
  const p = destination(ORIGIN, 0, metresNorth);
  return { coords: { latitude: p.lat, longitude: p.lon, accuracy: acc, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: t };
};

/** Wires a WebGps to the state machine exactly as tracking.ts does. */
function rig(opts: { secure?: boolean; geo?: FakeGeolocation | null } = {}) {
  const geo = opts.geo === undefined ? new FakeGeolocation() : opts.geo;
  let m: GpsMachine = initialGpsMachine();
  const fixes: GeoPositionLike[] = [];
  const dispatch = (e: GpsEvent) => (m = reduceGps(m, e));
  const gps = new WebGps(
    { geolocation: () => geo ?? undefined, secure: () => opts.secure ?? true },
    {
      onFix: (p) => { fixes.push(p); dispatch({ type: 'FIX', now: Date.now(), acc: p.coords.accuracy }); },
      onError: (kind, code, message) => dispatch({ type: 'ERROR', now: Date.now(), kind, code, message }),
    },
  );
  return { geo: geo!, gps, fixes, dispatch, get m() { return m; } };
}

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(1_700_000_000_000); });
afterEach(() => jest.useRealTimers());

describe('browser GPS acquisition', () => {
  it('1. acquires a genuine fix: permission request → acquiring → GPS Ready', async () => {
    const r = rig();
    r.dispatch({ type: 'REQUEST_PERMISSION', now: Date.now() });
    expect(gpsMessage(r.m)).toBe('Acquiring GPS signal…');
    const p = r.gps.requestPermission();
    expect(r.geo.pending[0].opts).toMatchObject({ enableHighAccuracy: true, maximumAge: 0, timeout: WEB_GPS_DEFAULTS.timeoutMs });
    r.geo.resolveCurrent(pos(Date.now(), 6));
    await expect(p).resolves.toBe('granted');
    expect(r.m.phase).toBe('gps_ready');
    expect(gpsMessage(r.m)).toBe('GPS Ready');
    expect(r.fixes).toHaveLength(1);
  });

  it('2. permission denied → error state, "Enable location permission", watcher torn down', async () => {
    const r = rig();
    const p = r.gps.requestPermission();
    r.geo.rejectCurrent(1);
    await expect(p).resolves.toBe('denied');
    expect(r.m.phase).toBe('error');
    expect(gpsMessage(r.m)).toBe('Enable location permission');
    // A denial arriving on the watch also stops it — no zombie watcher.
    r.gps.start();
    r.geo.emitError(1);
    expect(r.gps.active).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
    expect(gpsStatus({ permission: 'unknown', servicesEnabled: true, fix: null, fixAt: null, geo: r.m }, Date.now())).toBe('no_permission');
  });

  it('3. a timeout before the first fix keeps searching — it is never reported as lost', async () => {
    const r = rig();
    const p = r.gps.requestPermission();
    r.geo.rejectCurrent(3);
    await expect(p).resolves.toBe('granted'); // permission was not refused; the fix is just slow
    expect(r.m.phase).toBe('acquiring_fix');
    expect(gpsMessage(r.m)).toBe('Searching for satellites…');
    // Ten minutes of waiting is still "searching", not "lost".
    r.dispatch({ type: 'TICK', now: Date.now() + 600_000 });
    expect(r.m.phase).toBe('acquiring_fix');
    expect(gpsStatus({ permission: 'granted', servicesEnabled: true, fix: null, fixAt: null, geo: r.m }, Date.now() + 600_000)).toBe('acquiring');
  });

  it('4. position unavailable is temporary: searching before a fix, reacquiring after one', () => {
    const r = rig();
    r.gps.start();
    r.geo.emitError(2);
    expect(r.m.phase).toBe('acquiring_fix');
    expect(r.m.lastError?.kind).toBe('unavailable');
    expect(r.gps.active).toBe(true); // keeps trying
    r.geo.emit(pos(Date.now()));
    r.geo.emitError(2);
    expect(r.m.phase).toBe('gps_lost');
    expect(gpsMessage(r.m)).toBe('Reacquiring GPS…');
  });

  it('5. poor accuracy is shown as weak and is not laid down as a breadcrumb', () => {
    const r = rig();
    r.gps.start();
    r.geo.emit(pos(Date.now(), 85));
    expect(r.m.phase).toBe('gps_weak');
    expect(gpsMessage(r.m)).toBe('GPS accuracy is weak');
    expect(gpsStatus({ permission: 'granted', servicesEnabled: true, fix: positionToFix(r.fixes[0]), fixAt: Date.now(), geo: r.m }, Date.now())).toBe('poor');
    // The existing anti-drift filter still rejects it — the browser path does not bypass it.
    const first = filterFix(initialFilterState(), positionToFix(pos(Date.now(), 5)), FILTER_PRESETS.balanced);
    const bad = filterFix(first.state, positionToFix(pos(Date.now() + 5000, 85, 30)), FILTER_PRESETS.balanced);
    expect(bad.result.accepted).toBe(false);
  });

  it('6. a temporary interruption probes, then restarts the watch, and reads as reacquiring', () => {
    const r = rig();
    r.gps.start();
    r.geo.emit(pos(Date.now()));
    expect(r.m.phase).toBe('gps_ready');
    jest.advanceTimersByTime(WEB_GPS_DEFAULTS.probeAfterMs + WEB_GPS_DEFAULTS.heartbeatMs);
    expect(r.gps.stats.probes).toBe(1);
    expect(r.geo.pending[0].opts).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 });
    jest.advanceTimersByTime(WEB_GPS_DEFAULTS.restartAfterMs);
    expect(r.gps.stats.restarts).toBe(1);
    expect(r.geo.watches.size).toBe(1); // replaced, not duplicated
    r.dispatch({ type: 'TICK', now: Date.now() });
    expect(r.m.phase).toBe('gps_lost');
    // The fresh watch gets a full grace period instead of being replaced every heartbeat.
    jest.advanceTimersByTime(WEB_GPS_DEFAULTS.heartbeatMs * 2);
    expect(r.gps.stats.restarts).toBe(1);
  });

  it('7. recovers from lost as soon as a fix arrives (from the watch or a probe)', () => {
    const r = rig();
    r.gps.start();
    r.dispatch({ type: 'TRACKING_START', now: Date.now() });
    r.geo.emit(pos(Date.now()));
    expect(r.m.phase).toBe('tracking');
    jest.advanceTimersByTime(35_000);
    r.dispatch({ type: 'TICK', now: Date.now() });
    expect(r.m.phase).toBe('gps_lost');
    r.geo.resolveCurrent(pos(Date.now(), 7, 20)); // the heartbeat probe answers
    expect(r.m.phase).toBe('tracking');
    // Same reading reported again by the watch is not double-counted.
    r.geo.emit(pos(r.fixes[r.fixes.length - 1].timestamp, 7, 20));
    expect(r.fixes).toHaveLength(2);
  });

  it('8. repeated START presses never create a second watcher', () => {
    const r = rig();
    expect(r.gps.start()).toBe(true);
    expect(r.gps.start()).toBe(false);
    expect(r.gps.start()).toBe(false);
    expect(r.geo.watches.size).toBe(1);
    expect(jest.getTimerCount()).toBe(1);
  });

  it('8b. concurrent trek starts record exactly one trek', async () => {
    jest.useRealTimers();
    const db = openNodeDb();
    await migrate(db, Date.now());
    const rec = new TrekRecorder(db);
    const opts = { name: 'x', startFix: positionToFix(pos(Date.now())), mode: 'balanced' as const, trackingMode: 'foreground' as const, now: Date.now() };
    const results = await Promise.allSettled([rec.start(opts), rec.start(opts), rec.start(opts)]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((await db.all("SELECT id FROM trek_sessions WHERE status = 'recording'")).length).toBe(1);
  });

  it('9. STOP clears the watch and heartbeat, and ignores late callbacks', () => {
    const r = rig();
    r.gps.start();
    r.dispatch({ type: 'TRACKING_START', now: Date.now() });
    r.geo.emit(pos(Date.now()));
    jest.advanceTimersByTime(16_000); // a probe is now in flight
    const late = r.geo.pending.splice(0);
    const watchCb = [...r.geo.watches.values()][0].ok;
    r.gps.stop();
    r.dispatch({ type: 'TRACKING_STOP', now: Date.now() });
    expect(r.gps.active).toBe(false);
    expect(r.geo.cleared).toEqual([1]);
    expect(jest.getTimerCount()).toBe(0);
    late.forEach((q) => q.ok(pos(Date.now() + 1)));
    watchCb(pos(Date.now() + 2));
    expect(r.fixes).toHaveLength(1);
    expect(r.m.tracking).toBe(false);
    expect(r.m.phase).toBe('gps_ready');
  });
});

describe('10. platform separation and support checks', () => {
  it('web uses the browser API; iOS and Android keep Expo Location', () => {
    expect(chooseGpsBackend('web')).toBe('browser');
    expect(chooseGpsBackend('ios')).toBe('expo-location');
    expect(chooseGpsBackend('android')).toBe('expo-location');
  });

  it('constructing the adapter touches no browser API until it is started', () => {
    const geolocation = jest.fn(() => undefined);
    new WebGps({ geolocation, secure: () => true }, { onFix: jest.fn(), onError: jest.fn() });
    expect(geolocation).not.toHaveBeenCalled();
  });

  it('reports an unsupported browser and an insecure (http://) page instead of searching forever', async () => {
    const none = rig({ geo: null });
    expect(none.gps.start()).toBe(false);
    expect(gpsMessage(none.m)).toBe('GPS is not supported here');
    const http = rig({ secure: false });
    await expect(http.gps.requestPermission()).resolves.toBe('insecure');
    expect(http.m.phase).toBe('error');
    expect(gpsStatus({ permission: 'unknown', servicesEnabled: null, fix: null, fixAt: null, geo: http.m }, Date.now())).toBe('unsupported');
    expect(classifyGeoError({ code: 1 }, false)).toBe('insecure');
  });
});

describe('browser fixes feed the existing recording engine', () => {
  it('records real breadcrumbs through TrekRecorder', async () => {
    jest.useRealTimers();
    const db = openNodeDb();
    await migrate(db, Date.now());
    const rec = new TrekRecorder(db);
    const t0 = Date.now();
    await rec.start({ name: 'web', startFix: positionToFix(pos(t0)), mode: 'balanced', trackingMode: 'foreground', now: t0 });
    const walked = [1, 2, 3, 4].map((i) => positionToFix(pos(t0 + i * 10_000, 5, i * 12)));
    const r = await rec.ingest(walked);
    expect(r!.accepted).toHaveLength(4);
    expect(rec.liveStats(t0 + 40_000)!.distance).toBeGreaterThan(45);
  });
});
