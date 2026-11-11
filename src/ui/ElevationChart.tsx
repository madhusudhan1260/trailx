import React, { useEffect, useMemo, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { ClipPath, Defs, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { T } from './primitives';
import { C, F } from './theme';

const ARect = Animated.createAnimatedComponent(Rect);

/**
 * Altitude over distance. Draws only real altitude samples; when the device reported none it
 * says so instead of drawing a flat line.
 */
export function ElevationChart({ data, height = 170, marker }: { data: { d: number; alt: number }[]; height?: number; marker?: number | null }) {
  const [w, setW] = useState(0);
  const reveal = useSharedValue(0);
  useEffect(() => {
    reveal.value = 0;
    reveal.value = withTiming(1, { duration: 1100, easing: Easing.out(Easing.cubic) });
  }, [data.length, reveal]);
  const clip = useAnimatedProps(() => ({ width: w * reveal.value }));

  const m = useMemo(() => {
    if (data.length < 2 || w === 0) return null;
    const padL = 38, padB = 22, padT = 10;
    const maxD = data[data.length - 1].d || 1;
    let lo = Infinity, hi = -Infinity;
    for (const p of data) { lo = Math.min(lo, p.alt); hi = Math.max(hi, p.alt); }
    if (hi - lo < 20) { const mid = (hi + lo) / 2; lo = mid - 10; hi = mid + 10; }
    const x = (d: number) => padL + (d / maxD) * (w - padL - 6);
    const y = (a: number) => padT + (1 - (a - lo) / (hi - lo)) * (height - padT - padB);
    let line = '';
    data.forEach((p, i) => (line += `${i ? 'L' : 'M'}${x(p.d).toFixed(1)} ${y(p.alt).toFixed(1)}`));
    const area = `${line}L${x(maxD).toFixed(1)} ${height - padB}L${padL} ${height - padB}Z`;
    return { line, area, lo, hi, x, y, maxD, padL, padB, padT };
  }, [data, w, height]);

  return (
    <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} style={{ height }}>
      {!m ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <T v="small" center>Altitude unavailable. This device did not report usable GPS altitude for this trek, so no elevation profile is shown.</T>
        </View>
      ) : (
        <Svg width={w} height={height}>
          <Defs>
            <LinearGradient id="ev" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={C.lime} stopOpacity={0.42} />
              <Stop offset="1" stopColor={C.lime} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {[m.hi, (m.hi + m.lo) / 2, m.lo].map((a, i) => (
            <React.Fragment key={i}>
              <Line x1={m.padL} x2={w - 6} y1={m.y(a)} y2={m.y(a)} stroke={C.line} strokeWidth={1} />
              <SvgText x={m.padL - 6} y={m.y(a) + 4} fontSize={10} fontFamily={F.bodyMedium} fill={C.muted} textAnchor="end">{Math.round(a)}</SvgText>
            </React.Fragment>
          ))}
          <SvgText x={m.padL} y={height - 5} fontSize={10} fontFamily={F.bodyMedium} fill={C.muted}>0</SvgText>
          <SvgText x={w - 6} y={height - 5} fontSize={10} fontFamily={F.bodyMedium} fill={C.muted} textAnchor="end">{m.maxD >= 1000 ? `${(m.maxD / 1000).toFixed(1)} km` : `${Math.round(m.maxD)} m`}</SvgText>
          <Defs>
            <ClipPath id="rv"><ARect x={0} y={0} height={height} animatedProps={clip} /></ClipPath>
          </Defs>
          <Path d={m.area} fill="url(#ev)" clipPath="url(#rv)" />
          <Path d={m.line} stroke={C.lime} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" fill="none" clipPath="url(#rv)" />
          {marker != null ? <Line x1={m.x(marker)} x2={m.x(marker)} y1={m.padT} y2={height - m.padB} stroke={C.text} strokeWidth={1.5} strokeDasharray="3 4" /> : null}
        </Svg>
      )}
    </View>
  );
}
