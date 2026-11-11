import React, { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg';
import { T } from './primitives';
import { C, F } from './theme';

const APath = Animated.createAnimatedComponent(Path);
const ACircle = Animated.createAnimatedComponent(Circle);

/**
 * The TRAILX mark: a breadcrumb trail that climbs a ridge and is retraced to its origin dot.
 * On mount the trail draws itself, then the origin dot pulses once.
 */
export function Logo({ size = 64, animate = true, wordmark = false }: { size?: number; animate?: boolean; wordmark?: boolean }) {
  const draw = useSharedValue(animate ? 0 : 1);
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (!animate) return;
    draw.value = withDelay(150, withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.cubic) }));
    pulse.value = withDelay(1500, withRepeat(withSequence(withTiming(1, { duration: 1400 }), withTiming(0, { duration: 0 })), -1));
  }, [animate, draw, pulse]);
  const LEN = 150;
  const trail = useAnimatedProps(() => ({ strokeDashoffset: LEN * (1 - draw.value) }));
  const ring = useAnimatedProps(() => ({ r: 5 + pulse.value * 9, opacity: 0.5 * (1 - pulse.value) }));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.22 }}>
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <Defs>
          <SvgGradient id="lg" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={C.lime} />
            <Stop offset="1" stopColor="#6FD13A" />
          </SvgGradient>
        </Defs>
        <Path d="M4 52 L22 22 L32 36 L42 14 L60 52 Z" fill={C.forest2} stroke={C.moss} strokeWidth={1.5} strokeLinejoin="round" />
        <APath d="M14 52 C20 44 16 38 24 34 C32 30 30 24 36 22 C40 20.5 41 17 42 14" stroke="url(#lg)" strokeWidth={4} strokeLinecap="round" fill="none" strokeDasharray={LEN} animatedProps={trail} />
        <ACircle cx={14} cy={52} fill="none" stroke={C.lime} strokeWidth={1.5} animatedProps={ring} />
        <Circle cx={14} cy={52} r={4.5} fill={C.lime} />
        <Circle cx={42} cy={14} r={3} fill={C.text} />
      </Svg>
      {wordmark ? (
        <T style={{ fontFamily: F.display, fontSize: size * 0.46, letterSpacing: size * 0.06, color: C.text }}>
          TRAIL<T style={{ fontFamily: F.display, fontSize: size * 0.46, color: C.lime }}>X</T>
        </T>
      ) : null}
    </View>
  );
}

function ridge(w: number, h: number, seed: number, rough: number, base: number): string {
  // Deterministic pseudo-random ridge line so the scene is identical on every launch.
  let s = seed;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  // Alternating valleys and peaks at irregular spacing and height: a low-poly ridge silhouette.
  let x = -w * 0.04;
  let d = `M0 ${h} L0 ${base.toFixed(1)}`;
  let peak = true;
  while (x < w) {
    x += w * (0.07 + rnd() * 0.1);
    const y = peak ? base - rough * (0.45 + rnd() * 0.55) : base - rough * rnd() * 0.3;
    d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
    peak = !peak;
  }
  return `${d} L${w} ${h} Z`;
}

/**
 * Layered mountain/forest environment with slow parallax drift and twinkling stars.
 * Purely decorative — it depicts no real place and carries no data.
 */
export function MountainScene({ height = 420 }: { height?: number }) {
  const { width: sw } = useWindowDimensions();
  const w = Math.max(sw, 360) * 1.25;
  const drift = useSharedValue(0);
  const twinkle = useSharedValue(0);
  useEffect(() => {
    drift.value = withRepeat(withTiming(1, { duration: 26000, easing: Easing.inOut(Easing.sin) }), -1, true);
    twinkle.value = withRepeat(withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [drift, twinkle]);
  const layer = (depth: number) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useAnimatedStyle(() => ({ transform: [{ translateX: -w * 0.1 + (drift.value - 0.5) * depth }] }));
  const far = layer(14);
  const mid = layer(30);
  const near = layer(54);
  const stars = useAnimatedStyle(() => ({ opacity: 0.45 + twinkle.value * 0.5 }));
  const starList = React.useMemo(() => {
    let s = 11;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    return Array.from({ length: 46 }, () => ({ x: rnd() * w, y: rnd() * height * 0.42, r: 0.5 + rnd() * 1.3 }));
  }, [w, height]);
  return (
    <View pointerEvents="none" style={{ height, overflow: 'hidden' }}>
      <Animated.View style={[StyleSheet.absoluteFill, stars]}>
        <Svg width={w} height={height}>
          {starList.map((p, i) => <Circle key={i} cx={p.x} cy={p.y} r={p.r} fill={i % 7 === 0 ? C.lime : '#DCE8D8'} opacity={0.35 + (i % 5) * 0.13} />)}
        </Svg>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, far]}>
        <Svg width={w} height={height}><Path d={ridge(w, height, 3, height * 0.34, height * 0.66)} fill="#143A27" /></Svg>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, mid]}>
        <Svg width={w} height={height}><Path d={ridge(w, height, 8, height * 0.24, height * 0.8)} fill="#0C2518" /></Svg>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, near]}>
        <Svg width={w} height={height}><Path d={ridge(w, height, 21, height * 0.15, height * 0.94)} fill="#061009" /></Svg>
      </Animated.View>
    </View>
  );
}
