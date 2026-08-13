# 러닝 목표(페이스·거리) 및 실시간 편차 표시 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈 화면에서 목표 페이스·거리를 로컬(AsyncStorage)에 설정하고, 러닝 중 목표 페이스 대비 뒤쳐짐/앞섬을 미터 단위로 색상 표시한다.

**Architecture:** `settingsStore`와 동일한 zustand persist 패턴의 신규 `goalStore`(DB 미사용) + 순수 계산 함수 `src/lib/goal.ts` + `GoalDialog` 컴포넌트 + 홈 화면(`app/(tabs)/index.tsx`) 통합. 편차 = 실제 거리 − (일시정지 제외 경과시간 × 목표 페이스 기대 거리).

**Tech Stack:** Expo SDK 57 / React Native 0.86 / zustand 5 (persist) / AsyncStorage / NativeWind / jest-expo

**Spec:** `docs/superpowers/specs/2026-08-13-run-goal-pace-design.md`

## Global Constraints

- 목표 데이터는 DB(Supabase)에 절대 올리지 않는다. AsyncStorage 키 `goal`, version 0.
- 페이스 스테퍼: 15초 단위, 범위 3'00"(180초)~10'00"(600초), 기본 6'00"(360초).
- 거리 스테퍼: 0.5 단위, 범위 0.5~50, 기본 5.0 (현재 단위 km/mi 기준 수치, 단위 변경 시 변환 없음).
- 편차 표시 가드: 경과 30초(30_000ms) 미만이면 표시하지 않음. 데드밴드 ±10m는 'onPace'.
- 색상: 뒤쳐짐 `text-destructive`, 앞섬·목표 도달 `text-green-600 dark:text-green-500`, onPace `text-muted-foreground`.
- 문구: `▼ {N}m 뒤쳐짐` / `▲ {N}m 앞섬` / `목표 페이스 유지` / 목표 없을 때 요약 `목표 없음`.
- 러닝 중(running/paused/saving) 목표 변경 UI는 노출하지 않는다(idle에서만).
- 테스트 실행은 `npm test`(TZ=Asia/Seoul jest). 커밋 메시지는 기존 컨벤션(한국어, `feat:`/`refactor:` 접두사).

---

### Task 1: safeStorage 제네릭 추출 (`src/lib/persist.ts`)

기존 `settingsStore.ts`의 `safeStorage`를 제네릭 팩토리로 추출해 goalStore와 공유한다.
기존 settingsStore 테스트(특히 손상 JSON 방어)가 리팩터의 회귀 테스트 역할을 한다.

**Files:**
- Create: `src/lib/persist.ts`
- Modify: `src/stores/settingsStore.ts`
- Test: `src/stores/__tests__/settingsStore.test.ts` (기존, 수정 없음)

**Interfaces:**
- Consumes: 없음
- Produces: `createSafeStorage<S>(): PersistStorage<S>` — Task 3의 goalStore가 사용

- [ ] **Step 1: `src/lib/persist.ts` 작성**

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PersistStorage, StorageValue } from 'zustand/middleware';

