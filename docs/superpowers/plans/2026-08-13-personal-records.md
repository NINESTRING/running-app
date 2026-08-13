# 개인 기록(달성 기록) 섹션 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기록 탭 목록 상단에 나이키 스타일 개인 기록 배지 8종(최장 거리/최장 시간/1K/1MI/5K/10K/하프/풀) 그리드를 추가한다.

**Architecture:** PR 계산은 `src/lib/records.ts`의 순수 함수(TDD): routePoints가 있으면 세그먼트별 투포인터 롤링 윈도우로 대상 거리의 최단 시간을 찾고, 없거나 못 미치면 평균 페이스 환산으로 폴백. 배지는 react-native-svg 쉴드(`RecordBadge`)로 그리고(웹 지원되므로 `.web.tsx` 불필요), `PersonalRecordsSection`이 3열 그리드로 조립해 `history.tsx`의 FlatList `ListHeaderComponent`에 들어간다.

**Tech Stack:** Expo SDK 57 / React Native 0.86 / react-native-svg 15 / lucide-react-native / NativeWind v4 / jest

**스펙:** `docs/superpowers/specs/2026-08-13-personal-records-design.md`

## Global Constraints

- 대상 거리(m): 1K=1000, 1MI=`METERS_PER_MILE`(1609.344, `src/lib/geo.ts:46` 재사용), 5K=5000, 10K=10000, 하프=21097.5, 풀=42195.
- 롤링 윈도우는 **세그먼트 내부에서만** 탐색 (일시정지를 건너뛰는 구간 불인정). 윈도우 끝 경계는 선형 보간.
- 폴백: 롤링 윈도우가 null일 때 `distanceM >= targetM && durationSec > 0`이면 `durationSec × (targetM / distanceM)`.
- 동률이면 먼저 달성한(startedAt이 오래된) 기록 유지 — 오래된 순으로 순회하며 **엄격 비교**(`<` / `>`)로만 갱신.
- 타임스탬프 역행 구간은 시간 델타를 0으로 클램프.
- 포인트 간 거리는 `haversineM`(`src/lib/geo.ts:5`) 재사용.
- 배지 색: 달성 = 쉴드 `#1f2937` + 테두리·라벨 `#3b82f6`(앱 차트 색), 미달성 = 쉴드 `#e5e7eb` + 테두리·라벨 `#9ca3af`.
- 미달성 배지: 캡션에 이름만 (날짜·값 없음), 탭 불가. 달성 배지 탭 → `/run/[id]` 이동.
- 값 포맷: 최장 거리 `formatDistance(m, unit) + unit`, 시간 기록 `formatDuration(초 × 1000)`. 날짜 `toLocaleDateString('ko-KR')`.
- 기록 0건이면 섹션 미표시 (기존 빈 상태 화면 유지).
- UI 컴포넌트는 단위 테스트 없음(코드베이스 관례) — `npx tsc --noEmit`으로 검증. lib은 TDD.
- import alias `@/*` → `./src/*`. UI 텍스트는 `@/components/ui/text`의 `Text` 사용. 커밋 메시지는 한국어 요약 컨벤션.

---

### Task 1: 롤링 윈도우 — `bestSegmentTimeSec`

**Files:**
- Create: `src/lib/records.ts`
- Test: `src/lib/__tests__/records.test.ts`

**Interfaces:**
- Consumes: `RoutePoint` (`src/types/run.ts:1`), `haversineM` (`src/lib/geo.ts:5`)
- Produces: `bestSegmentTimeSec(routePoints: RoutePoint[][], targetM: number): number | null` — 대상 거리의 최단 시간(초, 소수 가능), 불가능하면 null

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/__tests__/records.test.ts` 생성:

```ts
import type { RoutePoint } from '../../types/run';
import { bestSegmentTimeSec } from '../records';

// 적도를 따라 경도로만 이동하면 haversine 거리가 정확히 비례한다
const M_PER_DEG = (6371000 * Math.PI) / 180;
function pt(m: number, sec: number): RoutePoint {
  return { latitude: 0, longitude: m / M_PER_DEG, altitude: null, timestamp: sec * 1000 };
}

