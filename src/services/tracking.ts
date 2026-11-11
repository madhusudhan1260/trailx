import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { AppState, Platform } from 'react-native';
import type { RawFix, SamplingMode } from '@/core/types';
import { getDb } from '@/db';
import { attachDraftPlan, getPlanForSession, getPoints } from '@/db/repo';
import { useApp } from '@/store';
import { cancelOverdueNotification, scheduleOverdueNotification } from './notify';
import { TrekRecorder, type ActiveTrek } from './recorder';

export const LOCATION_TASK = 'trailx-location-updates';

let recorder: Promise<TrekRecorder> | null = null;
export function getRecorder(): Promise<TrekRecorder> {
  if (!recorder) recorder = getDb().then((db) => new TrekRecorder(db));
  return recorder;
}

/** True once any fix flagged as mocked by the OS has been seen this session. */
let sawMock = false;
export const mockLocationSeen = () => sawMock;

function toFix(l: Location.LocationObject): RawFix {
  if (l.mocked) sawMock = true;
  const c = l.coords;
  return {
    lat: c.latitude,
    lon: c.longitude,
    t: l.timestamp,
    acc: c.accuracy != null && c.accuracy > 0 ? c.accuracy : null,
    alt: c.altitude ?? null,
    altAcc: c.altitudeAccuracy != null && c.altitudeAccuracy > 0 ? c.altitudeAccuracy : null,
    speed: c.speed != null && c.speed >= 0 ? c.speed : null,
    course: c.heading != null && c.heading >= 0 ? c.heading : null,
  };
}

/** Single entry point for every fix, from the background task and the foreground watcher alike. */
export async function handleFixes(fixes: RawFix[]): Promise<void> {
  if (fixes.length === 0) return;
  const { set } = useApp.getState();
  const latest = fixes.reduce((a, b) => (b.t > a.t ? b : a));
  const prev = useApp.getState().fix;
  if (!prev || latest.t > prev.t) {
    set({ fix: latest, fixAt: Date.now(), recentFixes: [...useApp.getState().recentFixes, latest].slice(-30), acquiring: false });
  }
  const rec = await getRecorder();
  const r = await rec.ingest(fixes);
  if (r) {
    const s = useApp.getState();
    set({ trek: r.trek, trail: r.accepted.length ? [...s.trail, ...r.accepted] : s.trail });
  }
}

// The task must be defined at module scope: when Android/iOS relaunch the app in the background
// to deliver locations, only top-level code runs — no React component is mounted.
if (Platform.OS !== 'web') {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      useApp.getState().set({ trackingWarning: `Location service error: ${error.message}` });
      return;
    }
    if (data?.locations?.length) await handleFixes(data.locations.map(toFix));
  });
}

const TASK_OPTIONS: Record<SamplingMode, Pick<Location.LocationTaskOptions, 'accuracy' | 'timeInterval' | 'distanceInterval' | 'deferredUpdatesInterval'>> = {
  precise: { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 2, deferredUpdatesInterval: 2000 },
  balanced: { accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 4, deferredUpdatesInterval: 4000 },
  saver: { accuracy: Location.Accuracy.Balanced, timeInterval: 12000, distanceInterval: 10, deferredUpdatesInterval: 12000 },
};

export const SAMPLING_INFO: Record<SamplingMode, { label: string; detail: string }> = {
  precise: { label: 'Precise', detail: 'A point every ~2 s. Best trail detail, highest battery use.' },
  balanced: { label: 'Balanced', detail: 'A point every ~4 s. Recommended for most treks.' },
  saver: { label: 'Battery saver', detail: 'A point every ~12 s. Coarser trail, longest battery life.' },
};

// ----------------------------------------------------------------------------------------------
// Permissions & live position
// ----------------------------------------------------------------------------------------------

export async function refreshPermissions(): Promise<void> {
  const { set } = useApp.getState();
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    let bg: boolean | null = null;
    if (Platform.OS !== 'web') bg = (await Location.getBackgroundPermissionsAsync()).granted;
    const services = await Location.hasServicesEnabledAsync().catch(() => null);
    set({ permission: fg.granted ? 'granted' : fg.canAskAgain ? 'unknown' : 'denied', backgroundPermission: bg, servicesEnabled: services });
  } catch {
    // leave as unknown
  }
}