// zustand의 createJSONStorage는 저장된 문자열을 넘겨받은 뒤 자체적으로 JSON.parse를 수행하는데,
// 이 파싱은 우리가 감싼 getItem 바깥(persist 내부)에서 일어나 손상된 JSON은 여전히 reject로 전파된다.
// hydrate()는 그 reject를 조용히 삼키기만 하고 hasHydrated를 true로 만들지 않으므로,
// 네이티브 읽기 오류든 손상된 JSON이든 이 getItem 안에서 직접 파싱까지 끝내고 실패 시 null을 반환해야
// 앱이 빈 화면에 영구히 멈추지 않는다.
export function createSafeStorage<S>(): PersistStorage<S> {
  return {
    getItem: async (name) => {
      try {
        const raw = await AsyncStorage.getItem(name);
        if (raw === null) return null;
        return JSON.parse(raw) as StorageValue<S>;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => AsyncStorage.setItem(name, JSON.stringify(value)),
    removeItem: (name) => AsyncStorage.removeItem(name),
  };
}
```

- [ ] **Step 2: `settingsStore.ts`를 팩토리 사용으로 변경**

`safeStorage` 정의(주석 포함, 1~31행 중 import·주석·`safeStorage` 상수)를 삭제하고 다음으로 대체:

```ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createSafeStorage } from '../lib/persist';

export type ThemePreference = 'system' | 'light' | 'dark';

interface SettingsState {
  unit: 'km' | 'mi';
  theme: ThemePreference;
  setUnit: (unit: 'km' | 'mi') => void;
  setTheme: (theme: ThemePreference) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      unit: 'km',
      theme: 'system',
      setUnit: (unit) => set({ unit }),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'settings',
      version: 0,
      storage: createSafeStorage<SettingsState>(),
    },
  ),
);
```

- [ ] **Step 3: 기존 테스트로 회귀 확인**

Run: `npm test -- src/stores/__tests__/settingsStore.test.ts`
Expected: 전체 PASS (손상 JSON 방어 테스트 포함 6건)

- [ ] **Step 4: 커밋**

```bash
git add src/lib/persist.ts src/stores/settingsStore.ts
git commit -m "refactor(store): safeStorage를 제네릭 팩토리로 추출"
```

---

### Task 2: 편차 계산 순수 함수 (`src/lib/goal.ts`)

**Files:**
- Create: `src/lib/goal.ts`
- Test: `src/lib/__tests__/goal.test.ts`

**Interfaces:**
- Consumes: `METERS_PER_MILE`, `formatPace` (기존 `src/lib/geo.ts`)
- Produces (Task 4·5가 사용):
  - 상수: `PACE_STEP_SEC=15`, `PACE_MIN_SEC=180`, `PACE_MAX_SEC=600`, `DEFAULT_PACE_SEC=360`, `DISTANCE_STEP_UNITS=0.5`, `DISTANCE_MIN_UNITS=0.5`, `DISTANCE_MAX_UNITS=50`, `DEFAULT_DISTANCE_UNITS=5`
  - `goalDeltaM(params: { distanceM: number; elapsedMs: number; paceSecPerUnit: number; unit: 'km' | 'mi' }): number | null`
  - `type GoalDeltaStatus = 'ahead' | 'behind' | 'onPace'`
  - `goalDeltaStatus(deltaM: number): GoalDeltaStatus`
  - `clampPaceSec(sec: number): number`
  - `clampDistanceUnits(units: number): number`
  - `goalSummary(paceSecPerUnit: number | null, distanceUnits: number | null, unit: 'km' | 'mi'): string`

- [ ] **Step 1: 실패하는 테스트 작성** (`src/lib/__tests__/goal.test.ts`)

```ts
import { METERS_PER_MILE } from '../geo';
import {
  clampDistanceUnits,
  clampPaceSec,
  DISTANCE_MAX_UNITS,
  DISTANCE_MIN_UNITS,
  goalDeltaM,
  goalDeltaStatus,
  goalSummary,
  PACE_MAX_SEC,
  PACE_MIN_SEC,
} from '../goal';

describe('goalDeltaM', () => {
  test('목표보다 느리면 음수(뒤쳐짐)', () => {
    // 6'00"/km 목표, 60초 경과 → 기대 166.67m, 실제 100m → 약 -66.7m
    const d = goalDeltaM({ distanceM: 100, elapsedMs: 60_000, paceSecPerUnit: 360, unit: 'km' });
    expect(d).toBeCloseTo(100 - (60 / 360) * 1000, 1);
  });

  test('목표보다 빠르면 양수(앞섬)', () => {
    const d = goalDeltaM({ distanceM: 250, elapsedMs: 60_000, paceSecPerUnit: 360, unit: 'km' });
    expect(d).toBeCloseTo(250 - (60 / 360) * 1000, 1);
  });

  test('경과 30초 미만이면 null(초반 가드)', () => {
    expect(
      goalDeltaM({ distanceM: 100, elapsedMs: 29_999, paceSecPerUnit: 360, unit: 'km' }),
    ).toBeNull();
  });

  test('정확히 30초부터 계산한다', () => {
    expect(
      goalDeltaM({ distanceM: 100, elapsedMs: 30_000, paceSecPerUnit: 360, unit: 'km' }),
    ).not.toBeNull();
  });

  test('mi 단위는 METERS_PER_MILE 기준으로 계산한다', () => {
    // 8'00"/mi 목표, 120초 경과 → 기대 0.25mi. 실제도 0.25mi면 편차 0
    const d = goalDeltaM({
      distanceM: (120 / 480) * METERS_PER_MILE,
      elapsedMs: 120_000,
      paceSecPerUnit: 480,
      unit: 'mi',
    });
    expect(d).toBeCloseTo(0, 6);
  });
});

