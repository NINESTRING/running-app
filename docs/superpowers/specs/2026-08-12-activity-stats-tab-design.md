# 활동(통계) 탭 — 나이키 런 클럽 스타일 재구성 설계

- 날짜: 2026-08-12
- 상태: 승인됨
- 대상: `app/(tabs)/stats.tsx` 및 관련 집계/차트 컴포넌트

## 목표

현재 "이번 주 거리" 막대 차트 하나뿐인 통계 탭을 나이키 런 클럽 앱의 활동 화면과 유사하게 재구성한다.

- 기간 세그먼트: **주 / 월 / 년 / 전체** 4개 모두 구현
- 기간 선택: 현재 기간 라벨(예: "2026년 ▼") 탭 → 모달 피커에서 데이터가 있는 기간 선택
- 큰 거리 숫자 + 단위 라벨(킬로미터/마일)
- 요약 3종: 러닝 횟수 / 평균 페이스 / 총시간
- 막대 차트: 기간별 버킷 + **평균 점선 + 우측 축 라벨** + 하단 기간 라벨

제외: 나이키 헤더의 프로필 아바타와 `+`(수동 기록 추가) 버튼 — 이 앱에 대응 기능이 없음.

## 접근 방식

**클라이언트 집계** (승인된 선택):

- 기존처럼 `listRuns()`로 전체 러닝 기록을 받아 클라이언트에서 집계한다. 개인 러닝 기록은 수백 건 수준이라 충분하다.
- Supabase SQL 집계(group by)는 도입하지 않는다 — 현 규모에 과함.
- 차트는 이미 설치된 `victory-native`(+`@shopify/react-native-skia`)를 사용하고, Skia가 웹에서 동작하지 않으므로 기존 관례대로 `.web.tsx` 폴백을 짝으로 만든다.

## 집계 로직 — `src/lib/stats.ts` 확장

```ts
export type PeriodType = 'week' | 'month' | 'year' | 'all';

// 기간 식별자: week → 해당 주 월요일(로컬) Date, month → {year, month}, year → year, all → 단일
export interface PeriodSummary {
  distanceM: number;
  runCount: number;
  durationSec: number;
  /** 총거리/총시간 파생. 거리 10m 미만이면 null (geo.paceSecPerUnit 규칙 준수) */
  avgPaceSecPerUnit: number | null;
}

export interface Bucket {
  label: string;   // 하단 축 라벨 ("월"~"일", "1주차", "1월"~"12월", "2024" 등)
  distanceM: number;
}
```

- `periodSummary(runs, periodType, anchor, unit)` — 해당 기간에 속한 러닝의 총거리·횟수·총시간·평균 페이스.
- `periodBuckets(runs, periodType, anchor)` — 막대 데이터:
  - `week`: 요일별 7개, **월요일 시작** (기존 `weeklyDistances`와 동일 규칙, 로컬 타임존).
  - `month`: 주별 버킷. 1일이 속한 주(월요일 시작)부터 말일이 속한 주까지, 4~6개.
  - `year`: 12개 월별 버킷 (1월~12월 고정).
  - `all`: 첫 러닝 연도부터 현재 연도까지 연도별 버킷. 기록이 없으면 현재 연도 1개.
- `availablePeriods(runs, periodType, now)` — 피커에 보여줄 기간 목록: 데이터가 있는 기간 ∪ {현재 기간}, 최신순. `all`은 피커 없음.
- 기존 `weeklyDistances`는 `periodBuckets(runs, 'week', ...)`로 흡수하고 제거, 테스트 갱신.
- 모든 날짜 계산은 로컬 타임존 기준 (기존 규칙 유지, 테스트는 `TZ=Asia/Seoul` 고정).

## UI — `app/(tabs)/stats.tsx` 재작성

레이아웃 (위→아래):

1. 큰 제목 **"활동"** (탭 타이틀 "통계"는 유지, 화면 제목만 변경).
2. 기간 세그먼트: `ui/toggle-group.tsx` 재사용, 주/월/년/전체 4개, 기본 선택 "주".
3. 기간 라벨 + ▼: 탭하면 `PeriodPicker` 모달. 라벨 형식 — 주: "M월 D일 ~ M월 D일", 월: "YYYY년 M월", 년: "YYYY년", 전체: 라벨/피커 없음.
4. 큰 거리 숫자: 선택 기간 총거리, 소수 1자리 (예: `345.6`), 굵은 이탤릭 대형 타이포. 아래 작은 회색 단위 라벨 "킬로미터"/"마일" — `useSettingsStore((s) => s.unit)` 연동.
5. 요약 3열: 러닝 횟수 / 평균 페이스(`formatPace`, null이면 `-'--''`) / 시간(`formatDuration`).
6. 막대 차트: `PeriodBarChart` — 선택 기간의 버킷.

상태/데이터:

- `useFocusEffect` + `listRuns()` (기존 패턴, cancelled 플래그 유지). 실패 시 빈 배열 → 0 값 표시.
- 세그먼트 전환 시 anchor는 현재 기간으로 리셋.
- 집계는 `useMemo`로 파생.

## 컴포넌트

- `src/components/PeriodBarChart.tsx` + `PeriodBarChart.web.tsx`
  - props: `buckets: Bucket[]`, `unit` (축 라벨 단위 변환용).
  - 막대(rounded, 기존 차트 색 `#3b82f6`), **평균 점선**: 값 = 총거리 ÷ 경과 버킷 수 — 현재 기간이면 시작부터 오늘이 속한 버킷까지, 과거 기간이면 전체 버킷 수 (스크린샷 예: 345.6km ÷ 8개월 = 43.2). 점선 우측에 값 라벨 표시. 총거리 0이면 점선 숨김. 우측 축 라벨(0 / 최대 부근 눈금), 하단 버킷 라벨(12개월처럼 많으면 격월 등 간헐 표시).
  - `WeeklyBarChart.tsx`/`.web.tsx`는 이 컴포넌트로 대체 후 삭제.
- `src/components/PeriodPicker.tsx`
  - `Modal` 기반 리스트 피커. props: `options: {key, label}[]`, `selectedKey`, `onSelect`, `visible`, `onClose`.
  - 웹 폴백 불필요 (RN `Modal`은 웹에서 동작).

## 테스트

`src/lib/__tests__/stats.test.ts` 확장 (TZ=Asia/Seoul):

- `periodBuckets`: 주(요일 배치·주 경계), 월(1일이 주 중간일 때 주차 분할, 4~6주 케이스), 년(12버킷·월 배치), 전체(다년도·빈 데이터).
- `periodSummary`: 합계·평균 페이스 파생, 거리 10m 미만 → null, 빈 기간 → 0/null.
- `availablePeriods`: 데이터 있는 기간 + 현재 기간 포함, 중복 제거, 최신순.
- 차트/화면은 기존 관례상 스냅샷 테스트 없음 — 로직만 테스트.

## 에러 처리

- `listRuns` 실패: 기존 서비스가 빈 배열을 반환 → 화면은 0.0 / 0회 / `-'--''` / 빈 차트.
- 러닝 0건: 동일하게 0 표시, 차트는 빈 버킷(막대 없음, 축만).
- 페이스: 총거리 10m 미만이면 null 처리 (`paceSecPerUnit` 규칙과 일치).