export async function requestForeground(): Promise<boolean> {
  const r = await Location.requestForegroundPermissionsAsync();
  await refreshPermissions();
  if (r.granted) void startLiveWatch();
  return r.granted;
}

export async function requestBackground(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const r = await Location.requestBackgroundPermissionsAsync();
  await refreshPermissions();
  return r.granted;
}

let liveSub: Location.LocationSubscription | null = null;
let liveStarting = false;

/**
 * Foreground position watcher. Runs whenever the app is visible so the GPS status shown to the
 * user is live, and is the recording source when background tracking is unavailable.
 */
export async function startLiveWatch(): Promise<void> {
  if (liveSub || liveStarting) return;
  if (useApp.getState().permission !== 'granted') return;
  liveStarting = true;
  try {
    useApp.getState().set({ acquiring: !useApp.getState().fix });
    liveSub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 0 },
      (l) => void handleFixes([toFix(l)]),
      () => useApp.getState().set({ servicesEnabled: false }),
    );
  } catch {
    liveSub = null;
  } finally {
    liveStarting = false;
  }
}

export function stopLiveWatch() {
  liveSub?.remove();
  liveSub = null;
}

/** Waits for a real fix. Returns null if none arrives — the caller must then NOT start a trek. */
export function acquireFix(timeoutMs = 30_000, goodEnough = 25): Promise<RawFix | null> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let best: RawFix | null = null;
    const check = () => {
      const s = useApp.getState();
      const fresh = s.fix && s.fixAt != null && s.fixAt >= startedAt - 3000 ? s.fix : null;
      if (fresh && fresh.acc != null && (!best || (best.acc ?? Infinity) >= fresh.acc)) best = fresh;
      if (best && best.acc != null && best.acc <= goodEnough) return done(best);
      if (Date.now() - startedAt > timeoutMs) return done(best);
    };
    const timer = setInterval(check, 400);
    const done = (f: RawFix | null) => {
      clearInterval(timer);
      resolve(f);
    };
    void startLiveWatch();
    check();
  });
}

// ----------------------------------------------------------------------------------------------
// Trek lifecycle
// ----------------------------------------------------------------------------------------------

async function startBackgroundUpdates(mode: SamplingMode): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    if (!(await Location.getBackgroundPermissionsAsync()).granted) return false;
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      ...TASK_OPTIONS[mode],
      activityType: Location.ActivityType.Fitness,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'TRAILX is recording your trek',
        notificationBody: 'Your route is being saved on this phone so you can find your way back.',
        notificationColor: '#C6FF3D',
        killServiceOnDestroy: false,
      },
    });
    return true;
  } catch (e) {
    useApp.getState().set({ trackingWarning: `Background tracking could not start: ${(e as Error).message}` });
    return false;
  }
}

async function stopBackgroundUpdates() {
  if (Platform.OS === 'web') return;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    // already stopped
  }
}

const FOREGROUND_ONLY_WARNING =
  Platform.OS === 'web'
    ? 'Browsers cannot record with the screen off. Keep this tab open and the screen on, or use the installed app.'
    : 'Background location is not allowed, so recording will stop while the screen is locked or the app is closed. Allow "Always" location access to fix this.';

export type StartResult = { ok: true; trek: ActiveTrek } | { ok: false; reason: 'permission' | 'services' | 'no_fix' | 'error'; message: string };

