import type { RunRecord } from '../types/run';

const DAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'];
const DAY_MS = 86_400_000;

export function weeklyDistances(
  runs: Pick<RunRecord, 'startedAt' | 'distanceM'>[],
  now: Date
): { day: string; km: number }[] {
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  const dow = (weekStart.getDay() + 6) % 7; // 월=0
  weekStart.setDate(weekStart.getDate() - dow);

  const out = DAY_LABELS.map((day) => ({ day, km: 0 }));
  for (const run of runs) {
    const idx = Math.floor(
      (new Date(run.startedAt).getTime() - weekStart.getTime()) / DAY_MS
    );
    if (idx >= 0 && idx < 7) out[idx].km += run.distanceM / 1000;
  }
  return out;
}