describe('goalDeltaStatus', () => {
  test('±10m 이내는 onPace(경계 포함)', () => {
    expect(goalDeltaStatus(0)).toBe('onPace');
    expect(goalDeltaStatus(10)).toBe('onPace');
    expect(goalDeltaStatus(-10)).toBe('onPace');
  });

  test('+10m 초과는 ahead, -10m 미만은 behind', () => {
    expect(goalDeltaStatus(10.1)).toBe('ahead');
    expect(goalDeltaStatus(-10.1)).toBe('behind');
  });
});

describe('클램프', () => {
  test('페이스는 최소·최대로 클램프된다', () => {
    expect(clampPaceSec(0)).toBe(PACE_MIN_SEC);
    expect(clampPaceSec(9999)).toBe(PACE_MAX_SEC);
    expect(clampPaceSec(360)).toBe(360);
  });

  test('거리는 최소·최대로 클램프된다', () => {
    expect(clampDistanceUnits(0)).toBe(DISTANCE_MIN_UNITS);
    expect(clampDistanceUnits(999)).toBe(DISTANCE_MAX_UNITS);
    expect(clampDistanceUnits(5)).toBe(5);
  });
});

describe('goalSummary', () => {
  test('둘 다 없으면 "목표 없음"', () => {
    expect(goalSummary(null, null, 'km')).toBe('목표 없음');
  });

  test('둘 다 있으면 페이스 · 거리', () => {
    expect(goalSummary(330, 5, 'km')).toBe(`5'30"/km · 5.00km`);
  });

  test('페이스만 있으면 페이스만', () => {
    expect(goalSummary(330, null, 'km')).toBe(`5'30"/km`);
  });

  test('거리만 있으면 거리만(단위 반영)', () => {
    expect(goalSummary(null, 5, 'mi')).toBe('5.00mi');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test -- src/lib/__tests__/goal.test.ts`
Expected: FAIL — `Cannot find module '../goal'`

- [ ] **Step 3: `src/lib/goal.ts` 구현**

```ts
import { formatPace, METERS_PER_MILE } from './geo';

export const PACE_STEP_SEC = 15;
export const PACE_MIN_SEC = 180; // 3'00"
export const PACE_MAX_SEC = 600; // 10'00"
export const DEFAULT_PACE_SEC = 360; // 6'00"

export const DISTANCE_STEP_UNITS = 0.5;
export const DISTANCE_MIN_UNITS = 0.5;
export const DISTANCE_MAX_UNITS = 50;
export const DEFAULT_DISTANCE_UNITS = 5;

// GPS 워밍업 요동을 피하기 위한 표시 유예
const MIN_ELAPSED_MS = 30_000;
// 색상 깜빡임을 막는 데드밴드
const DEADBAND_M = 10;

export type GoalDeltaStatus = 'ahead' | 'behind' | 'onPace';

/** 목표 페이스 대비 편차(m). 양수 = 앞섬, 음수 = 뒤쳐짐. 경과 30초 미만이면 null */
export function goalDeltaM(params: {
  distanceM: number;
  elapsedMs: number; // 일시정지 제외 경과 시간
  paceSecPerUnit: number;
  unit: 'km' | 'mi';
}): number | null {
  if (params.elapsedMs < MIN_ELAPSED_MS) return null;
  const unitM = params.unit === 'mi' ? METERS_PER_MILE : 1000;
  const expectedM = (params.elapsedMs / 1000 / params.paceSecPerUnit) * unitM;
  return params.distanceM - expectedM;
}

export function goalDeltaStatus(deltaM: number): GoalDeltaStatus {
  if (deltaM > DEADBAND_M) return 'ahead';
  if (deltaM < -DEADBAND_M) return 'behind';
  return 'onPace';
}

export function clampPaceSec(sec: number): number {
  return Math.min(PACE_MAX_SEC, Math.max(PACE_MIN_SEC, sec));
}

export function clampDistanceUnits(units: number): number {
  return Math.min(DISTANCE_MAX_UNITS, Math.max(DISTANCE_MIN_UNITS, units));
}

/** idle 카드용 목표 요약. 예: 5'30"/km · 5.00km */
export function goalSummary(
  paceSecPerUnit: number | null,
  distanceUnits: number | null,
  unit: 'km' | 'mi',
): string {
  const parts: string[] = [];
  if (paceSecPerUnit !== null) parts.push(`${formatPace(paceSecPerUnit)}/${unit}`);
  if (distanceUnits !== null) parts.push(`${distanceUnits.toFixed(2)}${unit}`);
  return parts.length > 0 ? parts.join(' · ') : '목표 없음';
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- src/lib/__tests__/goal.test.ts`
Expected: 전체 PASS (13건)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/goal.ts src/lib/__tests__/goal.test.ts
git commit -m "feat(goal): 목표 페이스 편차·클램프·요약 순수 함수"
```

---

### Task 3: 목표 스토어 (`src/stores/goalStore.ts`)

**Files:**
- Create: `src/stores/goalStore.ts`
- Test: `src/stores/__tests__/goalStore.test.ts`

**Interfaces:**
- Consumes: `createSafeStorage` (Task 1)
- Produces (Task 4·5가 사용): `useGoalStore` — 상태 `paceSecPerUnit: number | null`, `distanceUnits: number | null`, 액션 `setPace(v: number | null)`, `setDistance(v: number | null)`

- [ ] **Step 1: 실패하는 테스트 작성** (`src/stores/__tests__/goalStore.test.ts`)

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useGoalStore } from '../goalStore';

// persist의 setItem은 fire-and-forget이라 마이크로태스크 큐를 비워 저장 완료를 기다린다
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('goalStore', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useGoalStore.setState({ paceSecPerUnit: null, distanceUnits: null });
  });

  test('기본값은 목표 없음(null)', () => {
    expect(useGoalStore.getState().paceSecPerUnit).toBeNull();
    expect(useGoalStore.getState().distanceUnits).toBeNull();
  });

  test('setPace·setDistance로 설정하고 null로 해제한다', () => {
    useGoalStore.getState().setPace(330);
    useGoalStore.getState().setDistance(5);
    expect(useGoalStore.getState().paceSecPerUnit).toBe(330);
    expect(useGoalStore.getState().distanceUnits).toBe(5);

    useGoalStore.getState().setPace(null);
    expect(useGoalStore.getState().paceSecPerUnit).toBeNull();
    expect(useGoalStore.getState().distanceUnits).toBe(5);
  });

  test('변경 사항이 AsyncStorage에 저장된다', async () => {
    useGoalStore.getState().setPace(360);
    useGoalStore.getState().setDistance(10);
    await flush();

    const raw = await AsyncStorage.getItem('goal');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.state.paceSecPerUnit).toBe(360);
    expect(parsed.state.distanceUnits).toBe(10);
  });

  test('저장된 값이 rehydrate로 복원된다', async () => {
    await AsyncStorage.setItem(
      'goal',
      JSON.stringify({ state: { paceSecPerUnit: 300, distanceUnits: 21 }, version: 0 }),
    );

    await useGoalStore.persist.rehydrate();

    expect(useGoalStore.getState().paceSecPerUnit).toBe(300);
    expect(useGoalStore.getState().distanceUnits).toBe(21);
  });

  test('손상된 JSON이 저장되어 있어도 하이드레이션이 기본값으로 완료된다', async () => {
    await AsyncStorage.setItem('goal', 'not-json');

    await expect(useGoalStore.persist.rehydrate()).resolves.not.toThrow();

    expect(useGoalStore.persist.hasHydrated()).toBe(true);
    expect(useGoalStore.getState().paceSecPerUnit).toBeNull();
    expect(useGoalStore.getState().distanceUnits).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test -- src/stores/__tests__/goalStore.test.ts`
Expected: FAIL — `Cannot find module '../goalStore'`

- [ ] **Step 3: `src/stores/goalStore.ts` 구현**

```ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createSafeStorage } from '../lib/persist';

// 러닝 목표. DB에 올리지 않고 폰 로컬에만 저장한다.
// 값은 현재 단위(km/mi) 기준 — 단위를 바꿔도 숫자는 변환하지 않는다.
interface GoalState {
  paceSecPerUnit: number | null; // 목표 페이스(초/단위). null = 미설정
  distanceUnits: number | null; // 목표 거리(단위 수치, 예: 5 = 5km). null = 미설정
  setPace: (v: number | null) => void;
  setDistance: (v: number | null) => void;
}

export const useGoalStore = create<GoalState>()(
  persist(
    (set) => ({
      paceSecPerUnit: null,
      distanceUnits: null,
      setPace: (paceSecPerUnit) => set({ paceSecPerUnit }),
      setDistance: (distanceUnits) => set({ distanceUnits }),
    }),
    {
      name: 'goal',
      version: 0,
      storage: createSafeStorage<GoalState>(),
    },
  ),
);
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- src/stores/__tests__/goalStore.test.ts`
Expected: 전체 PASS (5건)

- [ ] **Step 5: 커밋**

```bash
git add src/stores/goalStore.ts src/stores/__tests__/goalStore.test.ts
git commit -m "feat(goal): 로컬 목표 스토어(zustand persist)"
```

---

### Task 4: 목표 설정 다이얼로그 (`src/components/GoalDialog.tsx`)

UI 컴포넌트라 단위 테스트 없음(이 코드베이스는 lib/store 수준만 유닛 테스트, UI는 수동 확인).
드래프트 상태를 로컬로 들고 있다가 "확인"에서만 스토어에 반영한다.

**Files:**
- Create: `src/components/GoalDialog.tsx`

**Interfaces:**
- Consumes: `useGoalStore` (Task 3), `clampPaceSec`·`clampDistanceUnits`·상수들 (Task 2), `formatPace` (`src/lib/geo.ts`), `useSettingsStore`, ui의 `AlertDialog*`·`Button`·`Text`
- Produces: `GoalDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void })` — Task 5가 사용

- [ ] **Step 1: 컴포넌트 작성**

```tsx
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { formatPace } from '@/lib/geo';
import {
  clampDistanceUnits,
  clampPaceSec,
  DEFAULT_DISTANCE_UNITS,
  DEFAULT_PACE_SEC,
  DISTANCE_STEP_UNITS,
  PACE_STEP_SEC,
} from '@/lib/goal';
import { useGoalStore } from '@/stores/goalStore';
import { useSettingsStore } from '@/stores/settingsStore';

export function GoalDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const unit = useSettingsStore((s) => s.unit);
  // 드래프트 — 확인을 눌러야 스토어에 반영된다
  const [pace, setPace] = useState<number | null>(null);
  const [distance, setDistance] = useState<number | null>(null);

  // 열 때마다 저장된 목표로 드래프트 초기화
  useEffect(() => {
    if (!open) return;
    const g = useGoalStore.getState();
    setPace(g.paceSecPerUnit);
    setDistance(g.distanceUnits);
  }, [open]);

  const onConfirm = () => {
    const g = useGoalStore.getState();
    g.setPace(pace);
    g.setDistance(distance);
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>목표 설정</AlertDialogTitle>
        </AlertDialogHeader>
        <View className="gap-4 py-2">
          <GoalRow
            label={`페이스(/${unit})`}
            valueText={pace !== null ? formatPace(pace) : null}
            onToggle={() => setPace(pace !== null ? null : DEFAULT_PACE_SEC)}
            onStep={(dir) =>
              setPace((v) => clampPaceSec((v ?? DEFAULT_PACE_SEC) + dir * PACE_STEP_SEC))
            }
          />
          <GoalRow
            label={`거리(${unit})`}
            valueText={distance !== null ? distance.toFixed(2) : null}
            onToggle={() => setDistance(distance !== null ? null : DEFAULT_DISTANCE_UNITS)}
            onStep={(dir) =>
              setDistance((v) =>
                clampDistanceUnits((v ?? DEFAULT_DISTANCE_UNITS) + dir * DISTANCE_STEP_UNITS),
              )
            }
          />
        </View>
        <AlertDialogFooter>
          <AlertDialogCancel onPress={() => onOpenChange(false)}>
            <Text>취소</Text>
          </AlertDialogCancel>
          <AlertDialogAction onPress={onConfirm}>
            <Text>확인</Text>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function GoalRow({
  label,
  valueText,
  onToggle,
  onStep,
}: {
  label: string;
  valueText: string | null; // null = 사용 안 함
  onToggle: () => void;
  onStep: (dir: 1 | -1) => void;
}) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      {valueText === null ? (
        <Button size="sm" variant="outline" onPress={onToggle}>
          <Text>설정</Text>
        </Button>
      ) : (
        <View className="flex-row items-center gap-2">
          <Button
            size="icon"
            variant="outline"
            onPress={() => onStep(-1)}
            accessibilityLabel={`${label} 감소`}
          >
            <Text>−</Text>
          </Button>
          <Text className="w-16 text-center text-base font-semibold">{valueText}</Text>
          <Button
            size="icon"
            variant="outline"
            onPress={() => onStep(1)}
            accessibilityLabel={`${label} 증가`}
          >
            <Text>+</Text>
          </Button>
          <Button size="sm" variant="ghost" onPress={onToggle}>
            <Text className="text-muted-foreground">해제</Text>
          </Button>
        </View>
      )}
    </View>
  );
}
```

- [ ] **Step 2: 타입·린트 확인**

Run: `npx tsc --noEmit && npm run lint`
Expected: 오류 없음 (미사용 import 경고 없어야 함)

- [ ] **Step 3: 커밋**

```bash
git add src/components/GoalDialog.tsx
git commit -m "feat(goal): 목표 설정 다이얼로그(스테퍼 입력)"
```

---

### Task 5: 홈 화면 통합 (`app/(tabs)/index.tsx`)

idle 카드에 목표 요약+버튼, 러닝 중 편차 줄, 거리 목표 진행 표시를 추가한다.

**Files:**
- Modify: `app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: `GoalDialog` (Task 4), `useGoalStore` (Task 3), `goalDeltaM`·`goalDeltaStatus`·`goalSummary` (Task 2), 기존 `formatDistance`·`METERS_PER_MILE`(`@/lib/geo`), `cn`(`@/lib/utils`)

