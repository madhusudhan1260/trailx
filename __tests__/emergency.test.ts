import { randomBytes } from 'crypto';
import {
  ALERT_STATUS_LABEL, availableChannels, buildEmergencyMessage, buildShortMessage, lastReliable,
  makeEmergencyId, nextAlertStatus, overdueLevel, type EmergencyEvent,
} from '@/core/emergency';
import {
  decryptPacket, derivePartyKey, encodePacket, fragment, fromBase64, isExpired, OPEN_RESCUE_KEY,
  PacketType, readHeader, Reassembler, RelayEngine, toBase64, type SosPayload,
} from '@/core/protocol';
import { fix, ORIGIN } from './helpers';

const T = Date.UTC(2026, 10, 11, 6, 30, 0);
const rng = (n: number) => new Uint8Array(randomBytes(n));

const event: EmergencyEvent = {
  id: 'TX-7K2M9Q',
  kind: 'sos',
  createdAt: T,
  position: fix(ORIGIN, T - 4000, 9, 912),
  positionLive: true,
  trail: [fix(ORIGIN, T - 60000, 8), fix(ORIGIN, T - 4000, 9)],
  start: { lat: 12.9, lon: 77.5, t: T - 3_600_000 },
  battery: 0.23,
  profile: { name: 'Asha', bloodGroup: 'O+', medical: 'Asthma', allergies: null },
  contacts: [{ id: 1, name: 'Ravi', phone: '+911234567890', relation: 'Brother' }],
  destination: 'Ridge camp',
};

describe('emergency message', () => {
  it('contains every required field', () => {
    const m = buildEmergencyMessage(event);
    for (const part of ['TX-7K2M9Q', '12.971600, 77.594600', '±9 m', '2026-11-11 06:29:56 UTC', '12.900000, 77.500000', '23%', 'Ravi (Brother): +911234567890', 'O+', 'Asthma', 'CURRENT LOCATION'])
      expect(m).toContain(part);
  });

  it('says so plainly when the position is not live or unknown', () => {
    expect(buildEmergencyMessage({ ...event, positionLive: false })).toContain('LAST KNOWN LOCATION');
    const none = buildEmergencyMessage({ ...event, position: null, trail: [], battery: null });
    expect(none).toContain('LOCATION UNKNOWN');
    expect(none).toContain('battery: unknown');
    expect(buildShortMessage({ ...event, position: null })).toContain('Location unknown');
  });

  it('short form fits in three SMS segments', () => {
    expect(buildShortMessage(event).length).toBeLessThanOrEqual(459);
    expect(buildShortMessage(event)).toContain('12.97160,77.59460');
  });

  it('lastReliable keeps the five newest trustworthy fixes in order', () => {
    const fixes = Array.from({ length: 9 }, (_, i) => fix(ORIGIN, T + i, i === 7 ? 300 : i === 8 ? null : 10));
    const r = lastReliable(fixes);
    expect(r.map((f) => f.t - T)).toEqual([2, 3, 4, 5, 6]);
  });

  it('ids avoid look-alike characters', () => {
    const id = makeEmergencyId(Uint8Array.from([0, 1, 31, 32, 255, 100]));
    expect(id).toMatch(/^TX-[2-9A-HJ-NP-Z]{6}$/);
  });
});

describe('alert delivery states', () => {
  it('never jumps to delivery_confirmed without first being sent', () => {
    for (const s of ['saved_local', 'waiting', 'handed_off', 'failed'] as const) expect(nextAlertStatus(s, 'ack')).toBeNull();
    expect(nextAlertStatus('sent', 'ack')).toBe('delivery_confirmed');
  });
  it('opening the SMS composer is a hand-off, not a send', () => {
    expect(nextAlertStatus('waiting', 'handoff')).toBe('handed_off');
    expect(ALERT_STATUS_LABEL.handed_off).toMatch(/not confirmed/i);
    expect(ALERT_STATUS_LABEL.sent).toMatch(/not confirmed/i);
  });
  it('follows the normal path and allows retry after failure', () => {
    expect(nextAlertStatus('saved_local', 'queue')).toBe('waiting');
    expect(nextAlertStatus('waiting', 'reported_sent')).toBe('sent');
    expect(nextAlertStatus('waiting', 'fail')).toBe('failed');
    expect(nextAlertStatus('failed', 'retry')).toBe('waiting');
    expect(nextAlertStatus('delivery_confirmed', 'retry')).toBeNull();
    expect(nextAlertStatus('expired', 'handoff')).toBeNull();
  });
  it('offline with no peers there is no channel at all', () => {
    expect(availableChannels({ smsAvailable: false, online: false, blePeers: 0, satelliteReady: false })).toEqual([]);
    expect(availableChannels({ smsAvailable: true, online: false, blePeers: 2, satelliteReady: false })).toEqual(['sms', 'ble']);
  });
});

describe('overdue trek', () => {
  it('classifies relative to the expected return time', () => {
    expect(overdueLevel(null, T).level).toBe('none');
    expect(overdueLevel(T + 3 * 3600_000, T).level).toBe('ok');
    expect(overdueLevel(T + 10 * 60_000, T).level).toBe('due_soon');
    const o = overdueLevel(T - 25 * 60_000, T);
    expect(o).toEqual({ level: 'overdue', deltaMs: 25 * 60_000 });
  });
});

