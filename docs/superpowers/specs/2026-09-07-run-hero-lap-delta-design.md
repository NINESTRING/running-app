# 러닝 화면 랩·목표 편차 강조 + 지도 줌 아웃

## 배경
러닝 중 상단 카드에서 "랩 N · 랩타임"과 "▼ Nm 뒤쳐짐"이 각각 text-lg / text-xl 한 줄로 표시된다.
뛰면서 읽기에는 너무 작다. 지도가 좁아지더라도 이 두 정보를 키운다. 지도는 한 단계 줌 아웃한다.

## 변경

### 1. 상단 카드 히어로 행 (`app/(tabs)/index.tsx`)
- 2×2 지표 그리드는 그대로 둔다.
- 기존 랩 줄과 `GoalDeltaLine`을 제거하고, 그 자리에 `HeroRow`를 둔다.
  - `flex-row`, 각 셀 `flex-1 items-center`. 값은 `text-5xl font-bold`(지표 text-4xl보다 한 단계 큼), 라벨은 `text-base text-muted-foreground`.
  - **랩 셀**(게이트 감지 + running/paused일 때): 값 `N` + 접미 `바퀴째`(text-2xl), 라벨 `이번 랩 mm:ss`.
  - **편차 셀**(goalDelta가 null이 아닐 때): `goalDeltaDisplay(deltaM)`의 value/label. behind → 빨강, ahead → 초록, onPace → muted.
  - 둘 다 없으면 행을 렌더하지 않는다. 하나만 있으면 그 셀이 가운데에 온다.
- 구간(스플릿) 줄은 그대로 text-lg 유지.

### 2. 순수 헬퍼 (`src/lib/goal.ts`)
```ts
goalDeltaDisplay(deltaM): { status: GoalDeltaStatus; value: string; label: string }
```
- behind: `{ value: '▼ 120m', label: '뒤쳐짐' }`
- ahead: `{ value: '▲ 120m', label: '앞섬' }`
- onPace: `{ value: '유지', label: '목표 페이스' }`
- m은 `Math.round(Math.abs(deltaM))`.

### 3. 지도 줌 아웃 (`src/components/RouteMap.tsx`)
- 라이브용 delta 리터럴 0.01 세 곳(initialCoords 영역, animateTo, follow region)을 `LIVE_REGION_DELTA = 0.02` 상수로 통일한다.
- 정적 경로용 `regionForRoute`(기록 상세)는 건드리지 않는다.

## 테스트
- `goalDeltaDisplay` 3분기 + 반올림 단위 테스트를 `goal.test.ts`에 추가.
- 컴포넌트/지도는 `tsc`, `lint`, 기존 jest로 회귀 확인. 실기기 확인은 후속.

## 비범위
- 카드 높이에 맞춘 `mapPadding`(사용자 마커가 카드에 가려지는 문제)은 후속.