- [ ] **Step 1: import 추가**

기존 import 블록에 추가:

```tsx
import { GoalDialog } from '@/components/GoalDialog';
import { goalDeltaM, goalDeltaStatus, goalSummary } from '@/lib/goal';
import { cn } from '@/lib/utils';
import { useGoalStore } from '@/stores/goalStore';
```

그리고 기존 geo import에 `METERS_PER_MILE` 추가:

```tsx
import { formatDistance, formatDuration, formatPace, METERS_PER_MILE, paceSecPerUnit } from '@/lib/geo';
```

- [ ] **Step 2: HomeScreen에 상태·계산 추가**

`const unit = useSettingsStore((s) => s.unit);` 아래에:

```tsx
const goalPaceSec = useGoalStore((s) => s.paceSecPerUnit);
const goalDistanceUnits = useGoalStore((s) => s.distanceUnits);
const [goalOpen, setGoalOpen] = useState(false);
```

`const elapsed = elapsedMs(...)` 아래에:

```tsx
// 목표 페이스 대비 편차 — 30초 미만이면 null(초반 가드)
const goalDelta =
  goalPaceSec !== null && (status === 'running' || status === 'paused')
    ? goalDeltaM({ distanceM, elapsedMs: elapsed, paceSecPerUnit: goalPaceSec, unit })
    : null;

// 거리 목표 진행 표시 (idle에서는 요약 줄이 있으므로 숨김)
const unitM = unit === 'mi' ? METERS_PER_MILE : 1000;
const showDistanceGoal = goalDistanceUnits !== null && status !== 'idle';
const distanceValue = showDistanceGoal
  ? `${formatDistance(distanceM, unit)} / ${goalDistanceUnits.toFixed(2)}`
  : formatDistance(distanceM, unit);
const distanceReached = showDistanceGoal && distanceM >= goalDistanceUnits * unitM;
```

