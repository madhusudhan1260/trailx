import type { AlertChannel, AlertStatus, EmergencyContact, EmergencyKind, EmergencyProfile } from '@/core/emergency';
import { decryptField, encryptField } from '@/core/fieldCipher';
import type { AltitudeUnit, DistanceUnit, Profile } from '@/core/profile';
import type { SamplingMode, TrackPoint, TrekStats, TrekStatus } from '@/core/types';
import type { Db } from './schema';

// ---------------------------------------------------------------- user / settings

export interface Settings {
  samplingMode: SamplingMode;
  /** Seconds the SOS button must be held. */
  sosHoldSeconds: number;
  haptics: boolean;
  lowBatteryWarn: number;
  distanceUnit: DistanceUnit;
  altitudeUnit: AltitudeUnit;
}

export const DEFAULT_SETTINGS: Settings = { samplingMode: 'balanced', sosHoldSeconds: 2, haptics: true, lowBatteryWarn: 0.2, distanceUnit: 'km', altitudeUnit: 'm' };

/** Profile fields that are encrypted at rest when a device key is available. */
export const SENSITIVE_FIELDS = ['medical', 'allergies', 'emergencyNotes'] as const;
export type SensitiveField = (typeof SENSITIVE_FIELDS)[number];
const SENSITIVE_COLUMN: Record<SensitiveField, string> = { medical: 'medical', allergies: 'allergies', emergencyNotes: 'emergency_notes' };

/** `name` is the full name (kept under that key because emergency messages use it). */
export interface User extends EmergencyProfile, Omit<Profile, 'fullName' | 'bloodGroup' | 'medical' | 'allergies'> {
  partyCode: string | null;
  onboarded: boolean;
  settings: Settings;
  /** Sensitive fields that exist on disk but could not be decrypted (device key missing). Never overwritten blindly. */
  unreadable: SensitiveField[];
}

export interface FieldKey {
  key: Uint8Array | null;
  nonce: () => Uint8Array;
}

export async function getUser(db: Db, key: Uint8Array | null = null): Promise<User> {
  const r = await db.first<any>('SELECT * FROM users WHERE id = 1');
  const unreadable: SensitiveField[] = [];
  const open = (f: SensitiveField) => {
    const d = decryptField(key, f, r?.[SENSITIVE_COLUMN[f]] ?? null);
    if (!d.ok) unreadable.push(f);
    return d.value;
  };
  return {
    uid: r?.uid ?? null,
    name: r?.name ?? null,
    preferredName: r?.preferred_name ?? null,
    photoUri: r?.photo_uri ?? null,
    dob: r?.dob ?? null,
    phone: r?.phone ?? null,
    email: r?.email ?? null,
    gender: r?.gender ?? null,
    language: r?.language ?? null,
    bloodGroup: r?.blood_group ?? null,
    medical: open('medical'),
    allergies: open('allergies'),
    emergencyNotes: open('emergencyNotes'),
    experience: r?.experience ?? null,
    difficulty: r?.difficulty ?? null,
    typicalDuration: r?.typical_duration ?? null,
    profileCreatedAt: r?.profile_created_at ?? null,
    profileUpdatedAt: r?.updated_at ?? null,
    partyCode: r?.party_code ?? null,
    onboarded: !!r?.onboarded,
    settings: { ...DEFAULT_SETTINGS, ...(r?.settings ? JSON.parse(r.settings) : {}) },
    unreadable,
  };
}

