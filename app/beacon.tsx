import { useRouter } from 'expo-router';
import { Bluetooth, Radio, TriangleAlert } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { fmtAge } from '@/core/stats';
import type { SosPayload } from '@/core/protocol';
import { getDb } from '@/db';
import { listBleMessages, type BleMessage } from '@/db/repo';
import { startBle, stopBle, useBle } from '@/services/ble';
import { updateUser } from '@/services/boot';
import { useApp } from '@/store';
import { Banner, Button, Field, Glass, Header, Screen, T } from '@/ui/primitives';
import { Stat, useNow } from '@/ui/Stat';
import { C, S } from '@/ui/theme';

export default function Beacon() {
  const router = useRouter();
  const ble = useBle();
  const user = useApp((s) => s.user);
  const now = useNow(5000);
  const [inbox, setInbox] = useState<BleMessage[]>([]);
  const [code, setCode] = useState(user?.partyCode ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void (async () => setInbox(await listBleMessages(await getDb(), Date.now())))(); }, [ble.inboxVersion]);
  const peers = Object.values(ble.peers);

  return (
    <Screen scroll bottom={60}>
      <Header title="Bluetooth beacon" eyebrow="Device to device" onBack={() => router.back()} />
      <Glass tone={ble.running ? 'lime' : undefined} style={{ padding: S.xl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
          <Radio size={22} color={ble.running ? C.lime : C.muted} />
          <T v="h2" style={{ flex: 1 }}>{ble.running ? (ble.scanning ? 'Scanning…' : 'On — listening') : 'Off'}</T>
        </View>
        <View style={{ flexDirection: 'row', gap: S.lg, marginTop: S.lg }}>
          <Stat label="Devices nearby" value={ble.running ? String(peers.length) : '—'} />
          <Stat label="Discoverable" value={ble.running ? (ble.advertising ? 'Yes' : 'No') : '—'} />
          <Stat label="Waiting to send" value={String(ble.outbox)} />
        </View>
        {ble.lastActivity ? <T v="small" color={C.text2} style={{ marginTop: S.md }}>{ble.lastActivity}</T> : null}
        <Button title={ble.running ? 'Turn beacon off' : 'Turn beacon on'} icon={Bluetooth} kind={ble.running ? 'ghost' : 'primary'} loading={busy} style={{ marginTop: S.lg }}
          onPress={async () => { setBusy(true); if (ble.running) await stopBle(); else await startBle(); setBusy(false); }} />
      </Glass>
      {ble.error ? <View style={{ marginTop: S.md }}><Banner icon={TriangleAlert} title="Bluetooth" body={ble.error} /></View> : null}

      <T v="small" style={{ marginTop: S.lg }}>
        Scanning runs in short bursts (8 s on, ~22 s off) in low-power mode to protect your battery. Range is typically 10–50 m outdoors and less through rock or dense forest. Delivery is never guaranteed. Messages expire after 12 hours and are passed on at most 3 times.
      </T>

      <T v="label" style={{ marginTop: S.xxl, marginBottom: S.sm }}>Party code</T>
      <Field label="Shared code (optional)" value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="e.g. RIDGE-42"
        hint="Agree a code with your group before you set off. With a code, only phones that know it can read your SOS. Without one, any TRAILX phone can read it (messages are then only protected against corruption, not against reading)." />
      <Button small title={code.trim() === (user?.partyCode ?? '') ? 'Saved' : 'Save code'} kind="ghost" disabled={code.trim() === (user?.partyCode ?? '')} onPress={() => updateUser({ partyCode: code.trim() || null })} />

      <T v="label" style={{ marginTop: S.xxl, marginBottom: S.sm }}>Received emergency messages</T>
      {inbox.length === 0 ? <T v="small">Nothing received.</T> : null}
      {inbox.map((m) => {
        const p = m.payload as SosPayload | null;
        return (
          <Glass key={m.msgId} tone={m.readable ? 'warn' : undefined} style={{ padding: S.lg, marginBottom: S.md }}>
            {p ? (
              <>
                <T v="h3" color={C.orange}>{p.k === 'sos' ? 'SOS' : 'Overdue'} · {p.n ?? 'Unnamed trekker'} · {p.id}</T>
                <T selectable v="mono" color={C.text} style={{ marginTop: 6 }}>{p.p ? `${p.p[0].toFixed(5)}, ${p.p[1].toFixed(5)}  ±${p.p[2] != null ? Math.round(p.p[2]) : '?'} m` : 'Position unknown'}</T>
                <T v="small" color={C.text2} style={{ marginTop: 4 }}>
                  {p.p ? `${p.live ? 'Live fix' : 'Last known fix'} from ${fmtAge(now - p.p[3])}. ` : ''}Battery {p.b != null ? `${Math.round(p.b * 100)}%` : 'unknown'}.{p.m ? ` Medical: ${p.m}.` : ''}
                </T>
              </>
            ) : (
              <T v="small">Encrypted message for another party (no matching code). It is being relayed, not read.</T>
            )}
            <T v="small" style={{ marginTop: 6 }}>Received {fmtAge(now - m.receivedAt)} · {m.hops === 0 ? 'directly from the sender' : `relayed ${m.hops}×`}</T>
          </Glass>
        );
      })}
    </Screen>
  );
}
