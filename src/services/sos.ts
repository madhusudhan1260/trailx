import * as Clipboard from 'expo-clipboard';
import * as Crypto from 'expo-crypto';
import * as SMS from 'expo-sms';
import { Platform, Share } from 'react-native';
import { overdueLevel, type ChannelAvailability, type EmergencyEvent, type EmergencyKind } from '@/core/emergency';
import type { SosPayload } from '@/core/protocol';
import { getDb } from '@/db';
import { getFieldKey } from './profileStore';
import { getEvent, listAlerts, listContacts, updatePlan, type StoredAlert, type StoredEvent } from '@/db/repo';
import { useApp } from '@/store';
import { activePeerCount, clearOutboxFor, queueSos, startBle, useBle } from './ble';
import { haptic } from './device';
import { applyAlertAction, raiseEmergency } from './emergencyStore';
import { notifyNow } from './notify';
import { readySatelliteProvider } from './satellite';
import { acquireFix } from './tracking';

/** A fix is considered "live" for an SOS if it arrived within this window. */
const LIVE_WINDOW_MS = 10_000;

/**
 * Raises an emergency. Order matters:
 *   1. gather what is known right now (no waiting if a fresh fix exists),
 *   2. write the event + queue to SQLite,
 *   3. only then try any radios.
 */
export async function triggerEmergency(kind: EmergencyKind): Promise<EmergencyEvent> {
  const s = useApp.getState();
  const now = Date.now();
  let liveFix = s.fix && s.fixAt != null && now - s.fixAt <= LIVE_WINDOW_MS ? s.fix : null;
  // No fresh fix: give the receiver 4 s to produce one, but never hold the SOS up longer than that.
  if (!liveFix && kind === 'sos' && s.permission === 'granted') liveFix = await acquireFix(4000, 40);
  const st = useApp.getState();
  const db = await getDb();
  const event = await raiseEmergency(db, {
    profileKey: (await getFieldKey()).key,
    kind,
    sessionId: st.trek?.id ?? null,
    liveFix,
    recentFixes: st.recentFixes.length ? st.recentFixes : st.fix ? [st.fix] : [],
    start: st.trek ? { lat: st.trek.start.lat, lon: st.trek.start.lon, t: st.trek.startedAt } : null,
    battery: st.battery,
    destination: st.plan?.destination ?? st.trek?.destination ?? null,
    now: Date.now(),
    randomBytes: (n) => Crypto.getRandomBytes(n),
  });
  haptic(kind === 'sos' ? 'heavy' : 'warning');
  for (const a of await listAlerts(db, event.id)) await applyAlertAction(db, a.id, 'queue', Date.now());
  st.touch();
  // Bluetooth is the one channel that can work with no network at all, so start it immediately.
  void broadcastOverBle(event.id);
  return event;
}

export async function channelAvailability(): Promise<ChannelAvailability> {
  const smsAvailable = Platform.OS === 'web' ? false : await SMS.isAvailableAsync().catch(() => false);
  return {
    smsAvailable,
    online: useApp.getState().online === true,
    blePeers: activePeerCount(),
    satelliteReady: (await readySatelliteProvider()) != null,
  };
}

function phoneOf(a: StoredAlert): string | null {
  const p = a.recipient?.split(' · ')[1];
  return p ? p.replace(/[^\d+]/g, '') : null;
}

/**
 * Opens the system SMS composer addressed to every emergency contact. TRAILX cannot send an SMS
 * silently — the user presses send. What we record afterwards is exactly what the OS told us.
 */
export async function sendSms(eventId: string): Promise<{ ok: boolean; message: string }> {
  const db = await getDb();
  const event = await getEvent(db, eventId);
  if (!event) return { ok: false, message: 'Emergency record not found.' };
  if (Platform.OS === 'web' || !(await SMS.isAvailableAsync().catch(() => false))) return { ok: false, message: 'This device cannot send SMS.' };
  const alerts = (await listAlerts(db, eventId)).filter((a) => a.channel === 'sms');
  const numbers = alerts.map(phoneOf).filter((n): n is string => !!n);
  if (numbers.length === 0) return { ok: false, message: 'Add an emergency contact first.' };
  const { result } = await SMS.sendSMSAsync(numbers, event.shortMessage);
  const now = Date.now();
  for (const a of alerts) {
    if (result === 'sent') await applyAlertAction(db, a.id, 'reported_sent', now, 'The messaging app reported the SMS as sent. No delivery receipt is available.');
    else if (result === 'unknown') await applyAlertAction(db, a.id, 'handoff', now, 'SMS composer opened. Android does not report whether you pressed send.');
    // 'cancelled': nothing was sent; leave the alert waiting.
  }
  useApp.getState().touch();
  return {
    ok: result !== 'cancelled',
    message: result === 'sent' ? 'SMS sent. Delivery to the recipient is not confirmed.' : result === 'unknown' ? 'SMS composer was opened. TRAILX cannot tell whether the message was sent — check your messaging app.' : 'SMS cancelled. Nothing was sent.',
  };
}

