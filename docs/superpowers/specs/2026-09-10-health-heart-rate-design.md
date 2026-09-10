# 건강 앱 심박 가져오기 설계 (iOS HealthKit)

2026-09-10

## 목표

미밴드·애플워치 등이 건강 앱(HealthKit)에 기록한 심박을, 러닝 저장 후 해당 러닝 구간에서 읽어
기록에 붙인다. 기록 상세에 평균·최대 심박과 시간×bpm 그래프를, 히스토리 목록에 평균 심박을 보인다.

배경: Redmi Smart Band 2 등 표준 BLE 심박 방송이 없는 밴드는 실시간 연동이 불가능하다.
Mi Fitness가 건강 앱에 동기화한 데이터를 사후에 읽는 것이 유일한 경로이며, 이 경로는 애플워치·
갤럭시워치 등 건강 앱에 쓰는 어떤 기기에도 같은 코드로 동작한다.

## 범위

- **iOS(HealthKit)만.** Android(Health Connect)·웹은 서비스 인터페이스에서 항상 `null`을 반환하고
  설정 섹션을 숨긴다. Health Connect 연동은 별도 태스크.
- 실시간 심박 표시는 범위 밖. 러닝 중 화면은 바꾸지 않는다.
- 심박 존(zone)·칼로리 등 파생 지표는 만들지 않는다.

## 요구사항

- 기능은 설정 토글로 켠다(기본 꿈). 켤 때 HealthKit 읽기 권한을 요청한다. 켜진 동안만 조회·백필한다.
- 저장 시 1회 조회하고, 그 시점에 데이터가 없으면(동기화 지연) 이후 히스토리·상세 화면이 열릴 때
  조용히 다시 조회해 채운다(lazy 백필).
- 조회 실패·지연이 러닝 저장을 막거나 지연시키지 않는다. 실패 시 `null`.
- 채워진 심박은 DB에 저장한다 — 기기를 바꿔도 남고, 히스토리 목록에서도 쓴다.
- 과거 기록도 토글을 켠 뒤에는 백필 대상이 된다(단, 시작 시각이 최근 7일 이내인 기록만).

## 데이터 모델

### 마이그레이션 (`supabase/migrations/20260910000000_runs_heart_rate.sql`)

날씨 컬럼과 같은 패턴 — 세 컬럼은 함께 기록되거나 함께 `null`.

```sql
-- 러닝 구간 심박. null = 미조회·데이터 없음·구버전 기록. 기록 탭·상세에서 lazy 백필된다.
-- heart_rate_samples: [[startedAt 기준 경과초, bpm], ...] — 10초 버킷 평균, 시간 오름차순
alter table public.runs add column heart_rate_samples jsonb;
alter table public.runs add column avg_hr smallint check (avg_hr between 30 and 250);
alter table public.runs add column max_hr smallint check (max_hr between 30 and 250);
alter table public.runs add constraint runs_heart_rate_atomic
  check ((heart_rate_samples is null) = (avg_hr is null)
     and (avg_hr is null) = (max_hr is null));
```

이후 `runs_with_geojson` 뷰를 drop 후 재생성하며 세 컬럼을 추가한다(`security_invoker = on` 유지).
`npm run gen:types`로 `src/types/database.types.ts`를 갱신한다.

### 타입

```ts
// src/types/run.ts
export type HeartRateSample = [elapsedSec: number, bpm: number];

export interface HeartRateSummary {
  samples: HeartRateSample[]; // 길이 ≥ 1, 시간 오름차순
  avgHr: number; // 정수 bpm (원본 샘플 평균, 버킷 평균이 아님)
  maxHr: number; // 정수 bpm
}

// RunRecord·FinishedRun 공통 추가 필드
heartRate: HeartRateSummary | null; // null = 미조회·데이터 없음·구버전 기록
```

- `src/services/runs.ts` — `saveRun()` insert에 세 컬럼 매핑, `rowToRunRecord()`에서
  `parseHeartRateSamples(json)`로 검증 파싱(형식 이상이면 `heartRate: null`)
  (`parseRoutePoints`와 같은 자리인 `src/services/runs.ts`에 둔다). 세 컬럼 중 하나라도
  `null`이면 전체를 `null`로 취급한다.
- 신규 `updateRunHeartRate(id, summary): Promise<boolean>` — `updateRunLocationLabel`과 같은
  패턴, 실패 시 `false`.

`elapsedSec`는 **러닝 시작(`started_at`) 기준 벽시계 경과초**다. 일시정지 구간 샘플은 제외하지만
경과초를 압축하지는 않는다(일시정지 구간은 그래프에서 빈 구간으로 보인다).

