import type { RoutePoint } from '../types/run';

export const SPLIT_KM_M = 1000;
export const SPLIT_MI_M = 1609.344;

export function splitDistanceFor(unit: 'km' | 'mi'): number {
  return unit === 'mi' ? SPLIT_MI_M : SPLIT_KM_M;
}

// runStore.RunSegment와 구조 호환 (stores 역참조를 피하기 위한 구조적 타입)
export interface TimeRange {
  start: number; // epoch ms
  end: number; // epoch ms
}

/**
 * flat 포인트 배열을 완료된 세그먼트 시간 구간별 그룹으로 나눈다.
 * 마지막 세그먼트 이후 포인트(진행 중 러닝)는 별도 그룹으로 묶고, 빈 그룹은 제거한다.
 * 포인트·세그먼트 모두 시간 오름차순 전제.
 */
export function partitionPoints(
  points: RoutePoint[],
  segments: TimeRange[]
): RoutePoint[][] {
  const groups: RoutePoint[][] = Array.from(
    { length: segments.length + 1 },
    () => []
  );
  let si = 0;
  for (const p of points) {
    while (si < segments.length && p.timestamp > segments[si].end) si++;
    groups[si].push(p);
  }
  return groups.filter((g) => g.length > 0);
}

const SMOOTH_WINDOW_HALF = 2; // 이동평균 윈도우 5 (중심 ±2)

/**
 * GPS 고도 노이즈(±5~10m)를 흡수하는 이동평균.
 * 고도가 null인 포인트는 null을 유지하고 이웃 평균 계산에서도 제외한다.
 */
export function smoothAltitudes(points: RoutePoint[]): (number | null)[] {
  return points.map((p, i) => {
    if (p.altitude === null) return null;
    let sum = 0;
    let n = 0;
    const from = Math.max(0, i - SMOOTH_WINDOW_HALF);
    const to = Math.min(points.length - 1, i + SMOOTH_WINDOW_HALF);
    for (let j = from; j <= to; j++) {
      const a = points[j].altitude;
      if (a !== null) {
        sum += a;
        n++;
      }
    }
    return sum / n;
  });
}
