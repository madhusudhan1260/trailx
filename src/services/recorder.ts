import { FILTER_PRESETS, filterFix, initialFilterState, openNewSegment, type FilterState, type RejectReason } from '@/core/filter';
import { accumulate, initialAccumulator, toStats, type StatsAccumulator } from '@/core/stats';
import type { RawFix, SamplingMode, TrackPoint, TrekStats, TrekStatus } from '@/core/types';
import type { Db } from '@/db/schema';

export interface ActiveTrek {
  id: number;
  name: string;
  status: TrekStatus;
  startedAt: number;
  start: { lat: number; lon: number; acc: number | null; alt: number | null };
  destination: string | null;
  mode: SamplingMode;
  trackingMode: 'background' | 'foreground';
  pausedMs: number;
  pausedAt: number | null;
  filter: FilterState;
  acc: StatsAccumulator;
  /** Most recent fix from the provider, whether or not it became a breadcrumb. */
  lastFix: RawFix | null;
}

interface SessionRow {
  id: number; name: string; status: TrekStatus; started_at: number; ended_at: number | null;
  start_lat: number; start_lon: number; start_acc: number | null; start_alt: number | null;
  destination: string | null; sampling_mode: SamplingMode; tracking_mode: 'background' | 'foreground';
  paused_ms: number; paused_at: number | null; filter_state: string; stats_state: string; last_fix: string | null;
}

export interface IngestResult {
  accepted: TrackPoint[];
  rejected: Partial<Record<RejectReason, number>>;
  trek: ActiveTrek;
}

/**
 * Owns the life of a recording. Every state change is written to SQLite inside a transaction
 * together with the filter and statistics state, so a crash or OS kill at any moment loses at
 * most the fixes that had not yet been delivered — never the trek.
 *
 * It has no dependency on React Native, which is what lets the same code run in the background
 * location task, in the UI, and in the automated persistence tests.
 */
