import type { GeoErrorKind } from '@/core/gpsMachine';
import type { RawFix } from '@/core/types';

/**
 * Browser GPS adapter built directly on the W3C Geolocation API.
 *
 * Why it exists: expo-location's web implementation registers each watcher under its own counter
 * but emits positions under the browser's `watchPosition` id. Whenever the two drift apart (the
 * compass watcher also consumes an expo id, and every hide/show of the tab restarts the watcher),
 * the very first position finds no listener and expo clears the browser watch — so the app gets
 * one fix, then silence, then "GPS signal lost". It also never asks for high accuracy and drops
 * every watch error. This adapter talks to `navigator.geolocation` itself and feeds the same
 * `handleFixes` pipeline as the native background task, so filtering, recording, stats and
 * return navigation are unchanged.
 *
 * It touches no browser globals at import time and receives the Geolocation object through `env`,
 * so it is safe to bundle into native builds and is fully testable with a fake.
 */

export type GpsBackend = 'browser' | 'expo-location';
/** Web uses the browser Geolocation API; iOS/Android keep Expo Location + TaskManager (background). */
export function chooseGpsBackend(os: string): GpsBackend {
  return os === 'web' ? 'browser' : 'expo-location';
}

export interface GeoPositionLike {
  coords: { latitude: number; longitude: number; accuracy: number; altitude: number | null; altitudeAccuracy: number | null; heading: number | null; speed: number | null };
  timestamp: number;
}
export interface GeoErrorLike { code: number; message?: string }
export interface GeolocationLike {
  getCurrentPosition(ok: (p: GeoPositionLike) => void, err?: (e: GeoErrorLike) => void, opts?: PositionOptions): void;
  watchPosition(ok: (p: GeoPositionLike) => void, err?: (e: GeoErrorLike) => void, opts?: PositionOptions): number;
  clearWatch(id: number): void;
}
export interface PermissionsLike { query(d: { name: 'geolocation' }): Promise<{ state: string }> }

export interface WebGpsEnv {
  geolocation(): GeolocationLike | undefined;
  /** `window.isSecureContext`. Browsers only expose GPS to https:// and localhost pages. */
  secure(): boolean;
  permissions?(): PermissionsLike | undefined;
  now?(): number;
}

export interface WebGpsSink {
  onFix(p: GeoPositionLike): void;
  onError(kind: GeoErrorKind, code: number | null, message: string): void;
}

export interface WebGpsOptions {
  /** Per-request timeout handed to the browser. */
  timeoutMs: number;
  /** 0 = never accept a cached position; every fix must be fresh. */
  maximumAgeMs: number;
  /** Silence this long → ask for a one-shot fresh fix (covers browsers that only report on movement). */
  probeAfterMs: number;
  /** Silence this long → tear the watch down and start a new one (covers watches the browser dropped). */
  restartAfterMs: number;
  heartbeatMs: number;
}
export const WEB_GPS_DEFAULTS: WebGpsOptions = { timeoutMs: 20_000, maximumAgeMs: 0, probeAfterMs: 10_000, restartAfterMs: 30_000, heartbeatMs: 5_000 };

export function classifyGeoError(e: GeoErrorLike, secure: boolean): GeoErrorKind {
  if (e.code === 1) return secure ? 'denied' : 'insecure';
  if (e.code === 2) return 'unavailable';
  if (e.code === 3) return 'timeout';
  return 'unknown';
}

export function positionToFix(p: GeoPositionLike): RawFix {
  const c = p.coords;
  return {
    lat: c.latitude,
    lon: c.longitude,
    t: p.timestamp,
    acc: c.accuracy != null && c.accuracy > 0 ? c.accuracy : null,
    alt: c.altitude ?? null,
    altAcc: c.altitudeAccuracy != null && c.altitudeAccuracy > 0 ? c.altitudeAccuracy : null,
    speed: c.speed != null && c.speed >= 0 ? c.speed : null,
    course: c.heading != null && c.heading >= 0 ? c.heading : null,
  };
}

export type WebPermission = 'granted' | 'denied' | 'prompt' | 'unknown';

export class WebGps {
  private watchId: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private probing = false;
  private lastFixAt: number | null = null;
  private lastStamp = -Infinity;
  private watchStartedAt = 0;
  /** Bumped by stop(); callbacks from an older generation are ignored. */
  private gen = 0;
  readonly stats = { watchesStarted: 0, restarts: 0, probes: 0, errors: 0 };

  constructor(private env: WebGpsEnv, private sink: WebGpsSink, private opts: WebGpsOptions = WEB_GPS_DEFAULTS) {}

  private now() { return this.env.now ? this.env.now() : Date.now(); }
  private posOpts(): PositionOptions {
    return { enableHighAccuracy: true, timeout: this.opts.timeoutMs, maximumAge: this.opts.maximumAgeMs };
  }

  support(): 'ok' | 'unsupported' | 'insecure' {
    if (!this.env.secure()) return 'insecure';
    return this.env.geolocation() ? 'ok' : 'unsupported';
  }