/** Hands the full message to any installed app (WhatsApp, email, …) through the system share sheet. */
export async function shareMessage(event: StoredEvent): Promise<void> {
  await Share.share({ message: event.message }).catch(() => undefined);
}

export async function copyMessage(event: StoredEvent): Promise<void> {
  await Clipboard.setStringAsync(event.message);
  haptic('light');
}

async function sosPayload(e: StoredEvent): Promise<SosPayload> {
  const db = await getDb();
  const user = useApp.getState().user;
  const trail = await db.all<{ lat: number; lon: number; t: number }>('SELECT lat, lon, t FROM emergency_locations WHERE event_id = ? ORDER BY t', [e.id]);
  const row = await db.first<{ start_lat: number | null; start_lon: number | null }>('SELECT start_lat, start_lon FROM emergency_events WHERE id = ?', [e.id]);
  return {
    id: e.id,
    k: e.kind,
    t: e.createdAt,
    n: user?.name ?? null,
    p: e.lat != null && e.lon != null ? [e.lat, e.lon, e.acc, e.fixT ?? e.createdAt] : null,
    live: e.positionLive,
    s: row?.start_lat != null && row.start_lon != null ? [row.start_lat, row.start_lon] : null,
    b: e.battery,
    tr: trail.map((f) => [f.lat, f.lon, f.t] as [number, number, number]),
    m: user?.medical ?? null,
  };
}

/** Starts Bluetooth if needed and queues the event for every TRAILX device that comes into range. */
export async function broadcastOverBle(eventId: string): Promise<boolean> {
  const db = await getDb();
  const event = await getEvent(db, eventId);
  if (!event || event.resolvedAt) return false;
  const alert = (await listAlerts(db, eventId)).find((a) => a.channel === 'ble');
  if (!alert || alert.status === 'delivery_confirmed' || alert.status === 'expired') return false;
  if (!(await startBle())) {
    await applyAlertAction(db, alert.id, 'fail', Date.now(), useBle.getState().error ?? 'Bluetooth unavailable');
    useApp.getState().touch();
    return false;
  }
  if (alert.status === 'failed' || alert.status === 'sent') await applyAlertAction(db, alert.id, 'retry', Date.now());
  clearOutboxFor(alert.id);
  queueSos(await sosPayload(event), alert.id);
  return true;
}

/** After an app restart, put unfinished Bluetooth alerts back in the radio outbox. */
export async function resumePendingBle(): Promise<void> {
  const db = await getDb();
  const open = await db.all<{ event_id: string }>(
    "SELECT DISTINCT a.event_id FROM pending_alerts a JOIN emergency_events e ON e.id = a.event_id WHERE a.channel = 'ble' AND a.status IN ('waiting','sent','failed') AND e.resolved_at IS NULL AND e.created_at > ?",
    [Date.now() - 12 * 3600_000],
  );
  for (const r of open) await broadcastOverBle(r.event_id);
}

// ----------------------------------------------------------------------------------------------
// Overdue trek
// ----------------------------------------------------------------------------------------------

let overdueBusy = false;

/**
 * Runs on a timer while the app is alive (the scheduled local notification covers the case where
 * it is not). When the expected return time passes, an emergency message is PREPARED and saved.
 * It is not sent to anyone automatically — the user is shown the channels that are available.
 */
export async function checkOverdue(): Promise<StoredEvent | null> {
  const s = useApp.getState();
  const plan = s.plan;
  if (!s.trek || !plan || overdueBusy) return null;
  if (plan.overdueEventId) return null;
  if (overdueLevel(plan.expectedReturnAt, Date.now()).level !== 'overdue') return null;
  overdueBusy = true;
  try {
    const event = await triggerEmergency('overdue');
    const db = await getDb();
    await updatePlan(db, plan.id, { overdueEventId: event.id });
    s.set({ plan: { ...plan, overdueEventId: event.id } });
    void notifyNow('Overdue: emergency message prepared', 'It has NOT been sent. Open TRAILX to send it or to mark yourself safe.');
    return await getEvent(db, event.id);
  } finally {
    overdueBusy = false;
  }
}

export async function contactsCount(): Promise<number> {
  return (await listContacts(await getDb())).length;
}
