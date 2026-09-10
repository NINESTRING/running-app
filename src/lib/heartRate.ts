import type { HeartRateSample, HeartRateSummary, RoutePoint } from '../types/run';
import type { TimeRange } from './splits';

/** HealthKit 원본 샘플 — 서비스가 라이브러리 응답을 이 형태로 변환해 넘긴다. */
export interface RawHeartRateSample {
  timestamp: number; // epoch ms (샘플 시작 시각)
  bpm: number;
  sourceId: string; // HealthKit source bundle id (예: com.xiaomi.wearable)
}

// 저장 샘플 해상도. 애플워치는 초 단위까지 쓰므로 2시간 러닝도 720개 이내로 묶인다.
export const HR_BUCKET_MS = 10_000;
// 생리학적 범위 밖은 센서 오류로 본다 (DB check 제약과 동일)
export const HR_MIN_BPM = 30;
export const HR_MAX_BPM = 250;

/** 활동 구간 밖(일시정지) 샘플과 bpm 범위 밖 샘플을 제거한다. 구간 경계는 포함. */
export function filterActiveSamples(
  samples: RawHeartRateSample[],
  active: TimeRange[]
): RawHeartRateSample[] {
  return samples.filter(
    (s) =>
      s.bpm >= HR_MIN_BPM &&
      s.bpm <= HR_MAX_BPM &&
      active.some((r) => s.timestamp >= r.start && s.timestamp <= r.end)
  );
}

/**
 * 여러 소스(미밴드 + 애플워치 등)가 섞이면 샘플이 교차해 그래프가 톱니가 된다 —
 * 샘플 수가 가장 많은 소스 하나만 남긴다. 동수면 먼저 등장한 소스.
 */
export function pickDominantSource(samples: RawHeartRateSample[]): RawHeartRateSample[] {
  if (samples.length === 0) return [];
  const counts = new Map<string, number>();
  for (const s of samples) counts.set(s.sourceId, (counts.get(s.sourceId) ?? 0) + 1);
  let best = samples[0].sourceId;
  for (const [id, n] of counts) {
    if (n > (counts.get(best) ?? 0)) best = id;
  }
  return samples.filter((s) => s.sourceId === best);
}

/**
 * 10초 버킷 평균으로 [경과초, bpm]을 만들고 평균·최대를 계산한다.
 * - 경과초는 startedAt 기준 벽시계, 버킷 시작 시각 기준 (floor)
 * - avg·max는 버킷 평균이 아닌 원본 샘플 기준 — 버킷 평균의 평균은 샘플 밀도에 따라 편향된다
 * - startedAt 이전 샘플은 제거 (음수 경과초 방지)
 */
export function summarizeHeartRate(
  samples: RawHeartRateSample[],
  startedAt: number
): HeartRateSummary | null {
  const valid = samples.filter((s) => s.timestamp >= startedAt);
  if (valid.length === 0) return null;
  const buckets = new Map<number, { sum: number; n: number }>();
  let total = 0;
  let max = -Infinity;
  for (const s of valid) {
    const key = Math.floor((s.timestamp - startedAt) / HR_BUCKET_MS);
    const b = buckets.get(key) ?? { sum: 0, n: 0 };
    b.sum += s.bpm;
    b.n += 1;
    buckets.set(key, b);
    total += s.bpm;
    if (s.bpm > max) max = s.bpm;
  }
  const out: HeartRateSample[] = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, b]) => [(key * HR_BUCKET_MS) / 1000, Math.round(b.sum / b.n)]);
  return { samples: out, avgHr: Math.round(total / valid.length), maxHr: Math.round(max) };
}

/**
 * 저장된 기록에서 활동 구간을 복원한다 — route_points 그룹 경계가 일시정지이므로
 * 각 그룹의 [첫 timestamp, 마지막 timestamp]가 활동 구간이다. 빈 그룹은 건너뛴다.
 */
export function activeRangesFromRoutePoints(groups: RoutePoint[][]): TimeRange[] {
  const out: TimeRange[] = [];
  for (const g of groups) {
    if (g.length === 0) continue;
    out.push({ start: g[0].timestamp, end: g[g.length - 1].timestamp });
  }
  return out;
}

/** 필터 → 소스 선택 → 요약. 서비스는 이 함수만 부른다. */
export function summarizeRunHeartRate(
  raw: RawHeartRateSample[],
  startedAt: number,
  active: TimeRange[]
): HeartRateSummary | null {
  return summarizeHeartRate(pickDominantSource(filterActiveSamples(raw, active)), startedAt);
}
