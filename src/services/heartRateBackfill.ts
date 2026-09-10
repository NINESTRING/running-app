import { activeRangesFromRoutePoints } from '../lib/heartRate';
import type { TimeRange } from '../lib/splits';
import { useSettingsStore } from '../stores/settingsStore';
import type { HeartRateSummary, RunRecord } from '../types/run';
import { fetchRunHeartRate, isHeartRateSourceAvailable } from './heartRate';
import { updateRunHeartRate } from './runs';

// 이 기간이 지나도 비어 있으면 동기화가 안 된 기록으로 보고 더 조회하지 않는다 —
// 권한 거부는 HealthKit이 알려주지 않으므로, 이 제한이 빈 쿼리의 영구 반복을 막는 유일한 장치다
export const HR_BACKFILL_MAX_AGE_MS = 7 * 24 * 3600_000;
// 포커스당 HealthKit 쿼리 상한
export const HR_BACKFILL_LIMIT_PER_FOCUS = 5;

export function isHeartRateBackfillCandidate(run: RunRecord, now: number): boolean {
  return run.heartRate === null && now - Date.parse(run.startedAt) <= HR_BACKFILL_MAX_AGE_MS;
}

/** 저장된 기록에서 조회 구간·활동 구간을 복원한다. */
function queryWindow(run: RunRecord): { startedAt: number; endedAt: number; active: TimeRange[] } {
  const startedAt = Date.parse(run.startedAt);
  const ranges = run.routePoints ? activeRangesFromRoutePoints(run.routePoints) : [];
  if (ranges.length > 0) {
    // GPS(expo-location)는 5m 이동마다 포인트를 찍으므로, 출발 직후·정지 직전처럼 제자리에 서
    // 있는 구간에는 포인트가 없다 — route_points로 복원한 활동 구간은 저장 시(runStore.segments,
    // 벽시계 기준)보다 좁을 수 있다. durationSec(활동 총합의 근거)로 보정한다: 첫 구간 시작을
    // startedAt까지 당기고, 커버되지 않은 시간만큼 마지막 구간 끝을 늘린다.
    const active = ranges.map((r) => ({ ...r }));
    active[0].start = Math.min(active[0].start, startedAt);
    const covered = active.reduce((sum, r) => sum + (r.end - r.start), 0);
    const uncovered = Math.max(0, run.durationSec * 1000 - covered);
    active[active.length - 1].end += uncovered;
    return { startedAt, endedAt: active[active.length - 1].end, active };
  }
  // 경로 없는 기록 — 일시정지 정보가 없으니 전체를 한 구간으로 본다
  const endedAt = startedAt + run.durationSec * 1000;
  return { startedAt, endedAt, active: [{ start: startedAt, end: endedAt }] };
}

/**
 * 심박 없는 최근 기록을 화면이 떠 있는 동안 조용히 채운다 — 실패는 무시(다음 포커스에서 재시도).
 * 토글이 꺼져 있거나 HealthKit이 없으면 즉시 반환. runs는 최신순 전제(listRuns 순서).
 */
export async function backfillHeartRate(
  runs: RunRecord[],
  opts: {
    limit: number;
    isCancelled: () => boolean;
    onFilled: (id: string, hr: HeartRateSummary) => void;
  }
): Promise<void> {
  if (!useSettingsStore.getState().healthHeartRateOn) return;
  if (!isHeartRateSourceAvailable()) return;
  const now = Date.now();
  const targets = runs.filter((r) => isHeartRateBackfillCandidate(r, now)).slice(0, opts.limit);
  for (const run of targets) {
    if (opts.isCancelled()) return;
    const hr = await fetchRunHeartRate(queryWindow(run));
    if (hr === null) continue;
    if (!(await updateRunHeartRate(run.id, hr))) continue;
    if (opts.isCancelled()) return;
    opts.onFilled(run.id, hr);
  }
}