describe('bestSegmentTimeSec', () => {
  it('등속 주행에서 보간 포함 정확한 시간', () => {
    // 0m/0s → 600m/180s → 1200m/360s (등속 3.33m/s)
    const seg = [pt(0, 0), pt(600, 180), pt(1200, 360)];
    // 1000m 최단: 600→1200 구간에서 400m 보간 → 300초
    expect(bestSegmentTimeSec([seg], 1000)).toBeCloseTo(300, 3);
  });

  it('중간 가속 구간을 정확히 선택', () => {
    // 0~500m 느림(300초), 500~1500m 빠름(240초), 1500~2000m 느림(300초)
    const seg = [pt(0, 0), pt(500, 300), pt(1500, 540), pt(2000, 840)];
    expect(bestSegmentTimeSec([seg], 1000)).toBeCloseTo(240, 3);
  });

  it('세그먼트를 건너뛰는 구간은 불인정', () => {
    // 각 600m 세그먼트 2개 — 어느 쪽도 1000m 미달
    const seg1 = [pt(0, 0), pt(600, 180)];
    const seg2 = [pt(0, 1000), pt(600, 1180)];
    expect(bestSegmentTimeSec([seg1, seg2], 1000)).toBeNull();
  });

  it('여러 세그먼트 중 가장 빠른 것을 선택', () => {
    const slow = [pt(0, 0), pt(600, 180)]; // 500m ≈ 150초
    const fast = [pt(0, 1000), pt(600, 1120)]; // 500m ≈ 100초
    expect(bestSegmentTimeSec([slow, fast], 500)).toBeCloseTo(100, 3);
  });

  it('포인트 2개 미만 세그먼트는 무시', () => {
    expect(bestSegmentTimeSec([[pt(0, 0)], []], 100)).toBeNull();
  });

  it('타임스탬프 역행은 0으로 클램프', () => {
    // 10s → 5s(역행, 델타 0 처리) → 20s
    const seg = [pt(0, 10), pt(500, 5), pt(1000, 20)];
    expect(bestSegmentTimeSec([seg], 1000)).toBeCloseTo(15, 3);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- records`
Expected: FAIL — `Cannot find module '../records'`

- [ ] **Step 3: 최소 구현**

`src/lib/records.ts` 생성:

```ts
import type { RoutePoint } from '../types/run';
import { haversineM } from './geo';

/**
 * 세그먼트별 투포인터 롤링 윈도우로 대상 거리의 최단 시간(초)을 찾는다.
 * 일시정지를 건너뛰는 구간은 불인정 — 세그먼트 내부에서만 탐색.
 * 윈도우 끝 경계는 선형 보간, 타임스탬프 역행 구간은 0으로 클램프.
 */
export function bestSegmentTimeSec(
  routePoints: RoutePoint[][],
  targetM: number
): number | null {
  let best: number | null = null;
  for (const seg of routePoints) {
    if (seg.length < 2) continue;
    const dist: number[] = [0];
    const time: number[] = [0];
    for (let i = 1; i < seg.length; i += 1) {
      dist.push(dist[i - 1] + haversineM(seg[i - 1], seg[i]));
      time.push(
        time[i - 1] + Math.max(0, (seg[i].timestamp - seg[i - 1].timestamp) / 1000)
      );
    }
    if (dist[dist.length - 1] < targetM) continue;
    let j = 1;
    for (let i = 0; i < seg.length - 1; i += 1) {
      if (j <= i) j = i + 1;
      while (j < seg.length && dist[j] - dist[i] < targetM) j += 1;
      if (j >= seg.length) break;
      // dist[j-1]→dist[j] 사이에서 targetM 초과분을 선형 보간으로 덜어낸다
      const over = dist[j] - dist[i] - targetM;
      const stepDist = dist[j] - dist[j - 1];
      const stepTime = time[j] - time[j - 1];
      const t = time[j] - time[i] - (stepDist > 0 ? (over / stepDist) * stepTime : 0);
      if (best === null || t < best) best = t;
    }
  }
  return best;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- records`
Expected: PASS (6개)

- [ ] **Step 5: Commit**

```bash
git add src/lib/records.ts src/lib/__tests__/records.test.ts
git commit -m "feat(records): 롤링 윈도우 최단 시간 탐색 bestSegmentTimeSec 추가"
```

---

### Task 2: PR 집계 — `personalRecords` (+ 폴백)

**Files:**
- Modify: `src/lib/records.ts`
- Test: `src/lib/__tests__/records.test.ts`

**Interfaces:**
- Consumes: Task 1의 `bestSegmentTimeSec`, `METERS_PER_MILE` (`src/lib/geo.ts:46`), `RunRecord` (`src/types/run.ts:8`)
- Produces:
  - `interface RecordEntry { runId: string; startedAt: string; value: number }` — longestDistance는 m, 그 외는 초
  - `interface PersonalRecords { longestDistance; longestDuration; best1k; best1mi; best5k; best10k; bestHalf; bestFull }` — 각 `RecordEntry | null`
  - `personalRecords(runs: RunRecord[]): PersonalRecords`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/__tests__/records.test.ts`에 추가 (import에 `personalRecords` 추가, `RunRecord` 타입 import 추가):

```ts
import type { RunRecord } from '../../types/run';

function run(partial: Partial<RunRecord> & Pick<RunRecord, 'id' | 'startedAt'>): RunRecord {
  return {
    durationSec: 0,
    distanceM: 0,
    steps: null,
    routeGeojson: null,
    routePoints: null,
    ...partial,
  };
}

describe('personalRecords', () => {
  it('빈 배열이면 전부 null', () => {
    const r = personalRecords([]);
    expect(r).toEqual({
      longestDistance: null,
      longestDuration: null,
      best1k: null,
      best1mi: null,
      best5k: null,
      best10k: null,
      bestHalf: null,
      bestFull: null,
    });
  });

  it('최장 거리·시간을 선택하고 동률이면 오래된 기록 유지', () => {
    const runs = [
      run({ id: 'b', startedAt: '2026-02-01T07:00:00+09:00', distanceM: 5000, durationSec: 1500 }),
      run({ id: 'a', startedAt: '2026-01-01T07:00:00+09:00', distanceM: 5000, durationSec: 1200 }),
      run({ id: 'c', startedAt: '2026-03-01T07:00:00+09:00', distanceM: 3000, durationSec: 1500 }),
    ];
    const r = personalRecords(runs);
    expect(r.longestDistance).toMatchObject({ runId: 'a', value: 5000 }); // 동률 → 오래된 a
    expect(r.longestDuration).toMatchObject({ runId: 'b', value: 1500 }); // 동률 → b(2월) < c(3월)
  });

  it('routePoints 없는 기록은 평균 페이스 환산으로 폴백', () => {
    const runs = [
      run({ id: 'a', startedAt: '2026-01-01T07:00:00+09:00', distanceM: 5000, durationSec: 1500 }),
    ];
    const r = personalRecords(runs);
    expect(r.best1k?.value).toBeCloseTo(300, 3); // 1500 × 1000/5000
    expect(r.best5k?.value).toBeCloseTo(1500, 3);
    expect(r.best10k).toBeNull(); // 거리 미달
    expect(r.bestHalf).toBeNull();
    expect(r.bestFull).toBeNull();
  });

  it('routePoints가 있으면 롤링 윈도우가 폴백보다 우선', () => {
    // 전체 2000m/600초(평균 300초/km)지만 후반 1000m는 240초
    const seg = [pt(0, 0), pt(1000, 360), pt(2000, 600)];
    const runs = [
      run({
        id: 'a',
        startedAt: '2026-01-01T07:00:00+09:00',
        distanceM: 2000,
        durationSec: 600,
        routePoints: [seg],
      }),
    ];
    expect(personalRecords(runs).best1k?.value).toBeCloseTo(240, 3);
  });

  it('여러 러닝 중 최단 시간을 선택하고 동률이면 오래된 기록 유지', () => {
    const runs = [
      run({ id: 'new', startedAt: '2026-02-01T07:00:00+09:00', distanceM: 1000, durationSec: 300 }),
      run({ id: 'old', startedAt: '2026-01-01T07:00:00+09:00', distanceM: 1000, durationSec: 300 }),
      run({ id: 'slow', startedAt: '2026-03-01T07:00:00+09:00', distanceM: 1000, durationSec: 400 }),
    ];
    expect(personalRecords(runs).best1k).toMatchObject({ runId: 'old', value: 300 });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- records`
Expected: FAIL — `personalRecords is not a function`

- [ ] **Step 3: 최소 구현**

`src/lib/records.ts`에 추가. 상단 import를 `import { haversineM, METERS_PER_MILE } from './geo';`와 `import type { RoutePoint, RunRecord } from '../types/run';`로 변경:

```ts
export interface RecordEntry {
  runId: string;
  startedAt: string; // ISO
  value: number; // longestDistance: m, 그 외: 초
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

const TARGETS = {
  best1k: 1000,
  best1mi: METERS_PER_MILE,
  best5k: 5000,
  best10k: 10_000,
  bestHalf: 21_097.5,
  bestFull: 42_195,
} as const;

/** 롤링 윈도우 우선, null이면 평균 페이스 환산 폴백. 후보 아님 → null */
function bestTimeForRun(run: RunRecord, targetM: number): number | null {
  if (run.routePoints) {
    const t = bestSegmentTimeSec(run.routePoints, targetM);
    if (t !== null) return t;
  }
  if (run.distanceM >= targetM && run.durationSec > 0) {
    return run.durationSec * (targetM / run.distanceM);
  }
  return null;
}

/** 개인 기록 8종. 동률이면 먼저 달성한(오래된) 기록 유지 */
export function personalRecords(runs: RunRecord[]): PersonalRecords {
  const out: PersonalRecords = {
    longestDistance: null,
    longestDuration: null,
    best1k: null,
    best1mi: null,
    best5k: null,
    best10k: null,
    bestHalf: null,
    bestFull: null,
  };
  const ordered = [...runs].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
  );
  for (const run of ordered) {
    if (run.distanceM > (out.longestDistance?.value ?? 0)) {
      out.longestDistance = { runId: run.id, startedAt: run.startedAt, value: run.distanceM };
    }
    if (run.durationSec > (out.longestDuration?.value ?? 0)) {
      out.longestDuration = { runId: run.id, startedAt: run.startedAt, value: run.durationSec };
    }
    for (const key of Object.keys(TARGETS) as (keyof typeof TARGETS)[]) {
      const t = bestTimeForRun(run, TARGETS[key]);
      if (t !== null && t < (out[key]?.value ?? Infinity)) {
        out[key] = { runId: run.id, startedAt: run.startedAt, value: t };
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- records`
Expected: PASS (11개)

- [ ] **Step 5: 전체 스위트 확인 후 Commit**

Run: `npm test`
Expected: 전부 PASS

```bash
git add src/lib/records.ts src/lib/__tests__/records.test.ts
git commit -m "feat(records): 개인 기록 8종 집계 personalRecords — 롤링 윈도우 우선·평균 페이스 폴백"
```

---

### Task 3: 배지 UI — `RecordBadge` + `PersonalRecordsSection`

**Files:**
- Create: `src/components/RecordBadge.tsx`
- Create: `src/components/PersonalRecordsSection.tsx`

**Interfaces:**
- Consumes: Task 2의 `PersonalRecords`, `RecordEntry`; `formatDistance`/`formatDuration` (`src/lib/geo.ts`); `Text`/`Separator` (ui); react-native-svg; lucide-react-native
- Produces:
  - `RecordBadge({ label?, icon?, achieved, date?, name, value?, onPress? })`
  - `PersonalRecordsSection({ records: PersonalRecords; unit: 'km' | 'mi'; onPressRun: (runId: string) => void })`

react-native-svg는 웹을 지원하므로 `.web.tsx` 불필요. UI 컴포넌트는 단위 테스트 없음 — `npx tsc --noEmit`으로 검증.

- [ ] **Step 1: RecordBadge 구현**

`src/components/RecordBadge.tsx`:

```tsx
import { MoveUpRight, Timer } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import Svg, { Path, Text as SvgText } from 'react-native-svg';

import { Text } from '@/components/ui/text';

export interface RecordBadgeProps {
  /** 쉴드 중앙 텍스트 (1K, 5K, 21.1K …). icon과 둘 중 하나만 */
  label?: string;
  icon?: 'distance' | 'duration';
  achieved: boolean;
  /** 표시용으로 이미 포맷된 문자열 */
  date?: string;
  name: string;
  /** 표시용으로 이미 포맷된 문자열 */
  value?: string;
  onPress?: () => void;
}

const ACCENT = '#3b82f6';
const SHIELD_DARK = '#1f2937';
const GRAY = '#9ca3af';
const GRAY_BG = '#e5e7eb';

export function RecordBadge({
  label,
  icon,
  achieved,
  date,
  name,
  value,
  onPress,
}: RecordBadgeProps) {
  const IconCmp = icon === 'distance' ? MoveUpRight : Timer;
  const fg = achieved ? ACCENT : GRAY;
  const body = (
    <View className="items-center gap-0.5">
      <View className="h-24 w-20 items-center justify-center">
        <Svg width={72} height={86} viewBox="0 0 100 118">
          <Path
            d="M8 4 H92 V84 L50 112 L8 84 Z"
            fill={achieved ? SHIELD_DARK : GRAY_BG}
            stroke={fg}
            strokeWidth={5}
            strokeLinejoin="round"
          />
          {label ? (
            <SvgText
              x="50"
              y="66"
              textAnchor="middle"
              fontSize="26"
              fontWeight="bold"
              fill={fg}
            >
              {label}
            </SvgText>
          ) : null}
        </Svg>
        {icon ? (
          <View className="absolute inset-0 items-center justify-center pb-2">
            <IconCmp size={28} color={fg} />
          </View>
        ) : null}
      </View>
      {achieved && date ? (
        <Text className="text-xs text-muted-foreground">{date}</Text>
      ) : null}
      <Text className="text-center text-sm">{name}</Text>
      {achieved && value ? (
        <Text className="text-xs text-muted-foreground">{value}</Text>
      ) : null}
    </View>
  );
  if (achieved && onPress) {
    return (
      <Pressable onPress={onPress} className="active:opacity-70">
        {body}
      </Pressable>
    );
  }
  return body;
}
```

- [ ] **Step 2: PersonalRecordsSection 구현**

`src/components/PersonalRecordsSection.tsx`:

```tsx
import { View } from 'react-native';

import { RecordBadge } from '@/components/RecordBadge';
import { Separator } from '@/components/ui/separator';
import { Text } from '@/components/ui/text';
import { formatDistance, formatDuration } from '@/lib/geo';
import type { PersonalRecords, RecordEntry } from '@/lib/records';

interface Props {
  records: PersonalRecords;
  unit: 'km' | 'mi';
  onPressRun: (runId: string) => void;
}

const dateStr = (e: RecordEntry) => new Date(e.startedAt).toLocaleDateString('ko-KR');
const timeStr = (e: RecordEntry) => formatDuration(e.value * 1000);

export function PersonalRecordsSection({ records, unit, onPressRun }: Props) {
  const badges: {
    key: string;
    name: string;
    entry: RecordEntry | null;
    format: (e: RecordEntry) => string;
    label?: string;
    icon?: 'distance' | 'duration';
  }[] = [
    {
      key: 'longestDistance',
      name: '최장 거리 러닝',
      icon: 'distance',
      entry: records.longestDistance,
      format: (e) => `${formatDistance(e.value, unit)}${unit}`,
    },
    {
      key: 'longestDuration',
      name: '최장 시간 러닝',
      icon: 'duration',
      entry: records.longestDuration,
      format: timeStr,
    },
    { key: 'best1k', name: '1K 최고 기록', label: '1K', entry: records.best1k, format: timeStr },
    { key: 'best1mi', name: '마일 최고 기록', label: '1MI', entry: records.best1mi, format: timeStr },
    { key: 'best5k', name: '5K 최고 기록', label: '5K', entry: records.best5k, format: timeStr },
    { key: 'best10k', name: '10K 최고 기록', label: '10K', entry: records.best10k, format: timeStr },
    { key: 'bestHalf', name: '하프마라톤 최고 기록', label: '21.1K', entry: records.bestHalf, format: timeStr },
    { key: 'bestFull', name: '마라톤 최고 기록', label: '42.2K', entry: records.bestFull, format: timeStr },
  ];

  return (
    <View className="pb-2">
      <Text className="p-4 text-xl font-bold">개인 기록</Text>
      <View className="flex-row flex-wrap">
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
      <Separator />
    </View>
  );
}
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 4: Commit**

```bash
git add src/components/RecordBadge.tsx src/components/PersonalRecordsSection.tsx
git commit -m "feat(records): SVG 쉴드 배지 RecordBadge·개인 기록 그리드 섹션 추가"
```

---

### Task 4: 화면 통합 — `history.tsx`

**Files:**
- Modify: `app/(tabs)/history.tsx`

**Interfaces:**
- Consumes: Task 2의 `personalRecords`, Task 3의 `PersonalRecordsSection`. 기존 화면의 로딩/빈 상태/Supabase 분기와 FlatList 구조는 유지.
- Produces: 최종 화면. 이후 태스크 없음.

- [ ] **Step 1: history.tsx 수정**

전체 파일을 다음으로 교체 (기존 대비: `useMemo` import, `personalRecords`/`PersonalRecordsSection` import, `records` 계산, `ListHeaderComponent` 추가만 변경):

```tsx
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { PersonalRecordsSection } from '@/components/PersonalRecordsSection';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { formatDistance, formatDuration } from '@/lib/geo';
import { personalRecords } from '@/lib/records';
import { listRuns } from '@/services/runs';
import { supabase } from '@/services/supabase';
import { useSettingsStore } from '@/stores/settingsStore';
import type { RunRecord } from '@/types/run';

export default function HistoryScreen() {
  const router = useRouter();
  const [runs, setRuns] = useState<RunRecord[] | null>(null);
  const unit = useSettingsStore((s) => s.unit);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      listRuns().then((r) => {
        if (!cancelled) setRuns(r);
      });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  // 롤링 윈도우 계산이 목록 렌더보다 무거우므로 runs 변경 시에만 재계산
  const records = useMemo(() => (runs && runs.length > 0 ? personalRecords(runs) : null), [runs]);

  if (!supabase) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <Text className="text-center text-muted-foreground">
          Supabase가 설정되지 않았습니다.{'\n'}.env에 URL과 키를 넣어주세요.
        </Text>
      </View>
    );
  }

  if (runs === null) {
    return (
      <View className="flex-1 gap-3 bg-background p-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </View>
    );
  }

  if (runs.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <Text className="text-center text-muted-foreground">아직 러닝 기록이 없습니다.</Text>
      </View>
    );
  }

  return (
    <FlatList
      className="bg-background"
      data={runs}
      keyExtractor={(r) => r.id}
      ItemSeparatorComponent={() => <Separator />}
      ListHeaderComponent={
        records ? (
          <PersonalRecordsSection
            records={records}
            unit={unit}
            onPressRun={(runId) => router.push(`/run/${runId}`)}
          />
        ) : null
      }
      renderItem={({ item }) => (
        <Pressable
          className="gap-1 p-4 active:bg-accent"
          onPress={() => router.push(`/run/${item.id}`)}
        >
          <Text className="text-base font-semibold">
            {new Date(item.startedAt).toLocaleDateString('ko-KR')}
          </Text>
          <Text className="text-muted-foreground">
            {formatDistance(item.distanceM, unit)}{unit} ·{' '}
            {formatDuration(item.durationSec * 1000)}
          </Text>
        </Pressable>
      )}
    />
  );
}
```

- [ ] **Step 2: 전체 검증**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: 테스트 전부 PASS, 타입 에러 없음, 린트 에러 0 (기존 authStore.test.ts 경고 1건은 무관)

- [ ] **Step 3: Commit**

```bash
git add app/\(tabs\)/history.tsx
git commit -m "feat(records): 기록 탭 상단에 개인 기록 배지 섹션 통합"
```

---

## 검증 노트 (플랜 전체)

- 실기기/시뮬레이터 확인 포인트: ① 배지 8개 그리드 렌더(달성/미달성 색 구분) ② 달성 배지 탭 → 해당 러닝 상세 이동 ③ 설정 mi 전환 시 최장 거리 값 단위 변경 ④ 기록 0건 계정에서 섹션 미표시 ⑤ 웹(`npm run web`)에서 SVG 배지 렌더.
- SvgText 세로 정렬이 플랫폼별로 어긋나면 `y` 값(66)을 미세 조정 — `alignmentBaseline`은 웹/네이티브 지원 편차가 있어 사용하지 않고 y 좌표로 중앙 배치.
