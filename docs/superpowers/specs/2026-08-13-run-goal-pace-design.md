# 러닝 목표(페이스·거리) 및 실시간 편차 표시 설계

2026-08-13

## 목표

홈 화면에서 러닝 시작 전에 목표 페이스와 목표 거리를 설정하고, 러닝 중 목표 페이스 대비
뒤쳐짐/앞섬을 미터 단위로 실시간 표시한다. 뒤쳐지면 빨간색, 앞서면 초록색.

## 요구사항

- 목표는 DB에 올리지 않는다. 폰 로컬 저장소(AsyncStorage)에만 저장한다.
- 페이스 = 편차 계산 기준, 거리 = 완주 목표(진행률 표시용). 각각 독립적으로 설정/해제 가능.
- 뒤쳐질 때 빨간색 "▼ N m 뒤쳐짐", 앞설 때 초록색 "▲ N m 앞섬"으로 표시.
- 목표 설정 UI는 idle 상태 카드의 "목표" 버튼 → 다이얼로그. 입력은 스테퍼(+/-) 방식.
- 목표가 없으면 기존 화면·동작 그대로.
- 러닝 중 목표 변경은 불가(설정 진입은 idle에서만).

## 데이터 모델 & 저장 (신규 `src/stores/goalStore.ts`)

`settingsStore`와 동일한 zustand persist + AsyncStorage 패턴. 기존 `settingsStore.ts`의
`safeStorage`(손상 JSON 방어)를 제네릭 팩토리로 `src/lib/persist.ts`에 추출해 두 스토어가
공유한다.

```ts
interface GoalState {
  paceSecPerUnit: number | null; // 목표 페이스 (초/현재단위). null = 미설정
  distanceUnits: number | null;  // 목표 거리 (현재 단위 기준 수치, 예: 5 = 5km). null = 미설정
  setPace: (v: number | null) => void;
  setDistance: (v: number | null) => void;
}
```

- AsyncStorage 키: `goal`, version 0.
- 단위(km/mi) 변경 시 숫자는 변환하지 않고 의미만 현재 단위를 따른다
  (5'30"/km → 5'30"/mi). 단위 변경은 드문 조작이므로 단순함을 우선한다.

## 편차 계산 (신규 `src/lib/goal.ts`, 순수 함수)

```ts
/** 목표 페이스 대비 편차(m). 양수 = 앞섬, 음수 = 뒤쳐짐. 표시 불가 조건이면 null */
goalDeltaM(params: {
  distanceM: number;        // 실제 누적 거리
  elapsedMs: number;        // 일시정지 제외 경과 시간 (기존 elapsedMs 사용)
  paceSecPerUnit: number;   // 목표 페이스 (초/단위)
  unit: 'km' | 'mi';
}): number | null
```

- 기대 거리 = `elapsedMs / 1000 / paceSecPerUnit × 단위미터` (단위미터: km=1000, mi=`METERS_PER_MILE`).
- 편차 = 실제 거리 − 기대 거리.
- **초반 가드**: `elapsedMs < 30_000`이면 null 반환 — GPS 워밍업 요동 방지.
- 일시정지 시간은 `elapsedMs`가 이미 제외하므로 뒤쳐짐으로 계산되지 않는다.

표시 상태 판정(같은 파일, 순수 함수):

```ts
/** 편차를 표시 상태로 변환. deadband ±10m 이내는 'onPace' */
goalDeltaStatus(deltaM: number): 'ahead' | 'behind' | 'onPace'
```

## UI (`app/(tabs)/index.tsx` + 신규 `src/components/GoalDialog.tsx`)

### idle 상태

- 카드 상단에 목표 요약 줄 + "목표" 버튼 한 줄 추가.
  - 요약 예: `5'30"/km · 5.00km`, 페이스만 있으면 `5'30"/km`, 없으면 `목표 없음`.
  - 페이스 포맷은 기존 `formatPace` 재사용.
- "목표" 버튼 탭 → `GoalDialog` 오픈(기존 AlertDialog 컴포넌트 재사용).

### GoalDialog

- 페이스 행: "사용 안 함" 토글 + 스테퍼(+/- 15초, 범위 3'00"~10'00", 기본 6'00").
- 거리 행: "사용 안 함" 토글 + 스테퍼(+/- 0.5, 범위 0.5~50, 기본 5.0). 라벨에 현재 단위 표기.
- 확인 시 goalStore에 반영. 스테퍼 경계값은 순수 함수로 클램프(`src/lib/goal.ts`에 포함).

### running / paused 상태

- 페이스 목표가 있으면 기존 구간 페이스 줄 아래에 편차 줄 추가:
  - `behind`: 빨강(`text-destructive`) `▼ 42m 뒤쳐짐`
  - `ahead`: 초록(`text-green-600 dark:text-green-500`) `▲ 18m 앞섬`
  - `onPace`: muted `목표 페이스 유지`
  - `goalDeltaM`이 null(30초 미만)이면 줄 자체를 생략.
  - 미터 수치는 반올림 정수로 표시.
- 거리 목표가 있으면 거리 지표를 `3.21 / 5.00` 형태로 표시(라벨은 기존 `거리(km)` 유지).
  목표 거리 도달 시 거리 값 텍스트를 초록으로.
- paused 상태에서도 편차 줄은 유지 표시(시간이 멈춰 있으므로 값이 고정됨).

## 에러·엣지 케이스

- 저장소 읽기 실패 → safeStorage가 null 반환 → 목표 없음으로 기본 동작.
- GPS 미수신으로 거리가 늘지 않으면 뒤쳐짐이 계속 증가 — 사실 반영이므로 별도 처리 없음.
- 페이스 목표 없이 거리 목표만 있으면 편차 줄은 없고 거리 진행 표시만 나온다.

## 테스트

- `src/lib/__tests__/goal.test.ts`:
  - `goalDeltaM`: 뒤쳐짐/앞섬 계산, 30초 가드, mi 단위, 경계(정확히 30초).
  - `goalDeltaStatus`: 데드밴드 경계(±10m).
  - 스테퍼 클램프: 최소/최대 경계.
- `src/stores/__tests__/goalStore.test.ts`: 기본값, set/해제, persist 왕복,
  손상 JSON 방어(기존 settingsStore 테스트 패턴).
- UI는 실기기 수동 확인.
