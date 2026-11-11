import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

/**
 * TRAILX device-to-device message protocol (transport independent).
 *
 * Packet layout (big-endian):
 *   0  'T' 'X'            magic
 *   2  version            = 1
 *   3  type               1 SOS, 2 ACK, 3 PING
 *   4  flags              bit0: 1 = party key, 0 = open rescue key
 *   5  msgId[8]           random, unique per message
 *   13 createdAt u32      unix seconds
 *   17 ttlMin u16         message lifetime in minutes
 *   19 hops u8            incremented by every relay (not authenticated — it must be mutable)
 *   20 maxHops u8         relays stop forwarding at this count
 *   21 nonce[24]
 *   45 ciphertext + 16-byte Poly1305 tag (XChaCha20-Poly1305, header as associated data)
 */

export const PROTOCOL_VERSION = 1;
export const HEADER_LEN = 21;
export const NONCE_LEN = 24;
export const DEFAULT_TTL_MIN = 12 * 60;
export const DEFAULT_MAX_HOPS = 3;
/** Hard cap so a misbehaving peer cannot make a message travel forever. */
export const ABSOLUTE_MAX_HOPS = 6;

export enum PacketType {
  SOS = 1,
  ACK = 2,
  PING = 3,
}

export interface PacketHeader {
  type: PacketType;
  partyKey: boolean;
  msgId: Uint8Array;
  createdAt: number;
  ttlMin: number;
  hops: number;
  maxHops: number;
}

export type Rng = (n: number) => Uint8Array;

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * The open rescue key is published in this source file. It gives integrity framing only — NOT
 * confidentiality. It exists so any TRAILX device can read an SOS from a stranger.
 */
export const OPEN_RESCUE_KEY = sha256(enc.encode('trailx/v1/open-rescue'));

/** Derives a private key from a party code shared out-of-band by people trekking together. */
export function derivePartyKey(code: string): Uint8Array {
  return pbkdf2(sha256, enc.encode(code.trim().toUpperCase()), enc.encode('trailx/v1/party'), { c: 20_000, dkLen: 32 });
}

export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const fromHex = (h: string) => new Uint8Array((h.match(/.{2}/g) ?? []).map((x) => parseInt(x, 16)));

function writeHeader(h: PacketHeader): Uint8Array {
  const b = new Uint8Array(HEADER_LEN);
  const v = new DataView(b.buffer);
  b[0] = 0x54;
  b[1] = 0x58;
  b[2] = PROTOCOL_VERSION;
  b[3] = h.type;
  b[4] = h.partyKey ? 1 : 0;
  b.set(h.msgId, 5);
  v.setUint32(13, h.createdAt);
  v.setUint16(17, h.ttlMin);
  b[19] = h.hops;
  b[20] = h.maxHops;
  return b;
}

export function readHeader(packet: Uint8Array): PacketHeader | null {
  if (packet.length < HEADER_LEN + NONCE_LEN + 16) return null;
  if (packet[0] !== 0x54 || packet[1] !== 0x58 || packet[2] !== PROTOCOL_VERSION) return null;
  const v = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  const type = packet[3];
  if (type < 1 || type > 3) return null;
  return {
    type,
    partyKey: (packet[4] & 1) === 1,
    msgId: packet.slice(5, 13),
    createdAt: v.getUint32(13),
    ttlMin: v.getUint16(17),
    hops: packet[19],
    maxHops: packet[20],
  };
}

/** Associated data = header with the mutable hop counter zeroed. */
function aad(header: Uint8Array): Uint8Array {
  const a = header.slice(0, HEADER_LEN);
  a[19] = 0;
  return a;
}

export interface EncodeOptions {
  type: PacketType;
  payload: unknown;
  key: Uint8Array;
  partyKey: boolean;
  now: number;
  rng: Rng;
  ttlMin?: number;
  maxHops?: number;
  msgId?: Uint8Array;
}

export function encodePacket(o: EncodeOptions): Uint8Array {
  const header = writeHeader({
    type: o.type,
    partyKey: o.partyKey,
    msgId: o.msgId ?? o.rng(8),
    createdAt: Math.floor(o.now / 1000),
    ttlMin: o.ttlMin ?? DEFAULT_TTL_MIN,
    hops: 0,
    maxHops: Math.min(o.maxHops ?? DEFAULT_MAX_HOPS, ABSOLUTE_MAX_HOPS),
  });
  const nonce = o.rng(NONCE_LEN);
  const ct = xchacha20poly1305(o.key, nonce, aad(header)).encrypt(enc.encode(JSON.stringify(o.payload)));
  const out = new Uint8Array(HEADER_LEN + NONCE_LEN + ct.length);
  out.set(header, 0);
  out.set(nonce, HEADER_LEN);
  out.set(ct, HEADER_LEN + NONCE_LEN);
  return out;
}

/** Returns the decrypted JSON payload, or null when the key is wrong or the packet was tampered with. */
export function decryptPacket<T = unknown>(packet: Uint8Array, key: Uint8Array): T | null {
  try {
    const nonce = packet.slice(HEADER_LEN, HEADER_LEN + NONCE_LEN);
    const pt = xchacha20poly1305(key, nonce, aad(packet)).decrypt(packet.slice(HEADER_LEN + NONCE_LEN));
    return JSON.parse(dec.decode(pt)) as T;
  } catch {
    return null;
  }
}

export function isExpired(h: PacketHeader, now: number): boolean {
  return now / 1000 > h.createdAt + h.ttlMin * 60;
}

