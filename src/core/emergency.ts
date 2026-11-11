import { formatCoord } from './geo';
import type { LatLon, RawFix } from './types';

export interface EmergencyContact {
  id: number;
  name: string;
  phone: string;
  relation: string | null;
}

export interface EmergencyProfile {
  name: string | null;
  bloodGroup: string | null;
  medical: string | null;
  allergies: string | null;
}

export type EmergencyKind = 'sos' | 'overdue';

export interface EmergencyEvent {
  /** Short human-readable identifier, e.g. TX-7K2M9Q. */
  id: string;
  kind: EmergencyKind;
  createdAt: number;
  /** Best position available when the event was raised. Null if the device never had a fix. */
  position: RawFix | null;
  /** True when `position` came from a fix taken at activation; false when it is the last known one. */
  positionLive: boolean;
  /** Up to five most recent reliable fixes, oldest first. */
  trail: RawFix[];
  start: (LatLon & { t: number }) | null;
  /** 0..1, or null when the OS would not report it. */
  battery: number | null;
  profile: EmergencyProfile;
  contacts: EmergencyContact[];
  destination: string | null;
}

const ID_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I — read aloud over a bad line

export function makeEmergencyId(randomBytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += ID_ALPHABET[randomBytes[i] % ID_ALPHABET.length];
  return `TX-${s}`;
}

