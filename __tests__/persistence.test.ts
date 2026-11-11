import { randomBytes } from 'crypto';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { destination } from '@/core/geo';
import { buildRoute, initialNav, updateNav } from '@/core/reverseNav';
import { computeStats } from '@/core/stats';
import { addContact, attachDraftPlan, getDraftPlan, getPoints, getTrek, listAlerts, listEvents, listTreks, getUser, saveUser, saveDraftPlan, resolveEvent } from '@/db/repo';
import { migrate } from '@/db/schema';
import { applyAlertAction, raiseEmergency } from '@/services/emergencyStore';
import { TrekRecorder } from '@/services/recorder';
import { fix, ORIGIN, walk } from './helpers';
import { openNodeDb } from './nodeDb';

const T0 = 1_700_000_000_000;
const rb = (n: number) => new Uint8Array(randomBytes(n));

async function fresh(path?: string) {
  const db = openNodeDb(path);
  await migrate(db, T0);
  return db;
}

const startOpts = { name: 'Test trek', mode: 'balanced' as const, trackingMode: 'background' as const, now: T0 };

describe('schema', () => {
  it('creates every required table and is idempotent', async () => {
    const db = await fresh();
    await migrate(db, T0);
    const names = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => r.name);
    for (const t of ['users', 'trek_sessions', 'trek_locations', 'trek_statistics', 'emergency_contacts', 'emergency_events', 'emergency_locations', 'pending_alerts', 'safety_plans', 'saved_waypoints', 'trek_notes'])
      expect(names).toContain(t);
    expect((await db.all('SELECT * FROM users')).length).toBe(1);
  });
});

