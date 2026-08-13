# 기록 탭 — 개인 기록 구역 분리 · 월별 그룹 · 시간대 라벨 설계

- 날짜: 2026-08-13
- 상태: 승인됨
- 대상: `app/(tabs)/history.tsx`, `src/components/PersonalRecordsSection.tsx`, 신규 `src/lib/history.ts`

## 목표

기록(history) 탭의 러닝 목록을 개선한다.

1. **구역 분리**: 개인 기록 배지 그리드를 카드(`ui/card`)로 감싸 배경·테두리 대비를 주고, 그 아래 "러닝 기록" 섹션 타이틀로 목록 시작을 명확히 한다.
2. **월별 그룹**: 목록을 `SectionList`로 바꾸고 시작 시각 기준 연·월 섹션("2026년 8월")으로 나눈다. 최신 월이 위.
3. **시간대 라벨**: 각 행 제목을 `8. 13. (목) · 새벽 러닝` 형태로 바꾼다 — 요일 추가 + 시간대 라벨. 둘째 줄(거리 · 시간 · 날씨)은 기존 그대로.

## 시간대 판별 — `src/lib/history.ts` (신규)

- `timeOfDay(startedAt: string): '새벽' | '오전' | '오후' | '밤'`
  - 기기 로컬 시각의 시(hour) 기준: 새벽 0~5시, 오전 6~11시, 오후 12~17시, 밤 18~23시.
  - 화면에서는 `${timeOfDay(...)} 러닝`으로 표시.

## 월별 그룹핑 — `src/lib/history.ts`

- `groupRunsByMonth(runs: RunRecord[]): { title: string; data: RunRecord[] }[]`
  - 입력 순서(최신순)를 보존하며 로컬 연·월이 같은 연속 구간을 하나의 섹션으로 묶는다.
  - `title`은 `toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' })` → "2026년 8월".
  - 빈 배열 → 빈 배열.

## 화면 조립 — `app/(tabs)/history.tsx`

- `FlatList` → `SectionList`. `sections={groupRunsByMonth(runs)}`를 `useMemo`로 계산.
- 섹션 헤더: 월 타이틀 텍스트, `bg-background` + `text-muted-foreground` 계열 소제목 스타일. 기본 sticky 동작 유지.
- `ListHeaderComponent`: `PersonalRecordsSection`(카드화) + "러닝 기록" 타이틀(기존 "개인 기록" 타이틀과 동일한 `text-xl font-bold` 스타일).
- 행 제목: `formatRunDay(startedAt)`(아래) + ` · ${timeOfDay(startedAt)} 러닝`.
  - `formatRunDay`: `toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short' })` → "8. 13. (목)". `src/lib/history.ts`에 두되 Intl 포맷 래퍼이므로 스냅샷 수준 테스트만.
- 행 둘째 줄·탭 이동·로딩 스켈레톤·빈 상태·Supabase 미설정 분기는 기존 그대로.

## 개인 기록 카드화 — `src/components/PersonalRecordsSection.tsx`

- 루트를 `Card`(`mx-4 mt-4`)로 교체, "개인 기록" 타이틀은 `CardTitle`(`px-6 pt-0` 조정)로 카드 안에.
- 배지 그리드는 카드 내부(`CardContent` 또는 동급 패딩)로 이동. 하단 `Separator` 제거 — 카드 경계가 구분 역할.
- props·배지 구성·탭 동작 변경 없음.

## 테스트

`src/lib/__tests__/history.test.ts` (신규, `TZ=Asia/Seoul` 전제):

- `timeOfDay`: 경계값 0시/5시(새벽), 6시/11시(오전), 12시/17시(오후), 18시/23시(밤).
- `groupRunsByMonth`: 같은 달 여러 건 → 한 섹션, 여러 달 → 순서 보존한 다중 섹션, 연도가 다른 같은 월(2025-08 vs 2026-08) → 별도 섹션, 빈 배열 → 빈 배열, 타이틀 "2026년 8월" 형식.
- UI(카드화·SectionList 조립)는 기존 관례상 단위 테스트 없음 — `tsc --noEmit`으로 검증.

## 에러 처리

- `startedAt` 파싱 실패(Invalid Date)는 기존 화면과 동일하게 별도 방어 없음 — 저장 경로가 ISO 문자열을 보장.
- 러닝 0건이면 기존 빈 상태 화면 유지(섹션·카드 미표시).
