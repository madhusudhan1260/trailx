import { randomBytes } from 'crypto';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { decryptField, encryptField, ENC_PREFIX, fromB64, toB64 } from '@/core/fieldCipher';
import { greetingName, initials, parseDob, toE164, uuidFromBytes, validateContact, validatePersonal } from '@/core/profile';
import { addContact, getUser, listContacts, saveUser } from '@/db/repo';
import { migrate, SCHEMA_VERSION } from '@/db/schema';
import { openNodeDb } from './nodeDb';

const NOW = Date.UTC(2026, 10, 14, 9, 0, 0);
const rb = (n: number) => new Uint8Array(randomBytes(n));
const fk = (key: Uint8Array | null) => ({ key, nonce: () => rb(24) });

const good = { fullName: '  Madhu   Sudhan ', preferredName: 'Madhu', dob: '04/07/1998', phoneCode: '+91', phone: '098765 43210', email: 'madhu@example.com' };

describe('personal details validation', () => {
  it('accepts a complete, valid profile and normalises it', () => {
    const r = validatePersonal(good, NOW);
    expect(r.errors).toEqual({});
    expect(r.value).toEqual({ fullName: 'Madhu Sudhan', preferredName: 'Madhu', dob: '1998-07-04', phone: '+919876543210', email: 'madhu@example.com' });
  });

  it('rejects missing names, impossible dates, future birthdays, bad phones and emails', () => {
    const r = validatePersonal({ fullName: 'M', preferredName: ' ', dob: '31/02/2000', phoneCode: '+91', phone: '12', email: 'nope@' }, NOW);
    expect(Object.keys(r.errors).sort()).toEqual(['dob', 'email', 'fullName', 'phone', 'preferredName']);
    expect(r.value).toBeNull();
    expect(validatePersonal({ ...good, dob: '01/01/2030' }, NOW).errors.dob).toMatch(/future/);
  });

  it('email is optional', () => {
    expect(validatePersonal({ ...good, email: '' }, NOW).value?.email).toBeNull();
  });

  it('parses the supported date formats only', () => {
    expect(parseDob('2000-02-29')).toBe('2000-02-29');
    expect(parseDob('29.02.2001')).toBeNull();
    expect(parseDob('7/4/1998')).toBe('1998-04-07');
    expect(parseDob('yesterday')).toBeNull();
  });

  it('builds E.164 numbers from typed input', () => {
    expect(toE164('+91', '98765 43210')).toBe('+919876543210');
    expect(toE164('91', '+91 98765 43210')).toBe('+919876543210');
    expect(toE164('+44', '07700 900123')).toBe('+447700900123');
    expect(toE164('+1', '555')).toBeNull();
    expect(toE164('', '9876543210')).toBeNull();
  });
});

describe('emergency contact validation', () => {
  it('requires the primary contact, allows an empty secondary', () => {
    expect(validateContact({ name: '', phoneCode: '+91', phone: '', relation: '' }, true).errors).toMatchObject({ name: expect.any(String), phone: expect.any(String), relation: expect.any(String) });
    expect(validateContact({ name: '', phoneCode: '+91', phone: '', relation: '' }, false)).toMatchObject({ empty: true, value: null });
  });

  it('refuses the user’s own number as their emergency contact', () => {
    const r = validateContact({ name: 'Me', phoneCode: '+91', phone: '9876543210', relation: 'Self' }, true, '+919876543210');
    expect(r.errors.phone).toMatch(/own number/);
  });
});

