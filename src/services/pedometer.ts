import { Platform } from 'react-native';
import { Pedometer } from 'expo-sensors';
import type { RunSegment } from '../stores/runStore';
import { useRunStore } from '../stores/runStore';

let subscription: { remove: () => void } | null = null;

/** 거부·미지원·에러여도 false만 반환 — 호출부는 러닝 시작을 차단하지 않는다. */
export async function requestPedometerPermissions(): Promise<boolean> {
  try {
    const res = await Pedometer.requestPermissionsAsync();
    return res.granted;
  } catch {
    return false;
  }
}

export async function startStepCounting(): Promise<void> {
  if (subscription) return;
  try {
    if (!(await Pedometer.isAvailableAsync())) return;
    useRunStore.getState().beginStepTracking();
    subscription = Pedometer.watchStepCount((result) => {
      useRunStore.getState().addStepReading(result.steps, Date.now());
    });
  } catch {
    // 케이던스 없이 러닝 진행 — steps는 null(측정 안 됨)로 남는다
  }
}

export function stopStepCounting(): void {
  subscription?.remove();
  subscription = null;
}

/**
 * iOS 전용: CMPedometer 이력으로 러닝 세그먼트별 걸음을 백필한다.
 * 화면 꺼짐·백그라운드 구간이 보정되고, 일시정지 구간은 세그먼트 밖이라 자연 제외.
 * Android·실패 시 null — 호출부가 라이브 카운트로 폴백한다.
 */
export async function backfillSteps(
  segments: RunSegment[]
): Promise<number | null> {
  if (Platform.OS !== 'ios' || segments.length === 0) return null;
  try {
    let total = 0;
    for (const seg of segments) {
      const { steps } = await Pedometer.getStepCountAsync(
        new Date(seg.start),
        new Date(seg.end)
      );
      total += steps;
    }
    return total;
  } catch {
    return null;
  }
}