## 순수 계산 (신규 `src/lib/heartRate.ts`)

HealthKit에 의존하지 않는 부분을 모두 여기에 두고 유닛 테스트한다.

```ts
export interface RawHeartRateSample {
  timestamp: number; // epoch ms (샘플 시작 시각)
  bpm: number;
  sourceId: string; // HealthKit source bundle id
}

export interface TimeRange { start: number; end: number } // epoch ms (splits.ts와 구조 동일)

export const HR_BUCKET_MS = 10_000;
export const HR_MIN_BPM = 30;
export const HR_MAX_BPM = 250;

/** 활동 구간 밖(일시정지) 샘플과 범위 밖 bpm을 제거한다. */
export function filterActiveSamples(samples: RawHeartRateSample[], active: TimeRange[]): RawHeartRateSample[];

/** 여러 소스가 섞여 있으면 샘플 수가 가장 많은 소스 하나만 남긴다. 동수면 먼저 등장한 소스. */
export function pickDominantSource(samples: RawHeartRateSample[]): RawHeartRateSample[];

/**
 * 10초 버킷으로 평균해 [경과초, bpm] 배열을 만들고 평균·최대를 계산한다.
 * - elapsedSec = floor((bucketStart - startedAt) / 1000), 버킷 시작 기준
 * - avgHr·maxHr는 버킷 평균이 아닌 원본 샘플 기준, 반올림 정수
 * - 입력이 비면 null
 */
export function summarizeHeartRate(samples: RawHeartRateSample[], startedAt: number): HeartRateSummary | null;

/** 저장된 기록에서 활동 구간을 복원한다 — 각 route_points 그룹의 [첫 timestamp, 마지막 timestamp]. */
export function activeRangesFromRoutePoints(groups: RoutePoint[][]): TimeRange[];

/** 히스토리·상세 표시용 — maxHr 생략 시 "♥ 152", 지정 시 "♥ 152 · 최대 171" */
export function formatHeartRate(avgHr: number, maxHr?: number): string;

/** 차트 y 도메인 — [min-10, max+10]을 최소 폭 40bpm으로 확장 (elevationYDomain과 같은 발상) */
export function heartRateYDomain(samples: HeartRateSample[]): [number, number];
```

활동 구간(`active`)의 출처는 두 가지다.

| 시점 | 활동 구간 |
| --- | --- |
| 저장 시 | `runStore.segments` (종료 전 `pause`가 호출되므로 마지막 세그먼트까지 닫혀 있음) |
| 백필 | `activeRangesFromRoutePoints(run.routePoints)`; `routePoints`가 `null`이면 `[{ start: startedAt, end: startedAt + durationSec*1000 }]` 단일 구간 |

`segments`가 비어 있으면(시작 직후 종료 등) 저장 시 조회를 생략하고 `null`을 저장한다.

## HealthKit 서비스 (신규 `src/services/heartRate.ts`)

라이브러리: `@kingstinct/react-native-healthkit` + `react-native-nitro-modules`. `app.json`
`plugins`에 다음을 추가한다.

```json
["@kingstinct/react-native-healthkit", {
  "NSHealthShareUsageDescription": "건강 앱에 기록된 심박수를 러닝 기록에 표시하기 위해 읽습니다.",
  "NSHealthUpdateUsageDescription": "사용하지 않습니다.",
  "background": false
}]
```

```ts
/** HealthKit 사용 가능 여부 (iOS 실기기·시뮬레이터만 true, iPad 일부·Android·웹은 false). */
export function isHeartRateSourceAvailable(): boolean;

/**
 * 심박 읽기 권한 요청. 사용자가 시트를 닫으면 resolve된다.
 * 주의: HealthKit은 읽기 권한 거부 여부를 앱에 알려주지 않는다 — 이 함수는 "요청 시트를 띄웠고
 * 오류 없이 닫혔다"만 보장한다. 거부 시 이후 조회가 빈 결과로 돌아온다.
 */
export async function requestHeartRateAccess(): Promise<boolean>;

/**
 * [startedAt, endedAt] 구간의 심박을 읽어 활동 구간 필터 → 소스 선택 → 요약한다.
 * 타임아웃 5초. 데이터 없음·권한 없음·타임아웃·오류 모두 null. throw하지 않는다.
 */
export async function fetchRunHeartRate(params: {
  startedAt: number;
  endedAt: number;
  active: TimeRange[];
}): Promise<HeartRateSummary | null>;
```

