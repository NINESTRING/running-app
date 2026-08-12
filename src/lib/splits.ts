import type { RoutePoint } from '../types/run';
import { haversineM } from './geo';

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
 *
 * 중요: 출력 그룹은 segments.length와 1:1 대응되지 않는다.
 * - 포인트가 0개인 세그먼트는 출력에서 드롭됨 (그룹이 생기지 않음)
 * - 마지막 세그먼트 이후 포인트들은 추가 그룹을 형성함
 * 따라서 소비자는 그룹↔세그먼트 인덱스 대응을 가정하면 안 됨.
 * 대신 "그룹 경계 = 일시정지(시간 미산입)"라는 의미만 사용할 것.
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

export interface Split {
  index: number; // 1부터
  distanceM: number; // 완료 구간 = splitDistanceM, 진행 중 구간은 현재까지 누적
  durationSec: number; // 일시정지 시간 제외
  elevationDeltaM: number | null; // 구간 끝 − 시작 고도(스무딩 후). 고도 없으면 null
}

export interface SplitsResult {
  completed: Split[];
  current: Split | null; // 진행 중 미완료 구간. 이동 거리가 0이면 null
}

/**
 * 세그먼트 그룹 포인트를 splitDistanceM 단위 구간으로 나눈다.
 * - 같은 그룹 내 연속 쌍: 거리 = 하버사인, 시간 = timestamp 차이.
 * - 그룹 경계를 넘는 쌍: 거리만 합산, 시간 0 (일시정지 제외 — 라이브 distanceM 누적과 동일 규칙).
 * - 구간 경계가 쌍 중간에 걸치면 시각·고도를 선형 보간한다.
 */
export function computeSplits(
  groups: RoutePoint[][],
  splitDistanceM: number
): SplitsResult {
  const flat = groups.flat();
  if (flat.length < 2) return { completed: [], current: null };
  const smoothed = smoothAltitudes(flat);
  // 그룹 첫 포인트의 flat 인덱스 — 직전 쌍이 세그먼트 경계임을 표시
  const groupStartIdx = new Set<number>();
  let acc = 0;
  for (const g of groups) {
    groupStartIdx.add(acc);
    acc += g.length;
  }

  const completed: Split[] = [];
  let dist = 0;
  let durMs = 0;
  let startAlt = smoothed[0];
  let index = 1;

  for (let i = 1; i < flat.length; i++) {
    let dd = haversineM(flat[i - 1], flat[i]);
    let dt = groupStartIdx.has(i) ? 0 : flat[i].timestamp - flat[i - 1].timestamp;
    let fromAlt = smoothed[i - 1];
    const toAlt = smoothed[i];
    // 한 쌍이 여러 구간 경계를 넘을 수 있다
    while (dd > 0 && dist + dd >= splitDistanceM) {
      const need = splitDistanceM - dist;
      const f = need / dd;
      const tCross = dt * f;
      const altCross =
        fromAlt !== null && toAlt !== null
          ? fromAlt + (toAlt - fromAlt) * f
          : (toAlt ?? fromAlt);
      completed.push({
        index,
        distanceM: splitDistanceM,
        durationSec: (durMs + tCross) / 1000,
        elevationDeltaM:
          startAlt !== null && altCross !== null ? altCross - startAlt : null,
      });
      index++;
      dd -= need;
      dt -= tCross;
      dist = 0;
      durMs = 0;
      startAlt = altCross;
      fromAlt = altCross;
    }
    dist += dd;
    durMs += dt;
  }

  const endAlt = smoothed[flat.length - 1];
  const current =
    dist > 0
      ? {
          index,
          distanceM: dist,
          durationSec: durMs / 1000,
          elevationDeltaM:
            startAlt !== null && endAlt !== null ? endAlt - startAlt : null,
        }
      : null;
  return { completed, current };
}

/**
 * 구간 페이스(초/구간단위). 진행 중 구간은 구간 길이 기준 환산.
 * 거리 10m 미만이거나 시간 0 이하(일시정지 중 이동 후 재개 직후)는 null.
 */
export function splitPaceSec(
  split: Split | null,
  splitDistanceM: number
): number | null {
  if (!split || split.distanceM < 10 || split.durationSec <= 0) return null;
  return (split.durationSec * splitDistanceM) / split.distanceM;
}

/**
 * 라이브 표시용 구간 페이스: 마지막 GPS 포인트 이후 벽시계 경과 시간을 가산해,
 * 러너가 멈추면 페이스가 얼어붙지 않고 점점 느려지게 한다. 음수 경과는 0으로 클램프.
 */
export function liveSplitPaceSec(
  split: Split | null,
  splitDistanceM: number,
  extraSec: number
): number | null {
  if (!split) return null;
  return splitPaceSec(
    { ...split, durationSec: split.durationSec + Math.max(0, extraSec) },
    splitDistanceM
  );
}

/** 구간 고도 변화 표기: 상승 +N m, 하강 -N m, 0은 무부호, null은 — */
export function formatElevationDelta(deltaM: number | null): string {
  if (deltaM === null) return '—';
  const r = Math.round(deltaM);
  return r > 0 ? `+${r} m` : `${r === 0 ? 0 : r} m`;
}

/** 총 상승고도: 스무딩 후 양(+)의 변화만 합산. 유효 고도가 2개 미만이면 null */
export function elevationGainM(groups: RoutePoint[][]): number | null {
  const alts = smoothAltitudes(groups.flat()).filter(
    (a): a is number => a !== null
  );
  if (alts.length < 2) return null;
  let gain = 0;
  for (let i = 1; i < alts.length; i++) {
    const d = alts[i] - alts[i - 1];
    if (d > 0) gain += d;
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
