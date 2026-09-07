import { useImperativeHandle, useRef, type Ref } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
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
  /** 랩 게이트 좌표. 루프가 감지되면 마커로 표시 */
  gate?: { latitude: number; longitude: number } | null;
  ref?: Ref<RouteMapHandle>;
}

// 라이브 추적 시 보이는 범위(위·경도 폭). 상단 지표 카드가 지도 위쪽을 덮으므로
// 한 단계 넓게(약 2.2km) 잡아 주변 경로가 카드 아래로도 보이게 한다
const LIVE_REGION_DELTA = 0.02;

const DEFAULT_REGION = {
  latitude: 37.5663, // 서울시청
  longitude: 126.9779,
  latitudeDelta: LIVE_REGION_DELTA,
  longitudeDelta: LIVE_REGION_DELTA,
};

export function RouteMap({
  points,
  showsUserLocation = false,
  follow = false,
  initialCoords,
  gate = null,
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
      ? { ...initialCoords, latitudeDelta: LIVE_REGION_DELTA, longitudeDelta: LIVE_REGION_DELTA }
      : DEFAULT_REGION);

  useImperativeHandle(ref, () => ({
    animateTo: (coord) =>
      mapRef.current?.animateToRegion(
        { ...coord, latitudeDelta: LIVE_REGION_DELTA, longitudeDelta: LIVE_REGION_DELTA },
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
              latitudeDelta: LIVE_REGION_DELTA,
              longitudeDelta: LIVE_REGION_DELTA,
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
      {gate && (
        <Marker
          coordinate={gate}
          title="랩 게이트"
          pinColor="#3b82f6"
          anchor={{ x: 0.5, y: 1 }}
        />
      )}
    </MapView>
  );
}
