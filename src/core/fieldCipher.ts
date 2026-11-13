import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

/**
 * Encrypts individual sensitive profile fields (medical notes, allergies, emergency notes) at rest.
 * The 32-byte key lives in the OS keystore (iOS Keychain / Android Keystore via expo-secure-store),
 * never in SQLite. Values written without a key are stored as plain text and read back unchanged,
 * so the same database works on platforms without a keystore (web) and after a key loss the app
 * says the value is unreadable instead of crashing.
 */

export const ENC_PREFIX = 'enc1:';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function toB64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '=');
  }
  return s;
}
export function fromB64(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | ((B64.indexOf(clean[i + 2] ?? 'A') & 63) << 6) | (B64.indexOf(clean[i + 3] ?? 'A') & 63);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
/** Binds the ciphertext to the field it belongs to, so values cannot be swapped between columns. */
const aad = (field: string) => enc.encode(`trailx:profile:${field}`);

export function encryptField(key: Uint8Array | null, field: string, value: string | null, nonce24: () => Uint8Array): string | null {
  if (value == null || value === '') return null;
  if (!key) return value;
  const nonce = nonce24();
  const ct = xchacha20poly1305(key, nonce, aad(field)).encrypt(enc.encode(value));
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce);
  out.set(ct, nonce.length);
  return ENC_PREFIX + toB64(out);
}

export type Decrypted = { ok: true; value: string | null } | { ok: false; value: null };

export function decryptField(key: Uint8Array | null, field: string, stored: string | null): Decrypted {
  if (stored == null) return { ok: true, value: null };
  if (!stored.startsWith(ENC_PREFIX)) return { ok: true, value: stored };
  if (!key) return { ok: false, value: null };
  try {
    const raw = fromB64(stored.slice(ENC_PREFIX.length));
    const pt = xchacha20poly1305(key, raw.slice(0, 24), aad(field)).decrypt(raw.slice(24));
    return { ok: true, value: dec.decode(pt) };
  } catch {
    return { ok: false, value: null };
  }
}