describe('recording persistence', () => {
  it('saves the starting coordinates and timestamp when the trek starts', async () => {
    const db = await fresh();
    const rec = new TrekRecorder(db);
    const t = await rec.start({ ...startOpts, startFix: fix(ORIGIN, T0, 7, 920) });
    const row = await db.first<any>('SELECT * FROM trek_sessions WHERE id = ?', [t.id]);
    expect(row).toMatchObject({ start_lat: ORIGIN.lat, start_lon: ORIGIN.lon, start_acc: 7, start_alt: 920, started_at: T0, status: 'recording' });
    expect(await getPoints(db, t.id)).toHaveLength(1);
  });

  it('writes every accepted breadcrumb with its metadata, in batches', async () => {
    const db = await fresh();
    const rec = new TrekRecorder(db);
    const fixes = walk(ORIGIN, [[0, 500], [90, 200]]).map((f) => ({ ...f, speed: 1.2, course: 0, alt: 900, altAcc: 5 }));
    const t = await rec.start({ ...startOpts, startFix: fixes[0] });
    for (let i = 1; i < fixes.length; i += 7) await rec.ingest(fixes.slice(i, i + 7));
    const pts = await getPoints(db, t.id);
    expect(pts).toHaveLength(fixes.length);
    expect(pts.map((p) => p.seq)).toEqual(pts.map((_, i) => i));
    expect(pts[10]).toMatchObject({ lat: fixes[10].lat, lon: fixes[10].lon, t: fixes[10].t, acc: 5, alt: 900, speed: 1.2, course: 0, gap: false });
    const live = rec.liveStats(fixes[fixes.length - 1].t)!;
    expect(live.distance).toBeCloseTo(700, -1);
  });

  it('survives a process restart mid-trek with nothing lost and no distance distortion', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'trailx-')), 'restart.db');
    const fixes = walk(ORIGIN, [[0, 400], [90, 300]]);
    let db = await fresh(path);
    let rec = new TrekRecorder(db);
    const t = await rec.start({ ...startOpts, startFix: fixes[0] });
    await rec.ingest(fixes.slice(1, 30));
    db.close(); // the OS kills the app

    db = await fresh(path);
    rec = TrekRecorder.restart(db);
    const restored = await rec.current();
    expect(restored).not.toBeNull();
    expect(restored!.id).toBe(t.id);
    expect(restored!.status).toBe('recording');
    expect(restored!.start).toMatchObject(ORIGIN);
    await rec.ingest(fixes.slice(30));
    const done = await rec.finish(fixes[fixes.length - 1].t);
    const pts = await getPoints(db, t.id);
    expect(pts).toHaveLength(fixes.length);
    // identical to stats computed from scratch over the stored points
    const ref = computeStats(pts, T0, fixes[fixes.length - 1].t, 0);
    expect(done!.stats.distance).toBeCloseTo(ref.distance, 6);
    expect(done!.stats.distance).toBeCloseTo(700, -1);
    db.close();
  });

  it('re-delivered fixes after a restart are not recorded twice', async () => {
    const db = await fresh();
    const rec = new TrekRecorder(db);
    const fixes = walk(ORIGIN, [[0, 200]]);
    const t = await rec.start({ ...startOpts, startFix: fixes[0] });
    await rec.ingest(fixes.slice(1));
    const r = await rec.ingest(fixes.slice(5, 15));
    expect(r!.accepted).toHaveLength(0);
    expect(await getPoints(db, t.id)).toHaveLength(fixes.length);
  });

  it('pause stops distance and time; the paused state itself survives a restart', async () => {
    const db = await fresh();
    let rec = new TrekRecorder(db);
    const a = walk(ORIGIN, [[0, 200]]);
    const t = await rec.start({ ...startOpts, startFix: a[0] });
    await rec.ingest(a.slice(1));
    const pauseAt = a[a.length - 1].t + 1000;
    await rec.pause(pauseAt);
    // moves 300 m while paused
    const drift = walk(a[a.length - 1], [[90, 300]], 10, pauseAt + 1000);
    const during = await rec.ingest(drift);
    expect(during!.accepted).toHaveLength(0);
    expect(during!.trek.lastFix!.t).toBe(drift[drift.length - 1].t); // live position still tracked

    rec = TrekRecorder.restart(db);
    expect((await rec.current())!.status).toBe('paused');
    const resumeAt = drift[drift.length - 1].t + 1000;
    await rec.resume(resumeAt);
    const b = walk(drift[drift.length - 1], [[90, 100]], 10, resumeAt + 1000);
    await rec.ingest(b);
    const end = b[b.length - 1].t;
    const done = await rec.finish(end);
    expect(done!.stats.distance).toBeGreaterThan(290);
    expect(done!.stats.distance).toBeLessThan(310);
    expect(done!.stats.activeMs).toBe(end - T0 - (resumeAt - pauseAt));
    const pts = await getPoints(db, t.id);
    expect(new Set(pts.map((p) => p.seg)).size).toBe(2);
  });

  it('finish stores statistics and the trek appears in history; cancel removes everything', async () => {
    const db = await fresh();
    const rec = new TrekRecorder(db);
    const fixes = walk(ORIGIN, [[0, 300]]);
    await rec.start({ ...startOpts, startFix: fixes[0] });
    await rec.ingest(fixes.slice(1));
    const done = await rec.finish(fixes[fixes.length - 1].t);
    const list = await listTreks(db);
    expect(list).toHaveLength(1);
    expect(list[0].stats!.distance).toBeCloseTo(done!.stats.distance, 6);
    expect(await rec.current()).toBeNull();

    const t2 = await rec.start({ ...startOpts, startFix: fixes[0] });
    await rec.ingest(fixes.slice(1));
    await rec.cancel();
    expect(await getTrek(db, t2.id)).toBeNull();
    expect((await db.all('SELECT * FROM trek_locations WHERE session_id = ?', [t2.id])).length).toBe(0);
  });

  it('only one trek can be active', async () => {
    const db = await fresh();
    const rec = new TrekRecorder(db);
    await rec.start({ ...startOpts, startFix: fix(ORIGIN, T0) });
    await expect(rec.start({ ...startOpts, startFix: fix(ORIGIN, T0) })).rejects.toThrow(/already/);
  });

  it('a failed write rolls back the whole batch (transaction safety)', async () => {
    const db = await fresh();
    const rec = new TrekRecorder(db);
    const fixes = walk(ORIGIN, [[0, 100]]);
    const t = await rec.start({ ...startOpts, startFix: fixes[0] });
    await rec.ingest(fixes.slice(1, 4));
    // Sabotage: pre-insert a row that collides with a seq inside the next batch.
    await db.run('INSERT INTO trek_locations (session_id, seq, seg, lat, lon, t, dist) VALUES (?, 6, 0, 0, 0, 0, 0)', [t.id]);
    await expect(rec.ingest(fixes.slice(4))).rejects.toThrow();
    const pts = await getPoints(db, t.id);
    expect(pts.map((p) => p.seq)).toEqual([0, 1, 2, 3, 6]); // seq 4 and 5 from the failed batch were rolled back
    expect((await rec.current())!.filter.nextSeq).toBe(4); // memory did not run ahead of disk
  });

  it('end to end: record offline, finish, then navigate the stored route back to the start', async () => {
    const db = await fresh();
    const rec = new TrekRecorder(db);
    const fixes = walk(ORIGIN, [[20, 600], [110, 400], [45, 300]]);
    const t = await rec.start({ ...startOpts, startFix: fixes[0] });
    await rec.ingest(fixes.slice(1));
    await rec.finish(fixes[fixes.length - 1].t);
    const stored = await getPoints(db, t.id);
    const route = buildRoute(stored);
    let nav = initialNav();
    let last;
    for (const p of stored.slice().reverse()) {
      const r = updateNav(route, nav, destination(p, 77, 4), 6, 1.2);
      nav = r.nav;
      last = r.state;
      expect(r.state.status).not.toBe('off_route');
    }
    expect(last!.status).toBe('arrived');
  });
});