function utc(t: number): string {
  return new Date(t).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

/** Picks the last `n` reliable fixes (those with an accuracy estimate within `maxAcc`), oldest first. */
export function lastReliable(fixes: RawFix[], n = 5, maxAcc = 50): RawFix[] {
  return fixes.filter((f) => f.acc != null && f.acc <= maxAcc).slice(-n);
}

/** Full emergency report. Deliberately plain text so it survives SMS, chat apps, and being read aloud. */
export function buildEmergencyMessage(e: EmergencyEvent): string {
  const L: string[] = [];
  L.push(e.kind === 'sos' ? `EMERGENCY SOS — TRAILX ${e.id}` : `OVERDUE TREKKER — TRAILX ${e.id}`);
  if (e.profile.name) L.push(`${e.profile.name} needs help.`);
  L.push(`Raised: ${utc(e.createdAt)}`);
  L.push('');
  if (e.position) {
    L.push(e.positionLive ? 'CURRENT LOCATION' : 'LAST KNOWN LOCATION (no live GPS when raised)');
    L.push(formatCoord(e.position, 6));
    L.push(`Fix time: ${utc(e.position.t)}`);
    L.push(`GPS accuracy: ${e.position.acc != null ? `±${Math.round(e.position.acc)} m` : 'unknown'}`);
    if (e.position.alt != null) L.push(`Altitude: ${Math.round(e.position.alt)} m (GPS, approximate)`);
    L.push(`Map: https://maps.google.com/?q=${e.position.lat.toFixed(6)},${e.position.lon.toFixed(6)}`);
  } else {
    L.push('LOCATION UNKNOWN — the phone had no GPS fix.');
  }
  if (e.trail.length > 1) {
    L.push('');
    L.push('Recent track (oldest first):');
    for (const f of e.trail) L.push(`  ${formatCoord(f, 5)}  ${new Date(f.t).toISOString().slice(11, 19)}Z  ±${Math.round(f.acc ?? 0)}m`);
  }
  if (e.start) {
    L.push('');
    L.push(`Trek started at: ${formatCoord(e.start, 6)} (${utc(e.start.t)})`);
  }
  if (e.destination) L.push(`Planned destination: ${e.destination}`);
  L.push(`Phone battery: ${e.battery != null ? `${Math.round(e.battery * 100)}%` : 'unknown'}`);
  const med = [
    e.profile.bloodGroup && `Blood group ${e.profile.bloodGroup}`,
    e.profile.allergies && `Allergies: ${e.profile.allergies}`,
    e.profile.medical && `Medical: ${e.profile.medical}`,
  ].filter(Boolean);
  if (med.length) {
    L.push('');
    L.push(...(med as string[]));
  }
  if (e.contacts.length) {
    L.push('');
    L.push('Emergency contacts:');
    for (const c of e.contacts) L.push(`  ${c.name}${c.relation ? ` (${c.relation})` : ''}: ${c.phone}`);
  }
  return L.join('\n');
}

/** Short form that fits in a couple of SMS segments. */
export function buildShortMessage(e: EmergencyEvent): string {
  const who = e.profile.name ? `${e.profile.name} ` : '';
  const head = e.kind === 'sos' ? `SOS ${who}needs help.` : `${who}is overdue from a trek.`;
  if (!e.position) return `${head} TRAILX ${e.id}. Location unknown (no GPS). Battery ${e.battery != null ? Math.round(e.battery * 100) + '%' : '?'}.`;
  const p = e.position;
  return (
    `${head} TRAILX ${e.id}. ${e.positionLive ? 'Location' : 'Last known location'} ${p.lat.toFixed(5)},${p.lon.toFixed(5)} ` +
    `±${p.acc != null ? Math.round(p.acc) : '?'}m at ${new Date(p.t).toISOString().slice(0, 16).replace('T', ' ')}Z. ` +
    `Battery ${e.battery != null ? Math.round(e.battery * 100) + '%' : '?'}. ` +
    `https://maps.google.com/?q=${p.lat.toFixed(5)},${p.lon.toFixed(5)}`
  );
}

// ---------------------------------------------------------------------------------------------
// Delivery queue
// ---------------------------------------------------------------------------------------------

export type AlertChannel = 'sms' | 'share' | 'ble' | 'satellite';

/**
 * The only states an alert can be in. The wording matters: "handed_off" means we opened the SMS
 * composer or share sheet and CANNOT know whether the user pressed send. Only "delivery_confirmed"
 * means a recipient device acknowledged the message.
 */
export type AlertStatus =
  | 'saved_local'
  | 'waiting'
  | 'handed_off'
  | 'sent'
  | 'delivery_confirmed'
  | 'failed'
  | 'expired';

export type AlertAction = 'queue' | 'handoff' | 'reported_sent' | 'ack' | 'fail' | 'retry' | 'expire';

const TRANSITIONS: Record<AlertStatus, Partial<Record<AlertAction, AlertStatus>>> = {
  saved_local: { queue: 'waiting', handoff: 'handed_off', reported_sent: 'sent', fail: 'failed', expire: 'expired' },
  waiting: { handoff: 'handed_off', reported_sent: 'sent', fail: 'failed', expire: 'expired' },
  handed_off: { reported_sent: 'sent', handoff: 'handed_off', fail: 'failed', retry: 'waiting', expire: 'expired' },
  sent: { ack: 'delivery_confirmed', retry: 'waiting' },
  delivery_confirmed: {},
  failed: { retry: 'waiting', handoff: 'handed_off', reported_sent: 'sent', expire: 'expired' },
  expired: {},
};

/** Returns the next status, or null when the action is not allowed from the current one. */
export function nextAlertStatus(status: AlertStatus, action: AlertAction): AlertStatus | null {
  return TRANSITIONS[status][action] ?? null;
}

export const ALERT_STATUS_LABEL: Record<AlertStatus, string> = {
  saved_local: 'Saved on this phone',
  waiting: 'Waiting for a way to send',
  handed_off: 'Opened in messaging app — not confirmed sent',
  sent: 'Sent — delivery not confirmed',
  delivery_confirmed: 'Delivery confirmed by recipient device',
  failed: 'Sending failed',
  expired: 'Expired',
};

export interface ChannelAvailability {
  smsAvailable: boolean;
  online: boolean;
  blePeers: number;
  satelliteReady: boolean;
}

/** Which channels can carry an alert right now. Empty means: keep it saved and keep waiting. */
export function availableChannels(a: ChannelAvailability): AlertChannel[] {
  const out: AlertChannel[] = [];
  if (a.satelliteReady) out.push('satellite');
  if (a.smsAvailable) out.push('sms');
  if (a.online) out.push('share');
  if (a.blePeers > 0) out.push('ble');
  return out;
}

// ---------------------------------------------------------------------------------------------
// Overdue trek
// ---------------------------------------------------------------------------------------------

export type OverdueLevel = 'none' | 'ok' | 'due_soon' | 'overdue';

export function overdueLevel(expectedReturnAt: number | null, now: number, warnBeforeMs = 30 * 60_000): { level: OverdueLevel; deltaMs: number } {
  if (expectedReturnAt == null) return { level: 'none', deltaMs: 0 };
  const delta = now - expectedReturnAt;
  if (delta >= 0) return { level: 'overdue', deltaMs: delta };
  if (-delta <= warnBeforeMs) return { level: 'due_soon', deltaMs: delta };
  return { level: 'ok', deltaMs: delta };
}
