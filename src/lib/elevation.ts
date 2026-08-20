import type { RoutePoint } from '../types/run';
import { haversineM } from './geo';

/** 1단계 중앙값 필터 윈도우 반폭 (윈도우 5 = 중심 ±2) */
const MEDIAN_WINDOW_HALF = 2;
/** 2단계 이동평균 윈도우 반경. 거리 기준이라 러너 속도와 무관하게 강도가 일정하다 */
const SMOOTH_RADIUS_M = 50;

/** 윈도우 내 null이 아닌 값들의 중앙값. 값이 없으면 null */
function medianAt(alts: (number | null)[], i: number): number | null {
  const from = Math.max(0, i - MEDIAN_WINDOW_HALF);
  const to = Math.min(alts.length - 1, i + MEDIAN_WINDOW_HALF);
  const w: number[] = [];
  for (let j = from; j <= to; j++) {
    const a = alts[j];
    if (a !== null) w.push(a);
  }
  if (w.length === 0) return null;
  w.sort((x, y) => x - y);
  const mid = w.length >> 1;
  return w.length % 2 === 1 ? w[mid] : (w[mid - 1] + w[mid]) / 2;
}

/**
 * GPS 고도 노이즈를 흡수하는 2단계 필터.
 * 1단계: 윈도우 5 중앙값 — 단발 스파이크 제거.
 * 2단계: 누적 거리 ±SMOOTH_RADIUS_M 이내 이웃의 평균 — 잔여 노이즈 평탄화.
 *
 * 저주파 드리프트(수백 m~km 주기)는 이 필터로 제거되지 않는다. 드리프트는
 * elevationGainM의 히스테리시스 임계값에서, 그래프 인상은 elevationYDomain의
 * 최소 표시범위에서 각각 처리한다.
 *
 * 고도가 null인 포인트는 null을 유지하고 이웃 계산에서도 제외한다.
 * 일시정지 구간 경계는 특별 취급하지 않는다 — 일시정지 중 이동 거리도 누적
 * 거리에 포함되어 윈도우가 그만큼 넓어지는데, 평탄화 방향으로만 작용한다.
 */
export function smoothAltitudes(points: RoutePoint[]): (number | null)[] {
  const raw = points.map((p) => p.altitude);
  const median = raw.map((_, i) => medianAt(raw, i));

  // 누적 거리는 단조 증가 — two-pointer로 윈도우를 밀며 부분합을 갱신해 O(n)
  const cum = new Array<number>(points.length);
  for (let i = 0; i < points.length; i++) {
    cum[i] = i === 0 ? 0 : cum[i - 1] + haversineM(points[i - 1], points[i]);
  }

  const out = new Array<number | null>(points.length);
  let lo = 0;
  let hi = -1; // [lo, hi] 폐구간이 현재 윈도우
  let sum = 0;
  let count = 0;
  for (let i = 0; i < points.length; i++) {
    while (hi + 1 < points.length && cum[hi + 1] - cum[i] <= SMOOTH_RADIUS_M) {
      hi++;
      const a = median[hi];
      if (a !== null) {
        sum += a;
        count++;
      }
    }
    while (lo <= hi && cum[i] - cum[lo] > SMOOTH_RADIUS_M) {
      const a = median[lo];
      if (a !== null) {
        sum -= a;
        count--;
      }
      lo++;
    }
    out[i] = raw[i] === null ? null : (median[i] === null || count === 0 ? null : sum / count);
  }
  return out;
}