export async function saveUser(db: Db, u: User, fk: FieldKey = { key: null, nonce: () => new Uint8Array(24) }, now = Date.now()): Promise<void> {
  const raw = await db.first<Record<string, string | null>>('SELECT medical, allergies, emergency_notes FROM users WHERE id = 1');
  const seal = (f: SensitiveField) => {
    const v = u[f];
    // A value we could not decrypt is kept exactly as stored unless the user typed a new one.
    if ((v == null || v === '') && u.unreadable.includes(f)) return raw?.[SENSITIVE_COLUMN[f]] ?? null;
    return encryptField(fk.key, f, v || null, fk.nonce);
  };
  await db.run(
    `UPDATE users SET name = ?, preferred_name = ?, photo_uri = ?, dob = ?, phone = ?, email = ?, gender = ?, language = ?,
       blood_group = ?, medical = ?, allergies = ?, emergency_notes = ?, experience = ?, difficulty = ?, typical_duration = ?,
       uid = ?, party_code = ?, onboarded = ?, settings = ?,
       profile_created_at = COALESCE(profile_created_at, ?), updated_at = ?
     WHERE id = 1`,
    [
      u.name || null, u.preferredName || null, u.photoUri || null, u.dob || null, u.phone || null, u.email || null, u.gender || null, u.language || null,
      u.bloodGroup || null, seal('medical'), seal('allergies'), seal('emergencyNotes'), u.experience || null, u.difficulty || null, u.typicalDuration || null,
      u.uid || null, u.partyCode || null, u.onboarded ? 1 : 0, JSON.stringify(u.settings),
      u.onboarded || u.name ? now : null, now,
    ],
  );
}

// ---------------------------------------------------------------- treks

export interface TrekSummary {
  id: number;
  name: string;
  status: TrekStatus;
  startedAt: number;
  endedAt: number | null;
  start: { lat: number; lon: number };
  destination: string | null;
  stats: TrekStats | null;
  eventCount: number;
}

const TREK_SELECT = `
  SELECT s.id, s.name, s.status, s.started_at, s.ended_at, s.start_lat, s.start_lon, s.destination,
         st.distance, st.estimated_distance, st.elapsed_ms, st.active_ms, st.moving_ms, st.avg_speed, st.max_speed,
         st.elevation_gain, st.elevation_loss, st.max_altitude, st.min_altitude, st.altitude_coverage, st.point_count, st.gap_count,
         (SELECT COUNT(*) FROM emergency_events e WHERE e.session_id = s.id) AS event_count
  FROM trek_sessions s LEFT JOIN trek_statistics st ON st.session_id = s.id`;

function toSummary(r: any): TrekSummary {
  return {
    id: r.id, name: r.name, status: r.status, startedAt: r.started_at, endedAt: r.ended_at,
    start: { lat: r.start_lat, lon: r.start_lon }, destination: r.destination, eventCount: r.event_count ?? 0,
    stats: r.distance == null ? null : {
      distance: r.distance, estimatedDistance: r.estimated_distance, elapsedMs: r.elapsed_ms, activeMs: r.active_ms, movingMs: r.moving_ms,
      avgSpeed: r.avg_speed, maxSpeed: r.max_speed, elevationGain: r.elevation_gain, elevationLoss: r.elevation_loss,
      maxAltitude: r.max_altitude, minAltitude: r.min_altitude, altitudeCoverage: r.altitude_coverage, pointCount: r.point_count, gapCount: r.gap_count,
    },
  };
}

export async function listTreks(db: Db, limit = 200): Promise<TrekSummary[]> {
  return (await db.all<any>(`${TREK_SELECT} WHERE s.status = 'finished' ORDER BY s.started_at DESC LIMIT ?`, [limit])).map(toSummary);
}

export async function getTrek(db: Db, id: number): Promise<TrekSummary | null> {
  const r = await db.first<any>(`${TREK_SELECT} WHERE s.id = ?`, [id]);
  return r ? toSummary(r) : null;
}

export async function getPoints(db: Db, sessionId: number): Promise<TrackPoint[]> {
  const rows = await db.all<any>('SELECT seq, seg, lat, lon, t, acc, alt, alt_acc, speed, course, dist, gap FROM trek_locations WHERE session_id = ? ORDER BY seq', [sessionId]);
  return rows.map((r) => ({ seq: r.seq, seg: r.seg, lat: r.lat, lon: r.lon, t: r.t, acc: r.acc, alt: r.alt, altAcc: r.alt_acc, speed: r.speed, course: r.course, dist: r.dist, gap: !!r.gap }));
}

