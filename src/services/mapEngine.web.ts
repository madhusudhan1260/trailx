import { OFM_LIMITS, tilesIn, type BBox } from '@/core/tiles';
import type { MapArea } from '@/db/repo';

/**
 * Browser map engine. Every map resource (style, tile index, vector tiles, sprites, fonts) is read
 * through Cache Storage via a custom `txmap://` protocol: cache first, network second, and every
 * network answer is kept. Pre-downloading an area fills the same cache, so the map keeps working
 * after the signal is gone — as long as this tab/browser keeps its storage.
 */

export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const MAP_ATTRIBUTION = '© OpenFreeMap · © OpenMapTiles · Data © OpenStreetMap contributors';
const CACHE = 'trailx-map-v1';
const PROTO = 'txmap';

type G = { caches?: CacheStorage; isSecureContext?: boolean };
export const offlineMapsSupported = () => !!(globalThis as G).caches && (globalThis as G).isSecureContext !== false;

const toProto = (u: string) => u.replace(/^https:\/\//, `${PROTO}://`);
const toHttps = (u: string) => u.replace(new RegExp(`^${PROTO}://`), 'https://');

/** Cache-first fetch. Throws only when the resource is neither cached nor reachable. */
export async function cachedFetch(url: string, signal?: AbortSignal): Promise<Response> {
  const cache = offlineMapsSupported() ? await caches.open(CACHE) : null;
  const hit = cache ? await cache.match(url) : undefined;
  if (hit) return hit;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Map server answered ${res.status} for ${new URL(url).pathname}`);
  if (cache) await cache.put(url, res.clone()).catch(() => undefined); // storage full: still show it
  return res;
}

let registered = false;
/** Registers the protocol with maplibre-gl once. */
export function registerMapProtocol(maplibre: { addProtocol: (name: string, fn: (p: { url: string; type?: string }, ac: AbortController) => Promise<{ data: unknown }>) => void }) {
  if (registered) return;
  registered = true;
  maplibre.addProtocol(PROTO, async (params, ac) => {
    const res = await cachedFetch(toHttps(params.url), ac.signal);
    if (params.type === 'json') return { data: await res.json() };
    if (params.type === 'string') return { data: await res.text() };
    return { data: await res.arrayBuffer() };
  });
}

interface Style {
  sources: Record<string, { type: string; url?: string; tiles?: string[]; minzoom?: number; maxzoom?: number; attribution?: string }>;
  glyphs?: string;
  sprite?: string | { id: string; url: string }[];
  layers: { layout?: Record<string, unknown> }[];
  [k: string]: unknown;
}

/**
 * Loads the style through the cache and inlines each source's tile URLs (also through the cache),
 * so a cold start with no network still finds everything it needs locally.
 */
export async function loadStyle(): Promise<Style> {
  const style = (await (await cachedFetch(MAP_STYLE_URL)).json()) as Style;
  for (const src of Object.values(style.sources)) {
    if (src.url) {
      const tj = (await (await cachedFetch(src.url)).json()) as { tiles: string[]; minzoom?: number; maxzoom?: number; attribution?: string };
      delete src.url;
      src.tiles = tj.tiles;
      src.minzoom = tj.minzoom ?? src.minzoom;
      src.maxzoom = tj.maxzoom ?? src.maxzoom;
      src.attribution = tj.attribution ?? src.attribution;
    }
    if (src.tiles) src.tiles = src.tiles.map(toProto);
  }
  if (style.glyphs) style.glyphs = toProto(style.glyphs);
  if (typeof style.sprite === 'string') style.sprite = toProto(style.sprite);
  else if (Array.isArray(style.sprite)) style.sprite = style.sprite.map((s) => ({ ...s, url: toProto(s.url) }));
  return style;
}

/** Fonts referenced by literal `text-font` arrays in the style. */
function fontStacks(style: Style): string[] {
  const out = new Set<string>();
  for (const l of style.layers) {
    const f = l.layout?.['text-font'];
    if (Array.isArray(f) && f.every((x) => typeof x === 'string')) out.add((f as string[]).join(','));
  }
  return [...out];
}

function resourceUrls(style: Style, bbox: BBox, minZoom: number, maxZoom: number): string[] {
  const urls: string[] = [];
  const sprites = typeof style.sprite === 'string' ? [style.sprite] : (style.sprite ?? []).map((s) => s.url);
  for (const s of sprites) for (const suffix of ['.json', '.png', '@2x.json', '@2x.png']) urls.push(toHttps(s) + suffix);
  // Latin, Latin-1 and extended Latin labels; other scripts are cached when first seen online.
  if (style.glyphs) for (const fs of fontStacks(style)) for (const range of ['0-255', '256-511']) urls.push(toHttps(style.glyphs).replace('{fontstack}', encodeURIComponent(fs)).replace('{range}', range));
  for (const src of Object.values(style.sources)) {
    if (!src.tiles?.length) continue;
    const lo = Math.max(minZoom, src.minzoom ?? 0);
    const hi = Math.min(maxZoom, src.maxzoom ?? maxZoom);
    for (const t of tilesIn(bbox, lo, hi)) urls.push(toHttps(src.tiles[0]).replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y)));
  }
  return urls;
}

export async function downloadArea(
  plan: { bbox: BBox; minZoom: number; maxZoom: number },
  onProgress: (fraction: number, bytes: number) => void,
  signal?: AbortSignal,
): Promise<{ bytes: number; packId: string | null }> {
  if (!offlineMapsSupported()) throw new Error('This browser cannot store maps for offline use (needs https or localhost).');
  const style = await loadStyle();
  const urls = resourceUrls(style, plan.bbox, plan.minZoom, plan.maxZoom);
  let done = 0;
  let bytes = 0;
  let next = 0;
  let failure: Error | null = null;
  const worker = async () => {
    while (next < urls.length && !failure && !signal?.aborted) {
      const url = urls[next++];
      try {
        const res = await cachedFetch(url, signal);
        bytes += Number(res.headers.get('content-length')) || (await res.clone().arrayBuffer()).byteLength;
        if (bytes > OFM_LIMITS.maxBytes) throw new Error('Area is larger than the 50 MB offline limit — choose a smaller radius.');
      } catch (e) {
        // A missing tile over open ocean is normal (204/404); a network failure is not.
        if (!(e instanceof Error && /answered 404|answered 204/.test(e.message))) failure = e as Error;
      }
      done++;
      onProgress(done / urls.length, bytes);
    }
  };
  // OpenFreeMap allows at most 4 parallel requests for offline downloads.
  await Promise.all(Array.from({ length: OFM_LIMITS.parallel }, worker));
  if (signal?.aborted) throw new Error('Download cancelled');
  if (failure) throw failure;
  return { bytes, packId: null };
}

/** Removes an area's tiles. Shared resources (style, fonts) stay — other areas use them. */
export async function removeArea(a: MapArea): Promise<void> {
  if (!offlineMapsSupported()) return;
  const cache = await caches.open(CACHE);
  const style = await loadStyle().catch(() => null);
  const src = style ? Object.values(style.sources).find((s) => s.type === 'vector' && s.tiles?.length) : null;
  if (!src?.tiles) return;
  for (const t of tilesIn(a.bbox, a.minZoom, a.maxZoom)) await cache.delete(toHttps(src.tiles[0]).replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y)));
}
