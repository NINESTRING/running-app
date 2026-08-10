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
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return { status: 'denied' };
  try {
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
  } catch {
    // 위치 서비스 꺼짐 등 — 호출부에서 기본 지역을 유지한다
    return { status: 'unavailable' };
  }
}
