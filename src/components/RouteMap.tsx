import { useImperativeHandle, useRef, type Ref } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import { regionForRoute } from '../lib/geo';
import type { RoutePoint } from '../types/run';

export interface RouteMapHandle {
  animateTo(coord: { latitude: number; longitude: number }): void;
}

interface Props {
  points: RoutePoint[];
  showsUserLocation?: boolean;
  /** true면 새 좌표가 들어올 때마다 마지막 지점을 따라간다 (라이브 추적용) */
  follow?: boolean;
  initialCoords?: { latitude: number; longitude: number };
  ref?: Ref<RouteMapHandle>;
}

const DEFAULT_REGION = {
  latitude: 37.5663, // 서울시청
  longitude: 126.9779,
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};

export function RouteMap({
  points,
  showsUserLocation = false,
  follow = false,
  initialCoords,
  ref,
}: Props) {
  const mapRef = useRef<MapView>(null);
  const last = points[points.length - 1];

  // 우선순위: 보여줄 경로 전체 > 사용자 위치 > 기본 지역.
  // 지도는 로딩 시작 시점에 initialRegion을 다시 적용해 mount 때 넘긴 region을
  // 덮어쓰므로(react-native-maps iOS), 정적 경로는 initialRegion으로 맞춰야 한다.
  const initialRegion =
    regionForRoute(points) ??
    (initialCoords
      ? { ...initialCoords, latitudeDelta: 0.01, longitudeDelta: 0.01 }
      : DEFAULT_REGION);

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
      initialRegion={initialRegion}
      region={
        follow && last
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
