# 활동(통계) 탭 나이키 스타일 재구성 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 통계 탭을 나이키 런 클럽 스타일로 재구성 — 주/월/년/전체 기간 세그먼트, 기간 피커, 큰 거리 숫자, 러닝 횟수·평균 페이스·시간 요약, 평균 점선이 있는 기간별 막대 차트.

**Architecture:** `listRuns()`로 전체 러닝을 받아 클라이언트에서 집계한다. 집계 로직은 `src/lib/stats.ts`에 순수 함수로 추가하고(TDD), 화면은 `app/(tabs)/stats.tsx`가 집계 결과를 `PeriodBarChart`(victory-native, 웹은 View 폴백)와 `PeriodPicker`(RN Modal)로 조립한다. 기존 `weeklyDistances`/`WeeklyBarChart`는 새 구조로 흡수 후 삭제.

**Tech Stack:** Expo SDK 57 / React Native 0.86 / expo-router / NativeWind v4 / victory-native ^41 + @shopify/react-native-skia / zustand / jest

**스펙:** `docs/superpowers/specs/2026-08-12-activity-stats-tab-design.md`

## Global Constraints

- 날짜 계산은 전부 **로컬 타임존** 기준, 주 시작은 **월요일** (기존 `weeklyDistances` 규칙 유지).
- 테스트는 `npm test` (= `TZ=Asia/Seoul jest`)로 실행. 날짜 픽스처는 `+09:00` 오프셋 명시.
- 평균 페이스는 총거리/총시간에서 파생하고 거리 10m 미만이면 null (`src/lib/geo.ts`의 `paceSecPerUnit` 재사용).
- 평균 점선 값 = 총거리 ÷ 경과 버킷 수 (버킷 시작이 now 이하인 버킷 수). 총거리 0이면 점선 숨김.
- 차트 색은 기존과 동일한 `#3b82f6`. Skia 기반 victory-native는 웹에서 동작하지 않으므로 네이티브 `.tsx` / 웹 `.web.tsx` 쌍 유지.
- 단위는 `useSettingsStore((s) => s.unit)` (`'km' | 'mi'`) 연동. mi 변환 상수는 `METERS_PER_MILE = 1609.344` (`src/lib/geo.ts:46`).
- import 경로 alias: `@/*` → `./src/*`. UI 텍스트는 반드시 `@/components/ui/text`의 `Text` 사용.
- 커밋 메시지는 기존 컨벤션(`feat(stats): …`, 한국어 요약) 준수.

---

### Task 1: 기간 버킷 집계 — `periodBuckets` / `periodRange`

**Files:**
- Modify: `src/lib/stats.ts`
- Test: `src/lib/__tests__/stats.test.ts`

**Interfaces:**
- Consumes: `RunRecord` (`src/types/run.ts:8`)
- Produces (이후 태스크가 사용):
  - `type PeriodType = 'week' | 'month' | 'year' | 'all'`
  - `interface Bucket { label: string; distanceM: number; start: Date }`
  - `periodRange(type: PeriodType, anchor: Date): { start: Date; end: Date } | null` — 'all'은 null
  - `periodBuckets(runs: Pick<RunRecord, 'startedAt' | 'distanceM'>[], type: PeriodType, anchor: Date): Bucket[]`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/__tests__/stats.test.ts`의 기존 `weeklyDistances` describe **아래에** 추가 (기존 테스트는 Task 6까지 유지):

```ts
import { periodBuckets } from '../stats';

// 2026-08-03은 월요일, 2026-08-01은 토요일. "오늘"은 2026-08-05(수)로 고정
const WED = new Date('2026-08-05T12:00:00+09:00');

