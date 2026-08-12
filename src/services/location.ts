import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { useRunStore } from '../stores/runStore';

export const RUN_TRACKING_TASK = 'run-tracking';

TaskManager.defineTask(RUN_TRACKING_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  const { addPoint } = useRunStore.getState();
  for (const loc of locations) {
    addPoint({
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      altitude: loc.coords.altitude ?? null,
      timestamp: loc.timestamp,
    });
  }
});

export async function requestPermissions(): Promise<boolean> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return false;
  // 백그라운드 권한은 거부돼도 포그라운드 추적은 가능하므로 차단하지 않음
  await Location.requestBackgroundPermissionsAsync();
  return true;
}

export async function startTracking(): Promise<void> {
  await Location.startLocationUpdatesAsync(RUN_TRACKING_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 3000,
    distanceInterval: 5,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: '러닝 기록 중',
      notificationBody: '경로를 기록하고 있습니다.',
    },
  });
}

export async function stopTracking(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(RUN_TRACKING_TASK)) {
    await Location.stopLocationUpdatesAsync(RUN_TRACKING_TASK);
  }
}

export type MyLocationResult =
  | { status: 'granted'; coords: { latitude: number; longitude: number } }
  | { status: 'denied' }
  | { status: 'unavailable' };

/** 포그라운드 권한을 확보한 뒤 현재 좌표를 1회 조회한다. */
export async function getMyLocation(): Promise<MyLocationResult> {
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') return { status: 'denied' };
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      status: 'granted',
      coords: {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      },
    };
  } catch (e) {
    // 위치 서비스 꺼짐·권한 요청 실패 등 — 호출부에서 기본 지역을 유지한다
    console.warn('[location] getMyLocation 실패', e);
    return { status: 'unavailable' };
  }
}

export type MyLocationAction =
  | { kind: 'animate'; coords: { latitude: number; longitude: number } }
  | { kind: 'showDenied' }
  | { kind: 'ignore' };

/** getMyLocation 결과를 홈 화면 동작으로 변환한다. 마운트 시 거부는 조용히 무시, 버튼 탭 시 거부는 안내 표시. */
export function myLocationAction(result: MyLocationResult, fromButton: boolean): MyLocationAction {
  if (result.status === 'granted') return { kind: 'animate', coords: result.coords };
  if (result.status === 'denied' && fromButton) return { kind: 'showDenied' };
  return { kind: 'ignore' };
}

/**
 * 지도 첫 렌더용 초기 좌표. 프롬프트 없이, 권한이 이미 있을 때만
 * 캐시된 마지막 위치를 즉시 반환한다. 실패는 모두 null (기본 지역 폴백).
 */
export async function getInitialCoords(): Promise<{
  latitude: number;
  longitude: number;
} | null> {
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (fg.status !== 'granted') return null;
    const pos = await Location.getLastKnownPositionAsync();
    if (!pos) return null;
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  } catch (e) {
    console.warn('[location] getInitialCoords 실패', e);
    return null;
  }
}
