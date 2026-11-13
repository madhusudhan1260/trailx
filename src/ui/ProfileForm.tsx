import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Camera, Check, Lock, UserRound } from 'lucide-react-native';
import React, { useEffect } from 'react';
import { Image, Platform, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import type { EmergencyContact } from '@/core/emergency';
import {
  DIFFICULTY_INFO, DURATION_INFO, EXPERIENCE_INFO, formatDob, GENDER_INFO, initials, LANGUAGES, splitE164, validateContact, validatePersonal,
  type AltitudeUnit, type ContactInput, type Difficulty, type DistanceUnit, type Errors, type Experience, type Gender, type PersonalInput, type TypicalDuration,
} from '@/core/profile';
import type { SamplingMode } from '@/core/types';
import type { User } from '@/db/repo';
import { Field, T, Tap } from './primitives';
import { C, F, R, S } from './theme';

/** Everything the onboarding / edit-profile forms hold while the user is typing. */
export interface Draft extends PersonalInput {
  gender: Gender | null;
  language: string | null;
  photoUri: string | null;
  c1: ContactInput;
  c2: ContactInput;
  bloodGroup: string;
  medical: string;
  allergies: string;
  emergencyNotes: string;
  experience: Experience | null;
  difficulty: Difficulty | null;
  typicalDuration: TypicalDuration | null;
  distanceUnit: DistanceUnit;
  altitudeUnit: AltitudeUnit;
  samplingMode: SamplingMode;
}

const emptyContact = (code: string): ContactInput => ({ name: '', phoneCode: code, phone: '', relation: '' });

export function draftFromUser(u: User | null, contacts: EmergencyContact[] = []): Draft {
  const own = splitE164(u?.phone ?? null);
  const contact = (c?: EmergencyContact): ContactInput => {
    if (!c) return emptyContact(own.code);
    const p = splitE164(c.phone, own.code.replace('+', ''));
    return { name: c.name, phoneCode: p.code, phone: p.number, relation: c.relation ?? '' };
  };
  return {
    fullName: u?.name ?? '', preferredName: u?.preferredName ?? '', dob: formatDob(u?.dob ?? null), phoneCode: own.code, phone: own.number, email: u?.email ?? '',
    gender: u?.gender ?? null, language: u?.language ?? 'English', photoUri: u?.photoUri ?? null,
    c1: contact(contacts[0]), c2: contact(contacts[1]),
    bloodGroup: u?.bloodGroup ?? '', medical: u?.medical ?? '', allergies: u?.allergies ?? '', emergencyNotes: u?.emergencyNotes ?? '',
    experience: u?.experience ?? null, difficulty: u?.difficulty ?? null, typicalDuration: u?.typicalDuration ?? null,
    distanceUnit: u?.settings.distanceUnit ?? 'km', altitudeUnit: u?.settings.altitudeUnit ?? 'm', samplingMode: u?.settings.samplingMode ?? 'balanced',
  };
}

export type DraftErrors = Errors<keyof PersonalInput | 'c1name' | 'c1phone' | 'c1relation' | 'c2name' | 'c2phone' | 'c2relation' | 'experience'>;

export function checkPersonal(d: Draft, now: number) {
  return validatePersonal(d, now);
}

/** `requireContact` is false when contacts are managed elsewhere (edit profile shows existing ones). */
export function checkEmergency(d: Draft, ownPhone: string | null, requireContact = true) {
  const a = validateContact(d.c1, requireContact, ownPhone);
  const b = validateContact(d.c2, false, ownPhone);
  const errors: DraftErrors = {};
  for (const [k, v] of Object.entries(a.errors)) errors[`c1${k}` as keyof DraftErrors] = v;
  for (const [k, v] of Object.entries(b.errors)) errors[`c2${k}` as keyof DraftErrors] = v;
  if (a.value && b.value && a.value.phone === b.value.phone) errors.c2phone = 'This is the same number as the primary contact.';
  const contacts = [a.value, b.value].filter((c): c is NonNullable<typeof c> => !!c);
  return { errors, contacts };
}

export function checkTrekking(d: Draft) {
  const errors: DraftErrors = {};
  if (!d.experience) errors.experience = 'Choose your trekking experience.';
  return { errors };
}

/** Builds the user record to save from a validated draft. */
export function applyDraft(u: User, d: Draft, personal: NonNullable<ReturnType<typeof validatePersonal>['value']>): User {
  const t = (s: string) => s.replace(/\s+/g, ' ').trim() || null;
  return {
    ...u,
    name: personal.fullName, preferredName: personal.preferredName, dob: personal.dob, phone: personal.phone, email: personal.email,
    gender: d.gender, language: d.language, photoUri: d.photoUri,
    bloodGroup: t(d.bloodGroup)?.toUpperCase() ?? null, medical: d.medical.trim() || null, allergies: t(d.allergies), emergencyNotes: d.emergencyNotes.trim() || null,
    experience: d.experience, difficulty: d.difficulty, typicalDuration: d.typicalDuration,
    settings: { ...u.settings, distanceUnit: d.distanceUnit, altitudeUnit: d.altitudeUnit, samplingMode: d.samplingMode },
    // Fields the user re-entered are no longer "unreadable".
    unreadable: u.unreadable.filter((f) => !d[f].trim()),
  };
}

// ------------------------------------------------------------------------------------------ UI

type Set = <K extends keyof Draft>(k: K, v: Draft[K]) => void;

export function Choice<V extends string>({ label, value, options, onChange, error }: { label: string; value: V | null; options: Record<V, string>; onChange: (v: V) => void; error?: string }) {
  return (
    <View style={{ marginBottom: S.lg }}>
      <T v="label" style={{ marginBottom: S.sm }}>{label}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(Object.keys(options) as V[]).map((k) => {
          const on = value === k;
          return (
            <Tap key={k} onPress={() => onChange(k)} label={options[k]}
              style={{ paddingHorizontal: 14, height: 40, borderRadius: R.pill, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: on ? C.lime : C.line, backgroundColor: on ? 'rgba(198,255,61,0.12)' : C.glass }}>
              {on ? <Check size={14} color={C.lime} strokeWidth={3} /> : null}
              <T style={{ fontFamily: F.bodyMedium, fontSize: 14, color: on ? C.lime : C.text2 }}>{options[k]}</T>
            </Tap>
          );
        })}
      </View>
      {error ? <T v="small" color={C.orange} style={{ marginTop: 6 }}>{error}</T> : null}
    </View>
  );
}

