import * as Contacts from 'expo-contacts';
import { useFocusEffect, useRouter } from 'expo-router';
import { Bluetooth, ChevronRight, ClipboardList, Plus, Satellite, Trash2, TriangleAlert, UserPlus } from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
import { Platform, View } from 'react-native';
import { overdueLevel, type EmergencyContact } from '@/core/emergency';
import { fmtDuration } from '@/core/stats';
import { getDb } from '@/db';
import { addContact, deleteContact, getDraftPlan, listContacts, listEvents, type SafetyPlan, type StoredEvent } from '@/db/repo';
import { useBle } from '@/services/ble';
import { satelliteProviders } from '@/services/satellite';
import { useApp } from '@/store';
import { Banner, Button, Enter, Field, Glass, Screen, T, Tap } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';
import { useNow } from '@/ui/Stat';
import { C, F, S } from '@/ui/theme';

export default function Safety() {
  const router = useRouter();
  const dataVersion = useApp((s) => s.dataVersion);
  const activePlan = useApp((s) => s.plan);
  const trek = useApp((s) => s.trek);
  const ble = useBle();
  const now = useNow(15000);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [draft, setDraft] = useState<SafetyPlan | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', relation: '' });
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const db = await getDb();
    setContacts(await listContacts(db));
    setEvents(await listEvents(db));
    setDraft(await getDraftPlan(db));
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load, dataVersion]));

  const plan = trek ? activePlan : draft;
  const od = overdueLevel(plan?.expectedReturnAt ?? null, now);
  const openEvents = events.filter((e) => !e.resolvedAt);

  const save = async () => {
    if (!form.name.trim() || form.phone.replace(/[^\d]/g, '').length < 5) return setErr('Enter a name and a valid phone number.');
    await addContact(await getDb(), form);
    setForm({ name: '', phone: '', relation: '' });
    setErr(null);
    setOpen(false);
    void load();
  };
  const pick = async () => {
    setErr(null);
    try {
      if (!(await Contacts.requestPermissionsAsync()).granted) return setErr('Contacts permission was not granted. Type the details instead.');
      const c = await Contacts.presentContactPickerAsync();
      const phone = c?.phoneNumbers?.[0]?.number;
      if (c && phone) setForm({ name: c.name ?? '', phone, relation: '' });
      else if (c) setErr('That contact has no phone number.');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <Screen scroll>
      <T v="label" color={C.orange}>Safety</T>
      <T v="title" style={{ marginTop: 4 }}>Emergency & rescue</T>

      <Enter style={{ alignItems: 'center', marginVertical: S.xl }}>
        <Tap onPress={() => router.push('/sos')} feedback="medium" label="Open SOS"
          style={{ width: 176, height: 176, borderRadius: 88, backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center', borderWidth: 6, borderColor: 'rgba(255,255,255,0.22)', shadowColor: C.orange, shadowOpacity: 0.6, shadowRadius: 30, shadowOffset: { width: 0, height: 10 }, elevation: 16 }}>
          <T style={{ fontFamily: F.display, fontSize: 46, letterSpacing: 4, color: '#fff' }}>SOS</T>
          <T style={{ fontFamily: F.bodyBold, fontSize: 11.5, letterSpacing: 1, color: 'rgba(255,255,255,0.85)' }}>TAP TO OPEN</T>
        </Tap>
        <T v="small" center style={{ marginTop: S.md, maxWidth: 320 }}>Works with no signal: your position and an emergency message are saved on this phone first, then sent whenever a channel exists.</T>
      </Enter>

      <View style={{ gap: S.md }}>
        {openEvents.map((e) => (
          <Tap key={e.id} onPress={() => router.push(`/emergency/${e.id}`)}>
            <Banner icon={TriangleAlert} title={`${e.kind === 'sos' ? 'Active SOS' : 'Overdue alert prepared'} · ${e.id}`} body={`Raised ${new Date(e.createdAt).toLocaleString()}. Tap to send, share, or mark yourself safe.`} />
          </Tap>
        ))}
        {od.level === 'overdue' ? <Banner icon={TriangleAlert} title={`You are ${fmtDuration(od.deltaMs)} past your expected return`} body="Nobody has been notified automatically. Open the prepared alert above to send it, or update your plan." /> : null}

        <Tap onPress={() => router.push('/plan')}>
          <Glass style={{ padding: S.lg, flexDirection: 'row', alignItems: 'center', gap: S.md }}>
            <ClipboardList size={20} color={plan ? C.lime : C.text2} />
            <View style={{ flex: 1 }}>
              <T v="h3">Trek safety plan</T>
              <T v="small" color={C.text2}>{plan ? [plan.destination, plan.expectedReturnAt ? `expected back ${new Date(plan.expectedReturnAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : null].filter(Boolean).join(' · ') || 'Notes saved' : 'Not set. Add an expected return time to get an overdue warning.'}</T>
            </View>
            <ChevronRight size={18} color={C.muted} />
          </Glass>
        </Tap>

        <Tap onPress={() => router.push('/beacon')}>
          <Glass style={{ padding: S.lg, flexDirection: 'row', alignItems: 'center', gap: S.md }}>
            <Bluetooth size={20} color={ble.running ? C.lime : C.text2} />
            <View style={{ flex: 1 }}>
              <T v="h3">Bluetooth beacon</T>
              <T v="small" color={C.text2}>{ble.running ? `On · ${Object.keys(ble.peers).length} TRAILX device(s) heard nearby` : 'Off. Exchanges encrypted SOS with TRAILX phones within Bluetooth range.'}</T>
            </View>
            <ChevronRight size={18} color={C.muted} />
          </Glass>
        </Tap>

        <Glass style={{ padding: S.lg, flexDirection: 'row', gap: S.md }}>
          <Satellite size={20} color={C.text2} />
          <View style={{ flex: 1 }}>
            <T v="h3">Satellite communicator</T>
            <T v="small" color={C.text2}>
              {satelliteProviders().length
                ? satelliteProviders().map((p) => p.displayName).join(', ')
                : 'None connected. A phone’s GPS can only receive — TRAILX cannot transmit to satellites by itself. Support for external communicators is added per manufacturer SDK; none is bundled in this build.'}
            </T>
          </View>
        </Glass>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: S.xxl, marginBottom: S.sm }}>
        <T v="label">Trusted emergency contacts</T>
        <Button small title="Add" icon={Plus} kind="ghost" onPress={() => { setErr(null); setOpen(true); }} />
      </View>
      {contacts.length === 0 ? <T v="small">No contacts yet. Without one, an SOS can still be saved, shared and broadcast over Bluetooth, but there is nobody to text.</T> : null}
      {contacts.map((c) => (
        <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: 14, borderTopWidth: 1, borderTopColor: C.line }}>
          <View style={{ flex: 1 }}>
            <T v="h3">{c.name}{c.relation ? <T v="small">  {c.relation}</T> : null}</T>
            <T v="mono">{c.phone}</T>
          </View>
          <Tap onPress={async () => { await deleteContact(await getDb(), c.id); void load(); }} label={`Remove ${c.name}`} style={{ padding: 8 }}><Trash2 size={17} color={C.muted} /></Tap>
        </View>
      ))}

      {events.some((e) => e.resolvedAt) ? (
        <>
          <T v="label" style={{ marginTop: S.xxl, marginBottom: S.sm }}>Past emergency records</T>
          {events.filter((e) => e.resolvedAt).map((e) => (
            <Tap key={e.id} onPress={() => router.push(`/emergency/${e.id}`)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.line }}>
                <T v="mono" style={{ flex: 1 }}>{e.id} · {e.kind}</T>
                <T v="small">{new Date(e.createdAt).toLocaleDateString()}</T>
              </View>
            </Tap>
          ))}
        </>
      ) : null}

      <Sheet visible={open} onClose={() => setOpen(false)} title="Add emergency contact">
        {Platform.OS !== 'web' ? <Button small title="Pick from address book" icon={UserPlus} kind="ghost" onPress={pick} style={{ marginBottom: S.lg }} /> : null}
        <Field label="Name" value={form.name} onChangeText={(name) => setForm({ ...form, name })} placeholder="Full name" />
        <Field label="Phone" value={form.phone} onChangeText={(phone) => setForm({ ...form, phone })} placeholder="+91 …" keyboardType="phone-pad" hint="Include the country code so it works when roaming." />
        <Field label="Relation (optional)" value={form.relation} onChangeText={(relation) => setForm({ ...form, relation })} placeholder="Brother, partner, guide…" />
        {err ? <T v="small" color={C.orange} style={{ marginBottom: S.md }}>{err}</T> : null}
        <Button title="Save contact" onPress={save} />
      </Sheet>
    </Screen>
  );
}