describe('device-to-device protocol', () => {
  const payload: SosPayload = { id: 'TX-7K2M9Q', k: 'sos', t: T, n: 'Asha', p: [12.9716, 77.5946, 9, T - 4000], live: true, s: [12.9, 77.5], b: 0.23, tr: [[12.97, 77.59, T - 60000]], m: null };
  const party = derivePartyKey('ridge-42');
  const make = (extra = {}) => encodePacket({ type: PacketType.SOS, payload, key: party, partyKey: true, now: T, rng, ...extra });

  it('encrypts: payload is unreadable on the wire and round-trips with the right key', () => {
    const pkt = make();
    expect(new TextDecoder().decode(pkt)).not.toContain('Asha');
    expect(decryptPacket(pkt, party)).toEqual(payload);
    expect(decryptPacket(pkt, derivePartyKey('other'))).toBeNull();
    expect(decryptPacket(pkt, OPEN_RESCUE_KEY)).toBeNull();
  });

  it('party codes are case/space insensitive', () => {
    expect(Array.from(derivePartyKey(' Ridge-42 '))).toEqual(Array.from(party));
  });

  it('detects tampering with the ciphertext or the authenticated header', () => {
    const a = make();
    a[a.length - 20] ^= 1;
    expect(decryptPacket(a, party)).toBeNull();
    const b = make();
    b[18] ^= 0xff; // extend the TTL
    expect(decryptPacket(b, party)).toBeNull();
  });

  it('gives every message a unique id', () => {
    const ids = new Set(Array.from({ length: 50 }, () => readHeader(make())!.msgId.join(',')));
    expect(ids.size).toBe(50);
  });

  it('drops duplicates', () => {
    const relay = new RelayEngine(() => [party]);
    const pkt = make();
    expect(relay.handle(pkt, T).action).toBe('deliver');
    expect(relay.handle(pkt, T + 1000)).toEqual({ action: 'drop', reason: 'duplicate' });
    // the same message arriving via another relay (different hop count) is still a duplicate
    const viaRelay = pkt.slice();
    viaRelay[19] = 2;
    expect(relay.handle(viaRelay, T + 2000)).toEqual({ action: 'drop', reason: 'duplicate' });
  });

  it('expires messages after their TTL', () => {
    const pkt = make({ ttlMin: 30 });
    expect(isExpired(readHeader(pkt)!, T + 29 * 60_000)).toBe(false);
    expect(new RelayEngine(() => [party]).handle(pkt, T + 31 * 60_000)).toEqual({ action: 'drop', reason: 'expired' });
  });

  it('limits forwarding hops, and relayed copies still decrypt', () => {
    let pkt = make({ maxHops: 2 });
    const hops: number[] = [];
    for (let i = 0; i < 5; i++) {
      const d = new RelayEngine(() => [party]).handle(pkt, T);
      if (d.action !== 'deliver') throw new Error('unexpected drop');
      expect(d.payload).toEqual(payload);
      hops.push(d.header.hops);
      if (!d.forward) break;
      pkt = d.forward;
    }
    expect(hops).toEqual([0, 1, 2]);
  });

  it('a claimed maxHops above the absolute cap is not honoured', () => {
    const pkt = make();
    pkt[20] = 200;
    pkt[19] = 6;
    const d = new RelayEngine(() => []).handle(pkt, T);
    expect(d.action === 'deliver' && d.forward).toBeNull();
  });

  it('a device without the key relays what it cannot read', () => {
    const d = new RelayEngine(() => [OPEN_RESCUE_KEY]).handle(make(), T);
    expect(d.action === 'deliver' && d.payload === null && d.forward !== null).toBe(true);
  });

  it('rejects malformed packets and packets from the far future', () => {
    const relay = new RelayEngine(() => [party]);
    expect(relay.handle(new Uint8Array(10), T)).toEqual({ action: 'drop', reason: 'malformed' });
    expect(relay.handle(make(), T - 3600_000)).toEqual({ action: 'drop', reason: 'from_future' });
  });

  it('fragments for a 20-byte BLE payload and reassembles in any order', () => {
    const pkt = make();
    const frags = fragment(pkt, 20);
    expect(frags.every((f) => f.length <= 20)).toBe(true);
    const r = new Reassembler();
    let out: Uint8Array | null = null;
    for (const f of [...frags].reverse()) out = r.push(f, T) ?? out;
    expect(Array.from(out!)).toEqual(Array.from(pkt));
    expect(decryptPacket(out!, party)).toEqual(payload);
  });

  it('incomplete fragments never yield a packet', () => {
    const frags = fragment(make(), 60);
    const r = new Reassembler();
    expect(frags.slice(0, -1).map((f) => r.push(f, T)).every((x) => x === null)).toBe(true);
  });

  it('base64 round-trips arbitrary bytes', () => {
    for (const n of [0, 1, 2, 3, 4, 57, 200]) {
      const b = rng(n);
      expect(Array.from(fromBase64(toBase64(b)))).toEqual(Array.from(b));
      expect(toBase64(b)).toBe(Buffer.from(b).toString('base64'));
    }
  });
});
