import { OfflineManager, TransformRequestManager } from '@maplibre/maplibre-react-native';
import type { BBox } from '@/core/tiles';
import type { MapArea } from '@/db/repo';

/**
 * Native map engine (iOS/Android): MapLibre Native's offline packs store the style, fonts, sprites
 * and tiles for an area in the app's own map database, which works with no network at all.
 * Resources viewed while online are also kept in MapLibre's ambient cache.
 */

export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const MAP_ATTRIBUTION = '© OpenFreeMap · © OpenMapTiles · Data © OpenStreetMap contributors';
export const offlineMapsSupported = () => true;

let identified = false;
/** OpenFreeMap asks offline-capable apps to identify themselves with a unique User-Agent. */
function identify() {
  if (identified) return;
  identified = true;
  try {
    TransformRequestManager.addHeader({ id: 'trailx-ua', match: 'tiles\\.openfreemap\\.org', name: 'User-Agent', value: 'TRAILX/1.0 (offline trekking app)' });
  } catch {
    // older native builds without header support simply use the default agent
  }
}

export function prepareMapRequests() {
  identify();
}

export async function downloadArea(
  plan: { bbox: BBox; minZoom: number; maxZoom: number },
  onProgress: (fraction: number, bytes: number) => void,
  signal?: AbortSignal,
): Promise<{ bytes: number; packId: string | null }> {
  identify();
  return new Promise((resolve, reject) => {
    let settled = false;
    let packId: string | null = null;
    const finish = (fn: () => void) => { if (!settled) { settled = true; fn(); } };
    signal?.addEventListener('abort', () => {
      if (packId) void OfflineManager.deletePack(packId).catch(() => undefined);
      finish(() => reject(new Error('Download cancelled')));
    });
    OfflineManager.createPack(
      { mapStyle: MAP_STYLE_URL, bounds: plan.bbox, minZoom: plan.minZoom, maxZoom: plan.maxZoom, metadata: { app: 'trailx' } },
      (pack, status) => {
        packId = pack.id;
        onProgress(Math.min(1, status.percentage / 100), status.completedResourceSize);
        if (status.state === 'complete' || status.percentage >= 100) finish(() => resolve({ bytes: status.completedResourceSize, packId: pack.id }));
      },
      (pack, err) => {
        packId = pack.id;
        finish(() => reject(new Error(err.message || 'Offline map download failed')));
      },
    ).then((p) => { packId = p.id; }, (e) => finish(() => reject(e)));
  });
}

export async function removeArea(a: MapArea): Promise<void> {
  if (a.packId) await OfflineManager.deletePack(a.packId).catch(() => undefined);
}

/** Not used on native: MapLibre loads the style URL itself. Present so both engines share one shape. */
export function registerMapProtocol(_maplibre: unknown) {}