function Err({ text }: { text?: string }) {
  return text ? <T v="small" color={C.orange} style={{ marginTop: -S.md, marginBottom: S.md }}>{text}</T> : null;
}

export function PhoneField({ label, code, number, onCode, onNumber, error, hint }: { label: string; code: string; number: string; onCode: (s: string) => void; onNumber: (s: string) => void; error?: string; hint?: string }) {
  return (
    <>
      <View style={{ flexDirection: 'row', gap: S.sm }}>
        <Field label="Code" value={code} onChangeText={(s) => onCode(s.startsWith('+') ? s : `+${s.replace(/\+/g, '')}`)} keyboardType="phone-pad" maxLength={4} style={{ width: 78 }} autoComplete="tel-country-code" />
        <View style={{ flex: 1 }}>
          <Field label={label} value={number} onChangeText={onNumber} keyboardType="phone-pad" placeholder="98765 43210" autoComplete="tel-national" textContentType="telephoneNumber" hint={hint} />
        </View>
      </View>
      <Err text={error} />
    </>
  );
}

/** Copies the picked image into app storage so it survives the photo being deleted from the gallery. */
async function keepPhoto(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  if (Platform.OS === 'web') return asset.base64 ? `data:${asset.mimeType ?? 'image/jpeg'};base64,${asset.base64}` : asset.uri;
  const dir = new Directory(Paths.document, 'profile');
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, `photo-${Date.now()}.jpg`);
  new File(asset.uri).copy(dest);
  return dest.uri;
}

