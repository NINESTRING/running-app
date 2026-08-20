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
  // 입력이 null인 포인트는 null 유지 — medianAt은 이웃만 보므로 여기서 걸러야 한다
  const median = raw.map((a, i) => (a === null ? null : medianAt(raw, i)));

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
    out[i] = median[i] === null || count === 0 ? null : sum / count;
  }
  return out;
}

/**
 * 총 상승고도 히스테리시스 임계값.
 * 스무딩 후에도 남는 저주파 드리프트 진폭(약 ±4m)을 넘어야 드리프트가 상승으로
 * 계상되지 않는다. 실측: 임계값 3m에서 평지 2km가 15.2m, 5m에서 0m.
 */
const GAIN_THRESHOLD_M = 5;

/**
 * 총 상승고도. 기준점에서 GAIN_THRESHOLD_M 이상 올라간 분만 합산하고,
 * 그만큼 내려가면 상승분 없이 기준점만 옮긴다. 평지 노이즈는 임계값을 넘지
 * 못해 0으로 유지되고, 완만한 실제 언덕은 상승분이 계속 누적된다.
 *
 * 유효 고도가 2개 미만이면 null.
 *
 * 한계: 완만한 실제 상승은 약 8%, 롤링힐은 약 25% 과소 계상된다. 기압계나 DEM
 * 없이 고도 시계열만으로는 드리프트와 완만한 언덕을 구분할 수 없어, 과대 계상을
 * 없애는 대가로 받아들인 손실이다.
 */
export function elevationGainM(groups: RoutePoint[][]): number | null {
  const alts = smoothAltitudes(groups.flat()).filter(
    (a): a is number => a !== null
  );
  if (alts.length < 2) return null;
  let gain = 0;
  let ref = alts[0];
  for (let i = 1; i < alts.length; i++) {
    const a = alts[i];
    if (a - ref > GAIN_THRESHOLD_M) {
      gain += a - ref;
      ref = a;
    } else if (ref - a > GAIN_THRESHOLD_M) {
      ref = a;
    }
  }
  return gain;
}

export interface ProfilePoint {
  distanceM: number;
  altitudeM: number;
}

/** 고도 그래프용 누적 거리 × 스무딩 고도 시리즈. 고도 null 포인트는 제외(거리는 누적). */
export function elevationProfile(groups: RoutePoint[][]): ProfilePoint[] {
  const flat = groups.flat();
  const smoothed = smoothAltitudes(flat);
  const out: ProfilePoint[] = [];
  let dist = 0;
  for (let i = 0; i < flat.length; i++) {
    if (i > 0) dist += haversineM(flat[i - 1], flat[i]);
    const a = smoothed[i];
    if (a !== null) out.push({ distanceM: dist, altitudeM: a });
  }
  return out;
}

/** 구간 고도 변화 표기: 상승 +N m, 하강 -N m, 0은 무부호, null은 — */
export function formatElevationDelta(deltaM: number | null): string {
  if (deltaM === null) return '—';
  const r = Math.round(deltaM);
  return r > 0 ? `+${r} m` : `${r} m`; // String(-0) === '0'이라 -0도 '0 m'
}

/**
 * 고도 차트 y축 기본 최소 표시범위(m).
 * 스무딩 후에도 저주파 드리프트가 남으므로(평지 2km에서 약 8.6m) 최소 폭 없이
 * min/max에 맞추면 평지도 차트 높이를 가득 채워 큰 기복처럼 보인다. 40m면
 * 그 잔여 진폭이 높이의 약 21%로 완만한 물결이 되고, 실제 지형은 손실이 없다.
 */
const DEFAULT_MIN_SPAN_M = 40;

/**
 * 고도 차트 y 도메인 [min, max]. 프로필 고도 범위가 minSpanM 미만이면
 * 중앙값을 중심으로 minSpanM 폭까지 넓힌다. 그 이상이면 실제 min/max.
 * native/web 차트가 같은 규칙을 쓰도록 공용으로 둔다.
 */
export function elevationYDomain(
  profile: ProfilePoint[],
  minSpanM: number = DEFAULT_MIN_SPAN_M
): [number, number] {
  if (profile.length === 0) return [0, minSpanM];
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of profile) {
    if (p.altitudeM < lo) lo = p.altitudeM;
    if (p.altitudeM > hi) hi = p.altitudeM;
  }
  if (hi - lo < minSpanM) {
    const center = (lo + hi) / 2;
    return [center - minSpanM / 2, center + minSpanM / 2];
  }
  return [lo, hi];
}
