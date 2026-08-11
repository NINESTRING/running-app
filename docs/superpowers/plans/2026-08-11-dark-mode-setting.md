# 다크모드 설정 (로컬 저장) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 설정 화면에서 화면 모드(시스템/라이트/다크)를 선택하고 AsyncStorage에 영구 저장한다. 기존 거리 단위(km/mi)도 함께 영구 저장한다.

**Architecture:** `settingsStore`(zustand)에 zustand `persist` 미들웨어를 적용해 `theme`·`unit`을 AsyncStorage에 저장한다. 루트 레이아웃에서 NativeWind의 `colorScheme.set()`으로 저장된 테마를 적용한다. Tailwind를 class 다크모드로 전환해 수동 선택을 가능하게 한다.

**Tech Stack:** Expo SDK 57 / expo-router, NativeWind v4 (`nativewind@^4.2.6`), zustand + persist, `@react-native-async-storage/async-storage@2.2.0`, jest (`jest-expo` preset)

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-08-11-dark-mode-setting-design.md`
- UI 문구·테스트명은 한국어 (기존 관례)
- import 경로 별칭: `@/*` → `./src/*`
- 테스트 실행: `npm test` (TZ=Asia/Seoul 자동 설정), 타입 체크: `npx tsc --noEmit`
- 새 npm 의존성 추가 금지 — 필요한 패키지는 모두 설치되어 있음
- NativeWind v4 API 사실 (문서 확인 완료): `import { colorScheme } from 'nativewind'` 후 `colorScheme.set('light' | 'dark' | 'system')`. 수동 제어에는 `tailwind.config.js`의 `darkMode: 'class'`가 필수 — `'media'`인 상태에서 `colorScheme.set()` 호출 시 "Cannot manually set color scheme" 에러 발생
- AsyncStorage jest mock은 `__mocks__/@react-native-async-storage/async-storage.js`에 이미 존재 — 테스트에서 별도 mock 설정 불필요

---

### Task 1: settingsStore에 theme 추가 + persist 적용

**Files:**
- Modify: `src/stores/settingsStore.ts`
- Test: `src/stores/__tests__/settingsStore.test.ts` (신규)

**Interfaces:**
- Consumes: 없음
- Produces:
  - `export type ThemePreference = 'system' | 'light' | 'dark'`
  - `useSettingsStore` 상태: `{ unit: 'km' | 'mi'; theme: ThemePreference; setUnit(unit): void; setTheme(theme): void }`
  - persist 키: AsyncStorage의 `'settings'`, 형식 `{"state":{"unit":...,"theme":...},"version":0}`
  - `useSettingsStore.persist.hasHydrated()` / `onFinishHydration(cb)` (persist 미들웨어 제공, Task 2에서 사용)

- [ ] **Step 1: 실패하는 테스트 작성**

`src/stores/__tests__/settingsStore.test.ts` 생성:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useSettingsStore } from '../settingsStore';

// persist의 setItem은 fire-and-forget이라 마이크로태스크 큐를 비워 저장 완료를 기다린다
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('settingsStore', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useSettingsStore.setState({ unit: 'km', theme: 'system' });
  });

  test('기본값은 unit=km, theme=system이다', () => {
    expect(useSettingsStore.getState().unit).toBe('km');
    expect(useSettingsStore.getState().theme).toBe('system');
  });

  test('setTheme으로 테마를 변경한다', () => {
    useSettingsStore.getState().setTheme('dark');
    expect(useSettingsStore.getState().theme).toBe('dark');
  });

  test('setUnit으로 단위를 변경한다', () => {
    useSettingsStore.getState().setUnit('mi');
    expect(useSettingsStore.getState().unit).toBe('mi');
  });

  test('변경 사항이 AsyncStorage에 저장된다', async () => {
    useSettingsStore.getState().setTheme('dark');
    useSettingsStore.getState().setUnit('mi');
    await flush();

    const raw = await AsyncStorage.getItem('settings');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.state.theme).toBe('dark');
    expect(parsed.state.unit).toBe('mi');
  });

  test('저장된 값이 rehydrate로 복원된다', async () => {
    await AsyncStorage.setItem(
      'settings',
      JSON.stringify({ state: { unit: 'mi', theme: 'dark' }, version: 0 }),
    );

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState().unit).toBe('mi');
    expect(useSettingsStore.getState().theme).toBe('dark');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test -- src/stores/__tests__/settingsStore.test.ts`
Expected: FAIL — `theme` 프로퍼티 부재로 기본값·setTheme 테스트 실패, `useSettingsStore.persist` undefined로 rehydrate 테스트 실패

- [ ] **Step 3: settingsStore 구현**

`src/stores/settingsStore.ts` 전체를 다음으로 교체:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

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
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
```

주의: `create<SettingsState>()(persist(...))` — 미들웨어 사용 시 커리드 호출 `()()`이 zustand 타입 추론에 필요하다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- src/stores/__tests__/settingsStore.test.ts`
Expected: PASS (5개 테스트)

- [ ] **Step 5: 전체 테스트·타입 체크로 회귀 확인**

Run: `npm test && npx tsc --noEmit`
Expected: 전체 PASS. (persist 추가로 다른 스토어 테스트가 깨지지 않는지 확인)

- [ ] **Step 6: 커밋**

```bash
git add src/stores/settingsStore.ts src/stores/__tests__/settingsStore.test.ts
git commit -m "feat(settings): settingsStore에 theme 추가·AsyncStorage persist 적용"
```

---

### Task 2: class 다크모드 전환 + 루트 레이아웃에서 테마 적용

**Files:**
- Modify: `tailwind.config.js:4` (`darkMode: 'media'` → `'class'`)
- Modify: `src/global.css:29-51` (다크 변수 블록의 셀렉터 교체)
- Modify: `app/_layout.tsx`

**Interfaces:**
- Consumes: Task 1의 `useSettingsStore` (`theme` 필드, `persist.hasHydrated()`, `persist.onFinishHydration`)
- Produces: 앱 전역에서 `dark:` 변형과 CSS 변수 다크 팔레트가 저장된 테마 선택을 따름. 이후 태스크가 의존하는 새 export 없음

- [ ] **Step 1: tailwind.config.js 수정**

```js
// 변경 전
darkMode: 'media',
// 변경 후
darkMode: 'class',
```

- [ ] **Step 2: global.css 다크 변수 블록 셀렉터 교체**

`src/global.css`에서 `@media (prefers-color-scheme: dark) { :root { ... } }` 블록(29-51행)을 `.dark:root { ... }`로 교체한다. 변수 값은 그대로 유지:

```css
  .dark:root {
    --background: 0 0% 3.9%;
    --foreground: 0 0% 98%;
    --card: 0 0% 3.9%;
    --card-foreground: 0 0% 98%;
    --popover: 0 0% 3.9%;
    --popover-foreground: 0 0% 98%;
    --primary: 0 0% 98%;
    --primary-foreground: 0 0% 9%;
    --secondary: 0 0% 14.9%;
    --secondary-foreground: 0 0% 98%;
    --muted: 0 0% 14.9%;
    --muted-foreground: 0 0% 63.9%;
    --accent: 0 0% 14.9%;
    --accent-foreground: 0 0% 98%;
    --destructive: 0 70.9% 59.4%;
    --destructive-foreground: 0 0% 98%;
    --border: 0 0% 14.9%;
    --input: 0 0% 14.9%;
    --ring: 300 0% 45%;
  }
```

(`.dark:root`는 react-native-reusables/NativeWind class 다크모드의 표준 셀렉터다. `@layer base` 내부, `:root` 블록 다음에 위치.)

- [ ] **Step 3: app/_layout.tsx에 테마 적용·하이드레이션 게이트 추가**

`app/_layout.tsx` 전체를 다음으로 교체:

```tsx
import '../src/global.css';
import '../src/services/location';

import { PortalHost } from '@rn-primitives/portal';
import { Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { colorScheme as nativewindColorScheme, useColorScheme } from 'nativewind';
import { useEffect, useState } from 'react';
import { NAV_THEME } from '@/lib/theme';
import { ensureSignedIn } from '@/services/auth';
import { useSettingsStore } from '@/stores/settingsStore';

export default function RootLayout() {
  const { colorScheme } = useColorScheme();
  const scheme = colorScheme ?? 'light';
  const theme = useSettingsStore((s) => s.theme);
  // 저장된 테마를 읽기 전에 렌더하면 라이트 → 다크로 깜빡이므로 하이드레이션을 기다린다
  const [hydrated, setHydrated] = useState(useSettingsStore.persist.hasHydrated());

  useEffect(() => {
    const unsubscribe = useSettingsStore.persist.onFinishHydration(() => setHydrated(true));
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (hydrated) nativewindColorScheme.set(theme);
  }, [hydrated, theme]);

  useEffect(() => {
    ensureSignedIn().then((result) => {
      if (!result.ok) console.warn('익명 로그인 실패:', result.error);
    });
  }, []);

  if (!hydrated) return null;

  return (
    <ThemeProvider value={NAV_THEME[scheme]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="run/[id]" options={{ title: '러닝 상세' }} />
        <Stack.Screen name="changelog" options={{ title: '변경 사항' }} />
      </Stack>
      <PortalHost />
    </ThemeProvider>
  );
}
```

핵심:
- `colorScheme.set(theme)`은 `'system'`도 받는다 — 이 경우 NativeWind가 OS 설정을 따라간다.
- 기존 `useColorScheme()`은 *해석된* 스킴(light/dark)을 반환하므로 `NAV_THEME`/`StatusBar` 로직은 그대로 동작한다.
- 하이드레이션은 수 ms라 `return null` 구간은 체감되지 않는다 (초기 실행은 스플래시가 덮는다).

- [ ] **Step 4: 타입 체크·전체 테스트**

Run: `npx tsc --noEmit && npm test`
Expected: 모두 PASS

- [ ] **Step 5: 커밋**

```bash
git add tailwind.config.js src/global.css app/_layout.tsx
git commit -m "feat(theme): class 다크모드 전환·저장된 테마를 루트에서 적용"
```

---

### Task 3: 설정 화면에 "화면 모드" 섹션 추가

**Files:**
- Modify: `app/(tabs)/settings.tsx`

**Interfaces:**
- Consumes: Task 1의 `useSettingsStore` (`theme`, `setTheme`, `ThemePreference`)
- Produces: 없음 (말단 UI)

- [ ] **Step 1: 화면 모드 섹션 추가**

`app/(tabs)/settings.tsx` 전체를 다음으로 교체 (거리 단위 섹션 아래, 앱 정보 위에 추가):

```tsx
import { View } from 'react-native';

import { AccountSection } from '@/components/AccountSection';
import { AppInfoSection } from '@/components/AppInfoSection';
import { Text } from '@/components/ui/text';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useSettingsStore } from '@/stores/settingsStore';

export default function SettingsScreen() {
  const unit = useSettingsStore((s) => s.unit);
  const setUnit = useSettingsStore((s) => s.setUnit);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);

  return (
    <View className="flex-1 gap-6 bg-background p-4">
      <AccountSection />
      <View className="gap-3">
        <Text className="text-base font-semibold">거리 단위</Text>
        <ToggleGroup
          type="single"
          value={unit}
          onValueChange={(v) => {
            if (v === 'km' || v === 'mi') setUnit(v);
          }}
          className="justify-start"
        >
          <ToggleGroupItem value="km" isFirst>
            <Text>km</Text>
          </ToggleGroupItem>
          <ToggleGroupItem value="mi" isLast>
            <Text>mi</Text>
          </ToggleGroupItem>
        </ToggleGroup>
      </View>
      <View className="gap-3">
        <Text className="text-base font-semibold">화면 모드</Text>
        <ToggleGroup
          type="single"
          value={theme}
          onValueChange={(v) => {
            if (v === 'system' || v === 'light' || v === 'dark') setTheme(v);
          }}
          className="justify-start"
        >
          <ToggleGroupItem value="system" isFirst>
            <Text>시스템</Text>
          </ToggleGroupItem>
          <ToggleGroupItem value="light">
            <Text>라이트</Text>
          </ToggleGroupItem>
          <ToggleGroupItem value="dark" isLast>
            <Text>다크</Text>
          </ToggleGroupItem>
        </ToggleGroup>
      </View>
      <AppInfoSection />
    </View>
  );
}
```

주의: 가운데 항목(라이트)에는 `isFirst`/`isLast`를 주지 않는다 (거리 단위 2버튼 패턴과 동일한 컴포넌트의 3버튼 확장).

- [ ] **Step 2: 타입 체크·전체 테스트**

Run: `npx tsc --noEmit && npm test`
Expected: 모두 PASS

- [ ] **Step 3: 커밋**

```bash
git add "app/(tabs)/settings.tsx"
git commit -m "feat(settings): 화면 모드(시스템/라이트/다크) 선택 섹션 추가"
```

---

### Task 4: 실기기/시뮬레이터 수동 검증

**Files:** 없음 (검증만)

**Interfaces:**
- Consumes: Task 1–3 전체
- Produces: 없음

- [ ] **Step 1: 앱 실행 후 수동 확인**

dev build 실행 (`npx expo start`) 후:

1. 설정 탭 → 화면 모드 → "다크" 선택 → 전체 UI(배경·텍스트·내비게이션 헤더·상태바)가 즉시 어두워지는지
2. 앱 완전 종료 후 재실행 → 다크가 유지되는지 (persist 검증)
3. "시스템" 선택 → OS 다크모드 설정을 따라가는지
4. "라이트" 고정 → OS가 다크여도 라이트 유지되는지
5. 거리 단위 mi 선택 → 재시작 후 유지되는지

Expected: 5개 모두 정상. 문제 발견 시 superpowers:systematic-debugging으로 진단.