export async function renameTrek(db: Db, id: number, name: string) {
  await db.run('UPDATE trek_sessions SET name = ? WHERE id = ?', [name.trim() || 'Untitled trek', id]);
}

export async function setDestination(db: Db, id: number, destination: string | null) {
  await db.run('UPDATE trek_sessions SET destination = ? WHERE id = ?', [destination?.trim() || null, id]);
}

export async function deleteTrek(db: Db, id: number) {
  await db.run('DELETE FROM trek_sessions WHERE id = ?', [id]);
}

export async function totals(db: Db): Promise<{ treks: number; distance: number; activeMs: number; gain: number }> {
  const r = await db.first<any>(`SELECT COUNT(*) AS n, COALESCE(SUM(st.distance),0) AS d, COALESCE(SUM(st.active_ms),0) AS a, COALESCE(SUM(st.elevation_gain),0) AS g
    FROM trek_sessions s JOIN trek_statistics st ON st.session_id = s.id WHERE s.status = 'finished'`);
  return { treks: r?.n ?? 0, distance: r?.d ?? 0, activeMs: r?.a ?? 0, gain: r?.g ?? 0 };
}

// ---------------------------------------------------------------- contacts

export async function listContacts(db: Db): Promise<EmergencyContact[]> {
  return db.all<EmergencyContact>('SELECT id, name, phone, relation FROM emergency_contacts ORDER BY sort, id');
}

export async function addContact(db: Db, c: { name: string; phone: string; relation?: string | null }): Promise<number> {
  const r = await db.run('INSERT INTO emergency_contacts (name, phone, relation) VALUES (?, ?, ?)', [c.name.trim(), c.phone.trim(), c.relation?.trim() || null]);
  return r.lastId;
}

export async function deleteContact(db: Db, id: number) {
  await db.run('DELETE FROM emergency_contacts WHERE id = ?', [id]);
}

// ---------------------------------------------------------------- waypoints & notes

export interface Waypoint {
  id: number; sessionId: number | null; name: string; lat: number; lon: number; alt: number | null; acc: number | null; t: number; note: string | null;
}

const wp = (r: any): Waypoint => ({ id: r.id, sessionId: r.session_id, name: r.name, lat: r.lat, lon: r.lon, alt: r.alt, acc: r.acc, t: r.t, note: r.note });

export async function listWaypoints(db: Db, sessionId?: number): Promise<Waypoint[]> {
  const rows = sessionId == null
    ? await db.all<any>('SELECT * FROM saved_waypoints ORDER BY t DESC')
    : await db.all<any>('SELECT * FROM saved_waypoints WHERE session_id = ? ORDER BY t', [sessionId]);
  return rows.map(wp);
}

export async function addWaypoint(db: Db, w: Omit<Waypoint, 'id'>): Promise<number> {
  const r = await db.run('INSERT INTO saved_waypoints (session_id, name, lat, lon, alt, acc, t, note) VALUES (?,?,?,?,?,?,?,?)', [w.sessionId, w.name.trim() || 'Waypoint', w.lat, w.lon, w.alt, w.acc, w.t, w.note]);
  return r.lastId;
}

export async function deleteWaypoint(db: Db, id: number) {
  await db.run('DELETE FROM saved_waypoints WHERE id = ?', [id]);
}

export interface Note {
  id: number; sessionId: number; t: number; text: string | null; photoUri: string | null; lat: number | null; lon: number | null;
}

export async function listNotes(db: Db, sessionId: number): Promise<Note[]> {
  return (await db.all<any>('SELECT * FROM trek_notes WHERE session_id = ? ORDER BY t', [sessionId])).map((r) => ({ id: r.id, sessionId: r.session_id, t: r.t, text: r.text, photoUri: r.photo_uri, lat: r.lat, lon: r.lon }));
}

