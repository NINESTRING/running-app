# 러닝 날씨·기온 기록 설계

2026-08-13

## 목표

러닝 기록에 시작 시점의 날씨 상태와 기온을 자동으로 기록하고, 러닝 상세 화면과 히스토리 목록에 표시한다.

## 요구사항

- 수집은 자동 조회만: 러닝 시작 시점의 GPS 좌표로 Open-Meteo API(무료, 키 불필요)를 호출한다. 사용자 입력·수정 기능은 없다.
- 기록 항목은 날씨 상태(WMO weather code)와 기온(°C) 두 가지만.
- 표시는 러닝 상세 화면과 히스토리 목록 두 곳.
- 기존(과거) 기록은 백필하지 않는다. 날씨가 없는 기록은 해당 표시만 생략한다.
- 날씨 조회 실패가 러닝 저장을 막거나 지연시키는 일은 없어야 한다. 실패 시 `null`로 저장한다.

## 데이터 모델

### 마이그레이션 (`supabase/migrations/`)

`steps`·`route_points` 추가 때와 동일한 패턴:

```sql
-- 러닝 시작 시점 날씨. null = 조회 실패·구버전 기록.
alter table public.runs add column weather_code smallint;
alter table public.runs add column temperature_c real;
```

이후 `runs_with_geojson` 뷰를 drop 후 재생성하며 두 컬럼을 추가한다
(`create or replace`는 컬럼 순서 제약이 있으므로 기존 패턴대로 drop 사용,
`security_invoker = on` 유지).

`weather_code`와 `temperature_c`는 항상 함께 기록되거나 함께 `null`이다
(API가 두 값을 한 응답으로 주므로 부분 기록은 만들지 않는다).

### 타입

- `src/types/run.ts` — `RunRecord`에 `weatherCode: number | null`, `temperatureC: number | null` 추가.
- `src/services/runs.ts` — `FinishedRun`에 동일 필드 추가, `saveRun()` insert와 `rowToRunRecord()` 매핑에 반영.
- `src/types/database.types.ts` — 새 컬럼 반영해 갱신.

## 날씨 서비스 (신규 `src/services/weather.ts`)

```ts
fetchCurrentWeather(lat: number, lng: number):
  Promise<{ weatherCode: number; temperatureC: number } | null>
```

- Open-Meteo: `https://api.open-meteo.com/v1/forecast?latitude=…&longitude=…&current=temperature_2m,weather_code`
- AbortController로 5초 타임아웃.
- HTTP 오류·타임아웃·네트워크 오류·응답 필드 누락/형식 이상 등 모든 실패는 `null` 반환. throw하지 않는다.

## 조회 흐름

### 시작 시 (주 경로)

`app/(tabs)/index.tsx`의 `onStart`에서 러닝 시작 처리 후 fire-and-forget으로:

1. 기존 `getMyLocation()`으로 현재 좌표 1회 조회 (권한은 이미 확보된 상태).
2. `fetchCurrentWeather()` 호출.
3. 성공 시 `runStore`의 새 액션 `setWeather(startedAt, weatherCode, temperatureC)`로 보관.

`setWeather`는 조회를 시작한 시점의 `startedAt`을 인자로 받아, store의 현재
`startedAt`과 일치할 때만 반영한다. 늦게 도착한 응답이 저장 완료 후(reset) 상태나
다음 러닝의 상태를 오염시키지 않기 위한 가드다.

### 저장 시 (폴백)

`onStop`에서 store에 날씨가 없으면(`weatherCode === null`) 마지막 GPS 포인트
좌표로 `fetchCurrentWeather()`를 1회 재시도한다(같은 5초 타임아웃). GPS 포인트가
하나도 없으면 재시도 없이 넘어간다. 그래도 실패하면 `null`로 저장한다.

### runStore 변경

- 상태 필드: `weatherCode: number | null`, `temperatureC: number | null` (initial: `null`).
- 액션: `setWeather(startedAt: number, weatherCode: number, temperatureC: number)` —
  `get().startedAt === startedAt`일 때만 set.
- `start()`가 `...initial`로 스프레드하므로 새 러닝 시작 시 자동 초기화된다.

## 표시

### WMO 코드 매핑 유틸 (신규 `src/lib/weather.ts`)

`weatherLabel(code: number): { emoji: string; label: string }`

| WMO 코드 | 표시 |
| --- | --- |
| 0 | ☀️ 맑음 |
| 1, 2 | 🌤 대체로 맑음 |
| 3 | ☁️ 흐림 |
| 45, 48 | 🌫 안개 |
| 51–57, 61–67, 80–82 | 🌧 비 |
| 71–77, 85, 86 | ❄️ 눈 |
| 95–99 | ⛈ 뇌우 |
| 그 외 | 🌡 기타 |

### 화면

- 상세(`app/run/[id].tsx`): 기존 메타 라인(거리·시간·페이스·케이던스·고도)에
  `· ☀️ 21°C` 형식으로 추가. `weatherCode` 또는 `temperatureC`가 `null`이면 생략.
- 히스토리(`app/(tabs)/history.tsx`): 각 항목 둘째 줄 끝에 `· ☀️ 21°` 추가. 동일하게 null이면 생략.
- 기온은 반올림해 정수로 표시한다.

## 에러 처리 요약

| 상황 | 동작 |
| --- | --- |
| 오프라인·API 장애·타임아웃 | 시작 시 조회 실패 → 저장 시 1회 재시도 → 실패 시 `null` 저장 |
| 좌표 없음 (웹에서 위치 거부 등) | 조회 생략, `null` 저장 |
| 늦은 응답 (러닝 종료·리셋 후 도착) | `startedAt` 가드로 무시 |
| 과거 기록 (`null`) | 화면에서 날씨 부분만 생략 |

## 테스트

- `weather.ts`: fetch 모킹 — 정상 응답 파싱, HTTP 4xx/5xx, 타임아웃(abort), 필드 누락 → `null`.
- `lib/weather.ts`: 대표 WMO 코드별 매핑, 미지정 코드 폴백.
- `runStore.setWeather`: 일치하는 `startedAt`이면 반영, 불일치·reset 후면 무시, `start()`가 초기화하는지.
- `runs.ts`: `rowToRunRecord`가 새 필드를 매핑하는지, null 처리.