  get active() { return this.watchId != null; }
  get lastFixTime() { return this.lastFixAt; }

  /** Reads the permission without prompting. iOS often answers "prompt" even when access is allowed. */
  async permissionState(): Promise<WebPermission> {
    try {
      const p = this.env.permissions?.();
      if (!p) return 'unknown';
      const s = (await p.query({ name: 'geolocation' })).state;
      return s === 'granted' || s === 'denied' || s === 'prompt' ? s : 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Triggers the browser permission prompt by asking for one real position. A timeout or
   * "position unavailable" means permission was NOT refused — only the fix is slow — so it
   * resolves 'granted' and lets the watch keep searching.
   */
  requestPermission(): Promise<'granted' | 'denied' | 'unsupported' | 'insecure'> {
    const sup = this.support();
    if (sup !== 'ok') {
      this.sink.onError(sup, null, sup === 'insecure' ? 'Geolocation requires a secure context (https)' : 'navigator.geolocation is missing');
      return Promise.resolve(sup);
    }
    const geo = this.env.geolocation()!;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (r: 'granted' | 'denied' | 'insecure') => { if (!settled) { settled = true; clearTimeout(guard); resolve(r); } };
      // Some browsers never call back if the prompt is dismissed; don't hang the Start button forever.
      const guard = setTimeout(() => finish('granted'), this.opts.timeoutMs + 60_000);
      geo.getCurrentPosition(
        (p) => { this.deliver(p, this.gen); finish('granted'); },
        (e) => {
          const kind = classifyGeoError(e, this.env.secure());
          this.stats.errors++;
          this.sink.onError(kind, e.code, e.message ?? '');
          finish(kind === 'denied' ? 'denied' : kind === 'insecure' ? 'insecure' : 'granted');
        },
        this.posOpts(),
      );
    });
  }

  /** Starts continuous updates. Idempotent: never creates a second watcher. Returns true if it started one. */
  start(): boolean {
    if (this.watchId != null) return false;
    const sup = this.support();
    if (sup !== 'ok') {
      this.sink.onError(sup, null, sup === 'insecure' ? 'Geolocation requires a secure context (https)' : 'navigator.geolocation is missing');
      return false;
    }
    this.openWatch();
    this.timer = setInterval(() => this.heartbeat(), this.opts.heartbeatMs);
    return true;
  }

  stop(): void {
    this.gen++;
    if (this.watchId != null) this.env.geolocation()?.clearWatch(this.watchId);
    this.watchId = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.probing = false;
  }

  /** Call when the page becomes visible again: browsers pause watches in hidden tabs. */
  wake(): void {
    if (this.watchId == null) return;
    const ref = Math.max(this.lastFixAt ?? 0, this.watchStartedAt);
    if (this.now() - ref > this.opts.probeAfterMs) this.probe();
  }

  private openWatch() {
    const geo = this.env.geolocation()!;
    const gen = this.gen;
    this.watchStartedAt = this.now();
    this.stats.watchesStarted++;
    this.watchId = geo.watchPosition((p) => this.deliver(p, gen), (e) => this.fail(e, gen), this.posOpts());
  }

  private deliver(p: GeoPositionLike, gen: number) {
    if (gen !== this.gen) return;
    this.lastFixAt = this.now();
    // Watch and probe can both report the same reading; pass each one on only once.
    if (p.timestamp <= this.lastStamp) return;
    this.lastStamp = p.timestamp;
    this.sink.onFix(p);
  }

  private fail(e: GeoErrorLike, gen: number) {
    if (gen !== this.gen) return;
    const kind = classifyGeoError(e, this.env.secure());
    this.stats.errors++;
    if (kind === 'denied' || kind === 'insecure') this.stop();
    this.sink.onError(kind, e.code, e.message ?? '');
  }

  private probe() {
    if (this.probing) return;
    const geo = this.env.geolocation();
    if (!geo) return;
    this.probing = true;
    this.stats.probes++;
    const gen = this.gen;
    geo.getCurrentPosition(
      (p) => { if (gen === this.gen) this.probing = false; this.deliver(p, gen); },
      (e) => { if (gen === this.gen) this.probing = false; this.fail(e, gen); },
      this.posOpts(),
    );
  }

  private heartbeat() {
    if (this.watchId == null) return;
    // Measured from the later of the last fix and the current watch's start, so a fresh watch gets
    // its full grace period instead of being replaced again on the next beat.
    const silent = this.now() - Math.max(this.lastFixAt ?? 0, this.watchStartedAt);
    if (silent > this.opts.restartAfterMs) {
      // The browser may have dropped the watch silently. Replace it rather than trust it.
      this.env.geolocation()?.clearWatch(this.watchId);
      this.stats.restarts++;
      this.probing = false;
      this.openWatch();
    } else if (silent > this.opts.probeAfterMs) this.probe();
  }
}
