import * as Crypto from 'expo-crypto';
import { PermissionsAndroid, Platform } from 'react-native';
import { create } from 'zustand';
import {
  decryptPacket, derivePartyKey, encodePacket, fragment, fromBase64, fromHex, OPEN_RESCUE_KEY, PacketType,
  readHeader, Reassembler, RelayEngine, toBase64, toHex, type AckPayload, type SosPayload,
} from '@/core/protocol';
import { getDb } from '@/db';
import { findAlertByMsgId, saveBleMessage } from '@/db/repo';
import { useApp } from '@/store';
import { Peripheral } from '../../modules/trailx-ble-peripheral';
import { applyAlertAction } from './emergencyStore';
import { haptic } from './device';
import { notifyNow } from './notify';

/**
 * Direct device-to-device emergency messaging over Bluetooth Low Energy.
 *
 * Each phone plays both roles:
 *   peripheral — advertises the TRAILX service and accepts writes (native module in /modules)
 *   central    — scans in short, spaced windows, connects to peers and writes queued packets
 *
 * Relay architecture: anything received that is still within its hop limit is placed in the same
 * outbox used for our own messages, so it is passed on at the next scan window. That store-and-
 * forward step is the building block for a future mesh; today it yields limited multi-hop relaying
 * between phones that happen to pass within range. Typical BLE range outdoors is tens of metres
 * and delivery is never guaranteed.
 */

export const SERVICE_UUID = '7a1f0001-6c2e-4b8a-9d3e-545241494c58';
export const RX_UUID = '7a1f0002-6c2e-4b8a-9d3e-545241494c58';
export const TX_UUID = '7a1f0003-6c2e-4b8a-9d3e-545241494c58';

const SCAN_MS = 8_000;
const IDLE_MS = 22_000;
const WRITE_CHUNK = 180; // used when a larger MTU was negotiated; falls back to 20
const PEER_TTL_MS = 90_000;

export interface BleState {
  supported: boolean | null;
  running: boolean;
  advertising: boolean;
  scanning: boolean;
  error: string | null;
  /** Peers heard recently: id → last seen (ms) and signal strength. */
  peers: Record<string, { seen: number; rssi: number | null }>;
  outbox: number;
  lastActivity: string | null;
  inboxVersion: number;
}

export const useBle = create<BleState>(() => ({
  supported: null, running: false, advertising: false, scanning: false, error: null, peers: {}, outbox: 0, lastActivity: null, inboxVersion: 0,
}));

interface OutItem {
  id: string;
  packet: Uint8Array;
  expiresAt: number;
  /** Peer ids this packet has already been written to. */
  sentTo: Set<string>;
  /** pending_alerts row to update, for messages we originated. */
  alertId: number | null;
}

let manager: import('react-native-ble-plx').BleManager | null = null;
let outbox: OutItem[] = [];
let loop: ReturnType<typeof setTimeout> | null = null;
let subs: { remove(): void }[] = [];
const reassembler = new Reassembler();
const relay = new RelayEngine(() => keys());

function keys(): Uint8Array[] {
  const code = useApp.getState().user?.partyCode;
  return code ? [partyKey(code), OPEN_RESCUE_KEY] : [OPEN_RESCUE_KEY];
}

let cachedKey: { code: string; key: Uint8Array } | null = null;
function partyKey(code: string): Uint8Array {
  if (cachedKey?.code !== code) cachedKey = { code, key: derivePartyKey(code) };
  return cachedKey.key;
}

const rng = (n: number) => Crypto.getRandomBytes(n);

export function activePeerCount(): number {
  const now = Date.now();
  return Object.values(useBle.getState().peers).filter((p) => now - p.seen < PEER_TTL_MS).length;
}

async function ensurePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (Platform.Version >= 31) {
    const r = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
    ]);
    return Object.values(r).every((v) => v === PermissionsAndroid.RESULTS.GRANTED);
  }
  return (await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION)) === PermissionsAndroid.RESULTS.GRANTED;
}

