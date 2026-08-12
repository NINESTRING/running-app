# 구간(스플릿) 페이스 · 고도 표시 설계

날짜: 2026-08-12
상태: 승인됨 (사용자 확인)

## 목표

나이키 런닝앱처럼 러닝 기록을 1km(또는 1mile) 구간으로 나눠 구간별 평균 페이스와
고도 변화를 보여준다. 추가로 총 상승고도와 거리×고도 그래프를 제공하고,
러닝 중에는 현재 구간 페이스를 실시간 표시한다.

## 요구사항 (사용자 확인 완료)

- 기록 상세 화면: 구간 리스트(구간 번호 | 평균 페이스 | 고도 변화) — 나이키 스타일.
- 기록 상세 화면: 총 상승고도(elevation gain) 요약 지표.
- 기록 상세 화면: 거리×고도 프로필 그래프.
- 홈(러닝 중): 현재 구간 번호와 현재 구간 실시간 페이스.
- 단위 설정(km ↔ mi) 변경 시 저장된 기록의 구간도 새 단위로 재계산되어 표시.
- 과거 기록 소급(백필)은 하지 않는다. 사용자가 과거 기록 삭제를 허용함.
  `route_points`가 없는 기록은 구간/고도 UI를 숨긴다.

## 저장 방식 (접근법 결정)

**선택: `runs.route_points` JSONB 컬럼에 원본 시계열 포인트 저장.**

- 단위 전환 재계산·고도 그래프 요구 때문에 계산 결과가 아닌 원본 시계열이 필요하다.
- LINESTRING ZM(4D PostGIS)은 `ST_AsGeoJSON`이 M(timestamp)을 버려 되읽기 파이프라인이
  복잡해지므로 탈락. 별도 `run_points` 테이블은 현재 요구 대비 과잉이므로 탈락.
- 기존 `route` geography 컬럼은 지도 표시용으로 그대로 유지한다.
- 용량: 3초/5m 간격 기준 1시간 ≈ 1,200포인트 ≈ 수십 KB. 문제 없음.

### JSONB 포맷

세그먼트(일시정지로 나뉜 러닝 구간)별로 그룹화한 압축 배열:

```
[
  [[t, lat, lng, alt], [t, lat, lng, alt], ...],   // 세그먼트 1
  [[t, lat, lng, alt], ...],                        // 세그먼트 2 (일시정지 후 재개)
]
```

- `t`: epoch ms, `alt`: 미터 (기기가 고도를 못 주면 `null`).
- 키를 반복하지 않는 튜플 배열로 용량을 줄인다.
- 저장 시 runStore의 flat `points`를 `segments`(시간 구간)로 파티셔닝해 만든다.
  포인트의 timestamp가 세그먼트 `[start, end]`에 속하면 해당 세그먼트에 배정한다.

### 마이그레이션

- `alter table public.runs add column route_points jsonb;`
- `runs_with_geojson` 뷰를 `route_points` 포함으로 재생성 (`security_invoker = on` 유지).
- `npm run gen:types`로 `database.types.ts` 재생성.

## 도메인 타입 변경

- `RoutePoint`에 `altitude: number | null` 추가.
  - `src/services/location.ts` 트래킹 태스크에서 `loc.coords.altitude ?? null`을 담는다.
  - 구현 전 Expo v57 문서에서 `LocationObjectCoords.altitude` 스펙을 확인한다
    (AGENTS.md 규칙).
- `RunRecord`에 `routePoints: RoutePoint[][] | null` 추가 (세그먼트 그룹 구조, JSONB 파싱 결과).
- `FinishedRun`은 기존 `points` 유지 + `segments: RunSegment[]` 추가 (저장 시 파티셔닝용).

## 계산 로직 — 신규 `src/lib/splits.ts` (순수 함수)

모든 함수는 세그먼트 그룹 구조 `RoutePoint[][]`를 입력으로 받는다.
runStore(라이브)와 RunRecord(저장 기록) 양쪽에서 재사용한다.

### `computeSplits(segments, splitDistanceM)`

반환: `{ splits: Split[], current: Split | null }`

```ts
interface Split {
  index: number;          // 1부터
  distanceM: number;      // 완료 구간 = splitDistanceM, 마지막/진행 중 구간은 잔여 거리
  durationSec: number;    // 일시정지 제외
  elevationDeltaM: number | null; // 구간 끝 고도 − 시작 고도 (스무딩 후), 고도 없으면 null
}
```

