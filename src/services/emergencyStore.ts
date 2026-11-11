import {
  buildEmergencyMessage, buildShortMessage, lastReliable, makeEmergencyId, nextAlertStatus,
  type AlertAction, type AlertStatus, type EmergencyEvent, type EmergencyKind,
} from '@/core/emergency';
import type { LatLon, RawFix } from '@/core/types';
import { getAlert, getUser, listContacts, type StoredAlert } from '@/db/repo';
import type { Db } from '@/db/schema';

export interface RaiseInput {
  kind: EmergencyKind;
  sessionId: number | null;
  /** A fix taken right now, if one could be obtained. */
  liveFix: RawFix | null;
  /** Most recent fixes known to the app (any quality); used for last-known position and trail. */
  recentFixes: RawFix[];
  start: (LatLon & { t: number }) | null;
  battery: number | null;
  destination: string | null;
  now: number;
  randomBytes: (n: number) => Uint8Array;
}

/**
 * Creates the emergency record and its delivery queue in ONE transaction. This is the first
 * thing that happens on SOS — before any attempt to send — so the record exists even if the app
 * is killed a moment later. Nothing here touches the network.
 */
export async function raiseEmergency(db: Db, input: RaiseInput): Promise<EmergencyEvent> {
  const user = await getUser(db);
  const contacts = await listContacts(db);
  const reliable = lastReliable(input.liveFix ? [...input.recentFixes, input.liveFix] : input.recentFixes);
  const liveOk = input.liveFix != null && input.liveFix.acc != null;
  const position = liveOk ? input.liveFix : reliable[reliable.length - 1] ?? input.recentFixes[input.recentFixes.length - 1] ?? null;
  const event: EmergencyEvent = {
    id: makeEmergencyId(input.randomBytes(6)),
    kind: input.kind,
    createdAt: input.now,
    position,
    positionLive: liveOk,
    trail: reliable,
    start: input.start,
    battery: input.battery,
    profile: { name: user.name, bloodGroup: user.bloodGroup, medical: user.medical, allergies: user.allergies },
    contacts,
    destination: input.destination,
  };
  const message = buildEmergencyMessage(event);
  const short = buildShortMessage(event);
  await db.tx(async () => {
    await db.run(
      `INSERT INTO emergency_events (id, session_id, kind, created_at, lat, lon, acc, alt, fix_t, position_live, battery, start_lat, start_lon, start_t, message, short_message)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [event.id, input.sessionId, event.kind, event.createdAt, position?.lat ?? null, position?.lon ?? null, position?.acc ?? null, position?.alt ?? null, position?.t ?? null,
        liveOk ? 1 : 0, event.battery, event.start?.lat ?? null, event.start?.lon ?? null, event.start?.t ?? null, message, short],
    );
    for (const f of reliable) await db.run('INSERT INTO emergency_locations (event_id, lat, lon, t, acc, alt) VALUES (?,?,?,?,?,?)', [event.id, f.lat, f.lon, f.t, f.acc, f.alt]);
    for (const c of contacts)
      await db.run("INSERT INTO pending_alerts (event_id, channel, recipient, status, created_at, updated_at) VALUES (?, 'sms', ?, 'saved_local', ?, ?)", [event.id, `${c.name} · ${c.phone}`, input.now, input.now]);
    await db.run("INSERT INTO pending_alerts (event_id, channel, recipient, status, created_at, updated_at) VALUES (?, 'ble', 'Nearby TRAILX devices', 'saved_local', ?, ?)", [event.id, input.now, input.now]);
  });
  return event;
}

/** Moves an alert through the delivery state machine. Illegal moves are ignored and return null. */
export async function applyAlertAction(db: Db, alertId: number, action: AlertAction, now: number, detail?: string | null, msgId?: string | null): Promise<StoredAlert | null> {
  const cur = await getAlert(db, alertId);
  if (!cur) return null;
  const next: AlertStatus | null = nextAlertStatus(cur.status, action);
  if (!next) return null;
  const attempts = cur.attempts + (action === 'handoff' || action === 'reported_sent' || action === 'fail' ? 1 : 0);
  await db.run('UPDATE pending_alerts SET status = ?, attempts = ?, updated_at = ?, detail = ?, msg_id = COALESCE(?, msg_id) WHERE id = ?', [next, attempts, now, detail ?? cur.detail, msgId ?? null, alertId]);
  return getAlert(db, alertId);
}