- [ ] **Step 3: idle 목표 요약 줄 추가**

`<CardContent className="gap-3 p-4">` 안, `permissionDenied` 블록 다음·지표 행 앞에:

```tsx
{status === 'idle' && (
  <View className="flex-row items-center justify-between">
    <Text className="text-sm text-muted-foreground">
      {goalSummary(goalPaceSec, goalDistanceUnits, unit)}
    </Text>
    <Button size="sm" variant="outline" onPress={() => setGoalOpen(true)}>
      <Text>목표</Text>
    </Button>
  </View>
)}
```

- [ ] **Step 4: 거리 지표를 진행 표시로 교체**

기존:

```tsx
<Metric label={`거리(${unit})`} value={formatDistance(distanceM, unit)} />
```

교체:

```tsx
<Metric
  label={`거리(${unit})`}
  value={distanceValue}
  valueClassName={cn(
    showDistanceGoal && 'text-lg',
    distanceReached && 'text-green-600 dark:text-green-500',
  )}
/>
```

`Metric` 컴포넌트에 `valueClassName` prop 추가:

```tsx
function Metric({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <View className="items-center">
      <Text className={cn('text-2xl font-bold', valueClassName)}>{value}</Text>
      <Text className="text-xs text-muted-foreground">{label}</Text>
    </View>
  );
}
```