describe('greeting', () => {
  it('uses the preferred name, else the first name — never a hardcoded one', () => {
    expect(greetingName({ preferredName: 'Madhu', name: 'Madhusudhan R' })).toBe('Madhu');
    expect(greetingName({ preferredName: null, name: 'Asha Rao' })).toBe('Asha');
    expect(greetingName({ preferredName: null, name: null })).toBeNull();
    expect(initials({ name: 'Asha Devi Rao' })).toBe('AR');
  });

  it('generates RFC 4122 v4 identifiers', () => {
    expect(uuidFromBytes(rb(16))).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('field encryption at rest', () => {
  const key = rb(32);
  it('round-trips and never stores the plaintext', () => {
    const c = encryptField(key, 'medical', 'Type 1 diabetes, insulin', () => rb(24))!;
    expect(c.startsWith(ENC_PREFIX)).toBe(true);
    expect(c).not.toContain('diabetes');
    expect(decryptField(key, 'medical', c)).toEqual({ ok: true, value: 'Type 1 diabetes, insulin' });
  });

  it('fails closed with the wrong key or when moved to another field', () => {
    const c = encryptField(key, 'medical', 'secret', () => rb(24))!;
    expect(decryptField(rb(32), 'medical', c).ok).toBe(false);
    expect(decryptField(key, 'allergies', c).ok).toBe(false);
    expect(decryptField(null, 'medical', c).ok).toBe(false);
  });

  it('base64 matches Node’s encoder', () => {
    for (const n of [0, 1, 2, 3, 31, 64]) {
      const b = rb(n);
      expect(toB64(b)).toBe(Buffer.from(b).toString('base64'));
      expect(Array.from(fromB64(toB64(b)))).toEqual(Array.from(b));
    }
  });
});

describe('profile persistence (real SQLite)', () => {
  it('migrates a v1 database without losing existing details', async () => {
    const db = openNodeDb();
    await db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT, blood_group TEXT, medical TEXT, allergies TEXT, party_code TEXT, onboarded INTEGER NOT NULL DEFAULT 0, settings TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL)`);
    await db.run("INSERT INTO users (id, name, blood_group, onboarded, created_at) VALUES (1, 'Asha Rao', 'B+', 1, 1)");
    await db.exec('PRAGMA user_version = 1');
    await migrate(db, NOW);
    expect((await db.first<{ user_version: number }>('PRAGMA user_version'))!.user_version).toBe(SCHEMA_VERSION);
    const u = await getUser(db);
    expect(u).toMatchObject({ name: 'Asha Rao', bloodGroup: 'B+', onboarded: true, preferredName: null, phone: null });
    await migrate(db, NOW); // idempotent
  });

  it('saves the onboarding profile once and loads it after a restart — no repeated onboarding', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'trailx-')), 'p.db');
    const key = rb(32);
    let db = openNodeDb(path);
    await migrate(db, NOW);
    const u = await getUser(db, key);
    expect(u.onboarded).toBe(false);
    await db.tx(async () => {
      await addContact(db, { name: 'Ravi', phone: '+919811111111', relation: 'Brother' });
      await saveUser(db, { ...u, uid: uuidFromBytes(rb(16)), name: 'Madhu Sudhan', preferredName: 'Madhu', phone: '+919876543210', dob: '1998-07-04', medical: 'Asthma', onboarded: true }, fk(key), NOW);
    });
    db.close();

    db = openNodeDb(path); // process restart
    const back = await getUser(db, key);
    expect(back).toMatchObject({ onboarded: true, preferredName: 'Madhu', medical: 'Asthma', profileCreatedAt: NOW, profileUpdatedAt: NOW });
    expect(greetingName(back)).toBe('Madhu');
    expect((await listContacts(db)).map((c) => c.name)).toEqual(['Ravi']);
    const raw = await db.first<{ medical: string }>('SELECT medical FROM users WHERE id = 1');
    expect(raw!.medical.startsWith(ENC_PREFIX)).toBe(true);

    // Editing the preferred name changes the greeting; the uid and creation time stay put.
    await saveUser(db, { ...back, preferredName: 'Maddy' }, fk(key), NOW + 1000);
    const edited = await getUser(db, key);
    expect(greetingName(edited)).toBe('Maddy');
    expect(edited.uid).toBe(back.uid);
    expect(edited.profileCreatedAt).toBe(NOW);
    expect(edited.profileUpdatedAt).toBe(NOW + 1000);
    db.close();
  });

  it('a failed onboarding save leaves nothing half-written', async () => {
    const db = openNodeDb();
    await migrate(db, NOW);
    const u = await getUser(db);
    await expect(db.tx(async () => {
      await addContact(db, { name: 'Ravi', phone: '+919811111111' });
      await saveUser(db, { ...u, name: 'Madhu', onboarded: true });
      throw new Error('disk full');
    })).rejects.toThrow('disk full');
    expect((await getUser(db)).onboarded).toBe(false);
    expect(await listContacts(db)).toHaveLength(0);
  });

  it('never overwrites encrypted details it cannot read (lost key)', async () => {
    const db = openNodeDb();
    await migrate(db, NOW);
    const key = rb(32);
    await saveUser(db, { ...(await getUser(db, key)), medical: 'Epilepsy' }, fk(key));
    const noKey = await getUser(db, null);
    expect(noKey.medical).toBeNull();
    expect(noKey.unreadable).toContain('medical');
    await saveUser(db, { ...noKey, preferredName: 'Asha' }, fk(null));
    expect((await getUser(db, key)).medical).toBe('Epilepsy');
  });
});