- 플랫폼 분기: 라이브러리가 `healthkit.ios.ts`/`healthkit.ts`(비iOS 스텁) 분기를 내장하므로 서비스는
  단일 파일 `src/services/heartRate.ts`로 두고 `Platform.OS !== 'ios'`면 `isHeartRateSourceAvailable()`은
  `false`, `fetchRunHeartRate`는 즉시 `null`을 반환한다. jest(iOS 플랫폼)에서는 nitro 네이티브 모듈을
  로드할 수 없으므로 `@kingstinct/react-native-healthkit`을 **팩토리 모킹**해 서비스를 유닛 테스트한다
  (`services/__tests__/heartRate.test.ts`). `heartRateBackfill.test.ts`는 `@/services/heartRate`를 팩토리
  모킹한다.
- 조회: `queryQuantitySamples('HKQuantityTypeIdentifierHeartRate', { filter: { startDate, endDate }, unit: 'count/min', limit: 0(무제한), ascending: true })`. 라이브러리의 정확한 옵션 이름은 구현 시 v14 문서에서 확인한다.
- 조회 결과를 `RawHeartRateSample`로 변환할 때 `sourceId`는 샘플의 `sourceRevision.source.bundleIdentifier`.

## 설정

- `settingsStore`에 `healthHeartRateOn: boolean`(기본 `false`), `setHealthHeartRateOn(v)`. 기존
  저장본은 얕은 병합으로 `false` 복원 — 버전 올림 불필요.
- 신규 `src/components/HealthSection.tsx`, 설정 탭에서 `VoiceGuideSection` 아래에 배치.
  - `isHeartRateSourceAvailable()`이 `false`면 `null` 렌더(섹션 자체를 숨김).
  - 제목 "건강 앱 연동", 스위치 라벨 "심박 가져오기", 설명 "미밴드·애플워치 등이 건강 앱에 기록한
    심박을 러닝 기록에 붙입니다. 러닝 저장 뒤 동기화가 끝나면 기록에 표시됩니다."
  - 켤 때: `requestHeartRateAccess()` → `true`면 `setHealthHeartRateOn(true)`. `false`(오류)면
    끔 상태 유지 + 안내 문구 표시 "건강 앱 접근을 허용하지 못했습니다. 설정 > 건강 > 데이터 접근 및
    기기에서 허용해 주세요."
  - 끌 때: 즉시 `false`. 이미 저장된 심박은 지우지 않는다.
  - 스위치는 RN 내장 `Switch`를 쓴다(프로젝트 `ui/toggle.tsx`는 버튼형 토글이라 켬/끔 설정에는
    부적합). 신규 UI 프리미티브 패키지는 추가하지 않는다.

## 조회 흐름

### 저장 시

`app/(tabs)/index.tsx` `onStop`의 기존 `Promise.all`에 항목 추가:

```ts
useSettingsStore.getState().healthHeartRateOn && s.segments.length > 0
  ? fetchRunHeartRate({ startedAt: s.startedAt, endedAt: stoppedAt, active: s.segments })
  : Promise.resolve(null)
```

`saveRun`에 `heartRate` 전달. 5초 타임아웃은 걸음 백필·날씨 재시도와 병렬이므로 저장을 추가로
지연시키지 않는다.

### 백필 (신규 `src/services/heartRateBackfill.ts`)

```ts
export const HR_BACKFILL_MAX_AGE_MS = 7 * 24 * 3600_000;
export const HR_BACKFILL_LIMIT_PER_FOCUS = 5;

export function isHeartRateBackfillCandidate(run: RunRecord, now: number): boolean;
// heartRate === null && now - Date.parse(startedAt) <= MAX_AGE

/** 후보 기록을 최신순 limit개까지 조회·저장하고, 성공한 건마다 onFilled를 호출한다. 실패는 무시. */
export async function backfillHeartRate(
  runs: RunRecord[],
  opts: { limit: number; isCancelled: () => boolean; onFilled: (id: string, hr: HeartRateSummary) => void }
): Promise<void>;
```

- 토글이 꺼져 있거나 `isHeartRateSourceAvailable()`이 `false`면 즉시 반환.
- 히스토리(`history.tsx`): `backfillLocationLabels` 호출 직후 같은 방식으로 호출, `onFilled`에서
  `setRuns`로 해당 행만 갱신.
- 상세(`app/run/[id].tsx`): `getRun` 완료 후 그 기록 1건(`limit: 1`)에 대해 호출, 성공 시 `setRun`.
  러닝 직후 상세로 들어간 사용자가 새로고침 없이 값을 보게 하기 위함.
- 7일 제한은 영원히 빈 쿼리를 반복하는 것을 막기 위한 것이다. 7일이 지나도 비어 있으면 그 기록은
  심박 없는 기록으로 남는다.

