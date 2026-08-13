# 기록 탭 월별 그룹·시간대 라벨·개인기록 카드화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기록 탭의 러닝 목록을 월별 섹션으로 나누고, 각 행에 시간대(새벽/오전/오후/밤) 라벨을 붙이고, 개인 기록 배지 그리드를 카드로 분리한다.

**Architecture:** 순수 함수(`timeOfDay`, `formatRunDay`, `groupRunsByMonth`)를 신규 `src/lib/history.ts`에 두고 jest로 검증. 화면은 `app/(tabs)/history.tsx`의 FlatList를 SectionList로 교체하고, `PersonalRecordsSection`의 루트를 기존 `ui/card`로 감싼다.

**Tech Stack:** Expo(React Native) + expo-router, NativeWind 클래스, jest(`TZ=Asia/Seoul`), TypeScript.

**Spec:** `docs/superpowers/specs/2026-08-13-history-grouping-design.md`

## Global Constraints

- 테스트 실행은 항상 `npm test`(package.json이 `TZ=Asia/Seoul jest`로 실행) — 시간대 테스트가 이 TZ를 전제한다.
- 시간대 경계: 새벽 0~5시, 오전 6~11시, 오후 12~17시, 밤 18~23시 (로컬 시각 `getHours()` 기준).
- 날짜 포맷은 기존 관례대로 `toLocaleDateString('ko-KR', …)` 사용. 월 헤더 "2026년 8월", 행 날짜 "8. 13. (목)".
- `src/lib` 모듈은 상대 경로 import(`./geo`, `../types/run`), 화면·컴포넌트는 `@/` alias — 기존 파일 관례 유지.
- 커밋 메시지는 기존 이력처럼 한국어 conventional commit (`feat(history): …`).

---

### Task 1: `src/lib/history.ts` — 순수 함수 3종 + 테스트

**Files:**
- Create: `src/lib/history.ts`
- Test: `src/lib/__tests__/history.test.ts`

**Interfaces:**
- Consumes: `RunRecord` (`src/types/run.ts`)
- Produces (Task 2가 사용):
  - `timeOfDay(startedAt: string): '새벽' | '오전' | '오후' | '밤'`
  - `formatRunDay(startedAt: string): string` — "8. 13. (목)"
  - `groupRunsByMonth(runs: RunRecord[]): RunSection[]`, `RunSection = { title: string; data: RunRecord[] }`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/__tests__/history.test.ts`:

```ts
import type { RunRecord } from '../../types/run';
import { formatRunDay, groupRunsByMonth, timeOfDay } from '../history';

function run(partial: Partial<RunRecord> & Pick<RunRecord, 'id' | 'startedAt'>): RunRecord {
  return {
    durationSec: 0,
    distanceM: 0,
    steps: null,
    routeGeojson: null,
    routePoints: null,
    weatherCode: null,
    temperatureC: null,
    ...partial,
  };
}

describe('timeOfDay', () => {
  // TZ=Asia/Seoul 전제 (npm test 스크립트가 설정)
  it.each([
    ['2026-08-13T00:00:00+09:00', '새벽'],
    ['2026-08-13T05:59:00+09:00', '새벽'],
    ['2026-08-13T06:00:00+09:00', '오전'],
    ['2026-08-13T11:59:00+09:00', '오전'],
    ['2026-08-13T12:00:00+09:00', '오후'],
    ['2026-08-13T17:59:00+09:00', '오후'],
    ['2026-08-13T18:00:00+09:00', '밤'],
    ['2026-08-13T23:59:00+09:00', '밤'],
  ])('%s → %s', (iso, expected) => {
    expect(timeOfDay(iso)).toBe(expected);
  });
});

describe('formatRunDay', () => {
  it('"월. 일. (요일)" 형식', () => {
    expect(formatRunDay('2026-08-13T04:44:00+09:00')).toBe('8. 13. (목)');
  });
});

