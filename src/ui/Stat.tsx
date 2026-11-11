import React, { useEffect, useRef, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { T } from './primitives';
import { C, F } from './theme';

/** Eases a displayed number toward its target so counters glide instead of jumping. */
export function useEased(target: number, ms = 600): number {
  const [v, setV] = useState(target);
  const from = useRef(target);
  const cur = useRef(target);
  useEffect(() => {
    from.current = cur.current;
    if (Math.abs(target - from.current) < 1e-9) return;
    const t0 = Date.now();
    let raf = 0;
    const tick = () => {
      const k = Math.min(1, (Date.now() - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      cur.current = from.current + (target - from.current) * e;
      setV(cur.current);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** Re-renders every `ms` so elapsed-time readouts stay current. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function BigStat({ value, unit, label, color = C.text, size = 64, note }: { value: string; unit?: string; label: string; color?: string; size?: number; note?: string }) {
  return (
    <View>
      <T v="label">{label}</T>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
        <T style={{ fontFamily: F.display, fontSize: size, lineHeight: size * 1.08, letterSpacing: -size * 0.035, color, fontVariant: ['tabular-nums'] }}>{value}</T>
        {unit ? <T style={{ fontFamily: F.displayMedium, fontSize: size * 0.3, color: C.muted }}>{unit}</T> : null}
      </View>
      {note ? <T v="small" color={C.orange}>{note}</T> : null}
    </View>
  );
}

export function Stat({ value, unit, label, style, color = C.text, note }: { value: string; unit?: string; label: string; style?: StyleProp<ViewStyle>; color?: string; note?: string }) {
  return (
    <View style={[{ flex: 1, minWidth: 92 }, style]}>
      <T v="label" numberOfLines={1}>{label}</T>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 4 }}>
        <T style={{ fontFamily: F.display, fontSize: 25, lineHeight: 30, color, fontVariant: ['tabular-nums'] }}>{value}</T>
        {unit ? <T style={{ fontFamily: F.bodyMedium, fontSize: 12.5, color: C.muted }}>{unit}</T> : null}
      </View>
      {note ? <T v="small" style={{ fontSize: 11, lineHeight: 14 }}>{note}</T> : null}
    </View>
  );
}
