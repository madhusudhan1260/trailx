/**
 * The user's own profile: entered once during onboarding, stored only on this phone, editable later.
 * Pure TypeScript — validation and formatting are shared by onboarding, Profile editing and tests.
 */

export type Experience = 'beginner' | 'intermediate' | 'advanced';
export type Difficulty = 'easy' | 'moderate' | 'hard';
export type TypicalDuration = 'half_day' | 'full_day' | 'multi_day';
export type DistanceUnit = 'km' | 'mi';
export type AltitudeUnit = 'm' | 'ft';
export type Gender = 'woman' | 'man' | 'nonbinary' | 'undisclosed';

export interface Profile {
  /** Stable random identifier for this user on this device (also used as the BLE/group identity). */
  uid: string | null;
  fullName: string | null;
  preferredName: string | null;
  /** Local file URI (native) or data URI (web) of the profile photo. Never uploaded. */
  photoUri: string | null;
  /** ISO date, YYYY-MM-DD. */
  dob: string | null;
  /** E.164, e.g. +919876543210. */
  phone: string | null;
  email: string | null;
  gender: Gender | null;
  language: string | null;
  bloodGroup: string | null;
  /** Sensitive — encrypted at rest on native builds. */
  medical: string | null;
  allergies: string | null;
  emergencyNotes: string | null;
  experience: Experience | null;
  difficulty: Difficulty | null;
  typicalDuration: TypicalDuration | null;
  profileCreatedAt: number | null;
  profileUpdatedAt: number | null;
}

export const EMPTY_PROFILE: Profile = {
  uid: null, fullName: null, preferredName: null, photoUri: null, dob: null, phone: null, email: null, gender: null,
  language: null, bloodGroup: null, medical: null, allergies: null, emergencyNotes: null, experience: null, difficulty: null,
  typicalDuration: null, profileCreatedAt: null, profileUpdatedAt: null,
};

export const LANGUAGES = ['English', 'हिन्दी', 'ಕನ್ನಡ', 'தமிழ்', 'తెలుగు', 'മലയാളം', 'मराठी', 'বাংলা', 'Español', 'Français', 'Deutsch'];

export type Errors<K extends string> = Partial<Record<K, string>>;

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Normalises a country code + local number into E.164, or returns null if it cannot be a phone number. */
export function toE164(countryCode: string, number: string): string | null {
  const cc = countryCode.replace(/[^\d]/g, '');
  let n = number.replace(/[^\d]/g, '');
  if (!cc || cc.length > 3) return null;
  if (n.startsWith('0')) n = n.replace(/^0+/, ''); // national trunk prefix
  if (n.startsWith(cc) && n.length > cc.length + 6) n = n.slice(cc.length); // pasted with country code
  const full = cc + n;
  if (n.length < 6 || full.length < 8 || full.length > 15) return null;
  return `+${full}`;
}

/** Splits a stored E.164 number back into its parts for editing (best effort: the code is 1–3 digits). */
export function splitE164(e164: string | null, knownCode = '91'): { code: string; number: string } {
  if (!e164) return { code: `+${knownCode}`, number: '' };
  const d = e164.replace(/[^\d]/g, '');
  if (d.startsWith(knownCode) && d.length - knownCode.length >= 6) return { code: `+${knownCode}`, number: d.slice(knownCode.length) };
  const len = d.startsWith('1') || d.startsWith('7') ? 1 : 2; // NANP / Russia-Kazakhstan, else most codes
  return { code: `+${d.slice(0, len)}`, number: d.slice(len) };
}

export function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
}

/** Accepts DD/MM/YYYY, DD-MM-YYYY or YYYY-MM-DD. Returns ISO YYYY-MM-DD or null. */
export function parseDob(s: string): string | null {
  const t = s.trim();
  let y: number, m: number, d: number;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (r) [y, m, d] = [+r[1], +r[2], +r[3]];
  else if ((r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t))) [d, m, y] = [+r[1], +r[2], +r[3]];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function ageOn(iso: string, now: number): number {
  const [y, m, d] = iso.split('-').map(Number);
  const n = new Date(now);
  let age = n.getFullYear() - y;
  if (n.getMonth() + 1 < m || (n.getMonth() + 1 === m && n.getDate() < d)) age--;
  return age;
}

