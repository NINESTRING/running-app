import type { RoutePoint } from '../types/run';
import { haversineM } from './geo';

/**
 * 세그먼트별 투포인터 롤링 윈도우로 대상 거리의 최단 시간(초)을 찾는다.
 * 일시정지를 건너뛰는 구간은 불인정 — 세그먼트 내부에서만 탐색.
 * 윈도우 끝 경계는 선형 보간, 타임스탐프 역행 구간은 0으로 클램프.
 */
export function bestSegmentTimeSec(
  routePoints: RoutePoint[][],
  targetM: number
): number | null {
  let best: number | null = null;
  for (const seg of routePoints) {
    if (seg.length < 2) continue;
    const dist: number[] = [0];
    const time: number[] = [0];
    for (let i = 1; i < seg.length; i += 1) {
      dist.push(dist[i - 1] + haversineM(seg[i - 1], seg[i]));
      time.push(
        time[i - 1] + Math.max(0, (seg[i].timestamp - seg[i - 1].timestamp) / 1000)
      );
    }
    if (dist[dist.length - 1] < targetM) continue;
    let j = 1;
    for (let i = 0; i < seg.length - 1; i += 1) {
      if (j <= i) j = i + 1;
      while (j < seg.length && dist[j] - dist[i] < targetM) j += 1;
      if (j >= seg.length) break;
      // dist[j-1]→dist[j] 사이에서 targetM 초과분을 선형 보간으로 덜어낸다
      const over = dist[j] - dist[i] - targetM;
      const stepDist = dist[j] - dist[j - 1];
      const stepTime = time[j] - time[j - 1];
      const t = time[j] - time[i] - (stepDist > 0 ? (over / stepDist) * stepTime : 0);
      if (best === null || t < best) best = t;
    }
  }
  return best;
}