describe('periodBuckets', () => {
  it('week: 월~일 7개 버킷, 요일별 합산, 지난주 제외', () => {
    const runs = [
      { startedAt: '2026-08-03T07:00:00+09:00', distanceM: 3000 }, // 월
      { startedAt: '2026-08-03T20:00:00+09:00', distanceM: 2000 }, // 월
      { startedAt: '2026-08-09T07:00:00+09:00', distanceM: 1000 }, // 일
      { startedAt: '2026-07-27T07:00:00+09:00', distanceM: 9000 }, // 지난주 월
    ];
    const result = periodBuckets(runs, 'week', WED);
    expect(result.map((b) => b.label)).toEqual(['월', '화', '수', '목', '금', '토', '일']);
    expect(result[0].distanceM).toBe(5000);
    expect(result[6].distanceM).toBe(1000);
    expect(result[1].distanceM).toBe(0);
    expect(result[0].start).toEqual(new Date('2026-08-03T00:00:00+09:00'));
  });

  it('month: 1일부터 월요일 경계로 분할, 시작일 라벨, 버킷 합 = 월 총거리', () => {
    const runs = [
      { startedAt: '2026-08-01T07:00:00+09:00', distanceM: 1000 }, // 첫 부분 주(1~2일)
      { startedAt: '2026-08-09T07:00:00+09:00', distanceM: 2000 }, // 3일 시작 주
      { startedAt: '2026-08-31T07:00:00+09:00', distanceM: 4000 }, // 31일 시작 주
      { startedAt: '2026-07-31T07:00:00+09:00', distanceM: 9000 }, // 7월 — 제외
    ];
    const result = periodBuckets(runs, 'month', WED);
    // 2026년 8월: 1(토), 3(월), 10, 17, 24, 31 시작 — 6개 버킷
    expect(result.map((b) => b.label)).toEqual(['1일', '3일', '10일', '17일', '24일', '31일']);
    expect(result[0].distanceM).toBe(1000);
    expect(result[1].distanceM).toBe(2000);
    expect(result[5].distanceM).toBe(4000);
    expect(result.reduce((s, b) => s + b.distanceM, 0)).toBe(7000);
  });

  it('year: 12개 월 버킷, 다른 해 제외', () => {
    const runs = [
      { startedAt: '2026-03-15T07:00:00+09:00', distanceM: 5000 },
      { startedAt: '2026-08-01T07:00:00+09:00', distanceM: 3000 },
      { startedAt: '2025-12-31T07:00:00+09:00', distanceM: 9000 }, // 제외
    ];
    const result = periodBuckets(runs, 'year', WED);
    expect(result).toHaveLength(12);
    expect(result.map((b) => b.label)).toEqual([
      '1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월',
    ]);
    expect(result[2].distanceM).toBe(5000);
    expect(result[7].distanceM).toBe(3000);
    expect(result[11].distanceM).toBe(0);
  });

  it('all: 첫 기록 연도부터 현재 연도까지 연도별 버킷', () => {
    const runs = [
      { startedAt: '2024-05-01T07:00:00+09:00', distanceM: 1000 },
      { startedAt: '2026-08-01T07:00:00+09:00', distanceM: 2000 },
    ];
    const result = periodBuckets(runs, 'all', WED);
    expect(result.map((b) => b.label)).toEqual(['2024', '2025', '2026']);
    expect(result[0].distanceM).toBe(1000);
    expect(result[1].distanceM).toBe(0);
    expect(result[2].distanceM).toBe(2000);
  });

  it('all: 기록이 없으면 현재 연도 1개', () => {
    const result = periodBuckets([], 'all', WED);
    expect(result.map((b) => b.label)).toEqual(['2026']);
    expect(result[0].distanceM).toBe(0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- stats`
Expected: FAIL — `periodBuckets is not a function` (또는 export 없음)

- [ ] **Step 3: 최소 구현**

`src/lib/stats.ts`에 추가 (기존 `weeklyDistances`는 그대로 둠). 기존 `DAY_LABELS`, `DAY_MS` 상수를 재사용:

```ts
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- stats`
Expected: PASS (기존 `weeklyDistances` 테스트 포함 전부)

- [ ] **Step 5: Commit**

```bash
git add src/lib/stats.ts src/lib/__tests__/stats.test.ts
git commit -m "feat(stats): 기간별(주/월/년/전체) 버킷 집계 periodBuckets 추가"
```

---

### Task 2: 기간 요약·평균선·축 눈금 — `periodSummary` / `averageDistanceM` / `niceMax`

**Files:**
- Modify: `src/lib/stats.ts`
- Test: `src/lib/__tests__/stats.test.ts`

**Interfaces:**
- Consumes: Task 1의 `PeriodType`, `Bucket`, `runsInPeriod`(내부), `src/lib/geo.ts`의 `paceSecPerUnit`
- Produces:
  - `interface PeriodSummary { distanceM: number; runCount: number; durationSec: number; avgPaceSecPerUnit: number | null }`
  - `periodSummary(runs: Pick<RunRecord, 'startedAt' | 'distanceM' | 'durationSec'>[], type: PeriodType, anchor: Date, unit: 'km' | 'mi'): PeriodSummary`
  - `averageDistanceM(buckets: Bucket[], now: Date): number | null`
  - `niceMax(value: number): number` — 차트 y축 최대 눈금(1/2/5×10ⁿ 올림, 0 이하이면 10)

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/__tests__/stats.test.ts`에 추가 (import에 `averageDistanceM, niceMax, periodBuckets, periodSummary` 포함):

```ts
describe('periodSummary', () => {
  it('기간 내 합계와 총거리/총시간 파생 평균 페이스', () => {
    const runs = [
      { startedAt: '2026-08-03T07:00:00+09:00', distanceM: 3000, durationSec: 900 },
      { startedAt: '2026-08-04T07:00:00+09:00', distanceM: 2000, durationSec: 600 },
      { startedAt: '2026-07-27T07:00:00+09:00', distanceM: 9000, durationSec: 999 }, // 지난주 제외
    ];
    const s = periodSummary(runs, 'week', WED, 'km');
    expect(s.distanceM).toBe(5000);
    expect(s.runCount).toBe(2);
    expect(s.durationSec).toBe(1500);
    expect(s.avgPaceSecPerUnit).toBeCloseTo(300); // 1500초 / 5km
  });

  it('mi 단위 평균 페이스', () => {
    const runs = [
      { startedAt: '2026-08-03T07:00:00+09:00', distanceM: 3000, durationSec: 900 },
      { startedAt: '2026-08-04T07:00:00+09:00', distanceM: 2000, durationSec: 600 },
    ];
    const s = periodSummary(runs, 'week', WED, 'mi');
    expect(s.avgPaceSecPerUnit).toBeCloseTo(482.8, 1); // 1500초 / (5000/1609.344)mi
  });

  it('빈 기간이면 0과 null', () => {
    const s = periodSummary([], 'year', WED, 'km');
    expect(s).toEqual({
      distanceM: 0,
      runCount: 0,
      durationSec: 0,
      avgPaceSecPerUnit: null,
    });
  });
});

describe('averageDistanceM', () => {
  it('총거리 ÷ 경과 버킷 수 (현재가 속한 기간)', () => {
    // 2026년 뷰, 오늘 8/5 → 1~8월 8개 버킷 경과. 345.6km / 8 = 43.2km
    const runs = [
      { startedAt: '2026-01-10T07:00:00+09:00', distanceM: 145_600 },
      { startedAt: '2026-07-10T07:00:00+09:00', distanceM: 200_000 },
    ];
    const buckets = periodBuckets(runs, 'year', WED);
    expect(averageDistanceM(buckets, WED)).toBeCloseTo(43_200);
  });

  it('과거 기간이면 전체 버킷 수로 나눔', () => {
    const runs = [{ startedAt: '2025-03-10T07:00:00+09:00', distanceM: 120_000 }];
    const buckets = periodBuckets(runs, 'year', new Date('2025-06-01T00:00:00+09:00'));
    expect(averageDistanceM(buckets, WED)).toBeCloseTo(10_000); // 120km / 12개월
  });

  it('총거리 0이면 null', () => {
    const buckets = periodBuckets([], 'year', WED);
    expect(averageDistanceM(buckets, WED)).toBeNull();
  });
});

describe('niceMax', () => {
  it('1/2/5×10ⁿ 눈금으로 올림', () => {
    expect(niceMax(0)).toBe(10);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(43.2)).toBe(50);
    expect(niceMax(128)).toBe(200);
    expect(niceMax(100)).toBe(100);
    expect(niceMax(3.4)).toBe(5);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- stats`
Expected: FAIL — `periodSummary is not a function`

- [ ] **Step 3: 최소 구현**

`src/lib/stats.ts`에 추가. 파일 상단에 `import { paceSecPerUnit } from './geo';` 추가:

```ts
export interface PeriodSummary {
  distanceM: number;
  runCount: number;
  durationSec: number;
  /** 총거리/총시간 파생. 거리 10m 미만이면 null (paceSecPerUnit 규칙) */
  avgPaceSecPerUnit: number | null;
}

export function periodSummary(
  runs: Pick<RunRecord, 'startedAt' | 'distanceM' | 'durationSec'>[],
  type: PeriodType,
  anchor: Date,
  unit: 'km' | 'mi'
): PeriodSummary {
  const inPeriod = runsInPeriod(runs, type, anchor);
  let distanceM = 0;
  let durationSec = 0;
  for (const r of inPeriod) {
    distanceM += r.distanceM;
    durationSec += r.durationSec;
  }
  return {
    distanceM,
    runCount: inPeriod.length,
    durationSec,
    avgPaceSecPerUnit: paceSecPerUnit(distanceM, durationSec * 1000, unit),
  };
}

/** 평균 점선 값 = 총거리 ÷ 경과 버킷 수(시작이 now 이하). 총거리 0이면 null */
export function averageDistanceM(buckets: Bucket[], now: Date): number | null {
  const total = buckets.reduce((s, b) => s + b.distanceM, 0);
  if (total <= 0) return null;
  const elapsed = buckets.filter((b) => b.start.getTime() <= now.getTime()).length;
  return total / Math.max(elapsed, 1);
}

/** 차트 y축 최대 눈금: 1/2/5×10ⁿ으로 올림. 0 이하이면 10 */
export function niceMax(value: number): number {
  if (value <= 0) return 10;
  const base = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 2, 5]) {
    if (value <= m * base) return m * base;
  }
  return 10 * base;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- stats`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/stats.ts src/lib/__tests__/stats.test.ts
git commit -m "feat(stats): 기간 요약 periodSummary·평균선 averageDistanceM·축 눈금 niceMax"
```

---

### Task 3: 기간 피커 옵션 — `availablePeriods` / `periodLabel`

**Files:**
- Modify: `src/lib/stats.ts`
- Test: `src/lib/__tests__/stats.test.ts`

**Interfaces:**
- Consumes: Task 1의 `PeriodType`, `startOfWeek`, `addDays`
- Produces:
  - `interface PeriodOption { key: string; label: string; anchor: Date }`
  - `availablePeriods(runs: Pick<RunRecord, 'startedAt'>[], type: PeriodType, now: Date): PeriodOption[]` — 기록 있는 기간 ∪ 현재 기간, 최신순. `'all'`은 `[]`
  - `periodLabel(type: PeriodType, anchor: Date): string`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
describe('availablePeriods', () => {
  it('month: 기록 있는 달 + 현재 달, 최신순, 중복 제거', () => {
    const runs = [
      { startedAt: '2026-06-10T07:00:00+09:00' },
      { startedAt: '2026-06-20T07:00:00+09:00' },
      { startedAt: '2025-11-01T07:00:00+09:00' },
    ];
    const options = availablePeriods(runs, 'month', WED);
    expect(options.map((o) => o.label)).toEqual([
      '2026년 8월', // 현재 달 (기록 없어도 포함)
      '2026년 6월',
      '2025년 11월',
    ]);
    expect(options[1].anchor).toEqual(new Date('2026-06-01T00:00:00+09:00'));
    expect(new Set(options.map((o) => o.key)).size).toBe(3);
  });

  it('week: 주 시작~끝 날짜 라벨', () => {
    const options = availablePeriods([], 'week', WED);
    expect(options).toHaveLength(1);
    expect(options[0].label).toBe('8월 3일 ~ 8월 9일');
    expect(options[0].anchor).toEqual(new Date('2026-08-03T00:00:00+09:00'));
  });

  it('year: 연도 라벨', () => {
    const runs = [{ startedAt: '2024-02-01T07:00:00+09:00' }];
    const options = availablePeriods(runs, 'year', WED);
    expect(options.map((o) => o.label)).toEqual(['2026년', '2024년']);
  });

  it('all: 빈 배열 (피커 없음)', () => {
    expect(availablePeriods([], 'all', WED)).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- stats`
Expected: FAIL — `availablePeriods is not a function`

- [ ] **Step 3: 최소 구현**

`src/lib/stats.ts`에 추가:

```ts
export interface PeriodOption {
  key: string;
  label: string;
  anchor: Date;
}

export function periodLabel(type: PeriodType, anchor: Date): string {
  if (type === 'week') {
    const start = startOfWeek(anchor);
    const end = addDays(start, 6);
    return `${start.getMonth() + 1}월 ${start.getDate()}일 ~ ${end.getMonth() + 1}월 ${end.getDate()}일`;
  }
  if (type === 'month') return `${anchor.getFullYear()}년 ${anchor.getMonth() + 1}월`;
  if (type === 'year') return `${anchor.getFullYear()}년`;
  return '전체';
}

/** 피커 옵션: 기록이 있는 기간 ∪ 현재 기간, 최신순. 'all'은 빈 배열 */
export function availablePeriods(
  runs: Pick<RunRecord, 'startedAt'>[],
  type: PeriodType,
  now: Date
): PeriodOption[] {
  if (type === 'all') return [];
  const byKey = new Map<string, Date>();
  const put = (d: Date) => {
    const anchor =
      type === 'week'
        ? startOfWeek(d)
        : type === 'month'
          ? new Date(d.getFullYear(), d.getMonth(), 1)
          : new Date(d.getFullYear(), 0, 1);
    const key =
      type === 'week'
        ? `${anchor.getFullYear()}-${anchor.getMonth() + 1}-${anchor.getDate()}`
        : type === 'month'
          ? `${anchor.getFullYear()}-${anchor.getMonth() + 1}`
          : `${anchor.getFullYear()}`;
    if (!byKey.has(key)) byKey.set(key, anchor);
  };
  put(now);
  for (const run of runs) put(new Date(run.startedAt));
  return [...byKey.entries()]
    .sort((a, b) => b[1].getTime() - a[1].getTime())
    .map(([key, anchor]) => ({ key, anchor, label: periodLabel(type, anchor) }));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- stats`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/stats.ts src/lib/__tests__/stats.test.ts
git commit -m "feat(stats): 기간 피커 옵션 availablePeriods·periodLabel 추가"
```

---

### Task 4: 차트 컴포넌트 — `PeriodBarChart` (네이티브 + 웹)

**Files:**
- Create: `src/components/PeriodBarChart.tsx`
- Create: `src/components/PeriodBarChart.web.tsx`

**Interfaces:**
- Consumes: Task 1~2의 `Bucket`, `niceMax`, `src/lib/geo.ts`의 `METERS_PER_MILE`
- Produces: `PeriodBarChart({ buckets: Bucket[]; averageM: number | null; unit: 'km' | 'mi' })` — 자체 높이(차트 208px + 라벨)를 갖는 완결 블록. 두 파일의 props는 동일해야 함.

차트 로직은 lib에서 테스트했으므로 컴포넌트 자체는 기존 관례대로 단위 테스트 없음. 타입체크로 검증.

- [ ] **Step 1: 네이티브 구현 작성**

`src/components/PeriodBarChart.tsx`:

```tsx
import { DashPathEffect, Line as SkiaLine, vec } from '@shopify/react-native-skia';
import { useState } from 'react';
import { View } from 'react-native';
import { Bar, CartesianChart } from 'victory-native';

import { Text } from '@/components/ui/text';
import { METERS_PER_MILE } from '@/lib/geo';
import { niceMax, type Bucket } from '@/lib/stats';

interface Props {
  buckets: Bucket[];
  averageM: number | null;
  unit: 'km' | 'mi';
}

export function PeriodBarChart({ buckets, averageM, unit }: Props) {
  const [chartHeight, setChartHeight] = useState(0);
  const unitM = unit === 'mi' ? METERS_PER_MILE : 1000;
  const data = buckets.map((b, i) => ({ x: i, value: b.distanceM / unitM }));
  const yMax = niceMax(Math.max(...data.map((d) => d.value), 0));
  const avg = averageM === null ? null : averageM / unitM;
  const sparse = buckets.length > 8; // 12개월 등은 라벨 격버킷 표시

  return (
    <View className="gap-1">
      <View className="flex-row">
        <View
          className="h-52 flex-1"
          onLayout={(e) => setChartHeight(e.nativeEvent.layout.height)}
        >
          <CartesianChart
            data={data}
            xKey="x"
            yKeys={['value']}
            domain={{ y: [0, yMax] }}
            domainPadding={{ left: 16, right: 16 }}
          >
            {({ points, chartBounds }) => {
              const avgY =
                avg === null
                  ? null
                  : chartBounds.bottom -
                    (avg / yMax) * (chartBounds.bottom - chartBounds.top);
              return (
                <>
                  <Bar
                    points={points.value}
                    chartBounds={chartBounds}
                    color="#3b82f6"
                    roundedCorners={{ topLeft: 4, topRight: 4 }}
                  />
                  {avgY !== null && (
                    <SkiaLine
                      p1={vec(chartBounds.left, avgY)}
                      p2={vec(chartBounds.right, avgY)}
                      color="#9ca3af"
                      strokeWidth={1}
                    >
                      <DashPathEffect intervals={[4, 4]} />
                    </SkiaLine>
                  )}
                </>
              );
            }}
          </CartesianChart>
          {avg !== null && chartHeight > 0 && (
            <Text
              className="absolute right-1 text-xs text-muted-foreground"
              style={{ top: Math.max((1 - avg / yMax) * chartHeight - 16, 0) }}
            >
              {avg.toFixed(1)}
            </Text>
          )}
        </View>
        <View className="h-52 w-12 justify-between pl-1">
          <Text className="text-xs text-muted-foreground">{yMax}</Text>
          <Text className="text-xs text-muted-foreground">0{unit}</Text>
        </View>
      </View>
      <View className="flex-row pr-12">
        {buckets.map((b, i) => (
          <View key={b.start.toISOString()} className="flex-1 items-center">
            <Text className="text-xs text-muted-foreground">
              {sparse && i % 2 === 1 ? '' : b.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
```

참고: 평균값 라벨의 오버레이 top은 캔버스 내부 chartBounds와 완전히 일치하지 않는 근사 위치다(축을 그리지 않아 패딩이 거의 0이라 시각적으로 충분). victory-native v41의 `CartesianChart` children 인자는 `points`/`chartBounds`를 제공하며 이는 기존 `WeeklyBarChart.tsx:10`에서 이미 사용하던 패턴.

- [ ] **Step 2: 웹 폴백 구현 작성**

`src/components/PeriodBarChart.web.tsx`:

```tsx
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { METERS_PER_MILE } from '@/lib/geo';
import { niceMax, type Bucket } from '@/lib/stats';

interface Props {
  buckets: Bucket[];
  averageM: number | null;
  unit: 'km' | 'mi';
}

// victory-native는 Skia(CanvasKit WASM) 기반이라 웹에서는 WASM을 따로 로드하지 않으면
// 동작하지 않는다. 웹 번들에서는 View 기반 막대 그래프로 대체한다.
export function PeriodBarChart({ buckets, averageM, unit }: Props) {
  const unitM = unit === 'mi' ? METERS_PER_MILE : 1000;
  const yMax = niceMax(Math.max(...buckets.map((b) => b.distanceM / unitM), 0));
  const avg = averageM === null ? null : averageM / unitM;
  const sparse = buckets.length > 8;

  return (
    <View className="gap-1">
      <View className="flex-row">
        <View className="h-52 flex-1">
          <View style={styles.row}>
            {buckets.map((b) => (
              <View key={b.start.toISOString()} style={styles.slot}>
                <View
                  style={[
                    styles.bar,
                    { height: `${(b.distanceM / unitM / yMax) * 100}%` },
                  ]}
                />
              </View>
            ))}
          </View>
          {avg !== null && (
            <>
              <View style={[styles.avgLine, { top: `${(1 - avg / yMax) * 100}%` }]} />
              <Text
                className="absolute right-1 text-xs text-muted-foreground"
                style={{ top: `${(1 - avg / yMax) * 100}%`, marginTop: -18 }}
              >
                {avg.toFixed(1)}
              </Text>
            </>
          )}
        </View>
        <View className="h-52 w-12 justify-between pl-1">
          <Text className="text-xs text-muted-foreground">{yMax}</Text>
          <Text className="text-xs text-muted-foreground">0{unit}</Text>
        </View>
      </View>
      <View className="flex-row pr-12">
        {buckets.map((b, i) => (
          <View key={b.start.toISOString()} className="flex-1 items-center">
            <Text className="text-xs text-muted-foreground">
              {sparse && i % 2 === 1 ? '' : b.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
  },
  slot: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  bar: {
    width: '55%',
    backgroundColor: '#3b82f6',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  avgLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#9ca3af',
  },
});
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 4: Commit**

```bash
git add src/components/PeriodBarChart.tsx src/components/PeriodBarChart.web.tsx
git commit -m "feat(stats): 평균 점선·축 라벨 지원 PeriodBarChart 컴포넌트 (네이티브/웹)"
```

---

### Task 5: 기간 선택 모달 — `PeriodPicker`

**Files:**
- Create: `src/components/PeriodPicker.tsx`

**Interfaces:**
- Consumes: Task 3의 `PeriodOption`
- Produces: `PeriodPicker({ visible: boolean; options: PeriodOption[]; selectedKey: string | null; onSelect: (key: string) => void; onClose: () => void })` — RN `Modal` 기반이라 웹 폴백 불필요.

- [ ] **Step 1: 구현 작성**

`src/components/PeriodPicker.tsx`:

```tsx
import { FlatList, Modal, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { PeriodOption } from '@/lib/stats';
import { cn } from '@/lib/utils';

interface Props {
  visible: boolean;
  options: PeriodOption[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onClose: () => void;
}

export function PeriodPicker({ visible, options, selectedKey, onSelect, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/40" onPress={onClose}>
        {/* 내부 시트 탭이 배경 onPress로 전파되지 않도록 빈 핸들러 */}
        <Pressable className="max-h-[60%] rounded-t-2xl bg-background pb-8 pt-2" onPress={() => {}}>
          <View className="items-center py-2">
            <View className="h-1 w-10 rounded-full bg-muted" />
          </View>
          <FlatList
            data={options}
            keyExtractor={(o) => o.key}
            renderItem={({ item }) => (
              <Pressable
                className="px-6 py-3 active:bg-accent"
                onPress={() => {
                  onSelect(item.key);
                  onClose();
                }}
              >
                <Text
                  className={cn(
                    'text-base',
                    item.key === selectedKey && 'font-bold'
                  )}
                >
                  {item.label}
                </Text>
              </Pressable>
            )}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add src/components/PeriodPicker.tsx
git commit -m "feat(stats): 기간 선택 모달 PeriodPicker 추가"
```

---

### Task 6: 화면 조립 — `stats.tsx` 재작성 + 구 코드 삭제

**Files:**
- Modify: `app/(tabs)/stats.tsx` (전체 재작성)
- Modify: `src/lib/stats.ts` (`weeklyDistances`와 `DAY_MS` 삭제 — `DAY_LABELS`는 유지)
- Modify: `src/lib/__tests__/stats.test.ts` (`weeklyDistances` describe와 import 삭제)
- Delete: `src/components/WeeklyBarChart.tsx`, `src/components/WeeklyBarChart.web.tsx`

**Interfaces:**
- Consumes: Task 1~5의 `periodBuckets`, `periodSummary`, `averageDistanceM`, `availablePeriods`, `PeriodType`, `PeriodBarChart`, `PeriodPicker`; `src/lib/geo.ts`의 `formatDuration`, `formatPace`, `METERS_PER_MILE`; `useSettingsStore`; `listRuns`
- Produces: 최종 화면. 이후 태스크 없음.

- [ ] **Step 1: stats.tsx 전체 재작성**

```tsx
import { useFocusEffect } from 'expo-router';
import { ChevronDown } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { PeriodBarChart } from '@/components/PeriodBarChart';
import { PeriodPicker } from '@/components/PeriodPicker';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { formatDuration, formatPace, METERS_PER_MILE } from '@/lib/geo';
import {
  availablePeriods,
  averageDistanceM,
  periodBuckets,
  periodSummary,
  type PeriodType,
} from '@/lib/stats';
import { listRuns } from '@/services/runs';
import { useSettingsStore } from '@/stores/settingsStore';
import type { RunRecord } from '@/types/run';

const PERIOD_TABS: { value: PeriodType; label: string }[] = [
  { value: 'week', label: '주' },
  { value: 'month', label: '월' },
  { value: 'year', label: '년' },
  { value: 'all', label: '전체' },
];

export default function StatsScreen() {
  const unit = useSettingsStore((s) => s.unit);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [periodType, setPeriodType] = useState<PeriodType>('week');
  // null = 현재 기간. 세그먼트 전환 시 리셋
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      listRuns().then((loaded) => {
        if (!cancelled) setRuns(loaded);
      });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  // 개인 기록 수백 건 수준이라 렌더마다 집계해도 충분히 가볍다
  const now = new Date();
  const options = availablePeriods(runs, periodType, now);
  const selected = options.find((o) => o.key === selectedKey) ?? options[0] ?? null;
  const anchor = selected?.anchor ?? now;
  const summary = periodSummary(runs, periodType, anchor, unit);
  const buckets = periodBuckets(runs, periodType, anchor);
  const averageM = averageDistanceM(buckets, now);
  const unitM = unit === 'mi' ? METERS_PER_MILE : 1000;
  const bigDistance = (summary.distanceM / unitM).toFixed(1);

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-5 p-4">
      <Text className="text-3xl font-bold">활동</Text>

      <ToggleGroup
        type="single"
        value={periodType}
        onValueChange={(v) => {
          if (v === 'week' || v === 'month' || v === 'year' || v === 'all') {
            setPeriodType(v);
            setSelectedKey(null);
          }
        }}
        variant="outline"
      >
        {PERIOD_TABS.map((tab, i) => (
          <ToggleGroupItem
            key={tab.value}
            value={tab.value}
            isFirst={i === 0}
            isLast={i === PERIOD_TABS.length - 1}
            className="flex-1"
          >
            <Text>{tab.label}</Text>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {periodType !== 'all' && selected && (
        <Pressable
          className="flex-row items-center gap-1 self-start"
          onPress={() => setPickerVisible(true)}
        >
          <Text className="text-xl font-semibold">{selected.label}</Text>
          <Icon as={ChevronDown} size={18} />
        </Pressable>
      )}

      <View>
        <Text className="text-6xl font-extrabold italic">{bigDistance}</Text>
        <Text className="text-sm text-muted-foreground">
          {unit === 'km' ? '킬로미터' : '마일'}
        </Text>
      </View>

      <View className="flex-row">
        <View className="flex-1 gap-0.5">
          <Text className="text-2xl font-semibold">{summary.runCount}</Text>
          <Text className="text-xs text-muted-foreground">러닝</Text>
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="text-2xl font-semibold">
            {formatPace(summary.avgPaceSecPerUnit)}
          </Text>
          <Text className="text-xs text-muted-foreground">평균 페이스</Text>
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="text-2xl font-semibold">
            {formatDuration(summary.durationSec * 1000)}
          </Text>
          <Text className="text-xs text-muted-foreground">시간</Text>
        </View>
      </View>

      <PeriodBarChart buckets={buckets} averageM={averageM} unit={unit} />

      <PeriodPicker
        visible={pickerVisible}
        options={options}
        selectedKey={selected?.key ?? null}
        onSelect={setSelectedKey}
        onClose={() => setPickerVisible(false)}
      />
    </ScrollView>
  );
}
```

- [ ] **Step 2: 구 코드 삭제**

```bash
rm src/components/WeeklyBarChart.tsx src/components/WeeklyBarChart.web.tsx
```

- `src/lib/stats.ts`에서 `weeklyDistances` 함수와 `DAY_MS` 상수 삭제 (`DAY_LABELS`는 `periodBuckets`가 사용하므로 유지).
- `src/lib/__tests__/stats.test.ts`에서 `weeklyDistances` describe 블록(기존 3개 테스트)과 해당 import 삭제. `NOW` 상수가 더 이상 안 쓰이면 함께 삭제.

- [ ] **Step 3: 잔여 참조 확인**

Run: `grep -rn "weeklyDistances\|WeeklyBarChart" src app`
Expected: 출력 없음

- [ ] **Step 4: 전체 검증**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: 테스트 전부 PASS, 타입/린트 에러 없음

- [ ] **Step 5: Commit**

```bash
git add -A app/\(tabs\)/stats.tsx src/lib/stats.ts src/lib/__tests__/stats.test.ts src/components/WeeklyBarChart.tsx src/components/WeeklyBarChart.web.tsx
git commit -m "feat(stats): 활동 탭 나이키 스타일 재구성 — 기간 세그먼트·피커·요약·평균선 차트"
```

---

## 검증 노트 (플랜 전체)

- 시뮬레이터/실기기 확인 포인트: ① 4개 세그먼트 전환 시 라벨·차트 갱신 ② 기간 라벨 탭 → 피커 → 과거 기간 선택 ③ 설정에서 mi로 바꾼 뒤 큰 숫자·페이스·축 라벨 변화 ④ 기록 0건 상태(0.0 / 0 / --'--" / 빈 차트) ⑤ 웹(`npm run web`)에서 View 폴백 차트 렌더.
- victory-native `domain`/`domainPadding` prop이 v41에서 시그니처가 다르면 https://commerce.nearform.com/open-source/victory-native 문서 확인 후 조정 (기존 `WeeklyBarChart.tsx`가 동일 라이브러리로 이미 렌더 확인됨).
