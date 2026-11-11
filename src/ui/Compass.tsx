import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';
import { cardinal } from '@/core/geo';
import { T } from './primitives';
import { C, F } from './theme';

/** Unwraps an angle so animations take the short way round (359° → 1° turns +2°, not −358°). */
function useUnwrapped(deg: number) {
  const v = useSharedValue(deg);
  useEffect(() => {
    const cur = v.value;
    let d = ((deg - cur) % 360 + 540) % 360 - 180;
    v.value = withSpring(cur + d, { damping: 22, stiffness: 120, mass: 0.7 });
  }, [deg, v]);
  return v;
}

const ACCURACY = ['Uncalibrated', 'Low', 'Medium', 'High'];

interface Props {
  /** Device heading in degrees, or null when no magnetometer reading exists. */
  heading: number | null;
  /** 0–3 calibration level from the OS. */
  accuracy?: number;
  /** Bearing to the next waypoint. */
  toTarget?: number | null;
  /** Bearing to the start point. */
  toStart?: number | null;
  size?: number;
  /** Whether `heading` is referenced to true north (else magnetic). */
  trueNorth?: boolean;
}

/**
 * Rotating compass dial. The dial turns against the phone so N always points to north, and the
 * target/start markers ride on the dial at their real bearings.
 */
export function Compass({ heading, accuracy = 0, toTarget, toStart, size = 260, trueNorth }: Props) {
  const rot = useUnwrapped(-(heading ?? 0));
  const dial = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));
  const c = size / 2;
  const r = c - 6;
  const poor = heading != null && accuracy <= 1;
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: size, height: size }}>
        <Animated.View style={[{ width: size, height: size }, dial]}>
          <Svg width={size} height={size}>
            <Circle cx={c} cy={c} r={r} fill="rgba(4,7,5,0.55)" stroke={poor ? C.orange : C.lineStrong} strokeWidth={1.5} />
            <Circle cx={c} cy={c} r={r - 34} fill="none" stroke={C.line} strokeWidth={1} />
            {Array.from({ length: 72 }, (_, i) => {
              const major = i % 18 === 0;
              const mid = i % 6 === 0;
              return (
                <Line key={i} x1={c} y1={c - r + 4} x2={c} y2={c - r + (major ? 18 : mid ? 13 : 8)} stroke={major ? C.text : mid ? C.text2 : C.faint} strokeWidth={major ? 2.2 : 1.2}
                  transform={`rotate(${i * 5} ${c} ${c})`} />
              );
            })}
            {['N', 'E', 'S', 'W'].map((l, i) => (
              <SvgText key={l} x={c} y={c - r + 38} fontSize={17} fontFamily={F.display} fontWeight="700" fill={l === 'N' ? C.orange : C.text} textAnchor="middle" transform={`rotate(${i * 90} ${c} ${c})`}>{l}</SvgText>
            ))}
            {toStart != null ? (
              <G transform={`rotate(${toStart} ${c} ${c})`}>
                <Circle cx={c} cy={c - r + 2} r={8} fill={C.bg} stroke={C.lime} strokeWidth={2.2} />
                <SvgText x={c} y={c - r + 5.5} fontSize={9} fontFamily={F.display} fontWeight="700" fill={C.lime} textAnchor="middle">S</SvgText>
              </G>
            ) : null}
            {toTarget != null ? (
              <G transform={`rotate(${toTarget} ${c} ${c})`}>
                <Path d={`M${c} ${c - r - 4} L${c + 10} ${c - r + 16} L${c} ${c - r + 10} L${c - 10} ${c - r + 16} Z`} fill={C.lime} />
              </G>
            ) : null}
          </Svg>
        </Animated.View>
        {/* fixed lubber line: the top of the phone */}
        <View pointerEvents="none" style={{ position: 'absolute', left: c - 1.5, top: 0, width: 3, height: 22, borderRadius: 2, backgroundColor: C.text }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          {heading != null ? (
            <>
              <T style={{ fontFamily: F.display, fontSize: size * 0.2, lineHeight: size * 0.22, color: C.text, fontVariant: ['tabular-nums'] }}>{Math.round(heading) % 360}°</T>
              <T v="label" color={C.text2}>{cardinal(heading)} · {trueNorth ? 'true' : 'magnetic'}</T>
            </>
          ) : (
            <T v="small" center style={{ maxWidth: size * 0.55 }}>No compass reading on this device</T>
          )}
        </View>
      </View>
      {heading != null ? (
        <T v="small" color={poor ? C.orange : C.muted} center style={{ marginTop: 10, maxWidth: 300 }}>
          {poor
            ? `Compass accuracy ${ACCURACY[accuracy]?.toLowerCase() ?? 'low'}. Move the phone in a figure-8 and keep it away from metal, magnets and power banks.`
            : `Compass accuracy: ${ACCURACY[accuracy] ?? 'unknown'}`}
        </T>
      ) : null}
    </View>
  );
}

/**
 * 3D-style direction indicator: an arrow lying on a tilted disc that swings to the relative
 * bearing (bearing to target minus where the phone is pointing).
 */
export function DirectionArrow({ relative, size = 190, color = C.lime, dim }: { relative: number | null; size?: number; color?: string; dim?: boolean }) {
  const rot = useUnwrapped(relative ?? 0);
  const arrow = useAnimatedStyle(() => ({ transform: [{ perspective: 700 }, { rotateX: '54deg' }, { rotateZ: `${rot.value}deg` }] }));
  const c = size / 2;
  return (
    <View style={{ width: size, height: size * 0.82, alignItems: 'center', justifyContent: 'center', opacity: dim ? 0.35 : 1 }}>
      <Animated.View style={[{ width: size, height: size }, arrow]}>
        <Svg width={size} height={size}>
          <Circle cx={c} cy={c} r={c - 4} fill="rgba(198,255,61,0.05)" stroke="rgba(198,255,61,0.25)" strokeWidth={1.5} />
          <Circle cx={c} cy={c} r={c - 26} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={1} strokeDasharray="2 7" />
          {/* drop shadow gives the arrow thickness */}
          <Path d={`M${c} ${c - c * 0.66 + 9} L${c + c * 0.42} ${c + c * 0.42 + 9} L${c} ${c + c * 0.16 + 9} L${c - c * 0.42} ${c + c * 0.42 + 9} Z`} fill="rgba(0,0,0,0.55)" />
          <Path d={`M${c} ${c - c * 0.66} L${c} ${c + c * 0.16} L${c - c * 0.42} ${c + c * 0.42} Z`} fill={color} />
          <Path d={`M${c} ${c - c * 0.66} L${c + c * 0.42} ${c + c * 0.42} L${c} ${c + c * 0.16} Z`} fill={color} opacity={0.62} />
        </Svg>
      </Animated.View>
    </View>
  );
}
