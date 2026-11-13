import { planArea } from '@/core/tiles';
import { getDb } from '@/db';
import { addMapArea, coveringArea, deleteMapArea, listMapAreas, updateMapArea, type MapArea } from '@/db/repo';
import { useApp } from '@/store';
import { downloadArea, offlineMapsSupported, removeArea } from './mapEngine';

/** Default area saved around a trek's start: enough for a day hike out and back. */
export const TREK_AREA_RADIUS_M = 5000;

let current: { id: number; abort: AbortController } | null = null;

export async function refreshMapAreas(): Promise<MapArea[]> {
  const areas = await listMapAreas(await getDb());
  useApp.getState().set({ mapAreas: areas });
  return areas;
}

export function isDownloading() {
  return current != null;
}

/**
 * Downloads the map around a point. The area is recorded first, so a crash leaves a visible
 * "failed — retry" entry rather than a silent half-download.
 */
export async function downloadAround(lat: number, lon: number, opts: { radiusM?: number; name: string; sessionId?: number | null }): Promise<MapArea> {
  if (!offlineMapsSupported()) throw new Error('Offline maps are not available in this browser (needs https or localhost).');
  if (current) throw new Error('Another map area is already downloading.');
  const plan = planArea(lat, lon, opts.radiusM ?? TREK_AREA_RADIUS_M);
  if (!plan) throw new Error('This area is too large to download in one go.');
  const db = await getDb();
  const id = await addMapArea(db, { name: opts.name, bbox: plan.bbox, minZoom: plan.minZoom, maxZoom: plan.maxZoom, tileCount: plan.tileCount, sessionId: opts.sessionId ?? null, now: Date.now() });
  const abort = new AbortController();
  current = { id, abort };
  const { set } = useApp.getState();
  set({ mapDownload: { areaId: id, fraction: 0, bytes: 0, radiusM: plan.radiusM } });
  await refreshMapAreas();
  try {
    const r = await downloadArea(plan, (fraction, bytes) => set({ mapDownload: { areaId: id, fraction, bytes, radiusM: plan.radiusM } }), abort.signal);
    await updateMapArea(db, id, { status: 'complete', bytes: r.bytes, packId: r.packId, error: null, now: Date.now() });
  } catch (e) {
    await updateMapArea(db, id, { status: 'failed', error: (e as Error).message, now: Date.now() });
    throw e;
  } finally {
    current = null;
    set({ mapDownload: null });
    await refreshMapAreas();
  }
  return (await listMapAreas(db)).find((a) => a.id === id)!;
}

export function cancelDownload() {
  current?.abort.abort();
}

export async function deleteArea(a: MapArea) {
  await removeArea(a);
  await deleteMapArea(await getDb(), a.id);
  await refreshMapAreas();
}

/**
 * Called when a trek starts: if the phone is online and the start is not inside a saved area,
 * save the map around it in the background so it is still there after the signal is lost.
 * Never blocks or fails the trek itself.
 */
export async function ensureTrekArea(start: { lat: number; lon: number }, sessionId: number): Promise<void> {
  try {
    if (!offlineMapsSupported() || current) return;
    const s = useApp.getState();
    if (s.online === false) return;
    const areas = await refreshMapAreas();
    if (coveringArea(areas, start.lat, start.lon)) return;
    const name = `Around trek start · ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
    await downloadAround(start.lat, start.lon, { name, sessionId });
  } catch {
    // Recorded on the area row; the trail view still works without a map.
  }
}
