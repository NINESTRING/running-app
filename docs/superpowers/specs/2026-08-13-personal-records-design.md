# 개인 기록(달성 기록) 섹션 — 기록 탭 설계

- 날짜: 2026-08-13
- 상태: 승인됨
- 대상: `app/(tabs)/history.tsx` 상단 섹션 + 신규 계산/배지 컴포넌트

## 목표

기록(history) 탭 목록 상단에 나이키 런 클럽의 "달성 기록 > 개인 기록"과 유사한 배지 그리드를 추가한다.

- 배지 8종 (나이키 스크린샷과 동일 구성·순서):
  1. 최장 거리 러닝 — 값: 거리 (단위 설정 반영)
  2. 최장 시간 러닝 — 값: 시간
  3. 1K 최고 기록 (1,000m) — 값: 시간
  4. 마일 최고 기록 (1,609.344m) — 값: 시간
  5. 5K 최고 기록 (5,000m) — 값: 시간
  6. 10K 최고 기록 (10,000m) — 값: 시간
  7. 하프마라톤 최고 기록 (21,097.5m) — 값: 시간
  8. 마라톤 최고 기록 (42,195m) — 값: 시간
- 각 배지 아래 캡션: 달성 날짜(`toLocaleDateString('ko-KR')`) / 이름 / 기록 값. 미달성 배지는 회색 + 이름만.
- 달성 배지 탭 → 해당 러닝 상세 화면(`/run/[id]`) 이동. 미달성 배지는 탭 불가.
- 러닝 기록이 0건이면 섹션을 표시하지 않는다 (기존 빈 상태 화면 유지).

## 계산 방식 (승인된 선택: 롤링 구간 + 폴백)

### `src/lib/records.ts` (신규)

- `bestSegmentTimeSec(routePoints: RoutePoint[][], targetM: number): number | null`
  - 세그먼트(일시정지로 분리된 배열)별로 누적 거리·시간 시계열을 만들고, **투포인터 롤링 윈도우**로 대상 거리를 만족하는 최단 시간 연속 구간을 찾는다.
  - 윈도우 경계가 포인트 사이에 떨어지면 **선형 보간**으로 시간을 정밀화한다.
  - 일시정지를 건너뛰는 구간은 인정하지 않는다 — 세그먼트 내부에서만 탐색.
  - 어떤 세그먼트도 대상 거리에 못 미치면 null.
  - 포인트 간 거리는 기존 `haversineM`(`src/lib/geo.ts`) 재사용.
- 폴백: 롤링 윈도우가 null(routePoints가 null인 구버전 기록, 또는 GPS 시계열 거리가 대상에 못 미치는 경우)일 때 `distanceM >= targetM`이면 `durationSec × (targetM / distanceM)`(러닝 전체 평균 페이스 환산)으로 추정. v1에서는 정밀 기록과 추정치를 화면에서 구분 표시하지 않는다.
- `personalRecords(runs: RunRecord[]): PersonalRecords`

```ts
export interface RecordEntry {
  runId: string;
  startedAt: string; // ISO
  value: number; // 최장 거리: m, 그 외: 초
}

export interface PersonalRecords {
  longestDistance: RecordEntry | null;
  longestDuration: RecordEntry | null;
  best1k: RecordEntry | null;
  best1mi: RecordEntry | null;
  best5k: RecordEntry | null;
  best10k: RecordEntry | null;
  bestHalf: RecordEntry | null;
  bestFull: RecordEntry | null;
}
```

- 동률이면 먼저 달성한(오래된) 기록 유지.
- 성능: 개인 데이터 규모(러닝 수백 건 × 포인트 수천 개)에서 클라이언트 계산으로 충분. 화면에서 `useMemo`로 runs 변경 시에만 재계산.

## 배지 컴포넌트

### `src/components/RecordBadge.tsx` (신규)

- react-native-svg로 쉴드(방패) 형태를 직접 그린다. react-native-svg는 웹을 지원하므로 `.web.tsx` 폴백 불필요.
- props: `{ label?: string; icon?: 'distance' | 'duration'; achieved: boolean; date?: string; name: string; value?: string; onPress?: () => void }`
  - 쉴드 중앙: 거리 기록은 텍스트 라벨(1K/1MI/5K/10K/21.1K/42.2K), 최장 거리·시간은 lucide 아이콘(MoveUpRight/Timer)을 SVG 위에 겹침.
- 달성: 어두운 쉴드 배경 + 포인트 컬러(#3b82f6) 테두리·라벨. 미달성: 회색(muted) 계열.
- 캡션은 SVG 밖 일반 Text — 날짜/이름/값 3줄(미달성은 이름만), `text-muted-foreground` 등 기존 토큰 사용.

### `src/components/PersonalRecordsSection.tsx` (신규)

- props: `{ records: PersonalRecords; unit: 'km' | 'mi'; onPressRun: (runId: string) => void }`
- "개인 기록" 섹션 제목 + 3열 그리드(flex-row flex-wrap, 셀 너비 1/3) + 하단 Separator.
- 값 포맷: 최장 거리 `formatDistance(value, unit) + unit`, 시간 기록 `formatDuration(value * 1000)`.

## 화면 조립 — `app/(tabs)/history.tsx` 수정

- `personalRecords(runs)`를 `useMemo`로 계산.
- FlatList `ListHeaderComponent`에 `PersonalRecordsSection` 배치 → 그 아래 기존 러닝 목록 유지.
- 배지 탭 → `router.push('/run/' + runId)` (기존 목록 아이템과 동일 패턴).
- 로딩(스켈레톤)·빈 상태·Supabase 미설정 분기는 기존 그대로.

## 테스트

`src/lib/__tests__/records.test.ts` (신규):

- `bestSegmentTimeSec`: 등속 단일 세그먼트(보간 포함 정확한 시간), 중간 가속 구간이 있는 케이스(빠른 구간을 정확히 선택), 다중 세그먼트(각각 독립 탐색, 세그먼트 간 연결 안 됨), 총거리 미달 → null, 포인트 2개 미만 세그먼트 무시.
- 폴백: routePoints null + distanceM ≥ target → 비례 환산값, distanceM < target → null.
- `personalRecords`: 최장 거리/시간 선택, 여러 러닝 중 최단 시간 선택, 동률 시 먼저 달성한 기록 유지, 빈 배열 → 전부 null.
- UI 컴포넌트(RecordBadge/PersonalRecordsSection)는 기존 관례상 단위 테스트 없음 — `tsc --noEmit`으로 검증.

## 에러 처리

- `listRuns` 실패(빈 배열) 또는 기록 0건: 섹션 미표시.
- 롤링 윈도우 null이고 폴백 조건(`distanceM >= targetM`)도 안 되면 해당 러닝은 그 배지의 후보가 아님 — 모든 러닝이 그러면 미달성.
- 잘못된 포인트(타임스탬프 역행)는 해당 구간 시간을 0 이상으로 클램프해 무시.
