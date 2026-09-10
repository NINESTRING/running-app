# 건강 앱 심박 가져오기(iOS HealthKit) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 미밴드·애플워치 등이 건강 앱(HealthKit)에 기록한 심박을 러닝 저장 후 러닝 구간에서 읽어 기록에 저장하고, 상세 화면에 평균·최대 심박과 시간×bpm 그래프, 히스토리에 평균 심박을 표시한다.

**Architecture:** HealthKit에 의존하지 않는 계산(활동 구간 필터·소스 선택·10초 버킷 요약·파싱·포맷)은 `src/lib/heartRate.ts` 순수 함수로 두고 유닛 테스트한다. `src/services/heartRate.ts`가 `@kingstinct/react-native-healthkit`을 감싸 권한 요청과 구간 조회를 제공하며, 모든 실패는 `null`. 저장 시 1회 조회하고, 동기화 지연으로 비어 있으면 위치 라벨과 같은 lazy 백필(`src/services/heartRateBackfill.ts`)이 히스토리·상세 진입 시 채운다. DB에는 `heart_rate_samples`·`avg_hr`·`max_hr` 3컬럼(원자적 null)을 추가한다.

**Tech Stack:** Expo 57 / React Native 0.86, `@kingstinct/react-native-healthkit` 14.x + `react-native-nitro-modules`, zustand(persist), victory-native, Supabase(Postgres), jest(jest-expo)

**스펙:** `docs/superpowers/specs/2026-09-10-health-heart-rate-design.md`

**스펙 대비 구현 보강(승인된 의도 내):** 스펙은 서비스를 `heartRate.ios.ts`/`heartRate.ts`로 나누라고 했으나, 라이브러리 자체가 `healthkit.ios.ts`/`healthkit.ts`(비iOS 스텁: 빈 배열·false 반환) 플랫폼 분기를 이미 갖고 있어 웹 번들에서 nitro 모듈이 로드되지 않는다. 따라서 서비스는 **단일 파일 `src/services/heartRate.ts`**로 두고 `Platform.OS === 'ios'` 가드를 추가한다. jest(iOS 플랫폼)에서는 `@kingstinct/react-native-healthkit`을 **팩토리 모킹**해 서비스 자체도 유닛 테스트한다(스펙의 "서비스는 실기기로만 확인"보다 커버리지가 넓어진다). 또한 `parseHeartRateSamples`는 스펙의 `src/lib/heartRate.ts`가 아니라 `route_points` 파서(`parseRoutePoints`)와 같은 자리인 `src/services/runs.ts`에 둔다 — DB 행 파싱은 모두 한 파일에 모으는 기존 관례를 따른다. Task 9에서 스펙 문구를 이 두 가지에 맞게 갱신한다.

## Global Constraints

- Expo v57 고정 — 네이티브 API를 새로 쓰기 전 https://docs.expo.dev/versions/v57.0.0/ 확인 (AGENTS.md). 이 기능의 네이티브 의존성은 서드파티 `@kingstinct/react-native-healthkit`(Expo config plugin 내장) + `react-native-nitro-modules`. Expo Go에서는 동작하지 않고 dev build(`npx expo run:ios`)가 필요하다.
- 테스트: `npm test` (TZ=Asia/Seoul jest). 특정 파일: `npm test -- src/lib/__tests__/heartRate.test.ts`
- 타입 검증: `npx tsc --noEmit`
- 커밋: main 직접, 한국어 제목, 프리픽스 `feat(hr):` / `test(hr):` / `docs(...)` (기존 로그 컨벤션). 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- UI 문구는 한국어. 기존 코드의 주석 스타일(왜를 설명하는 한국어 주석)을 따른다.
- 상수(스펙 확정값): `HR_BUCKET_MS = 10_000`, `HR_MIN_BPM = 30`, `HR_MAX_BPM = 250`, `HR_FETCH_TIMEOUT_MS = 5000`, `HR_BACKFILL_MAX_AGE_MS = 7일`, `HR_BACKFILL_LIMIT_PER_FOCUS = 5`, 차트 y 최소 폭 `40` bpm, 차트 색 `#ef4444`.
- 세 DB 컬럼은 함께 기록되거나 함께 `null`. 앱 코드에서는 `heartRate: HeartRateSummary | null` 하나로 다룬다.
- 저장(`onStop`)을 막거나 지연시키지 않는다 — 심박 조회는 기존 `Promise.all`에 병렬로 들어간다.
- 마이그레이션은 파일만 작성하고 **원격 적용은 사용자 확인 후** 한다(원격 프로젝트 `hytckdlqvfmrqpocgzin`). `database.types.ts`는 원격 적용 후 `npm run gen:types`로 재생성하되, 적용 전에는 수동으로 컬럼을 추가해 타입을 맞춘다.

---

### Task 1: 타입·마이그레이션·DB 매핑

**Files:**
- Create: `supabase/migrations/20260910000000_runs_heart_rate.sql`
- Modify: `src/types/run.ts`
- Modify: `src/types/database.types.ts` (runs Row/Insert/Update, runs_with_geojson Row — 수동 추가)
- Modify: `src/services/runs.ts`
- Modify: `src/lib/__tests__/history.test.ts:5-15`, `src/lib/__tests__/records.test.ts` (픽스처 `heartRate: null` 추가)
- Test: `src/services/__tests__/runs.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `type HeartRateSample = [elapsedSec: number, bpm: number]`
  - `interface HeartRateSummary { samples: HeartRateSample[]; avgHr: number; maxHr: number }`
  - `RunRecord.heartRate: HeartRateSummary | null`, `FinishedRun.heartRate: HeartRateSummary | null`
  - `parseHeartRateSamples(json: unknown): HeartRateSample[] | null` (`src/services/runs.ts`에서 export — Task 2에서 `src/lib/heartRate.ts`로 옮기지 않고 그대로 둔다. route_points 파서와 같은 자리)
  - `updateRunHeartRate(id: string, hr: HeartRateSummary): Promise<boolean>`

- [ ] **Step 1: 마이그레이션 파일 작성**

`supabase/migrations/20260910000000_runs_heart_rate.sql`:

```sql
-- 러닝 구간 심박. null = 미조회·데이터 없음·구버전 기록. 기록 탭·상세에서 lazy 백필된다.
-- heart_rate_samples: [[started_at 기준 벽시계 경과초, bpm], ...] — 10초 버킷 평균, 시간 오름차순.
-- avg_hr·max_hr는 버킷 평균이 아닌 원본 샘플 기준 정수.
alter table public.runs add column heart_rate_samples jsonb;
alter table public.runs add column avg_hr smallint
  check (avg_hr between 30 and 250);
alter table public.runs add column max_hr smallint
  check (max_hr between 30 and 250);
-- 세 컬럼은 함께 기록되거나 함께 null (원자적 기록)
alter table public.runs add constraint runs_heart_rate_atomic
  check ((heart_rate_samples is null) = (avg_hr is null)
     and (avg_hr is null) = (max_hr is null));

-- create or replace는 컬럼 순서 제약이 있어 drop 후 재생성 (의존 객체 없음)
drop view public.runs_with_geojson;
create view public.runs_with_geojson
  with (security_invoker = on) as
select
  id,
  user_id,
  started_at,
  duration_sec,
  distance_m,
  extensions.st_asgeojson(route) as route_geojson,
  route_points,
  steps,
  weather_code,
  temperature_c,
  location_label,
  heart_rate_samples,
  avg_hr,
  max_hr,
  created_at
from public.runs;
```

- [ ] **Step 2: 타입 추가**

`src/types/run.ts`의 `RunRecord` 위에 추가하고, `RunRecord`에 필드를 붙인다:

```ts
// [러닝 시작 기준 벽시계 경과초, bpm]. 일시정지 구간 샘플은 제외되지만 경과초는 압축하지 않는다.
export type HeartRateSample = [elapsedSec: number, bpm: number];

export interface HeartRateSummary {
  samples: HeartRateSample[]; // 길이 ≥ 1, 시간 오름차순, 10초 버킷 평균
  avgHr: number; // 정수 bpm — 원본 샘플 평균(버킷 평균이 아님)
  maxHr: number; // 정수 bpm — 원본 샘플 최대
}
```

`RunRecord` 마지막 필드 뒤에:

```ts
  heartRate: HeartRateSummary | null; // 건강 앱(HealthKit) 러닝 구간 심박. null = 미조회·데이터 없음·구버전 기록
