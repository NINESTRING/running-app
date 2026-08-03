import { StyleSheet } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import type { RoutePoint } from '../types/run';

interface Props {
  points: RoutePoint[];
  showsUserLocation?: boolean;
}

const DEFAULT_REGION = {
  latitude: 37.5663, // 서울시청
  longitude: 126.9779,
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};

export function RouteMap({ points, showsUserLocation = false }: Props) {
  const last = points[points.length - 1];
  return (
    <MapView
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