/** Starts advertising + periodic scanning. Resolves false (with a reason in the store) if the radio cannot be used. */
export async function startBle(): Promise<boolean> {
  const set = useBle.setState;
  if (useBle.getState().running) return true;
  if (Platform.OS === 'web') {
    set({ supported: false, error: 'Bluetooth messaging needs the installed app; browsers cannot advertise over BLE.' });
    return false;
  }
  let plx: typeof import('react-native-ble-plx');
  try {
    plx = require('react-native-ble-plx');
    manager = manager ?? new plx.BleManager();
  } catch {
    set({ supported: false, error: 'This build does not include the Bluetooth module (it is not available in Expo Go). Use a development or release build.' });
    return false;
  }
  if (!(await ensurePermissions())) {
    set({ error: 'Bluetooth permission was not granted.' });
    return false;
  }
  const state = await manager.state();
  if (state !== plx.State.PoweredOn) {
    set({ supported: state !== plx.State.Unsupported, error: state === plx.State.Unsupported ? 'This device has no Bluetooth Low Energy radio.' : 'Bluetooth is switched off. Turn it on to reach nearby TRAILX devices.' });
    return false;
  }

  set({ supported: true, running: true, error: null });

  // ---- peripheral role
  if (Peripheral) {
    try {
      subs.push(Peripheral.addListener('onWrite', (e) => void onFragment(e.value, 'peripheral')));
      subs.push(Peripheral.addListener('onAdvertising', (e) => set({ advertising: e.advertising, error: e.error ?? useBle.getState().error })));
      await Peripheral.start(SERVICE_UUID, RX_UUID, TX_UUID);
    } catch (e) {
      set({ advertising: false, error: `Cannot advertise: ${(e as Error).message}. This phone can still find other devices.` });
    }
  } else {
    set({ advertising: false, error: 'This build cannot advertise, so other phones will not discover it. It can still find them.' });
  }

  // ---- central role
  scheduleScan(0);
  return true;
}

export async function stopBle() {
  if (loop) clearTimeout(loop);
  loop = null;
  subs.forEach((s) => s.remove());
  subs = [];
  manager?.stopDeviceScan();
  await Peripheral?.stop().catch(() => undefined);
  useBle.setState({ running: false, advertising: false, scanning: false, peers: {} });
}

function scheduleScan(delay: number) {
  if (loop) clearTimeout(loop);
  loop = setTimeout(() => void scanWindow(), delay);
}

async function scanWindow() {
  const m = manager;
  if (!m || !useBle.getState().running) return;
  const plx: typeof import('react-native-ble-plx') = require('react-native-ble-plx');
  const found = new Map<string, import('react-native-ble-plx').Device>();
  useBle.setState({ scanning: true });
  try {
    await m.startDeviceScan([SERVICE_UUID], { scanMode: plx.ScanMode.LowPower, allowDuplicates: false }, (err, device) => {
      if (err) {
        useBle.setState({ error: err.message });
        return;
      }
      if (!device) return;
      found.set(device.id, device);
      useBle.setState((s) => ({ peers: { ...s.peers, [device.id]: { seen: Date.now(), rssi: device.rssi } } }));
    });
  } catch (e) {
    useBle.setState({ error: (e as Error).message });
  }
  await new Promise((r) => setTimeout(r, SCAN_MS));
  m.stopDeviceScan();
  useBle.setState({ scanning: false });

  const now = Date.now();
  outbox = outbox.filter((o) => o.expiresAt > now);
  useBle.setState((s) => ({
    outbox: outbox.length,
    peers: Object.fromEntries(Object.entries(s.peers).filter(([, p]) => now - p.seen < PEER_TTL_MS)),
  }));

  for (const device of found.values()) {
    const due = outbox.filter((o) => !o.sentTo.has(device.id));
    if (due.length) await deliverTo(device, due);
  }
  // Scan again sooner while there is something waiting to go out.
  if (useBle.getState().running) scheduleScan(outbox.some((o) => o.sentTo.size === 0) ? 4_000 : IDLE_MS);
}

async function deliverTo(device: import('react-native-ble-plx').Device, items: OutItem[]) {
  const m = manager;
  if (!m) return;
  let conn: import('react-native-ble-plx').Device | null = null;
  try {
    conn = await m.connectToDevice(device.id, { timeout: 8000, requestMTU: 185 });
    await conn.discoverAllServicesAndCharacteristics();
    const chunk = conn.mtu && conn.mtu >= WRITE_CHUNK + 3 ? WRITE_CHUNK : 20;
    // Listen for the peer's acknowledgement before writing.
    const mon = conn.monitorCharacteristicForService(SERVICE_UUID, TX_UUID, (err, c) => {
      if (!err && c?.value) void onFragment(c.value, 'central');
    });
    for (const item of items) {
      for (const f of fragment(item.packet, chunk)) await conn.writeCharacteristicWithResponseForService(SERVICE_UUID, RX_UUID, toBase64(f));
      item.sentTo.add(device.id);
      // The GATT write was acknowledged at the radio level: the peer's phone has the bytes.
      // That is "sent", not "delivered to a person" — confirmation needs the peer's encrypted ACK.
      if (item.alertId != null) await applyAlertAction(await getDb(), item.alertId, 'reported_sent', Date.now(), `Written to ${item.sentTo.size} nearby device(s) — awaiting acknowledgement`, item.id);
      useBle.setState({ lastActivity: `Sent to a nearby device at ${new Date().toLocaleTimeString()}` });
      useApp.getState().touch();
    }
    await new Promise((r) => setTimeout(r, 2500)); // give the peer a moment to notify its ACK
    mon.remove();
  } catch (e) {
    useBle.setState({ lastActivity: `Could not reach a nearby device (${(e as Error).message})` });
  } finally {
    await conn?.cancelConnection().catch(() => undefined);
  }
}

