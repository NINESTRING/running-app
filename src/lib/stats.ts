import type { RunRecord } from '../types/run';

const DAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'];
const DAY_MS = 86_400_000;

export function weeklyDistances(
  runs: Pick<RunRecord, 'startedAt' | 'distanceM'>[],
  now: Date
): { day: string; km: number }[] {
  // 주 경계는 프로세스 로컬 타임존 기준 — 기기에서는 사용자 로컬 주로 동작, 테스트는 TZ=Asia/Seoul로 고정 실행
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

export type PeriodType = 'week' | 'month' | 'year' | 'all';

export interface Bucket {
  label: string;
  distanceM: number;
  start: Date; // 버킷 시작(로컬, inclusive)
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function startOfWeek(d: Date): Date {
  const out = startOfDay(d);
  const dow = (out.getDay() + 6) % 7; // 월=0
  out.setDate(out.getDate() - dow);
  return out;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

/** 기간의 [시작, 끝) 로컬 경계. 'all'은 null(전체 기록) */
export function periodRange(
  type: PeriodType,
  anchor: Date
): { start: Date; end: Date } | null {
  if (type === 'week') {
    const start = startOfWeek(anchor);
    return { start, end: addDays(start, 7) };
  }
  if (type === 'month') {
    return {
      start: new Date(anchor.getFullYear(), anchor.getMonth(), 1),
      end: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1),
    };
  }
  if (type === 'year') {
    return {
      start: new Date(anchor.getFullYear(), 0, 1),
      end: new Date(anchor.getFullYear() + 1, 0, 1),
    };
  }
  return null;
}

function runsInPeriod<T extends Pick<RunRecord, 'startedAt'>>(
  runs: T[],
  type: PeriodType,
  anchor: Date
): T[] {
  const range = periodRange(type, anchor);
  if (!range) return runs;
  return runs.filter((r) => {
    const t = new Date(r.startedAt).getTime();
    return t >= range.start.getTime() && t < range.end.getTime();
  });
}

function bucketStarts(
  type: PeriodType,
  anchor: Date,
  runs: Pick<RunRecord, 'startedAt'>[]
): Date[] {
  if (type === 'week') {
    const start = startOfWeek(anchor);
    return DAY_LABELS.map((_, i) => addDays(start, i));
  }
  if (type === 'month') {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const next = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
    const starts = [first];
    // 1일이 속한 주의 다음 월요일부터 주 단위 경계
    let monday = addDays(startOfWeek(first), 7);
    while (monday < next) {
      starts.push(monday);
      monday = addDays(monday, 7);
    }
    return starts;
  }
  if (type === 'year') {
    return Array.from({ length: 12 }, (_, m) => new Date(anchor.getFullYear(), m, 1));
  }
  // all: 첫 기록 연도 ~ anchor(현재) 연도
  const anchorYear = anchor.getFullYear();
  let firstYear = anchorYear;
  for (const run of runs) {
    firstYear = Math.min(firstYear, new Date(run.startedAt).getFullYear());
  }
  return Array.from(
    { length: anchorYear - firstYear + 1 },
    (_, i) => new Date(firstYear + i, 0, 1)
  );
}

function bucketLabel(type: PeriodType, start: Date, index: number): string {
  if (type === 'week') return DAY_LABELS[index];
  if (type === 'month') return `${start.getDate()}일`;
  if (type === 'year') return `${start.getMonth() + 1}월`;
  return String(start.getFullYear());
}

/** 기간별 막대 버킷. 버킷 distanceM 합 = 기간 총거리 */
export function periodBuckets(
  runs: Pick<RunRecord, 'startedAt' | 'distanceM'>[],
  type: PeriodType,
  anchor: Date
): Bucket[] {
  const inPeriod = runsInPeriod(runs, type, anchor);
  const starts = bucketStarts(type, anchor, inPeriod);
  const buckets: Bucket[] = starts.map((start, i) => ({
    start,
    label: bucketLabel(type, start, i),
    distanceM: 0,
  }));
  for (const run of inPeriod) {
    const t = new Date(run.startedAt).getTime();
    let idx = -1;
    for (let i = 0; i < starts.length; i += 1) {
      if (starts[i].getTime() <= t) idx = i;
      else break;
    }
    if (idx >= 0) buckets[idx].distanceM += run.distanceM;
  }
  return buckets;
}