```

`src/types/database.types.ts`: `runs`의 `Row`에 `avg_hr: number | null`, `heart_rate_samples: Json | null`, `max_hr: number | null`을 알파벳 순 위치에 추가하고, `Insert`·`Update`에는 같은 이름을 `?:` 옵셔널로 추가한다. `runs_with_geojson`의 `Row`에도 세 컬럼을 `| null`로 추가한다(뷰 타입은 전부 nullable). 파일 상단 주석이 자동 생성 경고라면 그대로 두고, Task 9에서 `gen:types`로 덮어쓴다.

- [ ] **Step 3: 실패하는 테스트 작성 (rowToRunRecord·parseHeartRateSamples·updateRunHeartRate)**

`src/services/__tests__/runs.test.ts` 상단 import를 다음으로 바꾸고, `rowToRunRecord` describe의 `baseRow`에 세 컬럼을 추가한 뒤 케이스를 붙인다:

```ts
import {
  parseHeartRateSamples,
  parseRoutePoints,
  pointsToEwkt,
  rowToRunRecord,
  segmentsToJson,
} from '../runs';
```

`baseRow`에 추가:

```ts
    heart_rate_samples: null,
    avg_hr: null as number | null,
    max_hr: null as number | null,
```

`rowToRunRecord` describe 끝에 추가:

```ts
  it('heart_rate_samples·avg_hr·max_hr를 heartRate로 매핑한다', () => {
    const rec = rowToRunRecord({
      ...baseRow,
      heart_rate_samples: [[0, 120], [10, 131]],
      avg_hr: 126,
      max_hr: 133,
    });
    expect(rec?.heartRate).toEqual({
      samples: [[0, 120], [10, 131]],
      avgHr: 126,
      maxHr: 133,
    });
  });

  it('심박 컬럼이 전부 null이면 heartRate는 null (구버전·미조회 기록)', () => {
    const rec = rowToRunRecord(baseRow);
    expect(rec).not.toBeNull();
    expect(rec?.heartRate).toBeNull();
  });

  it('심박 컬럼 중 하나라도 null이거나 samples 형식이 어긋나면 heartRate는 null (레코드는 유지)', () => {
    expect(
      rowToRunRecord({ ...baseRow, heart_rate_samples: [[0, 120]], avg_hr: 120, max_hr: null })
        ?.heartRate
    ).toBeNull();
    const broken = rowToRunRecord({ ...baseRow, heart_rate_samples: 'x', avg_hr: 120, max_hr: 120 });
    expect(broken).not.toBeNull();
    expect(broken?.heartRate).toBeNull();
  });
```

새 describe 추가:

```ts
describe('parseHeartRateSamples', () => {
  it('[경과초, bpm] 튜플 배열을 그대로 돌려준다', () => {
    expect(parseHeartRateSamples([[0, 120], [10, 131.5]])).toEqual([[0, 120], [10, 131.5]]);
  });

  it('형식이 어긋나면 null', () => {
    expect(parseHeartRateSamples(null)).toBeNull();
    expect(parseHeartRateSamples('x')).toBeNull();
    expect(parseHeartRateSamples([])).toBeNull(); // 빈 배열
    expect(parseHeartRateSamples([[0]])).toBeNull(); // 튜플 길이 2 아님
    expect(parseHeartRateSamples([['a', 120]])).toBeNull(); // 경과초가 숫자 아님
    expect(parseHeartRateSamples([[0, NaN]])).toBeNull(); // 유한수 아님
    expect(parseHeartRateSamples([[-1, 120]])).toBeNull(); // 음수 경과초
  });
});
```

`updateRunHeartRate`는 supabase 모킹이 필요하므로 별도 파일 `src/services/__tests__/runs.heartRate.test.ts`를 새로 만든다(`runs.delete.test.ts`와 같은 패턴):

```ts
import { updateRunHeartRate } from '../runs';

// 케이스별로 supabase client를 교체하기 위한 가변 홀더 (getter로 매 접근마다 재평가)
const mockHolder: { client: unknown } = { client: null };

jest.mock('../supabase', () => ({
  get supabase() {
    return mockHolder.client;
  },
}));

function clientWithUpdateResult(error: { message: string } | null) {
  const eq = jest.fn().mockResolvedValue({ error });
  const update = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue({ update });
  return { client: { from }, from, update, eq };
}

const HR = { samples: [[0, 120], [10, 131]] as [number, number][], avgHr: 126, maxHr: 133 };

describe('updateRunHeartRate', () => {
  afterEach(() => {
    mockHolder.client = null;
  });

  it('세 컬럼을 함께 update하고 성공 시 true', async () => {
    const { client, from, update, eq } = clientWithUpdateResult(null);
    mockHolder.client = client;
    await expect(updateRunHeartRate('run-1', HR)).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith('runs');
    expect(update).toHaveBeenCalledWith({
      heart_rate_samples: HR.samples,
      avg_hr: 126,
      max_hr: 133,
    });
    expect(eq).toHaveBeenCalledWith('id', 'run-1');
  });

  it('DB 오류면 false', async () => {
    mockHolder.client = clientWithUpdateResult({ message: 'boom' }).client;
    await expect(updateRunHeartRate('run-1', HR)).resolves.toBe(false);
  });

  it('supabase 미설정이면 false', async () => {
    await expect(updateRunHeartRate('run-1', HR)).resolves.toBe(false);
  });
});
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `npm test -- src/services/__tests__/runs.test.ts src/services/__tests__/runs.heartRate.test.ts`
Expected: FAIL — `parseHeartRateSamples`·`updateRunHeartRate` is not a function / `heartRate` undefined.

- [ ] **Step 5: 구현 (`src/services/runs.ts`)**

import 갱신:

```ts
import type { HeartRateSample, HeartRateSummary, RoutePoint, RunRecord } from '../types/run';
```

`FinishedRun`에 추가:

```ts
  heartRate: HeartRateSummary | null; // 건강 앱 러닝 구간 심박. null = 토글 꿈·데이터 없음·조회 실패
```

`parseRoutePoints` 아래에 추가:

```ts
/** DB jsonb → HeartRateSample[]. 형식 이상·빈 배열·비유한수·음수 경과초면 null. */
export function parseHeartRateSamples(json: unknown): HeartRateSample[] | null {
  if (!Array.isArray(json) || json.length === 0) return null;
  const out: HeartRateSample[] = [];
  for (const t of json) {
    if (!Array.isArray(t) || t.length !== 2) return null;
    const [sec, bpm] = t;
    if (
      typeof sec !== 'number' ||
      typeof bpm !== 'number' ||
      !Number.isFinite(sec) ||
      !Number.isFinite(bpm) ||
      sec < 0
    ) {
      return null;
    }
    out.push([sec, bpm]);
  }
  return out;
}

/** 세 컬럼이 모두 있고 samples가 유효할 때만 요약을 만든다 — 하나라도 어긋나면 null. */
function rowToHeartRate(row: RunRow): HeartRateSummary | null {
  if (row.avg_hr === null || row.avg_hr === undefined) return null;
  if (row.max_hr === null || row.max_hr === undefined) return null;
  const samples = parseHeartRateSamples(row.heart_rate_samples);
  if (samples === null) return null;
  return { samples, avgHr: row.avg_hr, maxHr: row.max_hr };
}
```

`rowToRunRecord` 반환 객체에 `heartRate: rowToHeartRate(row),` 추가(`locationLabel` 뒤).

`saveRun` insert 객체에 추가:

```ts
      heart_rate_samples: run.heartRate?.samples ?? null,
      avg_hr: run.heartRate?.avgHr ?? null,
      max_hr: run.heartRate?.maxHr ?? null,
```

파일 끝에 추가:

```ts
/** lazy 백필용 — 심박 세 컬럼만 갱신. 실패 시 false (다음 기회에 재시도). */
export async function updateRunHeartRate(
  id: string,
  hr: HeartRateSummary
): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase
      .from('runs')
      .update({ heart_rate_samples: hr.samples, avg_hr: hr.avgHr, max_hr: hr.maxHr })
      .eq('id', id);
    return !error;
  } catch {
    return false;
  }
}
```

`RunRow` 타입은 `Tables<'runs_with_geojson'>`이므로 Step 2의 database.types 수정으로 세 컬럼이 존재해야 한다. `rowToHeartRate`가 `undefined`도 확인하는 이유: 뷰 타입은 nullable이지만 뷰 재생성 전 구버전 응답을 방어하기 위해서다.

테스트 픽스처 갱신 — `src/lib/__tests__/history.test.ts`와 `src/lib/__tests__/records.test.ts`의 `defaults`에 `heartRate: null,` 추가.

- [ ] **Step 6: 테스트·타입 통과 확인**

Run: `npm test -- src/services src/lib/__tests__/history.test.ts src/lib/__tests__/records.test.ts && npx tsc --noEmit`
Expected: PASS, 타입 오류 0. (`app/(tabs)/index.tsx`의 `saveRun` 호출에 `heartRate`가 빠져 타입 오류가 나면 이 태스크에서 임시로 `heartRate: null,`을 넣는다 — Task 6에서 실제 값으로 바꾼다.)

