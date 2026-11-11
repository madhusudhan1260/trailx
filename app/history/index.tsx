import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronRight, ShieldAlert } from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { fmtDistance, fmtDuration } from '@/core/stats';
import { getDb } from '@/db';
import { listTreks, totals, type TrekSummary } from '@/db/repo';
import { useApp } from '@/store';
import { Enter, Glass, Header, Screen, T, Tap } from '@/ui/primitives';
import { Stat } from '@/ui/Stat';
import { C, S } from '@/ui/theme';

export default function History() {
  const router = useRouter();
  const dataVersion = useApp((s) => s.dataVersion);
  const [treks, setTreks] = useState<TrekSummary[] | null>(null);
  const [sum, setSum] = useState({ treks: 0, distance: 0, activeMs: 0, gain: 0 });
  useFocusEffect(useCallback(() => {
    void (async () => { const db = await getDb(); setTreks(await listTreks(db)); setSum(await totals(db)); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]));
  const d = fmtDistance(sum.distance);
  return (
    <Screen scroll bottom={60}>
      <Header title="Trek history" eyebrow="Saved on this phone" onBack={() => router.back()} />
      <View style={{ flexDirection: 'row', gap: S.lg, marginBottom: S.xl }}>
        <Stat label="Treks" value={String(sum.treks)} />
        <Stat label="Distance" value={d.value} unit={d.unit} />
        <Stat label="Elev. gain" value={String(Math.round(sum.gain))} unit="m" note="where measured" />
      </View>
      {treks?.length === 0 ? <T>No saved treks yet. Finish a recording and it will appear here with its route, statistics and notes.</T> : null}
      {treks?.map((t, i) => {
        const td = fmtDistance(t.stats?.distance ?? 0);
        return (
          <Enter key={t.id} delay={Math.min(i, 8) * 45}>
            <Tap onPress={() => router.push(`/history/${t.id}`)}>
              <Glass style={{ padding: S.lg, marginBottom: S.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
                  <View style={{ flex: 1 }}>
                    <T v="h3" numberOfLines={1}>{t.name}</T>
                    <T v="small">{new Date(t.startedAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}{t.destination ? ` · ${t.destination}` : ''}</T>
                  </View>
                  {t.eventCount ? <ShieldAlert size={16} color={C.orange} /> : null}
                  <ChevronRight size={18} color={C.muted} />
                </View>
                <View style={{ flexDirection: 'row', gap: S.lg, marginTop: S.md }}>
                  <Stat label="Distance" value={td.value} unit={td.unit} />
                  <Stat label="Active" value={fmtDuration(t.stats?.activeMs ?? 0)} />
                  <Stat label="Gain" value={t.stats?.elevationGain != null ? String(Math.round(t.stats.elevationGain)) : '—'} unit={t.stats?.elevationGain != null ? 'm' : undefined} />
                </View>
              </Glass>
            </Tap>
          </Enter>
        );
      })}
    </Screen>
  );
}