- [ ] **Step 5: 편차 줄 추가**

기존 `liveSplits` 표시 블록 바로 아래에:

```tsx
{goalDelta !== null && <GoalDeltaLine deltaM={goalDelta} />}
```

파일 하단(`Metric` 근처)에 로컬 컴포넌트 추가:

```tsx
function GoalDeltaLine({ deltaM }: { deltaM: number }) {
  const status = goalDeltaStatus(deltaM);
  if (status === 'onPace') {
    return <Text className="text-center text-sm text-muted-foreground">목표 페이스 유지</Text>;
  }
  const m = Math.round(Math.abs(deltaM));
  return status === 'behind' ? (
    <Text className="text-center text-sm font-medium text-destructive">{`▼ ${m}m 뒤쳐짐`}</Text>
  ) : (
    <Text className="text-center text-sm font-medium text-green-600 dark:text-green-500">{`▲ ${m}m 앞섬`}</Text>
  );
}
```

- [ ] **Step 6: 다이얼로그 마운트**

기존 `<AlertDialog open={dialog !== null} ...>` 위에:

```tsx
<GoalDialog open={goalOpen} onOpenChange={setGoalOpen} />
```

- [ ] **Step 7: 타입·린트·전체 테스트**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: 모두 PASS

- [ ] **Step 8: 커밋**