export function formatDob(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export interface PersonalInput { fullName: string; preferredName: string; dob: string; phoneCode: string; phone: string; email: string }

export function validatePersonal(v: PersonalInput, now: number): { errors: Errors<keyof PersonalInput>; value: Pick<Profile, 'fullName' | 'preferredName' | 'dob' | 'phone' | 'email'> | null } {
  const e: Errors<keyof PersonalInput> = {};
  const fullName = clean(v.fullName);
  const preferredName = clean(v.preferredName);
  if (fullName.length < 2) e.fullName = 'Enter your full name.';
  else if (fullName.length > 80) e.fullName = 'Keep it under 80 characters.';
  if (!preferredName) e.preferredName = 'Enter the name TRAILX should greet you with.';
  else if (preferredName.length > 30) e.preferredName = 'Keep it under 30 characters.';
  const dob = parseDob(v.dob);
  if (!v.dob.trim()) e.dob = 'Enter your date of birth (DD/MM/YYYY).';
  else if (!dob) e.dob = 'That is not a real date. Use DD/MM/YYYY.';
  else {
    const age = ageOn(dob, now);
    if (age < 0) e.dob = 'Date of birth cannot be in the future.';
    else if (age > 120) e.dob = 'Please check the year.';
  }
  const phone = toE164(v.phoneCode, v.phone);
  if (!v.phone.trim()) e.phone = 'Enter your phone number — rescuers may need it.';
  else if (!phone) e.phone = 'Enter a valid number with its country code.';
  const email = clean(v.email);
  if (email && !isEmail(email)) e.email = 'That email address does not look right.';
  const ok = Object.keys(e).length === 0;
  return { errors: e, value: ok ? { fullName, preferredName, dob, phone, email: email || null } : null };
}

export interface ContactInput { name: string; phoneCode: string; phone: string; relation: string }

export function validateContact(v: ContactInput, required: boolean, ownPhone?: string | null): { errors: Errors<keyof ContactInput>; value: { name: string; phone: string; relation: string | null } | null; empty: boolean } {
  const e: Errors<keyof ContactInput> = {};
  const name = clean(v.name);
  const empty = !name && !v.phone.trim() && !clean(v.relation);
  if (empty && !required) return { errors: {}, value: null, empty: true };
  if (!name) e.name = 'Enter the contact’s name.';
  const phone = toE164(v.phoneCode, v.phone);
  if (!v.phone.trim()) e.phone = 'Enter their phone number.';
  else if (!phone) e.phone = 'Enter a valid number with its country code.';
  else if (ownPhone && phone === ownPhone) e.phone = 'This is your own number — choose someone who is not trekking with you.';
  if (required && !clean(v.relation)) e.relation = 'How do you know them? (e.g. Mother, Friend)';
  const ok = Object.keys(e).length === 0;
  return { errors: e, value: ok ? { name, phone: phone!, relation: clean(v.relation) || null } : null, empty: false };
}

/** The name used in greetings: the preferred name, else the first word of the full name, else null. */
/** Accepts a Profile (`fullName`) or a stored User (`name` holds the full name). */
type NameSource = { preferredName?: string | null; fullName?: string | null; name?: string | null } | null | undefined;

export function greetingName(p: NameSource): string | null {
  const pref = clean(p?.preferredName);
  if (pref) return pref;
  const first = clean(p?.fullName ?? p?.name).split(' ')[0];
  return first || null;
}

export function initials(p: NameSource): string {
  const src = clean(p?.fullName ?? p?.name) || clean(p?.preferredName);
  if (!src) return '?';
  const parts = src.split(' ');
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** RFC 4122 v4 from 16 random bytes. */
export function uuidFromBytes(b: Uint8Array): string {
  const h = Array.from(b.slice(0, 16), (x, i) => (i === 6 ? (x & 0x0f) | 0x40 : i === 8 ? (x & 0x3f) | 0x80 : x).toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const EXPERIENCE_INFO: Record<Experience, string> = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };
export const DIFFICULTY_INFO: Record<Difficulty, string> = { easy: 'Easy', moderate: 'Moderate', hard: 'Challenging' };
export const DURATION_INFO: Record<TypicalDuration, string> = { half_day: 'Half day', full_day: 'Full day', multi_day: 'Multi-day' };
export const GENDER_INFO: Record<Gender, string> = { woman: 'Woman', man: 'Man', nonbinary: 'Non-binary', undisclosed: 'Prefer not to say' };
