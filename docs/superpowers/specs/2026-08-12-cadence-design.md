# 케이던스(SPM) 측정 설계

날짜: 2026-08-12

## 목적

- 러닝 중 실시간 케이던스(분당 걸음 수, SPM)를 라이브 화면에 표시한다. 소스는 `expo-sensors`의 Pedometer + 최근 30초 슬라이딩 윈도우.
- 러닝 종료 시 총 걸음 수(`steps`)를 기록에 저장한다. iOS는 `getStepCountAsync`로 러닝 세그먼트별 백필해 화면 꺼짐/백그라운드 구간을 보정하고, Android는 라이브 누적값을 그대로 쓴다.
- 평균 케이던스는 저장하지 않고 표시 시점에 `steps / duration`으로 파생한다 — 페이스가 `distance_m + duration_sec`에서 파생되는 기존 컨벤션과 동일.
- 일시정지 구간의 걸음은 제외한다 — 거리(`addPoint`), 시간(`accumulatedMs`)과 동일한 규칙.
- Pedometer 미지원 기기·권한 거부 시에도 러닝은 정상 진행하고 케이던스만 `--` 표시. 이때 저장값은 `null`(0과 구분되는 "측정 안 됨").

Android Health Connect 백필, 가속도계 폴백, 실시간 케이던스 그래프는 범위 밖이다.

## 데이터 모델 & DB

- 새 마이그레이션: `alter table public.runs add column steps integer check (steps >= 0)` (nullable) + `runs_with_geojson` 뷰를 `steps` 포함해 재생성(`security_invoker = on` 유지).
- `npm run gen:types`로 `src/types/database.types.ts` 재생성.
- `src/types/run.ts`: `RunRecord`에 `steps: number | null` 추가. `rowToRunRecord`에서 `steps`는 nullable 허용 컬럼으로 취급(다른 필수 컬럼처럼 null이라고 레코드를 버리지 않는다).
- `src/services/runs.ts`: `FinishedRun`에 `steps: number | null` 추가, insert에 `steps` 포함.

## 상태 — `src/stores/runStore.ts`

추가 상태 (모두 `initial`에 포함해 `start()`/`reset()`에서 초기화):

- `steps: number | null` — 일시정지 제외 누적 걸음. `null` = 측정 안 됨. 구독 성공 시 0으로 시작.
- `lastStepReading: number` — 구독 이후 누적치(pedometer가 주는 값)의 마지막 값. 델타 계산용.
- `stepSamples: { timestamp: number; steps: number }[]` — 최근 60초 샘플. 라이브 SPM 계산용.
- `segments: { start: number; end: number }[]` — 완료된 러닝 세그먼트(epoch ms). iOS 백필용.

액션:

- `beginStepTracking()` — `steps`를 0으로 초기화(구독 성공 시 서비스가 호출).
- `addStepReading(cumulative: number, now: number)` — `lastStepReading`은 상태와 무관하게 항상 갱신. `status === 'running'`일 때만 델타 `max(0, cumulative - lastStepReading)`를 `steps`에 가산하고 샘플을 push(이후 `now - 60초` 이전 샘플 prune). paused 상태에서는 걸음·샘플 모두 버린다.
- `pause(now)` / `beginSave(now)` 확장 — 기존 시간 폴딩에 더해 `{ start: segmentStartedAt, end: now }`를 `segments`에 push, `stepSamples` 클리어(일시정지 중 SPM은 `--`).

## 신규 서비스 — `src/services/pedometer.ts`

`location.ts`와 같은 얇은 I/O 레이어. 로직은 store/lib에 둔다.