/** Compact SOS body carried inside a packet. Short keys keep it within a few BLE writes. */
export interface SosPayload {
  id: string;
  k: 'sos' | 'overdue';
  t: number;
  n: string | null;
  /** [lat, lon, accuracy, fixTime] or null when no position is known. */
  p: [number, number, number | null, number] | null;
  live: boolean;
  /** start [lat, lon] */
  s: [number, number] | null;
  b: number | null;
  /** recent track [[lat, lon, t], …] */
  tr: [number, number, number][];
  m: string | null;
}

export interface AckPayload {
  /** hex msgId being acknowledged */
  ack: string;
  t: number;
}

// ---------------------------------------------------------------------------------------------
// Relay: duplicate detection, expiry, hop limiting
// ---------------------------------------------------------------------------------------------

export type RelayDecision =
  | { action: 'drop'; reason: 'malformed' | 'duplicate' | 'expired' | 'from_future' }
  | {
      action: 'deliver';
      header: PacketHeader;
      /** Null when this device does not hold the key — it can still relay what it cannot read. */
      payload: unknown | null;
      /** Packet to pass on with the hop counter incremented, or null when the hop limit is reached. */
      forward: Uint8Array | null;
    };

export class RelayEngine {
  private seen = new Map<string, number>();

  constructor(private keys: () => Uint8Array[], private maxSeen = 512) {}

  /** Marks a message we originated so our own echo is not treated as new. */
  markSeen(msgId: Uint8Array, expiresAt: number) {
    this.seen.set(toHex(msgId), expiresAt);
  }

  hasSeen(msgId: Uint8Array): boolean {
    return this.seen.has(toHex(msgId));
  }

  handle(packet: Uint8Array, now: number): RelayDecision {
    const header = readHeader(packet);
    if (!header) return { action: 'drop', reason: 'malformed' };
    // Tolerate 10 minutes of clock skew between phones that have had no network time for days.
    if (header.createdAt * 1000 > now + 10 * 60_000) return { action: 'drop', reason: 'from_future' };
    if (isExpired(header, now)) return { action: 'drop', reason: 'expired' };
    const id = toHex(header.msgId);
    this.prune(now);
    if (this.seen.has(id)) return { action: 'drop', reason: 'duplicate' };
    this.seen.set(id, (header.createdAt + header.ttlMin * 60) * 1000);

    let payload: unknown | null = null;
    for (const k of this.keys()) {
      payload = decryptPacket(packet, k);
      if (payload != null) break;
    }

    let forward: Uint8Array | null = null;
    const limit = Math.min(header.maxHops, ABSOLUTE_MAX_HOPS);
    if (header.type === PacketType.SOS && header.hops < limit) {
      forward = packet.slice();
      forward[19] = header.hops + 1;
    }
    return { action: 'deliver', header, payload, forward };
  }

  private prune(now: number) {
    for (const [id, exp] of this.seen) if (exp < now) this.seen.delete(id);
    while (this.seen.size > this.maxSeen) this.seen.delete(this.seen.keys().next().value as string);
  }
}

// ---------------------------------------------------------------------------------------------
// Fragmentation for small BLE writes
// ---------------------------------------------------------------------------------------------

const FRAG_HEADER = 6; // tag[4] + index + total

export function fragment(packet: Uint8Array, mtuPayload: number): Uint8Array[] {
  const size = Math.max(8, mtuPayload - FRAG_HEADER);
  const total = Math.ceil(packet.length / size);
  if (total > 255) throw new Error('Packet too large to fragment');
  const tag = packet.slice(5, 9); // first 4 bytes of msgId
  const out: Uint8Array[] = [];
  for (let i = 0; i < total; i++) {
    const chunk = packet.slice(i * size, (i + 1) * size);
    const f = new Uint8Array(FRAG_HEADER + chunk.length);
    f.set(tag, 0);
    f[4] = i;
    f[5] = total;
    f.set(chunk, FRAG_HEADER);
    out.push(f);
  }
  return out;
}

export class Reassembler {
  private parts = new Map<string, { chunks: (Uint8Array | undefined)[]; got: number; at: number }>();

  constructor(private timeoutMs = 30_000) {}

  /** Feed one fragment; returns the full packet once every fragment has arrived. */
  push(frag: Uint8Array, now: number): Uint8Array | null {
    if (frag.length <= FRAG_HEADER) return null;
    for (const [k, v] of this.parts) if (now - v.at > this.timeoutMs) this.parts.delete(k);
    const tag = toHex(frag.slice(0, 4));
    const idx = frag[4];
    const total = frag[5];
    if (total === 0 || idx >= total) return null;
    let e = this.parts.get(tag);
    if (!e || e.chunks.length !== total) {
      e = { chunks: new Array(total), got: 0, at: now };
      this.parts.set(tag, e);
    }
    if (!e.chunks[idx]) {
      e.chunks[idx] = frag.slice(FRAG_HEADER);
      e.got++;
    }
    if (e.got < total) return null;
    this.parts.delete(tag);
    const len = e.chunks.reduce((n, c) => n + c!.length, 0);
    const out = new Uint8Array(len);
    let o = 0;
    for (const c of e.chunks) {
      out.set(c!, o);
      o += c!.length;
    }
    return out;
  }
}

// base64 without Buffer/atob so it behaves identically in Hermes, web and Node
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '=');
  }
  return s;
}
export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | ((B64.indexOf(clean[i + 2]) & 63) << 6) | (B64.indexOf(clean[i + 3]) & 63);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}
