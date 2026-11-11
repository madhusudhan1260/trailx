import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { safeFileName, toGPX, toJSON } from '@/core/exporter';
import { getDb } from '@/db';
import { getPoints, getTrek, listEvents, listNotes, listWaypoints } from '@/db/repo';

/** Writes the trek to a local file and opens the system share sheet (or downloads it in a browser). No upload happens. */
export async function exportTrek(id: number, format: 'gpx' | 'json'): Promise<string> {
  const db = await getDb();
  const trek = await getTrek(db, id);
  if (!trek) throw new Error('Trek not found');
  const points = await getPoints(db, id);
  const wps = (await listWaypoints(db, id)).map((w) => ({ name: w.name, lat: w.lat, lon: w.lon, alt: w.alt, t: w.t, note: w.note }));
  const body = format === 'gpx'
    ? toGPX(trek, points, wps)
    : toJSON(trek, points, wps, {
        notes: (await listNotes(db, id)).map((n) => ({ time: new Date(n.t).toISOString(), text: n.text, lat: n.lat, lon: n.lon, hasPhoto: !!n.photoUri })),
        safetyEvents: (await listEvents(db, id)).map((e) => ({ id: e.id, kind: e.kind, time: new Date(e.createdAt).toISOString(), lat: e.lat, lon: e.lon })),
      });
  const name = `${safeFileName(trek.name)}-${new Date(trek.startedAt).toISOString().slice(0, 10)}.${format}`;
  const mime = format === 'gpx' ? 'application/gpx+xml' : 'application/json';

  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([body], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return `Downloaded ${name}`;
  }
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(body);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: name, UTI: format === 'gpx' ? 'com.topografix.gpx' : 'public.json' });
    return `Exported ${name}`;
  }
  return `Saved to ${file.uri}`;
}