- `requestPedometerPermissions(): Promise<boolean>` — `Pedometer.requestPermissionsAsync()`. 거부·미지원·에러 시 `false`를 반환하되 호출부는 러닝 시작을 차단하지 않는다.
- `startStepCounting()` — `Pedometer.isAvailableAsync()` 확인 후 `Pedometer.watchStepCount()` 구독. 구독 성공 시 `beginStepTracking()`, 콜백마다 `addStepReading(result.steps, Date.now())`.
- `stopStepCounting()` — 구독 해제.
- `backfillSteps(segments): Promise<number | null>` — iOS 전용. 세그먼트별 `getStepCountAsync(new Date(start), new Date(end))` 합산. Android이거나 하나라도 실패하면 `null`.

## 순수 함수 — `src/lib/cadence.ts`

- `cadenceSpm(samples, now): number | null` — `now` 기준 최근 30초 윈도우 내 샘플로 (걸음 증가량 ÷ 실제 샘플 스팬 분). 샘플 2개 미만이거나 스팬 5초 미만이면 `null`.
- `avgCadenceSpm(steps: number | null, durationSec: number): number | null` — `steps`가 null이거나 `durationSec <= 0`이면 `null`.
- `formatCadence(spm: number | null): string` — `null → '--'`, 아니면 반올림 정수 문자열.

## 플로우

시작(`onStart`): 위치 권한 처리 후 `requestPedometerPermissions()` → 결과와 무관하게 러닝 시작, 허용 시 `startStepCounting()`.

종료(`onStop`): `beginSave` → `stopTracking` 뒤에

1. `stopStepCounting()`
2. 최종 `steps` 결정 — iOS: `backfillSteps(segments)` 성공 시 그 값, 실패 시 라이브 `steps` 폴백. Android: 라이브 `steps`.
3. `saveRun({ ..., steps })`. 저장 실패 시 기존처럼 `failSave()`로 상태가 보존되므로 재시도에도 steps·segments가 유지된다.

## UI

- 라이브 화면 `app/(tabs)/index.tsx`: Metric 행에 4번째 셀 `케이던스` 추가(거리·시간·페이스·케이던스 한 줄, flex 균등). 값은 기존 1초 리렌더 틱을 활용해 렌더 시 `formatCadence(cadenceSpm(stepSamples, now))`로 파생 — 별도 타이머 없음. 측정 불가·일시정지·데이터 부족 시 자연스럽게 `--`.
- 기록 상세 `app/run/[id].tsx`: `steps`가 있으면 스탯 라인에 `평균 케이던스 N spm` 추가, `null`이면 표시 생략.
- 기록 리스트(history)는 변경 없음.

## 권한 & 네이티브 설정

- `expo-sensors` 설치 (`npx expo install expo-sensors`).
- `app.json`: iOS `infoPlist`에 `NSMotionUsageDescription`(한국어 문구), Android `permissions`에 `android.permission.ACTIVITY_RECOGNITION`.
- 네이티브 모듈 추가이므로 dev build 재빌드 필요 (`npm run ios`). Expo Go에서는 검증 불가(기존 위치 추적과 동일한 제약).

## 테스트

- `src/lib/__tests__/cadence.test.ts`: 윈도우 SPM 계산, 샘플·스팬 부족 → null, 평균 계산, 포맷. 테스트명은 한국어.
- `src/stores/__tests__/runStore.test.ts` 확장: 델타 누적, paused 중 걸음 무시, 음수 델타 가드(0으로 클램프), pause/beginSave 시 세그먼트 기록·샘플 클리어, `start()`/`reset()` 초기화.
- 서비스(`pedometer.ts`)는 얇게 유지 — expo-sensors mock으로 구독/해제와 backfill 플랫폼 분기 정도만 검증.

## 구현 시 참고

- 코드를 쓰기 전에 Expo v57 문서의 Pedometer 페이지를 확인한다 (AGENTS.md 규칙). 특히 `watchStepCount`의 누적치 의미(구독 시점 기준), `getStepCountAsync`의 iOS 전용 여부.
- `watchStepCount` 콜백에는 타임스탬프가 없으므로 서비스에서 `Date.now()`를 주입한다(액션 시그니처에 `now`를 받아 테스트 가능하게).