describe('groupRunsByMonth', () => {
  it('빈 배열 → 빈 배열', () => {
    expect(groupRunsByMonth([])).toEqual([]);
  });

  it('같은 달 러닝은 순서를 보존해 한 섹션으로 묶는다', () => {
    const runs = [
      run({ id: 'a', startedAt: '2026-08-13T04:44:00+09:00' }),
      run({ id: 'b', startedAt: '2026-08-12T13:00:00+09:00' }),
    ];
    const sections = groupRunsByMonth(runs);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('2026년 8월');
    expect(sections[0].data.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('다른 달은 입력 순서대로 별도 섹션', () => {
    const runs = [
      run({ id: 'a', startedAt: '2026-08-13T04:44:00+09:00' }),
      run({ id: 'b', startedAt: '2026-07-30T21:00:00+09:00' }),
    ];
    const sections = groupRunsByMonth(runs);
    expect(sections.map((s) => s.title)).toEqual(['2026년 8월', '2026년 7월']);
    expect(sections[1].data.map((r) => r.id)).toEqual(['b']);
  });

  it('연도가 다른 같은 월은 별도 섹션', () => {
    const runs = [
      run({ id: 'a', startedAt: '2026-08-13T04:44:00+09:00' }),
      run({ id: 'b', startedAt: '2025-08-13T04:44:00+09:00' }),
    ];
    const sections = groupRunsByMonth(runs);
    expect(sections.map((s) => s.title)).toEqual(['2026년 8월', '2025년 8월']);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test -- history`
Expected: FAIL — `Cannot find module '../history'`

- [ ] **Step 3: 최소 구현 작성**

`src/lib/history.ts`:

```ts
import type { RunRecord } from '../types/run';

export type TimeOfDay = '새벽' | '오전' | '오후' | '밤';

/** 로컬 시각 기준 시간대. 새벽 0~5시, 오전 6~11시, 오후 12~17시, 밤 18~23시. */
export function timeOfDay(startedAt: string): TimeOfDay {
  const h = new Date(startedAt).getHours();
  if (h < 6) return '새벽';
  if (h < 12) return '오전';
  if (h < 18) return '오후';
  return '밤';
}

/** "8. 13. (목)" 형태의 목록 행 날짜. */
export function formatRunDay(startedAt: string): string {
  return new Date(startedAt).toLocaleDateString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  });
}

export interface RunSection {
  title: string; // "2026년 8월"
  data: RunRecord[];
}

/** 입력 순서(최신순)를 보존하며 로컬 연·월이 같은 연속 구간을 섹션으로 묶는다. */
export function groupRunsByMonth(runs: RunRecord[]): RunSection[] {
  const sections: RunSection[] = [];
  let prevKey: string | null = null;
  for (const r of runs) {
    const d = new Date(r.startedAt);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (key === prevKey) {
      sections[sections.length - 1].data.push(r);
    } else {
      sections.push({
        title: d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' }),
        data: [r],
      });
      prevKey = key;
    }
  }
  return sections;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- history`
Expected: PASS (전체 케이스)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/history.ts src/lib/__tests__/history.test.ts
git commit -m "feat(history): 시간대·날짜 포맷·월별 그룹 순수 함수 추가"
```

---

### Task 2: 화면 조립 — 개인 기록 카드화 + SectionList

**Files:**
- Modify: `src/components/PersonalRecordsSection.tsx`
- Modify: `app/(tabs)/history.tsx`

**Interfaces:**
- Consumes: Task 1의 `timeOfDay`, `formatRunDay`, `groupRunsByMonth`, `RunSection`; 기존 `Card`/`CardTitle`(`@/components/ui/card`).
- Produces: 없음 (최종 화면).

- [ ] **Step 1: PersonalRecordsSection 루트를 Card로 교체**

`src/components/PersonalRecordsSection.tsx` — import에서 `Separator`·`Text`(더 이상 직접 사용 안 함) 제거, `Card`/`CardTitle` 추가:

```tsx
import { Card, CardTitle } from '@/components/ui/card';
```

return 블록을 다음으로 교체 (badges 배열·매핑 내용은 그대로):

```tsx
return (
  <Card className="mx-4 mt-4 gap-4 py-4">
    <CardTitle className="px-4 text-xl font-bold">개인 기록</CardTitle>
    <View className="flex-row flex-wrap px-1">
      {badges.map((b) => {
        const entry = b.entry;
        return (
          <View key={b.key} className="w-1/3 items-center px-1 pb-5">
            <RecordBadge
              label={b.label}
              icon={b.icon}
              achieved={entry !== null}
              date={entry ? dateStr(entry) : undefined}
              name={b.name}
              value={entry ? b.format(entry) : undefined}
              onPress={entry ? () => onPressRun(entry.runId) : undefined}
            />
          </View>
        );
      })}
    </View>
  </Card>
);
```

(기존 루트 `<View className="pb-2">`·"개인 기록" Text·하단 `<Separator />` 제거.)

- [ ] **Step 2: history.tsx를 SectionList로 교체**

`app/(tabs)/history.tsx`:

import 변경 — `FlatList` → `SectionList`, Task 1 함수 추가:

```tsx
import { Pressable, SectionList, View } from 'react-native';
import { formatRunDay, groupRunsByMonth, timeOfDay } from '@/lib/history';
```

`records` useMemo 아래에 섹션 계산 추가:

```tsx
const sections = useMemo(() => (runs ? groupRunsByMonth(runs) : []), [runs]);
```

FlatList 블록을 다음으로 교체:

```tsx
return (
  <SectionList
    className="bg-background"
    sections={sections}
    keyExtractor={(r) => r.id}
    ItemSeparatorComponent={() => <Separator />}
    ListHeaderComponent={
      <View className="pb-2">
        {records ? (
          <PersonalRecordsSection
            records={records}
            unit={unit}
            onPressRun={(runId) => router.push(`/run/${runId}`)}
          />
        ) : null}
        <Text className="px-4 pt-6 text-xl font-bold">러닝 기록</Text>
      </View>
    }
    renderSectionHeader={({ section }) => (
      <Text className="bg-background px-4 pb-1 pt-3 text-sm font-semibold text-muted-foreground">
        {section.title}
      </Text>
    )}
    renderItem={({ item }) => (
      <Pressable
        className="gap-1 p-4 active:bg-accent"
        onPress={() => router.push(`/run/${item.id}`)}
      >
        <Text className="text-base font-semibold">
          {formatRunDay(item.startedAt)} · {timeOfDay(item.startedAt)} 러닝
        </Text>
        <Text className="text-muted-foreground">
          {formatDistance(item.distanceM, unit)}{unit} ·{' '}
          {formatDuration(item.durationSec * 1000)}
          {item.weatherCode !== null &&
            item.temperatureC !== null &&
            ` · ${weatherLabel(item.weatherCode).emoji} ${Math.round(item.temperatureC)}°`}
        </Text>
      </Pressable>
    )}
  />
);
```

(섹션 헤더는 iOS 기본 sticky 동작 유지 — `bg-background`라 겹침 없음.)

- [ ] **Step 3: 타입 검사·전체 테스트**

Run: `npx tsc --noEmit && npm test`
Expected: 타입 에러 0, 전체 테스트 PASS

- [ ] **Step 4: 커밋**

```bash
git add src/components/PersonalRecordsSection.tsx "app/(tabs)/history.tsx"
git commit -m "feat(history): 월별 섹션·시간대 라벨·개인기록 카드 분리"
```