## 표시

### 상세 (`app/run/[id].tsx`)

- 메타 라인 끝(날씨 앞)에 `· ♥ 152 · 최대 171` 추가. `heartRate === null`이면 생략.
- 고도 차트 아래에 `HeartRateChart`(신규 `src/components/HeartRateChart.tsx` + `.web.tsx` 폴백).
  x = 경과 분(`elapsedSec / 60`), y = bpm. victory-native `CartesianChart` + `Line`, 색 `#ef4444`,
  높이 `h-40`, 고도 차트와 같은 여백. y 도메인은 `[min(samples)-10, max(samples)+10]`을 최소 폭
  40bpm으로 확장(고도 차트 `elevationYDomain`과 같은 발상, `heartRateYDomain`을 lib에 둔다).
  샘플 2개 미만이면 차트 생략(요약 텍스트만).

### 히스토리 (`app/(tabs)/history.tsx`)

둘째 줄 끝(날씨 앞)에 `· ♥ 152` 추가. `null`이면 생략.

## 에러 처리 요약

| 상황 | 동작 |
| --- | --- |
| 토글 꿈 | 조회·백필 모두 생략, `null` 저장 |
| HealthKit 없음(iPad·Android·웹) | 설정 섹션 숨김, 서비스는 `null` |
| 권한 거부 | HealthKit이 거부를 알려주지 않으므로 빈 결과 → `null`. 7일간 백필이 빈 쿼리를 반복하지만 5건/포커스로 제한 |
| 동기화 지연으로 저장 시 데이터 없음 | `null` 저장 → 히스토리·상세 진입 시 백필 |
| 여러 소스 혼재 | 샘플 수 최다 소스만 사용 |
| bpm 30~250 밖 샘플 | 제거. 전부 제거되면 `null` |
| 타임아웃(5초)·오류 | `null`. 저장은 계속 진행 |
| 일시정지 구간 샘플 | 제거. 경과초는 압축하지 않아 그래프에 빈 구간으로 보임 |
| 저장된 jsonb 형식 이상 | `heartRate: null`로 파싱, 표시 생략(백필 후보에서도 7일 이내면 다시 조회해 덮어씀) |
| 과거 기록(구버전) | 토글 켠 뒤 7일 이내 기록만 백필, 나머지는 표시 생략 |

## 테스트

- `lib/heartRate.test.ts`: 활동 구간 필터(경계 포함·일시정지 제거·bpm 범위), 소스 선택(최다·동수),
  버킷 평균·경과초 계산·avg/max가 원본 기준인지, 빈 입력 `null`, `activeRangesFromRoutePoints`,
  `heartRateYDomain` 최소 폭.
- `services/runs.test.ts`: `rowToRunRecord` 세 컬럼 매핑, 하나라도 `null`이면 전체 `null`,
  `saveRun` insert 페이로드, `updateRunHeartRate` 성공·실패, `parseHeartRateSamples` 정상·형식
  이상·빈 배열·음수 경과초.
- `services/heartRateBackfill.test.ts`: 후보 판정(7일 경계), limit·취소·`onFilled`, 토글 꿈이면 no-op
  (`fetchRunHeartRate`·`updateRunHeartRate` 모킹).
- `stores/settingsStore.test.ts`: 기본값 `false`, 토글.
- `services/heartRate.test.ts`: 라이브러리 팩토리 모킹 — 가용성 false·throw, 권한 요청 인자·실패,
  구간 조회 인자(count/min·limit 0·ascending), 소스 매핑, Date/숫자 startDate, 빈 결과·throw·5초 타임아웃 → `null`.

## 실기기 확인 (네이티브 리빌드 필요)

1. `npx expo run:ios --device` 후 설정에서 토글 켬 → 건강 권한 시트에 심박수 항목이 뜨는지.
2. 밴드 착용 러닝 저장 → Mi Fitness 열어 동기화 → 앱 기록 탭 재진입 시 ♥ 값이 채워지는지.
3. 상세 진입 시 그래프와 평균·최대가 보이는지, 일시정지 구간이 빈 구간으로 나오는지.
4. 권한 거부 후 토글 켬 → 크래시 없이 빈 상태 유지, 7일 지난 기록은 백필 안 하는지.
5. 토글 꺼도 기존 심박이 남는지.

## 이후 태스크(범위 밖)

- Android Health Connect(`react-native-health-connect` v4): `heartRate.android.ts` 추가, Play 배포 시
  건강 데이터 선언.
- 표준 BLE 심박 센서 실시간 연동(Garmin·Band 8 이상·체스트 스트랩).
