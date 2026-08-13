import { haversineM, METERS_PER_MILE } from './geo';
import type { RoutePoint, RunRecord } from '../types/run';

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

export interface RecordEntry {
  runId: string;
  startedAt: string; // ISO
  value: number; // longestDistance: m, 그 외: 초
}

export interface PersonalRecords {
  longestDistance: RecordEntry | null;
  longestDuration: RecordEntry | null;
  best1k: RecordEntry | null;
  best1mi: RecordEntry | null;
  best5k: RecordEntry | null;
  best10k: RecordEntry | null;
  bestHalf: RecordEntry | null;
  bestFull: RecordEntry | null;
}

const TARGETS = {
  best1k: 1000,
  best1mi: METERS_PER_MILE,
  best5k: 5000,
  best10k: 10_000,
  bestHalf: 21_097.5,
  bestFull: 42_195,
} as const;

/** 롤링 윈도우 우선, null이면 평균 페이스 환산 폴백. 후보 아님 → null */
function bestTimeForRun(run: RunRecord, targetM: number): number | null {
  if (run.routePoints) {
    const t = bestSegmentTimeSec(run.routePoints, targetM);
    if (t !== null) return t;
  }
  if (run.distanceM >= targetM && run.durationSec > 0) {
    return run.durationSec * (targetM / run.distanceM);
  }
  return null;
}

/** 개인 기록 8종. 동률이면 먼저 달성한(오래된) 기록 유지 */
export function personalRecords(runs: RunRecord[]): PersonalRecords {
  const out: PersonalRecords = {
    longestDistance: null,
    longestDuration: null,
    best1k: null,
    best1mi: null,
    best5k: null,
    best10k: null,
    bestHalf: null,
    bestFull: null,
  };
  const ordered = [...runs].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
  );
  for (const run of ordered) {
    if (run.distanceM > (out.longestDistance?.value ?? 0)) {
      out.longestDistance = { runId: run.id, startedAt: run.startedAt, value: run.distanceM };
    }
    if (run.durationSec > (out.longestDuration?.value ?? 0)) {
      out.longestDuration = { runId: run.id, startedAt: run.startedAt, value: run.durationSec };
    }
    for (const key of Object.keys(TARGETS) as (keyof typeof TARGETS)[]) {
      const t = bestTimeForRun(run, TARGETS[key]);
      if (t !== null && t < (out[key]?.value ?? Infinity)) {
        out[key] = { runId: run.id, startedAt: run.startedAt, value: t };
      }
    }
  }
  return out;
}