export function PhotoPicker({ uri, name, onChange }: { uri: string | null; name: Pick<Draft, 'fullName' | 'preferredName'>; onChange: (uri: string | null) => void }) {
  const pop = useSharedValue(1);
  const ring = useSharedValue(0);
  useEffect(() => {
    if (!uri) return;
    pop.value = withSequence(withTiming(0.86, { duration: 120 }), withSpring(1, { damping: 9, stiffness: 160 }));
    ring.value = withSequence(withTiming(1, { duration: 380 }), withTiming(0, { duration: 700 }));
  }, [uri, pop, ring]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const r = useAnimatedStyle(() => ({ opacity: ring.value, transform: [{ scale: 1 + ring.value * 0.22 }] }));
  const [err, setErr] = React.useState<string | null>(null);

  const pick = async () => {
    setErr(null);
    try {
      if (Platform.OS !== 'web' && !(await ImagePicker.requestMediaLibraryPermissionsAsync()).granted) return setErr('Photo access was not allowed. A photo is optional.');
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.6, base64: Platform.OS === 'web' });
      if (!res.canceled && res.assets[0]) onChange(await keepPhoto(res.assets[0]));
    } catch (e) {
      setErr(`Could not use that photo: ${(e as Error).message}`);
    }
  };

  return (
    <View style={{ alignItems: 'center', marginBottom: S.xl }}>
      <Tap onPress={pick} label="Choose profile photo">
        <View style={{ width: 104, height: 104, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View style={[{ position: 'absolute', width: 104, height: 104, borderRadius: 52, borderWidth: 2, borderColor: C.lime }, r]} />
          <Animated.View style={[{ width: 96, height: 96, borderRadius: 48, overflow: 'hidden', backgroundColor: C.forest2, borderWidth: 1, borderColor: C.lineStrong, alignItems: 'center', justifyContent: 'center' }, a]}>
            {uri ? <Image source={{ uri }} style={{ width: 96, height: 96 }} /> : initials({ fullName: name.fullName, preferredName: name.preferredName }) === '?'
                ? <UserRound size={40} color={C.limeDim} strokeWidth={1.8} />
                : <T style={{ fontFamily: F.display, fontSize: 30, color: C.lime }}>{initials({ fullName: name.fullName, preferredName: name.preferredName })}</T>}
          </Animated.View>
          <View style={{ position: 'absolute', right: 2, bottom: 2, width: 32, height: 32, borderRadius: 16, backgroundColor: C.lime, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: C.bg }}>
            <Camera size={15} color={C.bg} strokeWidth={2.5} />
          </View>
        </View>
      </Tap>
      <View style={{ flexDirection: 'row', gap: S.lg, marginTop: S.sm }}>
        <T v="small">Profile photo · optional</T>
        {uri ? <Tap onPress={() => onChange(null)}><T v="small" color={C.orange}>Remove</T></Tap> : null}
      </View>
      {err ? <T v="small" color={C.orange} style={{ marginTop: 4 }}>{err}</T> : null}
    </View>
  );
}

export function PersonalSection({ d, set, errors }: { d: Draft; set: Set; errors: DraftErrors }) {
  return (
    <>
      <PhotoPicker uri={d.photoUri} name={d} onChange={(u) => set('photoUri', u)} />
      <Field label="Full name" value={d.fullName} onChangeText={(s) => set('fullName', s)} placeholder="As on your ID — rescuers may need it" autoComplete="name" textContentType="name" />
      <Err text={errors.fullName} />
      <Field label="Preferred name" value={d.preferredName} onChangeText={(s) => set('preferredName', s)} placeholder="What should TRAILX call you?" autoComplete="nickname" textContentType="nickname" />
      <Err text={errors.preferredName} />
      <Field label="Date of birth" value={d.dob} onChangeText={(s) => set('dob', s)} placeholder="DD/MM/YYYY" keyboardType="numbers-and-punctuation" autoComplete="birthdate-full" maxLength={10} />
      <Err text={errors.dob} />
      <PhoneField label="Your phone number" code={d.phoneCode} number={d.phone} onCode={(s) => set('phoneCode', s)} onNumber={(s) => set('phone', s)} error={errors.phone} />
      <Field label="Email · optional" value={d.email} onChangeText={(s) => set('email', s)} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" />
      <Err text={errors.email} />
      <Choice label="Gender · optional" value={d.gender} options={GENDER_INFO} onChange={(v) => set('gender', d.gender === v ? null : v)} />
      <Choice label="Preferred language" value={d.language} options={Object.fromEntries(LANGUAGES.map((l) => [l, l])) as Record<string, string>} onChange={(v) => set('language', v)} />
      <T v="small" style={{ marginTop: -S.sm, marginBottom: S.lg }}>TRAILX is currently in English; your choice is saved for when other languages are added.</T>
    </>
  );
}

function ContactFields({ which, c, onChange, errors, title }: { which: 'c1' | 'c2'; c: ContactInput; onChange: (c: ContactInput) => void; errors: DraftErrors; title: string }) {
  return (
    <>
      <T v="h3" style={{ marginBottom: S.md }}>{title}</T>
      <Field label="Name" value={c.name} onChangeText={(s) => onChange({ ...c, name: s })} placeholder="Someone not on this trek" />
      <Err text={errors[`${which}name`]} />
      <PhoneField label="Phone number" code={c.phoneCode} number={c.phone} onCode={(s) => onChange({ ...c, phoneCode: s })} onNumber={(s) => onChange({ ...c, phone: s })} error={errors[`${which}phone`]} />
      <Field label="Relationship" value={c.relation} onChangeText={(s) => onChange({ ...c, relation: s })} placeholder="Mother, friend, partner…" />
      <Err text={errors[`${which}relation`]} />
    </>
  );
}

export function EmergencySection({ d, set, errors, showContacts = true, encrypted }: { d: Draft; set: Set; errors: DraftErrors; showContacts?: boolean; encrypted: boolean }) {
  return (
    <>
      {showContacts ? (
        <>
          <ContactFields which="c1" title="Primary emergency contact" c={d.c1} onChange={(c) => set('c1', c)} errors={errors} />
          <ContactFields which="c2" title="Secondary contact · optional" c={d.c2} onChange={(c) => set('c2', c)} errors={errors} />
        </>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: S.sm, marginBottom: S.md }}>
        <Lock size={15} color={C.limeDim} />
        <T v="h3" style={{ flex: 1 }}>Medical details · optional, private</T>
      </View>
      <T v="small" style={{ marginBottom: S.lg }}>
        {encrypted
          ? 'Stored only on this phone, encrypted with a key kept in the phone’s secure keystore. Included in an emergency message only when you raise one.'
          : 'Stored only in this browser and NOT encrypted here (browsers have no secure keystore). Included in an emergency message only when you raise one.'}
      </T>
      <Field label="Blood group" value={d.bloodGroup} onChangeText={(s) => set('bloodGroup', s)} placeholder="e.g. O+" autoCapitalize="characters" maxLength={4} />
      <Field label="Medical information" value={d.medical} onChangeText={(s) => set('medical', s)} placeholder="Asthma, diabetes, medication…" multiline />
      <Field label="Allergies" value={d.allergies} onChangeText={(s) => set('allergies', s)} placeholder="Penicillin, bee stings…" />
      <Field label="Emergency notes" value={d.emergencyNotes} onChangeText={(s) => set('emergencyNotes', s)} placeholder="Anything rescuers should know" multiline />
    </>
  );
}

const DISTANCE: Record<DistanceUnit, string> = { km: 'Kilometres', mi: 'Miles' };
const ALTITUDE: Record<AltitudeUnit, string> = { m: 'Metres', ft: 'Feet' };
const BATTERY: Record<SamplingMode, string> = { precise: 'Most detail', balanced: 'Balanced', saver: 'Save battery' };

export function TrekkingSection({ d, set, errors }: { d: Draft; set: Set; errors: DraftErrors }) {
  return (
    <>
      <Choice label="Trekking experience" value={d.experience} options={EXPERIENCE_INFO} onChange={(v) => set('experience', v)} error={errors.experience} />
      <Choice label="Preferred difficulty · optional" value={d.difficulty} options={DIFFICULTY_INFO} onChange={(v) => set('difficulty', v)} />
      <Choice label="Typical trek length · optional" value={d.typicalDuration} options={DURATION_INFO} onChange={(v) => set('typicalDuration', v)} />
      <Choice label="Distance units" value={d.distanceUnit} options={DISTANCE} onChange={(v) => set('distanceUnit', v)} />
      <Choice label="Altitude units" value={d.altitudeUnit} options={ALTITUDE} onChange={(v) => set('altitudeUnit', v)} />
      {d.distanceUnit !== 'km' || d.altitudeUnit !== 'm'
        ? <T v="small" color={C.orange} style={{ marginTop: -S.sm, marginBottom: S.lg }}>Saved. Screens still show metric values for now — miles and feet display is not finished yet.</T>
        : null}
      <Choice label="GPS recording" value={d.samplingMode} options={BATTERY} onChange={(v) => set('samplingMode', v)} />
      <T v="small" style={{ marginTop: -S.sm }}>“Save battery” records a point every ~12 s instead of ~4 s. You can change this for any trek.</T>
    </>
  );
}