- [ ] **Step 7: 커밋**

```bash
git add supabase/migrations/20260910000000_runs_heart_rate.sql src/types/run.ts src/types/database.types.ts src/services/runs.ts src/services/__tests__/runs.test.ts src/services/__tests__/runs.heartRate.test.ts src/lib/__tests__/history.test.ts src/lib/__tests__/records.test.ts "app/(tabs)/index.tsx"
git commit -m "feat(hr): runs에 심박 컬럼 3개 추가 — 마이그레이션·타입·행 매핑·updateRunHeartRate

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: 순수 계산 — 활동 구간 필터·소스 선택·요약 (`src/lib/heartRate.ts`)

**Files:**
- Create: `src/lib/heartRate.ts`
- Test: `src/lib/__tests__/heartRate.test.ts`

**Interfaces:**
- Consumes: `HeartRateSample`, `HeartRateSummary` (Task 1), `TimeRange` (`src/lib/splits.ts`), `RoutePoint` (`src/types/run.ts`)
- Produces:
  - `interface RawHeartRateSample { timestamp: number; bpm: number; sourceId: string }`
  - `HR_BUCKET_MS`, `HR_MIN_BPM`, `HR_MAX_BPM`
  - `filterActiveSamples(samples: RawHeartRateSample[], active: TimeRange[]): RawHeartRateSample[]`
  - `pickDominantSource(samples: RawHeartRateSample[]): RawHeartRateSample[]`
  - `summarizeHeartRate(samples: RawHeartRateSample[], startedAt: number): HeartRateSummary | null`
  - `activeRangesFromRoutePoints(groups: RoutePoint[][]): TimeRange[]`
  - `summarizeRunHeartRate(raw: RawHeartRateSample[], startedAt: number, active: TimeRange[]): HeartRateSummary | null` — 위 세 단계를 순서대로 합친 편의 함수(필터 → 소스 → 요약). 서비스가 이것만 부른다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/__tests__/heartRate.test.ts`:

```ts
import {
  activeRangesFromRoutePoints,
  filterActiveSamples,
  HR_BUCKET_MS,
  pickDominantSource,
  summarizeHeartRate,
  summarizeRunHeartRate,
  type RawHeartRateSample,
} from '../heartRate';

const T0 = 1_700_000_000_000; // 러닝 시작 epoch ms

const s = (offsetMs: number, bpm: number, sourceId = 'com.xiaomi.wearable'): RawHeartRateSample => ({
  timestamp: T0 + offsetMs,
  bpm,
  sourceId,
});

describe('filterActiveSamples', () => {
  const active = [
    { start: T0, end: T0 + 60_000 },
    { start: T0 + 120_000, end: T0 + 180_000 },
  ];

  it('활동 구간 안 샘플만 남기고 경계는 포함한다', () => {
    const kept = filterActiveSamples(
      [s(0, 120), s(60_000, 125), s(90_000, 130), s(120_000, 135), s(200_000, 140)],
      active
    );
    expect(kept.map((x) => x.bpm)).toEqual([120, 125, 135]);
  });

  it('bpm 범위(30~250) 밖 샘플은 제거한다', () => {
    const kept = filterActiveSamples([s(0, 29), s(1000, 30), s(2000, 250), s(3000, 251)], active);
    expect(kept.map((x) => x.bpm)).toEqual([30, 250]);
  });

  it('활동 구간이 없으면 빈 배열', () => {
    expect(filterActiveSamples([s(0, 120)], [])).toEqual([]);
  });
});

describe('pickDominantSource', () => {
  it('샘플 수가 가장 많은 소스만 남긴다', () => {
    const out = pickDominantSource([
      s(0, 120, 'a'),
      s(1000, 121, 'b'),
      s(2000, 122, 'b'),
      s(3000, 123, 'a'),
      s(4000, 124, 'b'),
    ]);
    expect(out.every((x) => x.sourceId === 'b')).toBe(true);
    expect(out).toHaveLength(3);
  });

  it('동수면 먼저 등장한 소스', () => {
    const out = pickDominantSource([s(0, 120, 'a'), s(1000, 121, 'b')]);
    expect(out.map((x) => x.sourceId)).toEqual(['a']);
  });

  it('빈 입력은 빈 배열', () => {
    expect(pickDominantSource([])).toEqual([]);
  });
});

describe('summarizeHeartRate', () => {
  it('10초 버킷 평균으로 [경과초, bpm]을 만들고 avg·max는 원본 기준이다', () => {
    const out = summarizeHeartRate(
      [s(0, 120), s(4000, 130), s(HR_BUCKET_MS, 150), s(HR_BUCKET_MS + 9000, 160), s(35_000, 100)],
      T0
    );
    expect(out).toEqual({
      samples: [
        [0, 125], // (120+130)/2
        [10, 155], // (150+160)/2
        [30, 100],
      ],
      avgHr: 132, // (120+130+150+160+100)/5 = 132
      maxHr: 160,
    });
  });

  it('버킷 평균과 avg·max는 반올림 정수', () => {
    const out = summarizeHeartRate([s(0, 120), s(1000, 121), s(2000, 121)], T0);
    expect(out?.samples).toEqual([[0, 121]]); // 120.67 → 121
    expect(out?.avgHr).toBe(121);
    expect(out?.maxHr).toBe(121);
  });

  it('startedAt 이전 샘플은 음수 경과초가 되지 않도록 제거한다', () => {
    const out = summarizeHeartRate([s(-5000, 100), s(0, 120)], T0);
    expect(out?.samples).toEqual([[0, 120]]);
    expect(out?.avgHr).toBe(120);
  });

  it('입력 순서가 뒤섞여도 결과는 시간 오름차순', () => {
    const out = summarizeHeartRate([s(20_000, 140), s(0, 120)], T0);
    expect(out?.samples).toEqual([[0, 120], [20, 140]]);
  });

  it('입력이 비면 null', () => {
    expect(summarizeHeartRate([], T0)).toBeNull();
  });
});

describe('activeRangesFromRoutePoints', () => {
  const pt = (t: number) => ({ latitude: 0, longitude: 0, altitude: null, timestamp: t });

  it('각 그룹의 첫·마지막 timestamp를 구간으로 만든다', () => {
    expect(
      activeRangesFromRoutePoints([[pt(1000), pt(5000), pt(9000)], [pt(20_000), pt(25_000)]])
    ).toEqual([
      { start: 1000, end: 9000 },
      { start: 20_000, end: 25_000 },
    ]);
  });

  it('포인트 1개짜리 그룹은 start=end, 빈 그룹은 건너뛴다', () => {
    expect(activeRangesFromRoutePoints([[pt(1000)], [], [pt(3000)]])).toEqual([
      { start: 1000, end: 1000 },
      { start: 3000, end: 3000 },
    ]);
  });
});

describe('summarizeRunHeartRate', () => {
  it('필터 → 소스 선택 → 요약을 차례로 적용한다', () => {
    const active = [{ start: T0, end: T0 + 60_000 }];
    const out = summarizeRunHeartRate(
      [
        s(0, 120, 'band'),
        s(5000, 130, 'band'),
        s(7000, 999, 'band'), // 범위 밖
        s(8000, 90, 'watch'), // 소수 소스
        s(70_000, 170, 'band'), // 활동 구간 밖
      ],
      T0,
      active
    );
    expect(out).toEqual({ samples: [[0, 125]], avgHr: 125, maxHr: 130 });
  });

  it('필터 후 남는 샘플이 없으면 null', () => {
    expect(summarizeRunHeartRate([s(0, 300)], T0, [{ start: T0, end: T0 + 1000 }])).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- src/lib/__tests__/heartRate.test.ts`
Expected: FAIL — Cannot find module '../heartRate'.

- [ ] **Step 3: 구현 (`src/lib/heartRate.ts`)**

```ts
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- src/lib/__tests__/heartRate.test.ts`
Expected: PASS (전부).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/heartRate.ts src/lib/__tests__/heartRate.test.ts
git commit -m "feat(hr): 심박 순수 계산 — 활동 구간 필터·지배 소스 선택·10초 버킷 요약

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 표시 유틸 — `formatHeartRate`·`heartRateYDomain`

**Files:**
- Modify: `src/lib/heartRate.ts` (끝에 추가)
- Test: `src/lib/__tests__/heartRate.test.ts` (describe 추가)

**Interfaces:**
- Consumes: `HeartRateSample` (Task 1)
- Produces:
  - `formatHeartRate(avgHr: number, maxHr?: number): string` — `"♥ 152"` / `"♥ 152 · 최대 171"`
  - `HR_CHART_MIN_SPAN_BPM = 40`
  - `heartRateYDomain(samples: HeartRateSample[], minSpan?: number): [number, number]`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/__tests__/heartRate.test.ts` import에 `formatHeartRate, heartRateYDomain, HR_CHART_MIN_SPAN_BPM` 추가 후, 파일 끝에:

```ts
describe('formatHeartRate', () => {
  it('평균만: "♥ 152"', () => {
    expect(formatHeartRate(152)).toBe('♥ 152');
  });
  it('최대 포함: "♥ 152 · 최대 171"', () => {
    expect(formatHeartRate(152, 171)).toBe('♥ 152 · 최대 171');
  });
});

