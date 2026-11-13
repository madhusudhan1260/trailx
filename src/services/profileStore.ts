import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { toB64, fromB64 } from '@/core/fieldCipher';
import { uuidFromBytes } from '@/core/profile';
import { getDb } from '@/db';
import { addContact, getUser, listContacts, saveUser, type FieldKey, type User } from '@/db/repo';

const KEY_NAME = 'trailx.profile.key.v1';

let keyPromise: Promise<FieldKey> | null = null;

/**
 * Device key for encrypting sensitive profile fields. Held in the iOS Keychain / Android Keystore
 * (this device only, readable after first unlock so a background SOS can still include it).
 * Browsers have no equivalent store, so on web the fields are stored unencrypted — the Profile
 * screen says so rather than pretending otherwise.
 */
export function getFieldKey(): Promise<FieldKey> {
  if (!keyPromise) {
    keyPromise = (async () => {
      const nonce = () => Crypto.getRandomBytes(24);
      if (Platform.OS === 'web') return { key: null, nonce };
      try {
        if (!(await SecureStore.isAvailableAsync())) return { key: null, nonce };
        const opts = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
        let stored = await SecureStore.getItemAsync(KEY_NAME, opts);
        if (!stored) {
          stored = toB64(Crypto.getRandomBytes(32));
          await SecureStore.setItemAsync(KEY_NAME, stored, opts);
        }
        return { key: fromB64(stored), nonce };
      } catch {
        return { key: null, nonce };
      }
    })();
  }
  return keyPromise;
}

export const sensitiveEncrypted = () => Platform.OS !== 'web';

/** Loads the profile, giving the device a stable random identity the first time. */
export async function loadUser(): Promise<User> {
  const db = await getDb();
  const fk = await getFieldKey();
  const u = await getUser(db, fk.key);
  if (u.uid) return u;
  const withId = { ...u, uid: uuidFromBytes(Crypto.getRandomBytes(16)) };
  await saveUser(db, withId, fk);
  return getUser(db, fk.key);
}

export async function persistUser(u: User): Promise<User> {
  const db = await getDb();
  const fk = await getFieldKey();
  await saveUser(db, u, fk);
  return getUser(db, fk.key);
}

/**
 * Saves everything collected during onboarding in one transaction: either the profile, the
 * contacts and the "onboarded" flag are all stored, or none are and onboarding is shown again.
 */
export async function completeOnboarding(u: User, contacts: { name: string; phone: string; relation: string | null }[]): Promise<User> {
  const db = await getDb();
  const fk = await getFieldKey();
  await db.tx(async () => {
    const existing = new Set((await listContacts(db)).map((c) => c.phone));
    for (const c of contacts) if (!existing.has(c.phone)) await addContact(db, c);
    await saveUser(db, { ...u, onboarded: true }, fk);
  });
  return getUser(db, fk.key);
}