export async function addNote(db: Db, n: Omit<Note, 'id'>): Promise<number> {
  return (await db.run('INSERT INTO trek_notes (session_id, t, text, photo_uri, lat, lon) VALUES (?,?,?,?,?,?)', [n.sessionId, n.t, n.text, n.photoUri, n.lat, n.lon])).lastId;
}

export async function deleteNote(db: Db, id: number) {
  await db.run('DELETE FROM trek_notes WHERE id = ?', [id]);
}

// ---------------------------------------------------------------- safety plans

export interface SafetyPlan {
  id: number; sessionId: number | null; expectedReturnAt: number | null; destination: string | null; notes: string | null;
  notificationId: string | null; overdueEventId: string | null; createdAt: number;
}

const plan = (r: any): SafetyPlan => ({ id: r.id, sessionId: r.session_id, expectedReturnAt: r.expected_return_at, destination: r.destination, notes: r.notes, notificationId: r.notification_id, overdueEventId: r.overdue_event_id, createdAt: r.created_at });

/** The draft plan is the one row not yet attached to a trek. It is attached when START TREK is pressed. */
export async function getDraftPlan(db: Db): Promise<SafetyPlan | null> {
  const r = await db.first<any>('SELECT * FROM safety_plans WHERE session_id IS NULL ORDER BY id DESC LIMIT 1');
  return r ? plan(r) : null;
}

export async function getPlanForSession(db: Db, sessionId: number): Promise<SafetyPlan | null> {
  const r = await db.first<any>('SELECT * FROM safety_plans WHERE session_id = ? ORDER BY id DESC LIMIT 1', [sessionId]);
  return r ? plan(r) : null;
}

export async function saveDraftPlan(db: Db, p: { expectedReturnAt: number | null; destination: string | null; notes: string | null }, now: number): Promise<void> {
  await db.tx(async () => {
    await db.run('DELETE FROM safety_plans WHERE session_id IS NULL');
    if (p.expectedReturnAt != null || p.destination || p.notes)
      await db.run('INSERT INTO safety_plans (expected_return_at, destination, notes, created_at) VALUES (?,?,?,?)', [p.expectedReturnAt, p.destination?.trim() || null, p.notes?.trim() || null, now]);
  });
}

export async function attachDraftPlan(db: Db, sessionId: number): Promise<SafetyPlan | null> {
  await db.run('UPDATE safety_plans SET session_id = ? WHERE session_id IS NULL', [sessionId]);
  return getPlanForSession(db, sessionId);
}

export async function updatePlan(db: Db, id: number, patch: Partial<Pick<SafetyPlan, 'expectedReturnAt' | 'notificationId' | 'overdueEventId'>>) {
  const cur = await db.first<any>('SELECT * FROM safety_plans WHERE id = ?', [id]);
  if (!cur) return;
  await db.run('UPDATE safety_plans SET expected_return_at = ?, notification_id = ?, overdue_event_id = ? WHERE id = ?', [
    patch.expectedReturnAt !== undefined ? patch.expectedReturnAt : cur.expected_return_at,
    patch.notificationId !== undefined ? patch.notificationId : cur.notification_id,
    patch.overdueEventId !== undefined ? patch.overdueEventId : cur.overdue_event_id,
    id,
  ]);
}

// ---------------------------------------------------------------- emergency events & alerts

export interface StoredEvent {
  id: string; sessionId: number | null; kind: EmergencyKind; createdAt: number;
  lat: number | null; lon: number | null; acc: number | null; fixT: number | null; positionLive: boolean; battery: number | null;
  message: string; shortMessage: string; resolvedAt: number | null;
}

