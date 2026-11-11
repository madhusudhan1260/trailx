import { LocateFixed } from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withRepeat, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Circle, G, Line, Path, Polygon, Text as SvgText } from 'react-native-svg';
import { simplifyIndices, toLocal, type XY } from '@/core/geo';
import type { LatLon } from '@/core/types';
import { IconButton, T } from './primitives';
import { C, F } from './theme';

const ACircle = Animated.createAnimatedComponent(Circle);

export interface CanvasPoint extends LatLon {
  seg: number;
  gap: boolean;
}

interface Props {
  points: CanvasPoint[];
  /** Live position. Drawn only when a real fix exists. */
  current?: (LatLon & { acc: number | null }) | null;
  /** True when `current` is stale (GPS lost): the marker is drawn hollow. */
  stale?: boolean;
  /** Compass heading in degrees (true/magnetic north), for the direction cone. */
  heading?: number | null;
  /** Next waypoint to walk to. */
  target?: LatLon | null;
  waypoints?: (LatLon & { name: string })[];
  /** Direction of travel for the chevrons: 'forward' while recording, 'reverse' on the way back. */
  direction?: 'forward' | 'reverse';
  /** Draw only the first N points brightly (route playback / return progress). */
  litUntil?: number;
  /** Position of the playback marker. */
  ghost?: LatLon | null;
  height?: number;
  interactive?: boolean;
}

/**
 * Map-independent breadcrumb view. It draws nothing but the user's own recorded coordinates,
 * projected to metres around the start point — no tiles, no downloads, no network.
 * Pinch to zoom, twist to rotate, drag to pan. North is up until rotated.
 */