describe('heartRateYDomain', () => {
  it('[min-10, max+10]을 기본으로 한다', () => {
    expect(heartRateYDomain([[0, 120], [10, 180]])).toEqual([110, 190]);
  });

  it('폭이 최소 폭(40) 미만이면 중앙 기준으로 확장한다', () => {
    // 140~150 → 패딩 후 130~160(폭 30) → 중앙 145 ± 20
    expect(heartRateYDomain([[0, 140], [10, 150]])).toEqual([125, 165]);
    expect(HR_CHART_MIN_SPAN_BPM).toBe(40);
  });

  it('빈 배열은 [0, minSpan]', () => {
    expect(heartRateYDomain([])).toEqual([0, 40]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- src/lib/__tests__/heartRate.test.ts`
Expected: FAIL — `formatHeartRate is not a function`.

- [ ] **Step 3: 구현**

`src/lib/heartRate.ts` 끝에 추가:

```ts
/** 히스토리·상세 표시용. maxHr 생략 시 "♥ 152", 지정 시 "♥ 152 · 최대 171". */
export function formatHeartRate(avgHr: number, maxHr?: number): string {
  return maxHr === undefined ? `♥ ${avgHr}` : `♥ ${avgHr} · 최대 ${maxHr}`;
}

// y축 최소 표시 폭 — 평탄한 심박(예: 조깅 140~150)이 차트를 가득 채워 요동치듯 보이는 것을 막는다
export const HR_CHART_MIN_SPAN_BPM = 40;
const HR_CHART_PAD_BPM = 10;

/** 차트 y 도메인 — [min-10, max+10]을 최소 폭 minSpan으로 확장 (elevationYDomain과 같은 발상). */
export function heartRateYDomain(
  samples: HeartRateSample[],
  minSpan: number = HR_CHART_MIN_SPAN_BPM
): [number, number] {
  if (samples.length === 0) return [0, minSpan];
  let lo = Infinity;
  let hi = -Infinity;
  for (const [, bpm] of samples) {
    if (bpm < lo) lo = bpm;
    if (bpm > hi) hi = bpm;
  }
  lo -= HR_CHART_PAD_BPM;
  hi += HR_CHART_PAD_BPM;
  if (hi - lo < minSpan) {
    const center = (lo + hi) / 2;
    return [center - minSpan / 2, center + minSpan / 2];
  }
  return [lo, hi];
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- src/lib/__tests__/heartRate.test.ts`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/heartRate.ts src/lib/__tests__/heartRate.test.ts
git commit -m "feat(hr): 심박 표시 포맷·차트 y 도메인 유틸

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: HealthKit 서비스 (`src/services/heartRate.ts`) + 네이티브 의존성·플러그인

**Files:**
- Modify: `package.json` (의존성 추가 — `npx expo install`로)
- Modify: `app.json` (plugins)
- Create: `src/services/heartRate.ts`
- Test: `src/services/__tests__/heartRate.test.ts`

**Interfaces:**
- Consumes: `summarizeRunHeartRate`, `RawHeartRateSample` (Task 2), `HeartRateSummary` (Task 1), `TimeRange` (`src/lib/splits.ts`)
- Produces:
  - `isHeartRateSourceAvailable(): boolean`
  - `requestHeartRateAccess(): Promise<boolean>`
  - `fetchRunHeartRate(params: { startedAt: number; endedAt: number; active: TimeRange[] }): Promise<HeartRateSummary | null>`
  - `HR_FETCH_TIMEOUT_MS = 5000`

- [ ] **Step 1: 의존성 설치·플러그인 등록**

```bash
npx expo install @kingstinct/react-native-healthkit react-native-nitro-modules
```

`app.json` `plugins` 배열의 `"expo-image"` 앞에 추가:

```json
      [
        "@kingstinct/react-native-healthkit",
        {
          "NSHealthShareUsageDescription": "건강 앱에 기록된 심박수를 러닝 기록에 표시하기 위해 읽습니다.",
          "NSHealthUpdateUsageDescription": false,
          "background": false
        }
      ],
```

`NSHealthUpdateUsageDescription: false`는 플러그인이 쓰기 설명 키를 넣지 않게 하는 옵션이다(쓰기 권한을 요청하지 않으므로 필요 없다 — App Store 심사에서 미사용 권한 문구는 지적 대상). `background: false`는 백그라운드 전달 entitlement와 AppDelegate 수정을 끈다(사용하지 않음).

- [ ] **Step 2: 실패하는 테스트 작성**

`src/services/__tests__/heartRate.test.ts`:

```ts
import { fetchRunHeartRate, isHeartRateSourceAvailable, requestHeartRateAccess } from '../heartRate';

// jest.mock 팩토리는 스코프 밖 변수를 참조할 수 없지만 `mock` 접두사는 예외다.
const mockHk = {
  isHealthDataAvailable: jest.fn(() => true),
  requestAuthorization: jest.fn(async () => true),
  queryQuantitySamples: jest.fn(async () => [] as unknown[]),
};

// nitro 네이티브 모듈은 jest에서 로드할 수 없다 — 팩토리로 실제 모듈 로드를 막는다
jest.mock('@kingstinct/react-native-healthkit', () => ({
  isHealthDataAvailable: () => mockHk.isHealthDataAvailable(),
  requestAuthorization: (...args: unknown[]) => mockHk.requestAuthorization(...args),
  queryQuantitySamples: (...args: unknown[]) => mockHk.queryQuantitySamples(...args),
}));

const T0 = 1_700_000_000_000;
const hkSample = (offsetMs: number, bpm: number, bundleIdentifier = 'com.xiaomi.wearable') => ({
  startDate: new Date(T0 + offsetMs),
  endDate: new Date(T0 + offsetMs),
  quantity: bpm,
  unit: 'count/min',
  sourceRevision: { source: { name: 'Mi Fitness', bundleIdentifier } },
});

beforeEach(() => {
  mockHk.isHealthDataAvailable.mockReset().mockReturnValue(true);
  mockHk.requestAuthorization.mockReset().mockResolvedValue(true);
  mockHk.queryQuantitySamples.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('isHeartRateSourceAvailable', () => {
  it('HealthKit이 사용 가능하면 true', () => {
    expect(isHeartRateSourceAvailable()).toBe(true);
  });
  it('HealthKit이 없으면(iPad 등) false', () => {
    mockHk.isHealthDataAvailable.mockReturnValue(false);
    expect(isHeartRateSourceAvailable()).toBe(false);
  });
  it('네이티브 호출이 throw해도 false', () => {
    mockHk.isHealthDataAvailable.mockImplementation(() => {
      throw new Error('no native');
    });
    expect(isHeartRateSourceAvailable()).toBe(false);
  });
});

describe('requestHeartRateAccess', () => {
  it('심박 읽기 권한만 요청하고 true', async () => {
    await expect(requestHeartRateAccess()).resolves.toBe(true);
    expect(mockHk.requestAuthorization).toHaveBeenCalledWith({
      toRead: ['HKQuantityTypeIdentifierHeartRate'],
    });
  });
  it('HealthKit이 없으면 요청 없이 false', async () => {
    mockHk.isHealthDataAvailable.mockReturnValue(false);
    await expect(requestHeartRateAccess()).resolves.toBe(false);
    expect(mockHk.requestAuthorization).not.toHaveBeenCalled();
  });
  it('요청이 throw하면 false', async () => {
    mockHk.requestAuthorization.mockRejectedValue(new Error('denied'));
    await expect(requestHeartRateAccess()).resolves.toBe(false);
  });
});

describe('fetchRunHeartRate', () => {
  const params = { startedAt: T0, endedAt: T0 + 60_000, active: [{ start: T0, end: T0 + 60_000 }] };

  it('구간을 count/min 단위·오름차순·무제한으로 조회해 요약한다', async () => {
    mockHk.queryQuantitySamples.mockResolvedValue([hkSample(0, 120), hkSample(5000, 130)]);
    await expect(fetchRunHeartRate(params)).resolves.toEqual({
      samples: [[0, 125]],
      avgHr: 125,
      maxHr: 130,
    });
    expect(mockHk.queryQuantitySamples).toHaveBeenCalledWith('HKQuantityTypeIdentifierHeartRate', {
      filter: { date: { startDate: new Date(T0), endDate: new Date(T0 + 60_000) } },
      unit: 'count/min',
      limit: 0,
      ascending: true,
    });
  });

  it('소스 bundleIdentifier를 sourceId로 넘겨 지배 소스만 남긴다', async () => {
    mockHk.queryQuantitySamples.mockResolvedValue([
      hkSample(0, 120, 'band'),
      hkSample(1000, 121, 'band'),
      hkSample(2000, 60, 'watch'),
    ]);
    const out = await fetchRunHeartRate(params);
    expect(out?.avgHr).toBe(121); // watch 60은 제외
  });

  it('startDate가 숫자(epoch ms)로 와도 처리한다', async () => {
    mockHk.queryQuantitySamples.mockResolvedValue([{ ...hkSample(0, 120), startDate: T0 }]);
    await expect(fetchRunHeartRate(params)).resolves.toEqual({
      samples: [[0, 120]],
      avgHr: 120,
      maxHr: 120,
    });
  });

  it('샘플이 없으면 null', async () => {
    await expect(fetchRunHeartRate(params)).resolves.toBeNull();
  });

  it('HealthKit이 없으면 조회 없이 null', async () => {
    mockHk.isHealthDataAvailable.mockReturnValue(false);
    await expect(fetchRunHeartRate(params)).resolves.toBeNull();
    expect(mockHk.queryQuantitySamples).not.toHaveBeenCalled();
  });

  it('활동 구간이 비면 조회 없이 null', async () => {
    await expect(fetchRunHeartRate({ ...params, active: [] })).resolves.toBeNull();
    expect(mockHk.queryQuantitySamples).not.toHaveBeenCalled();
  });

  it('조회가 throw하면 null', async () => {
    mockHk.queryQuantitySamples.mockRejectedValue(new Error('boom'));
    await expect(fetchRunHeartRate(params)).resolves.toBeNull();
  });

  it('5초 안에 응답이 없으면 null', async () => {
    jest.useFakeTimers();
    mockHk.queryQuantitySamples.mockReturnValue(new Promise(() => {}));
    const p = fetchRunHeartRate(params);
    jest.advanceTimersByTime(5000);
    await expect(p).resolves.toBeNull();
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm test -- src/services/__tests__/heartRate.test.ts`
Expected: FAIL — Cannot find module '../heartRate'.

- [ ] **Step 4: 구현 (`src/services/heartRate.ts`)**

```ts
import {
  isHealthDataAvailable,
  queryQuantitySamples,
  requestAuthorization,
} from '@kingstinct/react-native-healthkit';
import { Platform } from 'react-native';
import { summarizeRunHeartRate, type RawHeartRateSample } from '../lib/heartRate';
import type { TimeRange } from '../lib/splits';
import type { HeartRateSummary } from '../types/run';

const HEART_RATE_TYPE = 'HKQuantityTypeIdentifierHeartRate' as const;
export const HR_FETCH_TIMEOUT_MS = 5000;

/**
 * HealthKit 사용 가능 여부. iOS 실기기·시뮬레이터만 true — iPad 일부·Android·웹은 false.
 * 라이브러리가 비iOS에서는 스텁(false)을 주지만, 네이티브 로드 실패까지 방어하기 위해 try로 감싼다.
 */
export function isHeartRateSourceAvailable(): boolean {
  if (Platform.OS !== 'ios') return false;
  try {
    return isHealthDataAvailable();
  } catch {
    return false;
  }
}

/**
 * 심박 읽기 권한 요청. 사용자가 시트를 닫으면 resolve된다.
 * 주의: HealthKit은 읽기 권한 거부 여부를 앱에 알려주지 않는다 — true는 "시트를 띄웠고 오류 없이
 * 닫혔다"만 보장한다. 거부 시 이후 조회가 빈 결과로 돌아온다.
 */
export async function requestHeartRateAccess(): Promise<boolean> {
  if (!isHeartRateSourceAvailable()) return false;
  try {
    await requestAuthorization({ toRead: [HEART_RATE_TYPE] });
    return true;
  } catch {
    return false;
  }
}

// nitro는 Date를 돌려주지만 직렬화 경로에 따라 숫자가 올 수 있어 둘 다 받는다
function toEpochMs(d: unknown): number | null {
  if (d instanceof Date) return d.getTime();
  if (typeof d === 'number' && Number.isFinite(d)) return d;
  if (typeof d === 'string') {
    const t = Date.parse(d);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/**
 * [startedAt, endedAt] 구간 심박을 읽어 활동 구간 필터 → 소스 선택 → 10초 버킷 요약.
 * 데이터 없음·권한 없음·타임아웃·오류 모두 null. throw하지 않는다.
 */
export async function fetchRunHeartRate(params: {
  startedAt: number;
  endedAt: number;
  active: TimeRange[];
}): Promise<HeartRateSummary | null> {
  if (params.active.length === 0) return null;
  if (!isHeartRateSourceAvailable()) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // 라이브러리 쿼리는 abort를 지원하지 않아 race로 타임아웃만 건다 (geocoding.ts와 같은 방식)
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), HR_FETCH_TIMEOUT_MS);
    });
    const result = await Promise.race([
      queryQuantitySamples(HEART_RATE_TYPE, {
        filter: {
          date: { startDate: new Date(params.startedAt), endDate: new Date(params.endedAt) },
        },
        unit: 'count/min',
        limit: 0, // 0 = 전부
        ascending: true,
      }),
      timeout,
    ]);
    if (result === null) return null;
    const raw: RawHeartRateSample[] = [];
    for (const s of result) {
      const ts = toEpochMs(s.startDate);
      if (ts === null || typeof s.quantity !== 'number') continue;
      raw.push({
        timestamp: ts,
        bpm: s.quantity,
        sourceId: s.sourceRevision?.source?.bundleIdentifier ?? 'unknown',
      });
    }
    return summarizeRunHeartRate(raw, params.startedAt, params.active);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

타입 오류가 나면(`filter.date` 키 이름이나 `unit` 리터럴 타입) `node_modules/@kingstinct/react-native-healthkit/src/types/QueryOptions.ts`의 `DateFilter`/`FilterForSamples`와 `types/QuantityType.ts`의 `UnitForIdentifier<'HKQuantityTypeIdentifierHeartRate'>`를 확인해 맞춘다. 14.1.0 기준 `filter: { date: { startDate, endDate } }`, `limit: number`(필수), `ascending?: boolean`, `unit?: string`이다.

- [ ] **Step 5: 테스트·타입 통과 확인**

Run: `npm test -- src/services/__tests__/heartRate.test.ts && npx tsc --noEmit`
Expected: PASS, 타입 오류 0.

- [ ] **Step 6: 커밋**

```bash
git add package.json package-lock.json app.json src/services/heartRate.ts src/services/__tests__/heartRate.test.ts
git commit -m "feat(hr): HealthKit 심박 서비스 — 가용성·권한 요청·러닝 구간 조회(5초 타임아웃)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 설정 토글 + `HealthSection`

**Files:**
- Modify: `src/stores/settingsStore.ts`
- Create: `src/components/HealthSection.tsx`
- Modify: `app/(tabs)/settings.tsx`
- Test: `src/stores/__tests__/settingsStore.test.ts`

**Interfaces:**
- Consumes: `isHeartRateSourceAvailable`, `requestHeartRateAccess` (Task 4)
- Produces: `settingsStore.healthHeartRateOn: boolean`, `setHealthHeartRateOn(v: boolean)`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/stores/__tests__/settingsStore.test.ts` 끝에 추가:

```ts
  test('건강 앱 심박 가져오기의 기본값은 false(끔)이다', () => {
    expect(useSettingsStore.getInitialState().healthHeartRateOn).toBe(false);
  });

  test('setHealthHeartRateOn으로 켜고 끈다', () => {
    useSettingsStore.getState().setHealthHeartRateOn(true);
    expect(useSettingsStore.getState().healthHeartRateOn).toBe(true);
    useSettingsStore.getState().setHealthHeartRateOn(false);
    expect(useSettingsStore.getState().healthHeartRateOn).toBe(false);
  });

  test('healthHeartRateOn 키가 없는 구버전 저장본은 false로 복원된다', async () => {
    await AsyncStorage.setItem(
      'settings',
      JSON.stringify({ state: { unit: 'mi', theme: 'dark' }, version: 0 }),
    );
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().healthHeartRateOn).toBe(false);
    expect(useSettingsStore.getState().unit).toBe('mi');
  });
```

`beforeEach`의 `setState`에 `healthHeartRateOn: false,` 추가.

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- src/stores/__tests__/settingsStore.test.ts`
Expected: FAIL — `setHealthHeartRateOn is not a function`.

- [ ] **Step 3: 스토어 구현**

`src/stores/settingsStore.ts`의 `SettingsState`에 추가:

```ts
  healthHeartRateOn: boolean; // 건강 앱(HealthKit) 심박 가져오기. 켜진 동안만 저장 시 조회·백필
  setHealthHeartRateOn: (v: boolean) => void;
```

초기 상태·액션에 추가:

```ts
      healthHeartRateOn: false,
      setHealthHeartRateOn: (healthHeartRateOn) => set({ healthHeartRateOn }),
```

persist 옵션 위 주석에 한 줄 추가: `// healthHeartRateOn도 같은 이유로 false(끔)로 복원된다.`

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- src/stores/__tests__/settingsStore.test.ts`
Expected: PASS.

- [ ] **Step 5: `HealthSection` 컴포넌트**

`src/components/HealthSection.tsx`:

```tsx
import { useState } from 'react';
import { Switch, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { isHeartRateSourceAvailable, requestHeartRateAccess } from '@/services/heartRate';
import { useSettingsStore } from '@/stores/settingsStore';

const DENIED_HINT =
  '건강 앱 접근을 허용하지 못했습니다. 설정 > 건강 > 데이터 접근 및 기기에서 허용해 주세요.';

/** 건강 앱(HealthKit) 연동 설정. HealthKit이 없는 기기(Android·웹·일부 iPad)에서는 렌더하지 않는다. */
export function HealthSection() {
  const on = useSettingsStore((s) => s.healthHeartRateOn);
  const setOn = useSettingsStore((s) => s.setHealthHeartRateOn);
  const [hint, setHint] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  if (!isHeartRateSourceAvailable()) return null;

  const onChange = async (next: boolean) => {
    if (!next) {
      // 끄기는 즉시. 이미 저장된 심박은 지우지 않는다.
      setOn(false);
      setHint(null);
      return;
    }
    setRequesting(true);
    const ok = await requestHeartRateAccess();
    setRequesting(false);
    if (ok) {
      setOn(true);
      setHint(null);
    } else {
      // HealthKit은 읽기 거부를 알려주지 않으므로 여기 오는 건 시트를 못 띄운 오류 경로다
      setOn(false);
      setHint(DENIED_HINT);
    }
  };

  return (
    <View className="gap-3">
      <Text className="text-base font-semibold">건강 앱 연동</Text>
      <View className="flex-row items-center justify-between">
        <Text>심박 가져오기</Text>
        <Switch
          value={on}
          onValueChange={onChange}
          disabled={requesting}
          accessibilityLabel="건강 앱에서 심박 가져오기"
        />
      </View>
      <Text className="text-sm text-muted-foreground">
        미밴드·애플워치 등이 건강 앱에 기록한 심박을 러닝 기록에 붙입니다. 러닝 저장 뒤 동기화가
        끝나면 기록에 표시됩니다.
      </Text>
      {hint !== null && <Text className="text-sm text-destructive">{hint}</Text>}
    </View>
  );
}
```

`app/(tabs)/settings.tsx`: import 추가 `import { HealthSection } from '@/components/HealthSection';` 후 `<VoiceGuideSection />` 아래에 `<HealthSection />`.

- [ ] **Step 6: 타입·전체 테스트 확인**

Run: `npx tsc --noEmit && npm test`
Expected: 타입 오류 0, 전부 PASS.

- [ ] **Step 7: 커밋**

```bash
git add src/stores/settingsStore.ts src/stores/__tests__/settingsStore.test.ts src/components/HealthSection.tsx "app/(tabs)/settings.tsx"
git commit -m "feat(hr): 설정에 건강 앱 심박 가져오기 토글 — 켤 때 HealthKit 권한 요청

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 저장 시 조회 (`onStop`)

**Files:**
- Modify: `app/(tabs)/index.tsx` (import, `onStop`의 `Promise.all`·`saveRun`)

**Interfaces:**
- Consumes: `fetchRunHeartRate` (Task 4), `useSettingsStore.healthHeartRateOn` (Task 5), `FinishedRun.heartRate` (Task 1)
- Produces: 없음 (화면 통합)

- [ ] **Step 1: import 추가**

`app/(tabs)/index.tsx`의 `@/services/geocoding` import 아래:

```ts
import { fetchRunHeartRate } from '@/services/heartRate';
```

`useSettingsStore`가 이미 import돼 있는지 확인(`unit`을 읽고 있으므로 있음).

- [ ] **Step 2: `Promise.all`에 심박 조회 추가**

`onStop`의 구조분해를 `const [steps, weather, locationLabel, heartRate] = await Promise.all([` 로 바꾸고, 배열 마지막에 추가:

```ts
      // 건강 앱 심박 — 토글이 켜진 경우만. Mi Fitness 동기화 지연으로 이 시점엔 비어 있을 수 있고,
      // 그때는 null로 저장한 뒤 기록 탭·상세에서 lazy 백필된다. 5초 타임아웃, 병렬이라 저장 지연 없음.
      useSettingsStore.getState().healthHeartRateOn && s.startedAt !== null && s.segments.length > 0
        ? fetchRunHeartRate({ startedAt: s.startedAt, endedAt: stoppedAt, active: s.segments })
        : Promise.resolve<HeartRateSummary | null>(null),
```

타입 import: `import type { HeartRateSummary } from '@/types/run';` (기존 types import가 있으면 거기에 합친다).

`saveRun({...})`의 `locationLabel,` 뒤에 `heartRate,` 추가 (Task 1에서 임시로 넣은 `heartRate: null,`이 있으면 교체).

- [ ] **Step 3: 타입·테스트 확인**

Run: `npx tsc --noEmit && npm test`
Expected: 타입 오류 0, 전부 PASS.

- [ ] **Step 4: 커밋**

```bash
git add "app/(tabs)/index.tsx"
git commit -m "feat(hr): 러닝 저장 시 건강 앱 심박 1회 조회 — 걸음·날씨·라벨과 병렬

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: lazy 백필 서비스 (`src/services/heartRateBackfill.ts`)

**Files:**
- Create: `src/services/heartRateBackfill.ts`
- Test: `src/services/__tests__/heartRateBackfill.test.ts`

**Interfaces:**
- Consumes: `fetchRunHeartRate`, `isHeartRateSourceAvailable` (Task 4), `updateRunHeartRate` (Task 1), `activeRangesFromRoutePoints` (Task 2), `useSettingsStore` (Task 5), `RunRecord`·`HeartRateSummary` (Task 1)
- Produces:
  - `HR_BACKFILL_MAX_AGE_MS`, `HR_BACKFILL_LIMIT_PER_FOCUS`
  - `isHeartRateBackfillCandidate(run: RunRecord, now: number): boolean`
  - `backfillHeartRate(runs: RunRecord[], opts: { limit: number; isCancelled: () => boolean; onFilled: (id: string, hr: HeartRateSummary) => void }): Promise<void>`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/services/__tests__/heartRateBackfill.test.ts`:

```ts
import { useSettingsStore } from '../../stores/settingsStore';
import type { RunRecord } from '../../types/run';
import {
  backfillHeartRate,
  HR_BACKFILL_LIMIT_PER_FOCUS,
  HR_BACKFILL_MAX_AGE_MS,
  isHeartRateBackfillCandidate,
} from '../heartRateBackfill';

const mockFetch = jest.fn();
const mockAvailable = jest.fn(() => true);
const mockUpdate = jest.fn();

// heartRate.ts는 nitro 네이티브 모듈을 import하므로 팩토리로 실제 모듈 로드를 막는다
jest.mock('../heartRate', () => ({
  fetchRunHeartRate: (...a: unknown[]) => mockFetch(...a),
  isHeartRateSourceAvailable: () => mockAvailable(),
}));
jest.mock('../runs', () => ({
  updateRunHeartRate: (...a: unknown[]) => mockUpdate(...a),
}));

const NOW = Date.parse('2026-09-10T09:00:00+09:00');
const HR = { samples: [[0, 120]] as [number, number][], avgHr: 120, maxHr: 120 };

function run(partial: Partial<RunRecord> & Pick<RunRecord, 'id' | 'startedAt'>): RunRecord {
  return {
    durationSec: 600,
    distanceM: 2000,
    steps: null,
    routeGeojson: null,
    routePoints: null,
    weatherCode: null,
    temperatureC: null,
    locationLabel: null,
    heartRate: null,
    ...partial,
  };
}

const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

beforeEach(() => {
  mockFetch.mockReset().mockResolvedValue(HR);
  mockAvailable.mockReset().mockReturnValue(true);
  mockUpdate.mockReset().mockResolvedValue(true);
  useSettingsStore.setState({ healthHeartRateOn: true });
});

describe('isHeartRateBackfillCandidate', () => {
  it('심박이 없고 7일 이내면 true', () => {
    expect(isHeartRateBackfillCandidate(run({ id: 'a', startedAt: iso(3600_000) }), NOW)).toBe(true);
    expect(
      isHeartRateBackfillCandidate(run({ id: 'a', startedAt: iso(HR_BACKFILL_MAX_AGE_MS) }), NOW)
    ).toBe(true); // 경계 포함
  });
  it('7일을 넘기면 false', () => {
    expect(
      isHeartRateBackfillCandidate(run({ id: 'a', startedAt: iso(HR_BACKFILL_MAX_AGE_MS + 1) }), NOW)
    ).toBe(false);
  });
  it('이미 심박이 있으면 false', () => {
    expect(
      isHeartRateBackfillCandidate(run({ id: 'a', startedAt: iso(0), heartRate: HR }), NOW)
    ).toBe(false);
  });
});

describe('backfillHeartRate', () => {
  const pt = (t: number) => ({ latitude: 0, longitude: 0, altitude: null, timestamp: t });
  const started = NOW - 3600_000;
  const withPoints = run({
    id: 'r1',
    startedAt: new Date(started).toISOString(),
    routePoints: [[pt(started + 1000), pt(started + 300_000)], [pt(started + 400_000), pt(started + 590_000)]],
  });

  it('routePoints 그룹으로 활동 구간을 만들어 조회하고, 저장 성공 시 onFilled를 부른다', async () => {
    const onFilled = jest.fn();
    await backfillHeartRate([withPoints], { limit: 5, isCancelled: () => false, onFilled });
    expect(mockFetch).toHaveBeenCalledWith({
      startedAt: started,
      endedAt: started + 590_000,
      active: [
        { start: started + 1000, end: started + 300_000 },
        { start: started + 400_000, end: started + 590_000 },
      ],
    });
    expect(mockUpdate).toHaveBeenCalledWith('r1', HR);
    expect(onFilled).toHaveBeenCalledWith('r1', HR);
  });

  it('routePoints가 없으면 startedAt~startedAt+durationSec 단일 구간', async () => {
    const r = run({ id: 'r2', startedAt: new Date(started).toISOString(), durationSec: 600 });
    await backfillHeartRate([r], { limit: 5, isCancelled: () => false, onFilled: jest.fn() });
    expect(mockFetch).toHaveBeenCalledWith({
      startedAt: started,
      endedAt: started + 600_000,
      active: [{ start: started, end: started + 600_000 }],
    });
  });

  it('후보만, 최대 limit개만 처리한다', async () => {
    const runs = [
      run({ id: 'old', startedAt: iso(HR_BACKFILL_MAX_AGE_MS + 1) }),
      run({ id: 'has', startedAt: iso(1000), heartRate: HR }),
      run({ id: 'a', startedAt: iso(2000) }),
      run({ id: 'b', startedAt: iso(3000) }),
      run({ id: 'c', startedAt: iso(4000) }),
    ];
    await backfillHeartRate(runs, { limit: 2, isCancelled: () => false, onFilled: jest.fn() });
    expect(mockUpdate.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
    expect(HR_BACKFILL_LIMIT_PER_FOCUS).toBe(5);
  });

  it('조회가 null이면 저장·콜백 없이 다음으로 넘어간다', async () => {
    mockFetch.mockResolvedValueOnce(null).mockResolvedValueOnce(HR);
    const onFilled = jest.fn();
    await backfillHeartRate(
      [run({ id: 'a', startedAt: iso(1000) }), run({ id: 'b', startedAt: iso(2000) })],
      { limit: 5, isCancelled: () => false, onFilled }
    );
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(onFilled).toHaveBeenCalledWith('b', HR);
  });

  it('저장 실패면 onFilled를 부르지 않는다', async () => {
    mockUpdate.mockResolvedValue(false);
    const onFilled = jest.fn();
    await backfillHeartRate([run({ id: 'a', startedAt: iso(1000) })], {
      limit: 5,
      isCancelled: () => false,
      onFilled,
    });
    expect(onFilled).not.toHaveBeenCalled();
  });

  it('취소되면 저장 후에도 onFilled를 부르지 않고 멈춘다', async () => {
    let cancelled = false;
    mockUpdate.mockImplementation(async () => {
      cancelled = true;
      return true;
    });
    const onFilled = jest.fn();
    await backfillHeartRate(
      [run({ id: 'a', startedAt: iso(1000) }), run({ id: 'b', startedAt: iso(2000) })],
      { limit: 5, isCancelled: () => cancelled, onFilled }
    );
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(onFilled).not.toHaveBeenCalled();
  });

  it('토글이 꺼져 있으면 아무것도 하지 않는다', async () => {
    useSettingsStore.setState({ healthHeartRateOn: false });
    await backfillHeartRate([run({ id: 'a', startedAt: iso(1000) })], {
      limit: 5,
      isCancelled: () => false,
      onFilled: jest.fn(),
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('HealthKit이 없으면 아무것도 하지 않는다', async () => {
    mockAvailable.mockReturnValue(false);
    await backfillHeartRate([run({ id: 'a', startedAt: iso(1000) })], {
      limit: 5,
      isCancelled: () => false,
      onFilled: jest.fn(),
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- src/services/__tests__/heartRateBackfill.test.ts`
Expected: FAIL — Cannot find module '../heartRateBackfill'.

- [ ] **Step 3: 구현 (`src/services/heartRateBackfill.ts`)**

```ts
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
  const active = run.routePoints ? activeRangesFromRoutePoints(run.routePoints) : [];
  if (active.length > 0) {
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- src/services/__tests__/heartRateBackfill.test.ts`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/services/heartRateBackfill.ts src/services/__tests__/heartRateBackfill.test.ts
git commit -m "feat(hr): 심박 lazy 백필 서비스 — 7일 이내·심박 없는 기록을 포커스당 5건 조회

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: 화면 — 히스토리·상세 표시, 백필 연결, `HeartRateChart`

**Files:**
- Create: `src/components/HeartRateChart.tsx`, `src/components/HeartRateChart.web.tsx`
- Modify: `app/(tabs)/history.tsx` (import, 포커스 이펙트, 행 둘째 줄)
- Modify: `app/run/[id].tsx` (import, 로드 이펙트, 메타 라인, 차트)

**Interfaces:**
- Consumes: `formatHeartRate`, `heartRateYDomain` (Task 3), `backfillHeartRate`, `HR_BACKFILL_LIMIT_PER_FOCUS` (Task 7), `RunRecord.heartRate` (Task 1)
- Produces: `HeartRateChart({ samples: HeartRateSample[] })` — 샘플 2개 미만이면 `null`

- [ ] **Step 1: `HeartRateChart` (native)**

`src/components/HeartRateChart.tsx`:

```tsx
import { CartesianChart, Line } from 'victory-native';
import { heartRateYDomain } from '@/lib/heartRate';
import type { HeartRateSample } from '@/types/run';

interface Props {
  samples: HeartRateSample[];
}

/** 경과 분 × bpm 라인 차트. 샘플이 2개 미만이면 렌더하지 않는다. */
export function HeartRateChart({ samples }: Props) {
  if (samples.length < 2) return null;
  const data = samples.map(([sec, bpm]) => ({ minute: sec / 60, bpm }));
  // 평탄한 심박이 차트를 가득 채워 요동치듯 보이지 않도록 최소 표시 폭을 준다
  const [yMin, yMax] = heartRateYDomain(samples);
  return (
    <CartesianChart data={data} xKey="minute" yKeys={['bpm']} domain={{ y: [yMin, yMax] }}>
      {({ points }) => <Line points={points.bpm} color="#ef4444" strokeWidth={2} />}
    </CartesianChart>
  );
}
```

- [ ] **Step 2: `HeartRateChart` (web 폴백)**

`src/components/HeartRateChart.web.tsx`:

```tsx
import { View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { heartRateYDomain } from '@/lib/heartRate';
import type { HeartRateSample } from '@/types/run';

interface Props {
  samples: HeartRateSample[];
}

// victory-native는 Skia(CanvasKit WASM) 기반이라 웹에서 동작하지 않는다.
// 웹 번들에서는 SVG 폴리라인으로 대체한다 (ElevationChart.web.tsx와 같은 구조).
export function HeartRateChart({ samples }: Props) {
  if (samples.length < 2) return null;
  const maxSec = samples[samples.length - 1][0] || 1;
  const [yMin, yMax] = heartRateYDomain(samples);
  const range = yMax - yMin || 1;
  const points = samples
    .map(([sec, bpm]) => `${(sec / maxSec) * 100},${40 - ((bpm - yMin) / range) * 36 - 2}`)
    .join(' ');
  return (
    <View style={{ flex: 1 }}>
      <Svg width="100%" height="100%" viewBox="0 0 100 40" preserveAspectRatio="none">
        <Polyline points={points} fill="none" stroke="#ef4444" strokeWidth={0.8} />
      </Svg>
    </View>
  );
}
```

- [ ] **Step 3: 히스토리 화면**

`app/(tabs)/history.tsx`:

import 추가:

```ts
import { formatHeartRate } from '@/lib/heartRate';
import { backfillHeartRate, HR_BACKFILL_LIMIT_PER_FOCUS } from '@/services/heartRateBackfill';
```

`useFocusEffect` 콜백에서 `void backfillLocationLabels(visible, () => cancelled, setRuns);` 다음 줄에 추가:

```ts
        // 건강 앱 심박 백필 — 라벨 백필과 독립적으로 병렬 진행 (서로 다른 행을 갱신하므로 충돌 없음)
        void backfillHeartRate(visible, {
          limit: HR_BACKFILL_LIMIT_PER_FOCUS,
          isCancelled: () => cancelled,
          onFilled: (id, heartRate) =>
            setRuns((prev) => (prev ? prev.map((x) => (x.id === id ? { ...x, heartRate } : x)) : prev)),
        });
```

행 둘째 줄 `<Text className="text-muted-foreground">` 안에서 날씨 표현식 **앞에** 추가:

```tsx
              {item.heartRate !== null && ` · ${formatHeartRate(item.heartRate.avgHr)}`}
```

- [ ] **Step 4: 상세 화면**

`app/run/[id].tsx`:

import 추가:

```ts
import { HeartRateChart } from '@/components/HeartRateChart';
import { formatHeartRate } from '@/lib/heartRate';
import { backfillHeartRate } from '@/services/heartRateBackfill';
```

로드 `useEffect`를 다음으로 교체(백필 1건 연결):

```ts
  useEffect(() => {
    let cancelled = false;
    if (id) {
      getRun(id).then((r) => {
        if (cancelled) return;
        setRun(r);
        // 러닝 직후 상세로 들어온 사용자가 새로고침 없이 심박을 보도록 이 기록 1건만 백필한다
        if (r) {
          void backfillHeartRate([r], {
            limit: 1,
            isCancelled: () => cancelled,
            onFilled: (_id, heartRate) =>
              setRun((prev) => (prev ? { ...prev, heartRate } : prev)),
          });
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [id]);
```

메타 라인에서 날씨 표현식 **앞에** 추가:

```tsx
          {run.heartRate !== null &&
            ` · ${formatHeartRate(run.heartRate.avgHr, run.heartRate.maxHr)}`}
```

고도 차트 블록 바로 아래에 추가:

```tsx
      {run.heartRate !== null && run.heartRate.samples.length >= 2 && (
        <View className="h-40 px-4 pb-2">
          <HeartRateChart samples={run.heartRate.samples} />
        </View>
      )}
```

- [ ] **Step 5: 타입·전체 테스트·린트 확인**

Run: `npx tsc --noEmit && npm test && npm run lint`
Expected: 타입 오류 0, 전부 PASS, 린트 오류 0.

- [ ] **Step 6: 커밋**

```bash
git add src/components/HeartRateChart.tsx src/components/HeartRateChart.web.tsx "app/(tabs)/history.tsx" "app/run/[id].tsx"
git commit -m "feat(hr): 기록 상세에 평균·최대 심박과 심박 그래프, 히스토리에 평균 심박 — 진입 시 lazy 백필

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: 마이그레이션 적용·타입 재생성·문서

**Files:**
- Modify: `src/types/database.types.ts` (`npm run gen:types`로 재생성)
- Modify: `docs/superpowers/specs/2026-09-10-health-heart-rate-design.md` (서비스 파일 구조 문구)
- Modify: `README.md` (스택·dev build 안내 한 줄)

**Interfaces:** 없음

- [ ] **Step 1: 원격 마이그레이션 적용 (사용자 확인 필수)**

원격 프로젝트(`hytckdlqvfmrqpocgzin`)에 마이그레이션을 적용하기 전에 사용자에게 확인을 받는다. 확인 후:

```bash
npx supabase db push --linked
```

또는 Supabase MCP `apply_migration`(name: `runs_heart_rate`, query: Task 1 Step 1의 SQL). 적용 후 `list_migrations`로 확인.

- [ ] **Step 2: 타입 재생성**

```bash
npm run gen:types
git diff --stat src/types/database.types.ts
npx tsc --noEmit
```

Expected: Task 1에서 수동 추가한 컬럼과 동일한 결과(diff가 포맷 외 없음), 타입 오류 0.

- [ ] **Step 3: 스펙 문구 갱신**

`docs/superpowers/specs/2026-09-10-health-heart-rate-design.md`의 "플랫폼 분기" 불릿(`heartRate.ios.ts`/`heartRate.ts` 스텁 설명과 jest 팩토리 모킹 문단)을 다음으로 교체:

```md
- 플랫폼 분기: 라이브러리가 `healthkit.ios.ts`/`healthkit.ts`(비iOS 스텁) 분기를 내장하므로 서비스는
  단일 파일 `src/services/heartRate.ts`로 두고 `Platform.OS !== 'ios'`면 `isHeartRateSourceAvailable()`은
  `false`, `fetchRunHeartRate`는 즉시 `null`을 반환한다. jest(iOS 플랫폼)에서는 nitro 네이티브 모듈을
  로드할 수 없으므로 `@kingstinct/react-native-healthkit`을 **팩토리 모킹**해 서비스를 유닛 테스트한다
  (`services/__tests__/heartRate.test.ts`). `heartRateBackfill.test.ts`는 `@/services/heartRate`를 팩토리
  모킹한다.
```

순수 계산 섹션의 `parseHeartRateSamples` 선언을 `src/lib/heartRate.ts` 목록에서 빼고, 데이터 모델 섹션의 "`parseHeartRateSamples(json)`로 검증 파싱" 문장 뒤에 "(`parseRoutePoints`와 같은 자리인 `src/services/runs.ts`에 둔다)"를 덧붙인다.

테스트 섹션의 "서비스의 HealthKit 호출 자체(`heartRate.ios.ts`)는 유닛 테스트하지 않고 실기기로 확인한다" 줄을 다음으로 교체:

```md
- `services/heartRate.test.ts`: 라이브러리 팩토리 모킹 — 가용성 false·throw, 권한 요청 인자·실패,
  구간 조회 인자(count/min·limit 0·ascending), 소스 매핑, Date/숫자 startDate, 빈 결과·throw·5초 타임아웃 → `null`.
```

- [ ] **Step 4: README 갱신**

`README.md` "스택" 줄 끝에 ` · @kingstinct/react-native-healthkit (iOS 심박)` 추가. "시작하기" 불릿의 dev build 항목 뒤에 한 줄 추가:

```md
- **건강 앱 심박 가져오기(HealthKit)도 dev build 필요**: 설정 탭 토글은 HealthKit이 있는 iOS 기기에서만 보인다. 의존성 추가 후 `npx expo run:ios`로 네이티브 리빌드.
```

- [ ] **Step 5: 커밋**

```bash
git add src/types/database.types.ts docs/superpowers/specs/2026-09-10-health-heart-rate-design.md README.md
git commit -m "docs(hr): 마이그레이션 적용 후 타입 재생성, 스펙 서비스 구조 문구·README 갱신

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: 실기기 확인 (수동)

**Files:** 없음 (확인 결과는 메모리 `health-heart-rate-followups.md`에 기록)

- [ ] **Step 1: 네이티브 리빌드**

```bash
npx expo run:ios --device
```

프로비저닝 프로필 만료(error 65)면 README "실기기 빌드 문제 해결" 절차를 따른다. Release 빌드 후 Debug 빌드 시 프리빌트 변종 불일치 함정(README)도 주의.

- [ ] **Step 2: 확인 항목**

1. 설정 탭에 "건강 앱 연동" 섹션이 보이고, 토글을 켜면 건강 권한 시트에 **심박수** 항목만 뜬다(쓰기 항목 없음).
2. 밴드 착용 러닝 저장 → Mi Fitness 열어 동기화 → 기록 탭 재진입 시 해당 기록 둘째 줄에 `♥ NNN`이 채워진다.
3. 상세 진입 시 메타 라인에 `♥ NNN · 최대 NNN`, 고도 차트 아래에 붉은 심박 그래프. 일시정지가 있던 러닝은 그 구간이 빈 구간으로 보인다.
4. 권한 시트에서 거부 후 토글을 다시 켜도 크래시 없이 빈 상태 유지. 7일 지난 기록은 백필하지 않는다(콘솔·네트워크로 `runs` update 없음 확인).
5. 토글을 꺼도 기존 심박 표시는 남는다.
6. `npx expo start --web`에서 설정 탭에 섹션이 숨겨지고, 상세 화면이 오류 없이 뜬다(웹 폴백 차트 포함, 심박 있는 기록이 있을 때).

- [ ] **Step 3: 결과 기록**

미확인·미결 항목은 메모리 `health-heart-rate-followups.md`에 기록하고 `MEMORY.md`에 한 줄 포인터를 추가한다.
