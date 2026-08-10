import { useImperativeHandle, useRef, type Ref } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import type { RoutePoint } from '../types/run';

export interface RouteMapHandle {
  animateTo(coord: { latitude: number; longitude: number }): void;
}

interface Props {
  points: RoutePoint[];
  showsUserLocation?: boolean;
  ref?: Ref<RouteMapHandle>;
}

const DEFAULT_REGION = {
  latitude: 37.5663, // 서울시청
  longitude: 126.9779,
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};

export function RouteMap({ points, showsUserLocation = false, ref }: Props) {
  const mapRef = useRef<MapView>(null);
  const last = points[points.length - 1];

  useImperativeHandle(ref, () => ({
    animateTo: (coord) =>
      mapRef.current?.animateToRegion(
        { ...coord, latitudeDelta: 0.01, longitudeDelta: 0.01 },
        500,
      ),
  }));

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      showsUserLocation={showsUserLocation}
      initialRegion={DEFAULT_REGION}
      region={
        last
          ? {
              latitude: last.latitude,
              longitude: last.longitude,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            }
          : undefined
      }
    >
      {points.length >= 2 && (
        <Polyline
          coordinates={points.map((p) => ({
            latitude: p.latitude,
            longitude: p.longitude,
          }))}
          strokeWidth={4}
          strokeColor="#3b82f6"
        />
      )}
    </MapView>
  );
}
