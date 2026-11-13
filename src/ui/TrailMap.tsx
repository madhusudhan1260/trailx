import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { MAP_STYLE_URL, prepareMapRequests } from '@/services/mapEngine';
import { TRAIL_LAYERS, toRNStyle, type TrailMapProps } from './trailMapStyle';

/**
 * Native renderer (MapLibre Native). Offline areas downloaded with OfflineManager and the
 * ambient cache are used automatically when there is no network.
 */
export default function TrailMap({ geo, focus, fit, follow, height, onFailed, onUserMove }: TrailMapProps) {
  useEffect(() => { prepareMapRequests(); }, []);
  const camera = follow && focus
    ? { center: [focus.lon, focus.lat] as [number, number], zoom: 16, duration: 700 }
    : fit
      ? { bounds: fit, padding: { top: 40, right: 40, bottom: 40, left: 40 }, duration: 600 }
      : {};
  return (
    <View style={{ height, borderRadius: 24, overflow: 'hidden', backgroundColor: '#0b1a12' }}>
      <Map
        style={{ flex: 1 }}
        mapStyle={MAP_STYLE_URL}
        attribution
        logo={false}
        compass
        scaleBar
        onDidFailLoadingMap={() => onFailed?.('Map failed to load: no network and no saved map for this area.')}
        onRegionWillChange={(e) => { if ((e.nativeEvent as { userInteraction?: boolean }).userInteraction) onUserMove?.(); }}
      >
        <Camera {...(camera as object)} maxZoom={19} />
        <GeoJSONSource id="trek" data={geo as never}>
          {TRAIL_LAYERS.map((l) => (
            <Layer key={l.id} id={l.id} type={l.type as never} filter={l.filter as never} style={toRNStyle(l) as never} />
          ))}
        </GeoJSONSource>
      </Map>
    </View>
  );
}