- 같은 세그먼트 내 연속 포인트 쌍: 거리 = 하버사인, 시간 = t2 − t1.
- 세그먼트 경계를 넘는 포인트 쌍: 거리는 합산(라이브 `distanceM` 누적 방식과 일치),
  시간은 0으로 처리(일시정지 시간 제외).
- 구간 경계(1000m / 1609.344m)가 포인트 사이에 걸치면 선형 보간으로 경계 시각·고도를 추정.
- 미완료 마지막 구간은 `current`로 반환 (상세 화면에서는 잔여 구간으로 리스트에 표시,
  홈 화면에서는 실시간 페이스 계산에 사용).

### `elevationGainM(segments): number | null`

- 고도 스무딩(아래) 후 양(+)의 고도 변화만 합산. 고도 데이터가 없으면 null.

### `elevationProfile(segments): { distanceM: number; altitudeM: number }[]`

- 그래프용 시리즈. 누적 거리 × 스무딩된 고도. 고도 없는 포인트는 제외.

### 고도 스무딩

- GPS 고도는 ±5~10m 노이즈가 있으므로 **저장은 원본 그대로, 계산·표시 시 스무딩**.
- 이동평균(윈도우 5포인트)을 적용한 뒤 구간 델타·총 상승·그래프에 사용.
- `alt === null` 포인트는 스무딩·계산에서 건너뛴다. 전체가 null이면 고도 UI를 숨긴다.

### 단위

- 구간 길이는 호출 인자: km = 1000m, mi = 1609.344m. settingsStore의 `unit`을 화면에서 전달.

## UI 변경

### 기록 상세 (`app/run/[id].tsx`)

- 요약 줄에 총 상승고도 추가 (예: `↑ 42 m`). 고도 없으면 생략.
- **구간 섹션** (나이키 스타일):
  - 헤더: `Km(또는 Mi) | 평균 페이스 | 고도`
  - 행: 구간 번호 | 페이스 텍스트 + 상대 길이 막대(가장 빠른 구간 대비 비율) | `±N m`
  - 마지막 부분 구간은 잔여 거리로 표시 (예: `0.4`).
- **고도 그래프**: 거리(x) × 고도(y) 라인 차트. victory-native + Skia 사용,
  `WeeklyBarChart` 패턴을 따라 `.web.tsx` 분기 제공.
- `routePoints`가 null인 기록(과거 기록)은 구간 섹션·고도 그래프·상승고도를 렌더링하지 않는다.

### 홈 — 러닝 중 (`app/(tabs)/index.tsx`)

- 현재 구간 번호와 현재 구간 실시간 페이스 표시 (예: `3 km 구간 5'42"`).
- runStore의 flat points + segments + `segmentStartedAt`으로 세그먼트 그룹을 구성해
  `computeSplits`를 재사용한다. 기존 라이브 지표 갱신 주기에 맞춰 갱신.

## 저장 흐름 변경 (`src/services/runs.ts`)

- `saveRun`이 `route_points` JSONB(세그먼트 그룹 압축 배열)를 함께 insert.
- `pointsToEwkt`는 2D 그대로 유지 (지도용).
- `rowToRunRecord`가 `route_points`를 파싱해 `routePoints`로 변환.
  파싱 실패(형식 불일치) 시 `routePoints: null`로 두고 나머지 필드는 정상 반환 —
  기존 지도+요약 화면은 계속 동작한다.

## 에러 처리

- 고도 전부 null(웹, 일부 기기): 구간 페이스는 표시, 고도 컬럼·그래프·상승고도는 숨김.
- `route_points` null 또는 파싱 실패: 구간/고도 UI 전체 숨김, 기존 화면 유지.
- 포인트 2개 미만 또는 첫 구간 미완료: 상세에서는 잔여 구간 1행만, 홈에서는 페이스 `-'--"` 처리.

## 테스트 (Jest, `src/lib/__tests__/splits.test.ts`)

- 구간 경계 선형 보간 (거리·시각·고도).
- 일시정지 제외: 세그먼트 경계 쌍의 시간 0 처리.
- 마지막 부분 구간(`current`) 반환.
- 고도: 스무딩, 총 상승 합산, null 고도 혼재·전부 null 처리.
- 단위: 1000m vs 1609.344m 구간 분할.
- `runs.ts`: 포인트→JSONB 직렬화, JSONB→`routePoints` 파싱, 파싱 실패 시 null.

## 구현 전 확인 사항

- Expo v57 문서(https://docs.expo.dev/versions/v57.0.0/)에서 expo-location의
  `LocationObjectCoords.altitude` 필드와 정확도 관련 옵션을 확인한다 (AGENTS.md 규칙).