/** Handles one incoming fragment from either role. */
async function onFragment(base64: string, via: 'peripheral' | 'central') {
  const now = Date.now();
  const packet = reassembler.push(fromBase64(base64), now);
  if (!packet) return;
  const decision = relay.handle(packet, now);
  if (decision.action === 'drop') return;
  const { header, payload, forward } = decision;
  const id = toHex(header.msgId);
  const db = await getDb();

  if (header.type === PacketType.ACK) {
    const ack = payload as AckPayload | null;
    if (!ack?.ack) return;
    const alert = await findAlertByMsgId(db, ack.ack);
    if (alert) {
      await applyAlertAction(db, alert.id, 'ack', now, 'A nearby TRAILX device confirmed it received and decrypted this message');
      useBle.setState({ lastActivity: `Delivery confirmed by a nearby device at ${new Date().toLocaleTimeString()}` });
      useApp.getState().touch();
      haptic('success');
    }
    return;
  }

  if (header.type !== PacketType.SOS) return;
  const fresh = await saveBleMessage(db, {
    msgId: id, receivedAt: now, hops: header.hops, readable: payload != null, payload, packet: toBase64(packet), expiresAt: (header.createdAt + header.ttlMin * 60) * 1000,
  });
  if (!fresh) return;
  useBle.setState((s) => ({ inboxVersion: s.inboxVersion + 1, lastActivity: `Emergency message received at ${new Date().toLocaleTimeString()}` }));

  if (payload) {
    const sos = payload as SosPayload;
    haptic('warning');
    void notifyNow('Emergency message from a nearby trekker', `${sos.n ?? 'Someone'} needs help${sos.p ? ` near ${sos.p[0].toFixed(5)}, ${sos.p[1].toFixed(5)}` : ''}. Open TRAILX › Safety.`);
    // Acknowledge to the sender, encrypted with whichever key opened the message.
    const key = keys().find((k) => decryptPacket(packet, k) != null)!;
    const ack = encodePacket({ type: PacketType.ACK, payload: { ack: id, t: now } satisfies AckPayload, key, partyKey: header.partyKey, now, rng, ttlMin: 10, maxHops: 0 });
    if (via === 'peripheral' && Peripheral) for (const f of fragment(ack, 20)) await Peripheral.notify(toBase64(f)).catch(() => 0);
  }
  // Store-and-forward: pass it on to other devices at the next scan window.
  if (forward) {
    outbox.push({ id, packet: forward, expiresAt: (header.createdAt + header.ttlMin * 60) * 1000, sentTo: new Set(), alertId: null });
    useBle.setState({ outbox: outbox.length });
  }
}

/** Queues an SOS for every TRAILX device that comes within range until it expires. Returns the message id. */
export function queueSos(payload: SosPayload, alertId: number | null): string {
  const code = useApp.getState().user?.partyCode;
  const now = Date.now();
  const packet = encodePacket({ type: PacketType.SOS, payload, key: code ? partyKey(code) : OPEN_RESCUE_KEY, partyKey: !!code, now, rng });
  const header = readHeader(packet)!;
  const id = toHex(header.msgId);
  relay.markSeen(header.msgId, (header.createdAt + header.ttlMin * 60) * 1000);
  outbox.push({ id, packet, expiresAt: (header.createdAt + header.ttlMin * 60) * 1000, sentTo: new Set(), alertId });
  useBle.setState({ outbox: outbox.length });
  if (useBle.getState().running) scheduleScan(0);
  return id;
}

export function clearOutboxFor(alertId: number) {
  outbox = outbox.filter((o) => o.alertId !== alertId);
  useBle.setState({ outbox: outbox.length });
}

export { fromHex };