```bash
git add "app/(tabs)/index.tsx"
git commit -m "feat(goal): 홈 화면 목표 설정·실시간 편차 표시"
```

---

### Task 6: 최종 검증

- [ ] **Step 1: 전체 테스트·린트·타입 체크**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: 모두 PASS

- [ ] **Step 2: 수동 확인 체크리스트 기록**

실기기(iOS dev build)에서 확인할 항목 — 코드 리뷰어에게 전달:

1. idle 카드에 "목표 없음" + 목표 버튼 표시 → 다이얼로그에서 페이스 5'30", 거리 5.0 설정 → 요약 `5'30"/km · 5.00km`.
2. 앱 재시작 후 목표 유지(AsyncStorage 복원).
3. 러닝 시작 → 30초까지 편차 줄 없음 → 이후 걷기 수준 속도면 빨간 "▼ Nm 뒤쳐짐", 뛰면 초록 "▲ Nm 앞섬", 경계 근처 "목표 페이스 유지".
4. 일시정지 중 편차 값 고정(뒤쳐짐 증가 없음), 거리 지표 `x.xx / 5.00` 표시.
5. 목표 해제 시 기존 화면과 동일.

- [ ] **Step 3: 커밋 로그 확인**

Run: `git log --oneline main -7`
Expected: Task 1~5 커밋 5건 존재
