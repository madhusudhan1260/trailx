import { useLocalSearchParams, useRouter } from 'expo-router';
import { Bluetooth, CircleCheck, Copy, MessageSquare, Share2, ShieldCheck } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming, ZoomIn } from 'react-native-reanimated';
import { ALERT_STATUS_LABEL, availableChannels, type AlertStatus, type ChannelAvailability } from '@/core/emergency';
import { getDb } from '@/db';
import { getEvent, listAlerts, resolveEvent, type StoredAlert, type StoredEvent } from '@/db/repo';
import { useBle } from '@/services/ble';
import { broadcastOverBle, channelAvailability, copyMessage, sendSms, shareMessage } from '@/services/sos';
import { useApp } from '@/store';
import { Banner, Button, Glass, Header, Screen, T } from '@/ui/primitives';
import { Confirm } from '@/ui/Sheet';
import { useNow } from '@/ui/Stat';
import { C, F, S } from '@/ui/theme';

const STATUS_COLOR: Record<AlertStatus, string> = {
  saved_local: C.text2, waiting: '#E6D34A', handed_off: '#E6D34A', sent: C.limeDim, delivery_confirmed: C.lime, failed: C.orange, expired: C.muted,
};

export default function Emergency() {
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const router = useRouter();
  const dataVersion = useApp((s) => s.dataVersion);
  const online = useApp((s) => s.online);
  const ble = useBle();
  const tick = useNow(5000);
  const [event, setEvent] = useState<StoredEvent | null>(null);
  const [alerts, setAlerts] = useState<StoredAlert[]>([]);
  const [chan, setChan] = useState<ChannelAvailability | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const pulse = useSharedValue(0);
  useEffect(() => { pulse.value = withRepeat(withTiming(1, { duration: 900 }), -1, true); }, [pulse]);
  const dot = useAnimatedStyle(() => ({ opacity: 0.35 + pulse.value * 0.65, transform: [{ scale: 0.85 + pulse.value * 0.3 }] }));

  const load = useCallback(async () => {
    const db = await getDb();
    setEvent(await getEvent(db, id));
    setAlerts(await listAlerts(db, id));
    setChan(await channelAvailability());
  }, [id]);
  useEffect(() => { void load(); }, [load, dataVersion, tick, online, ble.peers]);

  if (!event) return <Screen><Header title="Emergency" onBack={() => router.back()} /><T>Loading record…</T></Screen>;
  const resolved = event.resolvedAt != null;
  const channels = chan ? availableChannels(chan) : [];
  const smsAlerts = alerts.filter((a) => a.channel === 'sms');

  return (
    <Screen scroll bottom={60}>
      <Header title={event.id} eyebrow={event.kind === 'sos' ? 'Emergency SOS' : 'Overdue trek alert'} onBack={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/safety'))} />

      {fresh && !resolved ? (
        <Animated.View entering={ZoomIn.duration(420)}>
          <Glass tone="warn" style={{ padding: S.xl, alignItems: 'center', gap: S.sm, marginBottom: S.lg }}>
            <Animated.View style={[{ width: 18, height: 18, borderRadius: 9, backgroundColor: C.orange }, dot]} />
            <T v="h2" center>Emergency record saved on this phone</T>
            <T center>It has not been sent to anyone yet. Choose a channel below.</T>
          </Glass>
        </Animated.View>
      ) : null}
      {resolved ? <View style={{ marginBottom: S.lg }}><Banner tone="lime" icon={CircleCheck} title="Marked safe" body={`Resolved ${new Date(event.resolvedAt!).toLocaleString()}. Kept for your records.`} /></View> : null}

      {!resolved ? (
        <>
          <T v="label" style={{ marginBottom: S.sm }}>Send it</T>
          {channels.length === 0 ? <View style={{ marginBottom: S.md }}><Banner icon={Bluetooth} title="No way to send right now" body="No mobile signal, no internet, and no TRAILX device in Bluetooth range. The message stays saved and Bluetooth keeps listening. Move to higher or open ground if you safely can." /></View> : null}
          <View style={{ gap: S.md }}>
            <Button title={smsAlerts.length ? `Text ${smsAlerts.length} emergency contact${smsAlerts.length > 1 ? 's' : ''}` : 'No emergency contacts to text'} icon={MessageSquare} kind="warn"
              disabled={!chan?.smsAvailable || smsAlerts.length === 0} onPress={async () => setMsg((await sendSms(event.id)).message)} />
            {chan && !chan.smsAvailable ? <T v="small">This device cannot open an SMS composer.</T> : null}
            <View style={{ flexDirection: 'row', gap: S.md }}>
              <Button small title="Share…" icon={Share2} kind="ghost" style={{ flex: 1 }} onPress={() => shareMessage(event)} />
              <Button small title="Copy" icon={Copy} kind="ghost" style={{ flex: 1 }} onPress={async () => { await copyMessage(event); setMsg('Message copied to the clipboard.'); }} />
              <Button small title="Bluetooth" icon={Bluetooth} kind="ghost" style={{ flex: 1 }} onPress={async () => setMsg((await broadcastOverBle(event.id)) ? 'Queued for nearby TRAILX devices. It is sent automatically whenever one comes within range.' : useBle.getState().error ?? 'Bluetooth is unavailable.')} />
            </View>
            {msg ? <T v="small" color={C.text2}>{msg}</T> : null}
          </View>
        </>
      ) : null}

      <T v="label" style={{ marginTop: S.xl, marginBottom: S.sm }}>Delivery status</T>
      <Glass style={{ paddingHorizontal: S.lg }}>
        {alerts.map((a, i) => (
          <View key={a.id} style={{ paddingVertical: 14, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: STATUS_COLOR[a.status] }} />
              <T v="h3" style={{ flex: 1, fontSize: 14.5 }} numberOfLines={1}>{a.channel === 'sms' ? `SMS · ${a.recipient}` : a.recipient}</T>
            </View>
            <T v="small" color={STATUS_COLOR[a.status]} style={{ marginTop: 3 }}>{ALERT_STATUS_LABEL[a.status]}</T>
            {a.detail ? <T v="small" style={{ marginTop: 2 }}>{a.detail}</T> : null}
          </View>
        ))}
        {alerts.length === 0 ? <T v="small" style={{ paddingVertical: 14 }}>No delivery attempts recorded.</T> : null}
      </Glass>
      <T v="small" style={{ marginTop: S.sm }}>“Delivery confirmed” appears only when a receiving TRAILX device acknowledges the message. SMS and share give TRAILX no delivery receipt.</T>

      <T v="label" style={{ marginTop: S.xl, marginBottom: S.sm }}>Message</T>
      <Glass style={{ padding: S.lg }}>
        <T selectable style={{ fontFamily: F.displayMedium, fontSize: 13, lineHeight: 19, color: C.text }}>{event.message}</T>
      </Glass>

      {!resolved ? <Button title="I'm safe — end this emergency" icon={ShieldCheck} kind="ghost" onPress={() => setConfirm(true)} style={{ marginTop: S.xl }} /> : null}
      <Confirm visible={confirm} onClose={() => setConfirm(false)} title="Mark yourself safe?" confirm="Yes, I'm safe"
        body="Unsent alerts are cancelled and Bluetooth stops offering this message. Anyone who already received it is NOT told automatically — let them know yourself."
        onConfirm={async () => { await resolveEvent(await getDb(), event.id, Date.now()); useApp.getState().touch(); }} />
    </Screen>
  );
}