export class TrekRecorder {
  private active: ActiveTrek | null = null;
  private loaded = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private db: Db) {}

  /** Serialises all mutations so UI actions and background location batches never interleave. */
  private lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Returns the trek in progress, restoring it from disk after a restart. */
  async current(): Promise<ActiveTrek | null> {
    if (this.loaded) return this.active;
    return this.lock(async () => {
      if (this.loaded) return this.active;
      const r = await this.db.first<SessionRow>("SELECT * FROM trek_sessions WHERE status IN ('recording','paused') ORDER BY id DESC LIMIT 1");
      this.active = r
        ? {
            id: r.id, name: r.name, status: r.status, startedAt: r.started_at,
            start: { lat: r.start_lat, lon: r.start_lon, acc: r.start_acc, alt: r.start_alt },
            destination: r.destination, mode: r.sampling_mode, trackingMode: r.tracking_mode,
            pausedMs: r.paused_ms, pausedAt: r.paused_at,
            filter: JSON.parse(r.filter_state), acc: JSON.parse(r.stats_state),
            lastFix: r.last_fix ? JSON.parse(r.last_fix) : null,
          }
        : null;
      this.loaded = true;
      return this.active;
    });
  }

  /** Forget the in-memory copy (used by tests to simulate a process restart). */
  static restart(db: Db): TrekRecorder {
    return new TrekRecorder(db);
  }

  async start(opts: { name: string; startFix: RawFix; mode: SamplingMode; trackingMode: 'background' | 'foreground'; destination?: string | null; now: number }): Promise<ActiveTrek> {
    await this.current();
    return this.lock(async () => {
      if (this.active) throw new Error('A trek is already in progress');
      let filter = initialFilterState();
      let acc = initialAccumulator();
      const points: TrackPoint[] = [];
      // The start fix is the anchor of the whole return journey — it is always stored, even if
      // its accuracy is below the recording threshold. Its real accuracy is saved alongside.
      const first: TrackPoint = { ...opts.startFix, seq: 0, seg: 0, dist: 0, gap: false };
      filter = { ...filter, last: first, lastSeenT: first.t, nextSeq: 1, segOpen: false };
      acc = accumulate(acc, first);
      points.push(first);
      const id = await this.db.tx(async () => {
        const r = await this.db.run(
          `INSERT INTO trek_sessions (name, status, started_at, start_lat, start_lon, start_acc, start_alt, destination, sampling_mode, tracking_mode, filter_state, stats_state, last_fix)
           VALUES (?, 'recording', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [opts.name, opts.now, first.lat, first.lon, first.acc, first.alt, opts.destination ?? null, opts.mode, opts.trackingMode, JSON.stringify(filter), JSON.stringify(acc), JSON.stringify(opts.startFix)],
        );
        await this.insertPoints(r.lastId, points);
        return r.lastId;
      });
      this.active = {
        id, name: opts.name, status: 'recording', startedAt: opts.now,
        start: { lat: first.lat, lon: first.lon, acc: first.acc, alt: first.alt },
        destination: opts.destination ?? null, mode: opts.mode, trackingMode: opts.trackingMode,
        pausedMs: 0, pausedAt: null, filter, acc, lastFix: opts.startFix,
      };
      return this.active;
    });
  }

  private async insertPoints(sessionId: number, pts: TrackPoint[]) {
    for (const p of pts) {
      await this.db.run(
        'INSERT INTO trek_locations (session_id, seq, seg, lat, lon, t, acc, alt, alt_acc, speed, course, dist, gap) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [sessionId, p.seq, p.seg, p.lat, p.lon, p.t, p.acc, p.alt, p.altAcc, p.speed, p.course, p.dist, p.gap ? 1 : 0],
      );
    }
  }

  /** Feed a batch of raw fixes from the location provider. Safe to call when no trek is active. */
  async ingest(fixes: RawFix[]): Promise<IngestResult | null> {
    await this.current();
    return this.lock(async () => {
      const trek = this.active;
      if (!trek || fixes.length === 0) return null;
      const ordered = fixes.slice().sort((a, b) => a.t - b.t);
      let filter = trek.filter;
      let acc = trek.acc;
      let lastFix = trek.lastFix;
      const accepted: TrackPoint[] = [];
      const rejected: IngestResult['rejected'] = {};
      for (const f of ordered) {
        if (!lastFix || f.t >= lastFix.t) lastFix = f;
        if (trek.status !== 'recording') continue; // paused: keep the live position, lay no breadcrumbs
        const r = filterFix(filter, f, FILTER_PRESETS[trek.mode]);
        filter = r.state;
        if (r.result.accepted) {
          accepted.push(r.result.point);
          acc = accumulate(acc, r.result.point);
        } else rejected[r.result.reason] = (rejected[r.result.reason] ?? 0) + 1;
      }
      await this.db.tx(async () => {
        await this.insertPoints(trek.id, accepted);
        await this.db.run('UPDATE trek_sessions SET filter_state = ?, stats_state = ?, last_fix = ? WHERE id = ?', [JSON.stringify(filter), JSON.stringify(acc), lastFix ? JSON.stringify(lastFix) : null, trek.id]);
      });
      // Memory is only updated after the transaction commits, so it can never run ahead of disk.
      this.active = { ...trek, filter, acc, lastFix };
      return { accepted, rejected, trek: this.active };
    });
  }

  async pause(now: number): Promise<ActiveTrek | null> {
    await this.current();
    return this.lock(async () => {
      const t = this.active;
      if (!t || t.status !== 'recording') return t;
      await this.db.run("UPDATE trek_sessions SET status = 'paused', paused_at = ? WHERE id = ?", [now, t.id]);
      this.active = { ...t, status: 'paused', pausedAt: now };
      return this.active;
    });
  }

  async resume(now: number): Promise<ActiveTrek | null> {
    await this.current();
    return this.lock(async () => {
      const t = this.active;
      if (!t || t.status !== 'paused') return t;
      const pausedMs = t.pausedMs + Math.max(0, now - (t.pausedAt ?? now));
      const filter = openNewSegment(t.filter);
      await this.db.run("UPDATE trek_sessions SET status = 'recording', paused_at = NULL, paused_ms = ?, filter_state = ? WHERE id = ?", [pausedMs, JSON.stringify(filter), t.id]);
      this.active = { ...t, status: 'recording', pausedAt: null, pausedMs, filter };
      return this.active;
    });
  }

  /** Switches the GPS sampling/filter preset without interrupting the recording. */
  async setMode(mode: SamplingMode): Promise<ActiveTrek | null> {
    await this.current();
    return this.lock(async () => {
      const t = this.active;
      if (!t) return null;
      await this.db.run('UPDATE trek_sessions SET sampling_mode = ? WHERE id = ?', [mode, t.id]);
      this.active = { ...t, mode };
      return this.active;
    });
  }

  async finish(now: number): Promise<{ id: number; stats: TrekStats } | null> {
    await this.current();
    return this.lock(async () => {
      const t = this.active;
      if (!t) return null;
      const pausedMs = t.pausedMs + (t.status === 'paused' ? Math.max(0, now - (t.pausedAt ?? now)) : 0);
      const stats = toStats(t.acc, t.startedAt, now, pausedMs);
      await this.db.tx(async () => {
        await this.db.run("UPDATE trek_sessions SET status = 'finished', ended_at = ?, paused_ms = ?, paused_at = NULL WHERE id = ?", [now, pausedMs, t.id]);
        await saveStats(this.db, t.id, stats);
      });
      this.active = null;
      return { id: t.id, stats };
    });
  }

  /** Discards the trek in progress and every point recorded for it. */
  async cancel(): Promise<void> {
    await this.current();
    return this.lock(async () => {
      const t = this.active;
      if (!t) return;
      await this.db.run('DELETE FROM trek_sessions WHERE id = ?', [t.id]);
      this.active = null;
    });
  }

  liveStats(now: number): TrekStats | null {
    const t = this.active;
    if (!t) return null;
    const pausedMs = t.pausedMs + (t.status === 'paused' ? Math.max(0, now - (t.pausedAt ?? now)) : 0);
    return toStats(t.acc, t.startedAt, now, pausedMs);
  }
}

export async function saveStats(db: Db, sessionId: number, s: TrekStats) {
  await db.run(
    `INSERT OR REPLACE INTO trek_statistics (session_id, distance, estimated_distance, elapsed_ms, active_ms, moving_ms, avg_speed, max_speed, elevation_gain, elevation_loss, max_altitude, min_altitude, altitude_coverage, point_count, gap_count)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [sessionId, s.distance, s.estimatedDistance, s.elapsedMs, s.activeMs, s.movingMs, s.avgSpeed, s.maxSpeed, s.elevationGain, s.elevationLoss, s.maxAltitude, s.minAltitude, s.altitudeCoverage, s.pointCount, s.gapCount],
  );
}