export function RouteCanvas({ points, current, stale, heading, target, waypoints = [], direction = 'forward', litUntil, ghost, height = 360, interactive = true }: Props) {
  const [size, setSize] = useState({ w: 0, h: height });
  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  const origin: LatLon | null = points[0] ?? current ?? null;

  const model = useMemo(() => {
    if (!origin || size.w === 0) return null;
    const xy = points.map((p) => toLocal(origin, p));
    const extra: XY[] = [];
    if (current) extra.push(toLocal(origin, current));
    if (target) extra.push(toLocal(origin, target));
    for (const w of waypoints) extra.push(toLocal(origin, w));
    const all = xy.concat(extra);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of all) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    if (!Number.isFinite(minX)) { minX = maxX = minY = maxY = 0; }
    // Never zoom in past a 60 m window: at that scale GPS noise would look like movement.
    const spanX = Math.max(maxX - minX, 60);
    const spanY = Math.max(maxY - minY, 60);
    const pad = 44;
    const k = Math.min((size.w - pad * 2) / spanX, (size.h - pad * 2) / spanY);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const sc = (p: XY) => ({ x: size.w / 2 + (p.x - cx) * k, y: size.h / 2 - (p.y - cy) * k });
    return { xy, k, sc, metresAcross: size.w / k };
    // points.length is the meaningful change signal for a growing live trail
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.length, points[0]?.lat, points[0]?.lon, current?.lat, current?.lon, target?.lat, target?.lon, waypoints.length, size.w, size.h]);

  const drawn = useMemo(() => {
    if (!model || points.length === 0) return null;
    const { xy, k, sc } = model;
    // Simplify for drawing only (≈1.2 px tolerance). Navigation always uses the full-resolution trail.
    const keep = new Set(simplifyIndices(xy, 1.2 / k));
    const lit = litUntil ?? points.length;
    let solid = '';
    let solidLit = '';
    let dashed = '';
    const arrows: { x: number; y: number; a: number }[] = [];
    let prev: { x: number; y: number; i: number } | null = null;
    let sinceArrow = 0;
    for (let i = 0; i < xy.length; i++) {
      const breakBefore = i > 0 && (points[i].seg !== points[i - 1].seg || points[i].gap);
      if (!keep.has(i) && !breakBefore && !(i + 1 < xy.length && (points[i + 1].seg !== points[i].seg || points[i + 1].gap))) continue;
      const p = sc(xy[i]);
      if (!prev) {
        solid += `M${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
        if (i < lit) solidLit += `M${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      } else if (breakBefore) {
        dashed += `M${prev.x.toFixed(1)} ${prev.y.toFixed(1)}L${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
        solid += `M${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
        if (i < lit) solidLit += `M${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      } else {
        solid += `L${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
        if (i < lit) solidLit += `L${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
        const d = Math.hypot(p.x - prev.x, p.y - prev.y);
        sinceArrow += d;
        if (sinceArrow > 78 && d > 6) {
          sinceArrow = 0;
          const fwd = (Math.atan2(p.y - prev.y, p.x - prev.x) * 180) / Math.PI;
          arrows.push({ x: (p.x + prev.x) / 2, y: (p.y + prev.y) / 2, a: direction === 'forward' ? fwd : fwd + 180 });
        }
      }
      prev = { ...p, i };
    }
    return { solid, solidLit, dashed, arrows, start: sc(xy[0]), end: sc(xy[xy.length - 1]) };
  }, [model, points, litUntil, direction]);

  // ---- gestures: one transform on the whole drawing, driven on the UI thread
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const rot = useSharedValue(0);
  const savedRot = useSharedValue(0);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const gesture = useMemo(() => {
    const pinch = Gesture.Pinch()
      .onStart(() => { savedScale.value = scale.value; })
      .onUpdate((e) => { scale.value = Math.min(12, Math.max(0.5, savedScale.value * e.scale)); });
    const rotate = Gesture.Rotation()
      .onStart(() => { savedRot.value = rot.value; })
      .onUpdate((e) => { rot.value = savedRot.value + e.rotation; });
    const pan = Gesture.Pan()
      .minDistance(8)
      .onStart(() => { sx.value = tx.value; sy.value = ty.value; })
      .onUpdate((e) => { tx.value = sx.value + e.translationX; ty.value = sy.value + e.translationY; });
    const reset = Gesture.Tap().numberOfTaps(2).onEnd(() => {
      scale.value = withSpring(1); rot.value = withSpring(0); tx.value = withSpring(0); ty.value = withSpring(0);
    });
    return Gesture.Simultaneous(pinch, rotate, pan, reset);
  }, [scale, savedScale, rot, savedRot, tx, ty, sx, sy]);
  const recenter = () => {
    scale.value = withSpring(1); rot.value = withSpring(0); tx.value = withSpring(0); ty.value = withSpring(0);
  };
  const transform = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }, { rotate: `${rot.value}rad` }, { scale: scale.value }] }));
  const northStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}rad` }] }));

  // ---- pulsing position marker
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 1900, easing: Easing.out(Easing.quad) }), -1);
  }, [pulse]);
  const pulseProps = useAnimatedProps(() => ({ r: 8 + pulse.value * 20, opacity: 0.45 * (1 - pulse.value) }));

  const cur = model && current ? model.sc(toLocal(origin!, current)) : null;
  const tgt = model && target ? model.sc(toLocal(origin!, target)) : null;
  const gh = model && ghost ? model.sc(toLocal(origin!, ghost)) : null;
  const accR = model && current?.acc ? Math.min(current.acc * model.k, 140) : 0;

  const scaleBar = useMemo(() => {
    if (!model) return null;
    const target = model.metresAcross / 4;
    const steps = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    const m = steps.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
    return { px: m * model.k, label: m >= 1000 ? `${m / 1000} km` : `${m} m` };
  }, [model]);

  const body = (
    <Animated.View style={[StyleSheet.absoluteFill, transform]}>
      <Svg width={size.w} height={size.h}>
        {/* faint reference rings centred on the start: distance cues without any map */}
        {drawn && model ? [0.25, 0.5, 0.75].map((f) => (
          <Circle key={f} cx={drawn.start.x} cy={drawn.start.y} r={Math.max(size.w, size.h) * f} stroke="rgba(255,255,255,0.035)" strokeWidth={1} fill="none" />
        )) : null}
        {drawn ? (
          <>
            {drawn.dashed ? <Path d={drawn.dashed} stroke={C.orange} strokeWidth={2} strokeDasharray="5 7" strokeLinecap="round" fill="none" opacity={0.9} /> : null}
            <Path d={drawn.solid} stroke={C.lime} strokeWidth={16} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={litUntil != null ? 0.03 : 0.07} />
            <Path d={drawn.solid} stroke={C.lime} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={litUntil != null ? 0.07 : 0.16} />
            <Path d={drawn.solid} stroke={litUntil != null ? C.moss : C.lime} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            {litUntil != null && drawn.solidLit ? (
              <>
                <Path d={drawn.solidLit} stroke={C.lime} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.2} />
                <Path d={drawn.solidLit} stroke={C.lime} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </>
            ) : null}
            {drawn.arrows.map((a, i) => (
              <G key={i} transform={`translate(${a.x.toFixed(1)} ${a.y.toFixed(1)}) rotate(${a.a.toFixed(0)})`}>
                <Path d="M-4 -5 L3 0 L-4 5" stroke={C.bg} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                <Path d="M-4 -5 L3 0 L-4 5" stroke={C.text} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </G>
            ))}
            {/* start marker */}
            <Circle cx={drawn.start.x} cy={drawn.start.y} r={13} fill={C.bg} stroke={C.lime} strokeWidth={2.5} />
            <SvgText x={drawn.start.x} y={drawn.start.y + 4.5} fontSize={12} fontFamily={F.display} fontWeight="700" fill={C.lime} textAnchor="middle">S</SvgText>
            {points.length > 1 && !current ? <Circle cx={drawn.end.x} cy={drawn.end.y} r={6} fill={C.text} stroke={C.bg} strokeWidth={2} /> : null}
          </>
        ) : null}
        {model ? waypoints.map((w, i) => {
          const p = model.sc(toLocal(origin!, w));
          return (
            <G key={i}>
              <Polygon points={`${p.x},${p.y - 9} ${p.x + 7},${p.y} ${p.x},${p.y + 9} ${p.x - 7},${p.y}`} fill={C.bg} stroke={C.text} strokeWidth={1.8} />
              <SvgText x={p.x + 12} y={p.y + 4} fontSize={11} fontFamily={F.bodyMedium} fill={C.text2}>{w.name}</SvgText>
            </G>
          );
        }) : null}
        {tgt && cur ? <Line x1={cur.x} y1={cur.y} x2={tgt.x} y2={tgt.y} stroke={C.text} strokeWidth={1.5} strokeDasharray="3 6" opacity={0.7} /> : null}
        {tgt ? <><Circle cx={tgt.x} cy={tgt.y} r={9} fill="none" stroke={C.text} strokeWidth={2} /><Circle cx={tgt.x} cy={tgt.y} r={3} fill={C.text} /></> : null}
        {gh ? <><Circle cx={gh.x} cy={gh.y} r={11} fill={C.limeGlow} /><Circle cx={gh.x} cy={gh.y} r={6} fill={C.lime} stroke={C.bg} strokeWidth={2} /></> : null}
        {cur ? (
          <>
            {accR > 10 ? <Circle cx={cur.x} cy={cur.y} r={accR} fill="rgba(198,255,61,0.07)" stroke="rgba(198,255,61,0.28)" strokeWidth={1} /> : null}
            {!stale ? <ACircle cx={cur.x} cy={cur.y} fill={C.lime} animatedProps={pulseProps} /> : null}
            {heading != null && !stale ? (
              <G transform={`translate(${cur.x} ${cur.y}) rotate(${heading})`}>
                <Path d="M0 -30 L11 -8 L-11 -8 Z" fill={C.lime} opacity={0.5} />
              </G>
            ) : null}
            <Circle cx={cur.x} cy={cur.y} r={9} fill={stale ? C.bg : C.lime} stroke={stale ? C.orange : C.bg} strokeWidth={3} />
          </>
        ) : null}
      </Svg>
    </Animated.View>
  );

  return (
    <View onLayout={onLayout} style={{ height, borderRadius: 28, overflow: 'hidden', backgroundColor: '#030604', borderWidth: 1, borderColor: C.line }}>
      {interactive ? <GestureDetector gesture={gesture}><View style={StyleSheet.absoluteFill} collapsable={false}>{body}</View></GestureDetector> : body}
      {/* north indicator rotates with the drawing */}
      <View pointerEvents="none" style={{ position: 'absolute', top: 14, left: 14, alignItems: 'center' }}>
        <Animated.View style={northStyle}>
          <Svg width={34} height={34} viewBox="0 0 34 34">
            <Circle cx={17} cy={17} r={16} fill="rgba(4,7,5,0.7)" stroke={C.line} />
            <Path d="M17 5 L21.5 17 L17 14.5 L12.5 17 Z" fill={C.orange} />
            <Path d="M17 29 L21.5 17 L17 19.5 L12.5 17 Z" fill={C.faint} />
          </Svg>
        </Animated.View>
        <T v="label" style={{ fontSize: 9, marginTop: 2 }}>N</T>
      </View>
      {scaleBar ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: 16, bottom: 14 }}>
          <View style={{ width: scaleBar.px, height: 5, borderLeftWidth: 1.5, borderRightWidth: 1.5, borderBottomWidth: 1.5, borderColor: C.text2 }} />
          <T v="small" color={C.text2} style={{ fontSize: 11, marginTop: 2 }}>{scaleBar.label} · unzoomed</T>
        </View>
      ) : null}
      {interactive ? <View style={{ position: 'absolute', right: 12, bottom: 12 }}><IconButton icon={LocateFixed} onPress={recenter} label="Reset view" size={40} /></View> : null}
      {points.length === 0 && !current ? (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', padding: 32 }]}>
          <T v="small" center>No position yet. Your trail will be drawn here from real GPS fixes.</T>
        </View>
      ) : null}
    </View>
  );
}