const ev = (r: any): StoredEvent => ({ id: r.id, sessionId: r.session_id, kind: r.kind, createdAt: r.created_at, lat: r.lat, lon: r.lon, acc: r.acc, fixT: r.fix_t, positionLive: !!r.position_live, battery: r.battery, message: r.message, shortMessage: r.short_message, resolvedAt: r.resolved_at });

export async function listEvents(db: Db, sessionId?: number): Promise<StoredEvent[]> {
  const rows = sessionId == null
    ? await db.all<any>('SELECT * FROM emergency_events ORDER BY created_at DESC LIMIT 100')
    : await db.all<any>('SELECT * FROM emergency_events WHERE session_id = ? ORDER BY created_at', [sessionId]);
  return rows.map(ev);
}

export async function getEvent(db: Db, id: string): Promise<StoredEvent | null> {
  const r = await db.first<any>('SELECT * FROM emergency_events WHERE id = ?', [id]);
  return r ? ev(r) : null;
}

export async function resolveEvent(db: Db, id: string, now: number) {
  await db.tx(async () => {
    await db.run('UPDATE emergency_events SET resolved_at = ? WHERE id = ?', [now, id]);
    await db.run("UPDATE pending_alerts SET status = 'expired', updated_at = ?, detail = 'Emergency marked resolved' WHERE event_id = ? AND status IN ('saved_local','waiting','failed')", [now, id]);
  });
}

export interface StoredAlert {
  id: number; eventId: string; channel: AlertChannel; recipient: string | null; status: AlertStatus; attempts: number; msgId: string | null; detail: string | null; updatedAt: number;
}

const al = (r: any): StoredAlert => ({ id: r.id, eventId: r.event_id, channel: r.channel, recipient: r.recipient, status: r.status, attempts: r.attempts, msgId: r.msg_id, detail: r.detail, updatedAt: r.updated_at });

export async function listAlerts(db: Db, eventId?: string): Promise<StoredAlert[]> {
  const rows = eventId == null
    ? await db.all<any>("SELECT * FROM pending_alerts WHERE status IN ('saved_local','waiting','handed_off','failed') ORDER BY id")
    : await db.all<any>('SELECT * FROM pending_alerts WHERE event_id = ? ORDER BY id', [eventId]);
  return rows.map(al);
}

export async function getAlert(db: Db, id: number): Promise<StoredAlert | null> {
  const r = await db.first<any>('SELECT * FROM pending_alerts WHERE id = ?', [id]);
  return r ? al(r) : null;
}

export async function findAlertByMsgId(db: Db, msgId: string): Promise<StoredAlert | null> {
  const r = await db.first<any>('SELECT * FROM pending_alerts WHERE msg_id = ?', [msgId]);
  return r ? al(r) : null;
}

// ---------------------------------------------------------------- bluetooth inbox

export interface BleMessage {
  msgId: string; receivedAt: number; hops: number; readable: boolean; payload: any | null; packet: string; expiresAt: number;
}

export async function saveBleMessage(db: Db, m: BleMessage): Promise<boolean> {
  const r = await db.run('INSERT OR IGNORE INTO ble_messages (msg_id, received_at, hops, readable, payload, packet, expires_at) VALUES (?,?,?,?,?,?,?)', [m.msgId, m.receivedAt, m.hops, m.readable ? 1 : 0, m.payload ? JSON.stringify(m.payload) : null, m.packet, m.expiresAt]);
  return r.changes > 0;
}

export async function listBleMessages(db: Db, now: number): Promise<BleMessage[]> {
  await db.run('DELETE FROM ble_messages WHERE expires_at < ?', [now]);
  return (await db.all<any>('SELECT * FROM ble_messages ORDER BY received_at DESC')).map((r) => ({ msgId: r.msg_id, receivedAt: r.received_at, hops: r.hops, readable: !!r.readable, payload: r.payload ? JSON.parse(r.payload) : null, packet: r.packet, expiresAt: r.expires_at }));
}