describe('emergency persistence', () => {
  async function setup() {
    const db = await fresh();
    const u = await getUser(db);
    await saveUser(db, { ...u, name: 'Asha', bloodGroup: 'O+' });
    await addContact(db, { name: 'Ravi', phone: '+911234567890', relation: 'Brother' });
    await addContact(db, { name: 'Meera', phone: '+919876543210' });
    return db;
  }
  const recent = [fix(ORIGIN, T0 - 50_000, 8), fix(destination(ORIGIN, 0, 30), T0 - 20_000, 9), fix(destination(ORIGIN, 0, 60), T0 - 5000, 200)];

  it('SOS with no connectivity: event, trail and queue are all stored, nothing claims to be sent', async () => {
    const db = await setup();
    const e = await raiseEmergency(db, { kind: 'sos', sessionId: null, liveFix: fix(destination(ORIGIN, 0, 65), T0, 11), recentFixes: recent, start: { ...ORIGIN, t: T0 - 3600_000 }, battery: 0.41, destination: null, now: T0, randomBytes: rb });
    const [row] = await listEvents(db);
    expect(row).toMatchObject({ id: e.id, kind: 'sos', acc: 11, positionLive: true, battery: 0.41, resolvedAt: null });
    expect(row.message).toContain(e.id);
    expect(row.message).toContain('Ravi (Brother): +911234567890');
    const locs = await db.all<any>('SELECT * FROM emergency_locations WHERE event_id = ? ORDER BY t', [e.id]);
    expect(locs).toHaveLength(3); // two reliable recent fixes + the live one; the ±200 m fix is excluded
    const alerts = await listAlerts(db, e.id);
    expect(alerts.map((a) => a.channel)).toEqual(['sms', 'sms', 'ble']);
    expect(alerts.every((a) => a.status === 'saved_local')).toBe(true);
  });

  it('without live GPS it falls back to the last reliable fix and says so', async () => {
    const db = await setup();
    const e = await raiseEmergency(db, { kind: 'sos', sessionId: null, liveFix: null, recentFixes: recent, start: null, battery: null, destination: null, now: T0, randomBytes: rb });
    expect(e.positionLive).toBe(false);
    expect(e.position!.t).toBe(T0 - 20_000);
    expect((await listEvents(db))[0].message).toContain('LAST KNOWN LOCATION');
  });

  it('with no fix at all the event is still saved', async () => {
    const db = await setup();
    const e = await raiseEmergency(db, { kind: 'sos', sessionId: null, liveFix: null, recentFixes: [], start: null, battery: 0.1, destination: null, now: T0, randomBytes: rb });
    expect(e.position).toBeNull();
    expect((await listEvents(db))[0].message).toContain('LOCATION UNKNOWN');
  });

  it('alert status only advances through legal steps', async () => {
    const db = await setup();
    const e = await raiseEmergency(db, { kind: 'sos', sessionId: null, liveFix: null, recentFixes: recent, start: null, battery: null, destination: null, now: T0, randomBytes: rb });
    const [sms] = await listAlerts(db, e.id);
    expect(await applyAlertAction(db, sms.id, 'ack', T0)).toBeNull(); // cannot confirm what was never sent
    expect((await applyAlertAction(db, sms.id, 'queue', T0))!.status).toBe('waiting');
    const handed = await applyAlertAction(db, sms.id, 'handoff', T0 + 1, 'SMS composer opened');
    expect(handed).toMatchObject({ status: 'handed_off', attempts: 1, detail: 'SMS composer opened' });
    expect((await applyAlertAction(db, sms.id, 'reported_sent', T0 + 2))!.status).toBe('sent');
    expect((await applyAlertAction(db, sms.id, 'ack', T0 + 3))!.status).toBe('delivery_confirmed');
  });

  it('resolving an emergency expires what is still queued but keeps the record', async () => {
    const db = await setup();
    const e = await raiseEmergency(db, { kind: 'sos', sessionId: null, liveFix: null, recentFixes: recent, start: null, battery: null, destination: null, now: T0, randomBytes: rb });
    await resolveEvent(db, e.id, T0 + 10);
    expect((await listAlerts(db, e.id)).every((a) => a.status === 'expired')).toBe(true);
    expect((await listEvents(db))[0].resolvedAt).toBe(T0 + 10);
  });

  it('safety plan drafted before the trek is attached to it on start', async () => {
    const db = await setup();
    await saveDraftPlan(db, { expectedReturnAt: T0 + 4 * 3600_000, destination: 'Ridge camp', notes: null }, T0);
    expect((await getDraftPlan(db))!.destination).toBe('Ridge camp');
    const rec = new TrekRecorder(db);
    const t = await rec.start({ ...startOpts, startFix: fix(ORIGIN, T0) });
    const plan = await attachDraftPlan(db, t.id);
    expect(plan).toMatchObject({ sessionId: t.id, expectedReturnAt: T0 + 4 * 3600_000 });
    expect(await getDraftPlan(db)).toBeNull();
  });
});