export async function startTrek(name: string, mode: SamplingMode): Promise<StartResult> {
  const { set } = useApp.getState();
  try {
    await refreshPermissions();
    if (useApp.getState().permission !== 'granted' && !(await requestForeground()))
      return { ok: false, reason: 'permission', message: 'TRAILX needs location access to record your route. Enable it in system settings.' };
    if (useApp.getState().servicesEnabled === false)
      return { ok: false, reason: 'services', message: 'Location is switched off on this device. Turn it on to start a trek.' };

    set({ acquiring: true });
    const startFix = await acquireFix();
    set({ acquiring: false });
    if (!startFix)
      return { ok: false, reason: 'no_fix', message: 'No GPS fix yet. Move to open sky, away from buildings and dense canopy, and try again. The trek was not started because there is no starting point to return to.' };

    if (Platform.OS !== 'web' && !useApp.getState().backgroundPermission) await requestBackground();
    const background = await startBackgroundUpdates(mode);

    const rec = await getRecorder();
    const trek = await rec.start({ name, startFix, mode, trackingMode: background ? 'background' : 'foreground', now: Date.now() });
    const db = await getDb();
    const plan = await attachDraftPlan(db, trek.id);
    if (plan?.expectedReturnAt) await scheduleOverdueNotification(plan);
    set({
      trek,
      trail: await getPoints(db, trek.id),
      plan: await getPlanForSession(db, trek.id),
      backgroundActive: background,
      trackingWarning: background ? null : FOREGROUND_ONLY_WARNING,
      returnTrekId: null,
      nav: null,
    });
    return { ok: true, trek };
  } catch (e) {
    set({ acquiring: false });
    return { ok: false, reason: 'error', message: (e as Error).message };
  }
}

export async function pauseTrek() {
  const rec = await getRecorder();
  const trek = await rec.pause(Date.now());
  useApp.getState().set({ trek });
}

export async function resumeTrek() {
  const rec = await getRecorder();
  const trek = await rec.resume(Date.now());
  useApp.getState().set({ trek });
}

export async function finishTrek(): Promise<number | null> {
  const rec = await getRecorder();
  const plan = useApp.getState().plan;
  const done = await rec.finish(Date.now());
  await stopBackgroundUpdates();
  if (plan) await cancelOverdueNotification(plan);
  const s = useApp.getState();
  s.set({ trek: null, trail: [], plan: null, backgroundActive: null, trackingWarning: null });
  s.touch();
  return done?.id ?? null;
}

export async function cancelTrek() {
  const rec = await getRecorder();
  const plan = useApp.getState().plan;
  await rec.cancel();
  await stopBackgroundUpdates();
  if (plan) await cancelOverdueNotification(plan);
  useApp.getState().set({ trek: null, trail: [], plan: null, backgroundActive: null, trackingWarning: null });
}

/** Changes the sampling mode mid-trek by restarting the location service — recording never stops silently. */
export async function changeSamplingMode(mode: SamplingMode) {
  const trek = useApp.getState().trek;
  if (!trek) return;
  const rec = await getRecorder();
  const reloaded = await rec.setMode(mode);
  const background = trek.trackingMode === 'background' ? await startBackgroundUpdates(mode) : false;
  useApp.getState().set({ trek: reloaded, backgroundActive: background, trackingWarning: background || trek.trackingMode === 'foreground' ? useApp.getState().trackingWarning : 'Background tracking stopped and could not be restarted. Keep the app open.' });
}

/**
 * Called on every launch and every return to the foreground. Restores the trek in progress and
 * verifies the OS is still delivering locations; if it is not, restarts the service or tells the user.
 */
export async function restoreTracking(): Promise<void> {
  const { set } = useApp.getState();
  await refreshPermissions();
  const db = await getDb();
  const rec = await getRecorder();
  const trek = await rec.current();
  if (!trek) {
    // No trek in progress: make sure no orphaned location service keeps draining the battery.
    await stopBackgroundUpdates();
    set({ trek: null, backgroundActive: null });
    if (useApp.getState().permission === 'granted') void startLiveWatch();
    return;
  }
  set({ trek, trail: await getPoints(db, trek.id), plan: await getPlanForSession(db, trek.id) });
  if (trek.lastFix && !useApp.getState().fix) set({ fix: trek.lastFix, fixAt: trek.lastFix.t });
  let background = false;
  if (Platform.OS !== 'web') {
    background = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
    if (!background) background = await startBackgroundUpdates(trek.mode);
  }
  set({ backgroundActive: background, trackingWarning: background ? null : FOREGROUND_ONLY_WARNING });
  void startLiveWatch();
}

let appStateHooked = false;
export function hookAppState() {
  if (appStateHooked) return;
  appStateHooked = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void restoreTracking();
    else if (state === 'background') {
      // With a background service running, the foreground watcher is redundant and only costs battery.
      const s = useApp.getState();
      if (!s.trek || s.backgroundActive) stopLiveWatch();
    }
  });
}
