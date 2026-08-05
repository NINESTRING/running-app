# React Native Reusables 도입 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱 전체 UI를 React Native Reusables(RNR) + NativeWind 기반으로 전환하고, 시스템 설정을 따르는 라이트/다크 모드를 지원한다.

**Architecture:** RNR 공식 CLI로 NativeWind를 셋업하고 컴포넌트 소스를 `src/components/ui/`에 복사(shadcn 모델)한 뒤, 5개 화면(홈·기록·통계·설정·러닝 상세)의 StyleSheet를 RNR 컴포넌트 + Tailwind 클래스로 교체한다. 지도(react-native-maps)와 차트(Skia/victory-native)는 내부 구현을 유지하고 감싸는 레이아웃만 전환한다.

**Tech Stack:** Expo SDK 57, expo-router, React Native 0.86, NativeWind v4+, Tailwind CSS, React Native Reusables CLI, Jest(jest-expo)

**Spec:** `docs/superpowers/specs/2026-08-05-react-native-reusables-design.md`

## Global Constraints

- **코드 작성 전 Expo v57 문서 확인 필수** (AGENTS.md): https://docs.expo.dev/versions/v57.0.0/ — 특히 NativeWind 관련 설정이 이 버전과 다르면 문서가 우선한다.
- RNR 문서: https://reactnativereusables.com/docs — CLI 명령·컴포넌트 API가 아래 계획과 다르면 문서/CLI 생성 결과가 우선한다. 이 계획의 설정 파일 코드 블록은 검증용 기준값이다.
- React Native 의존성 설치는 반드시 `npx expo install` 사용 (버전 호환성 보장).
- 한국어 UI 문구는 아래 코드에 있는 그대로 유지한다 (임의 변경 금지).
- 경로 별칭 `@/*` → `./src/*` 는 tsconfig.json에 이미 존재한다.
- 검증 명령: `npm test` (TZ 고정 Jest), `npx tsc --noEmit` (타입체크).
- 지도/차트 내부 구현(`RouteMap*.tsx`, `WeeklyBarChart*.tsx`) 변경 금지.
- 각 태스크 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 추가.

---

### Task 1: 미커밋 작업 정리 커밋

작업 트리에 이전 세션의 웹 지원 작업이 미커밋 상태로 남아 있다 (`app/(tabs)/stats.tsx` 수정, `src/components/RouteMap.web.tsx`·`WeeklyBarChart.tsx`·`WeeklyBarChart.web.tsx` 신규). 마이그레이션이 `stats.tsx`를 덮어쓰므로 먼저 보존 커밋한다.

**Files:**
- Commit: `app/(tabs)/stats.tsx`, `src/components/RouteMap.web.tsx`, `src/components/WeeklyBarChart.tsx`, `src/components/WeeklyBarChart.web.tsx`

**Interfaces:**
- Consumes: 없음
- Produces: 깨끗한 작업 트리 (이후 태스크의 diff가 마이그레이션 변경만 담게 됨)

- [ ] **Step 1: 상태 확인**

Run: `git status --short`
Expected: 위 4개 파일만 표시 (M 1개, ?? 3개)

- [ ] **Step 2: 테스트로 현재 상태 확인**

Run: `npm test`
Expected: 전부 PASS

- [ ] **Step 3: 커밋**

```bash
git add "app/(tabs)/stats.tsx" src/components/RouteMap.web.tsx src/components/WeeklyBarChart.tsx src/components/WeeklyBarChart.web.tsx
git commit -m "feat(web): 주간 차트/지도 웹 대체 컴포넌트"
```

---

### Task 2: NativeWind + RNR 기반 셋업 (CLI init)

**Files:**
- Create: `tailwind.config.js`, `babel.config.js`, `metro.config.js`, `components.json` (CLI 생성), `src/lib/utils.ts` (CLI 생성, `cn` 유틸)
- Modify: `src/global.css`, `package.json` (의존성, jest transformIgnorePatterns)

**Interfaces:**
- Consumes: 없음
- Produces: Tailwind 클래스가 동작하는 빌드 파이프라인, `cn(...classes: ClassValue[]): string` (`@/lib/utils`), RNR 테마 CSS 변수(`--background`, `--foreground`, `--primary`, `--muted-foreground`, `--destructive`, `--border` 등 라이트/다크 세트)

- [ ] **Step 1: 문서 확인**

https://docs.expo.dev/versions/v57.0.0/ 와 https://reactnativereusables.com/docs/installation 를 읽고 아래 명령·설정이 현재 버전과 맞는지 확인한다. 다르면 문서를 따른다.

- [ ] **Step 2: RNR CLI init 실행**

Run: `npx react-native-reusables@latest init -y`
Expected: nativewind/tailwindcss 등 의존성 설치, 설정 파일 생성. 프롬프트가 나오면 컴포넌트 경로는 `src/components/ui`, CSS는 `src/global.css` 기준으로 답한다.

CLI가 기존 프로젝트를 지원하지 않거나 실패하면 수동 셋업으로 대체한다:

```bash
npx expo install nativewind tailwindcss react-native-css-interop
npx expo install tailwindcss-animate class-variance-authority clsx tailwind-merge @rn-primitives/portal
```

- [ ] **Step 3: 설정 파일 검증/보정**

CLI 생성 파일을 우선하되, 아래 불변 조건을 확인하고 어긋나면 맞춘다.

`metro.config.js` — CSS 입력 경로가 `./src/global.css`이고 `inlineRem: 16` 포함:

```js
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, {
  input: './src/global.css',
  inlineRem: 16,
});
```

`babel.config.js`:

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
  };
};
```

`tailwind.config.js` — `content`에 `./app/**/*.{ts,tsx}`와 `./src/**/*.{ts,tsx}` 포함, nativewind preset, 테마 색 토큰:

```js
const { hairlineWidth } = require('nativewind/theme');

module.exports = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderWidth: { hairline: hairlineWidth() },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
```

- [ ] **Step 4: global.css 병합**

`src/global.css`를 다음으로 교체한다. RNR 테마 변수(CLI가 생성했다면 그 값 우선)에 **기존 폰트 변수를 반드시 보존**한다:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 0 0% 3.9%;
    --card: 0 0% 100%;
    --card-foreground: 0 0% 3.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 0 0% 3.9%;
    --primary: 0 0% 9%;
    --primary-foreground: 0 0% 98%;
    --secondary: 0 0% 96.1%;
    --secondary-foreground: 0 0% 9%;
    --muted: 0 0% 96.1%;
    --muted-foreground: 0 0% 45.1%;
    --accent: 0 0% 96.1%;
    --accent-foreground: 0 0% 9%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 0 0% 98%;
    --border: 0 0% 89.8%;
    --input: 0 0% 89.8%;
    --ring: 0 0% 63%;
    --radius: 0.625rem;
  }

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
}

:root {
  --font-display:
    Spline Sans, Inter, ui-sans-serif, system-ui, sans-serif, Apple Color Emoji, Segoe UI Emoji,
    Segoe UI Symbol, Noto Color Emoji;
  --font-mono:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace;
  --font-rounded: 'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif;
  --font-serif: Georgia, 'Times New Roman', serif;
}
```

- [ ] **Step 5: jest 설정 보정**

`package.json`의 `jest.transformIgnorePatterns` 정규식 끝부분 `|zustand)` 를 `|zustand|nativewind|react-native-css-interop)` 으로 확장한다.

- [ ] **Step 6: 검증**

Run: `npx tsc --noEmit && npm test`
Expected: 타입 에러 0, 테스트 전부 PASS

Run: `npx expo start` 후 iOS 시뮬레이터(또는 웹)에서 앱 부팅 확인
Expected: 기존 화면이 그대로 뜬다 (아직 스타일 변화 없음)

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "chore: NativeWind + React Native Reusables 기반 셋업"
```

---

### Task 3: 테마 프로바이더 · 다크 모드 · 내비게이션 테마

**Files:**
- Create: `src/lib/theme.ts`
- Modify: `app/_layout.tsx`, `app/(tabs)/_layout.tsx`

**Interfaces:**
- Consumes: Task 2의 global.css 테마 변수, `nativewind`의 `useColorScheme`
- Produces: `NAV_THEME: Record<'light' | 'dark', Theme>` (`@/lib/theme`) — react-navigation 테마 객체. 루트에 `PortalHost` 장착 (Task 4 alert-dialog가 의존)

- [ ] **Step 1: 테마 상수 작성**

CLI init이 이미 동등한 테마 파일을 생성했다면 그 파일을 쓰고 이 스텝은 건너뛴다. 없으면 `src/lib/theme.ts` 생성 (색상은 global.css 변수와 동일 값):

```ts
import { DarkTheme, DefaultTheme, type Theme } from '@react-navigation/native';

export const NAV_THEME: Record<'light' | 'dark', Theme> = {
  light: {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: 'hsl(0 0% 100%)',
      border: 'hsl(0 0% 89.8%)',
      card: 'hsl(0 0% 100%)',
      notification: 'hsl(0 84.2% 60.2%)',
      primary: 'hsl(0 0% 9%)',
      text: 'hsl(0 0% 3.9%)',
    },
  },
  dark: {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      background: 'hsl(0 0% 3.9%)',
      border: 'hsl(0 0% 14.9%)',
      card: 'hsl(0 0% 3.9%)',
      notification: 'hsl(0 70.9% 59.4%)',
      primary: 'hsl(0 0% 98%)',
      text: 'hsl(0 0% 98%)',
    },
  },
};
```

`@react-navigation/native`가 package.json 직접 의존성에 없으면 `npx expo install @react-navigation/native` 로 추가한다.

- [ ] **Step 2: 루트 레이아웃 교체**

`app/_layout.tsx`:

```tsx
import '../src/global.css';
import '../src/services/location';

import { ThemeProvider } from '@react-navigation/native';
import { PortalHost } from '@rn-primitives/portal';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import { NAV_THEME } from '@/lib/theme';

export default function RootLayout() {
  const { colorScheme } = useColorScheme();
  const scheme = colorScheme ?? 'light';

  return (
    <ThemeProvider value={NAV_THEME[scheme]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="run/[id]" options={{ title: '러닝 상세' }} />
      </Stack>
      <PortalHost />
    </ThemeProvider>
  );
}
```

주의: `app.json`의 `userInterfaceStyle`은 이미 `"automatic"` 이므로 손대지 않는다.

- [ ] **Step 3: 탭 레이아웃에서 하드코딩 색 제거**

`app/(tabs)/_layout.tsx`에서 `screenOptions={{ tabBarActiveTintColor: '#3b82f6' }}` 를 `screenOptions={{}}` 없이 `<Tabs>` 로 바꾼다 (ThemeProvider의 primary가 활성 탭 색이 됨). 나머지 탭 정의는 그대로.

- [ ] **Step 4: 검증**

Run: `npx tsc --noEmit && npm test`
Expected: PASS

수동: iOS 시뮬레이터에서 앱 실행 → 시뮬레이터 다크 모드 토글(⇧⌘A) → 헤더/탭 바 색이 라이트/다크로 전환되는지 확인.

- [ ] **Step 5: 커밋**

```bash
git add app/_layout.tsx "app/(tabs)/_layout.tsx" src/lib/theme.ts package.json package-lock.json
git commit -m "feat(theme): RNR 테마 프로바이더 및 시스템 다크 모드 연동"
```

---

### Task 4: RNR 컴포넌트 추가

**Files:**
- Create: `src/components/ui/text.tsx`, `button.tsx`, `card.tsx`, `separator.tsx`, `toggle-group.tsx`, `skeleton.tsx`, `alert-dialog.tsx` (+ CLI가 끌어오는 의존 파일)

**Interfaces:**
- Consumes: Task 2의 `cn`, Task 3의 `PortalHost`
- Produces (이후 태스크가 사용하는 API):
  - `Text` (`@/components/ui/text`) — RN Text 대체, `className` 지원
  - `Button` (`@/components/ui/button`) — `variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link'`, `size: 'default' | 'sm' | 'lg' | 'icon'`, `onPress`; 자식으로 `<Text>` 사용
  - `Card, CardHeader, CardTitle, CardContent` (`@/components/ui/card`)
  - `Separator` (`@/components/ui/separator`)
  - `ToggleGroup, ToggleGroupItem` (`@/components/ui/toggle-group`) — `type="single"`, `value: string | undefined`, `onValueChange(v: string | undefined)`
  - `Skeleton` (`@/components/ui/skeleton`)
  - `AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel` (`@/components/ui/alert-dialog`) — `open: boolean`, `onOpenChange(open: boolean)` 제어 컴포넌트

- [ ] **Step 1: CLI로 컴포넌트 추가**

Run: `npx react-native-reusables@latest add text button card separator toggle-group skeleton alert-dialog -y`
Expected: `src/components/ui/` 아래 7개 컴포넌트 + peer 의존성(@rn-primitives/*) 설치

- [ ] **Step 2: 검증**

Run: `npx tsc --noEmit && npm test`
Expected: PASS. 실제 export 이름/시그니처가 위 Produces와 다르면 **이 계획의 이후 태스크 코드를 실제 API에 맞춰 조정**하고, 차이를 태스크 완료 보고에 남긴다.

- [ ] **Step 3: 커밋**

```bash
git add -A
git commit -m "feat(ui): RNR 컴포넌트 추가 (text/button/card/separator/toggle-group/skeleton/alert-dialog)"
```

---

### Task 5: 설정 화면 마이그레이션

**Files:**
- Modify: `app/(tabs)/settings.tsx` (전체 교체)

**Interfaces:**
- Consumes: `Text`, `ToggleGroup`, `ToggleGroupItem` (Task 4), `useSettingsStore` (기존 — `unit: 'km' | 'mi'`, `setUnit(u: 'km' | 'mi')`)
- Produces: 없음 (말단 화면)

- [ ] **Step 1: 화면 교체**

```tsx
import { View } from 'react-native';
import { Text } from '@/components/ui/text';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useSettingsStore } from '@/stores/settingsStore';

export default function SettingsScreen() {
  const unit = useSettingsStore((s) => s.unit);
  const setUnit = useSettingsStore((s) => s.setUnit);

  return (
    <View className="flex-1 gap-3 bg-background p-4">
      <Text className="text-base font-semibold">거리 단위</Text>
      <ToggleGroup
        type="single"
        value={unit}
        onValueChange={(v) => {
          if (v === 'km' || v === 'mi') setUnit(v);
        }}
        className="justify-start"
      >
        <ToggleGroupItem value="km">
          <Text>km</Text>
        </ToggleGroupItem>
        <ToggleGroupItem value="mi">
          <Text>mi</Text>
        </ToggleGroupItem>
      </ToggleGroup>
    </View>
  );
}
```

주의: `onValueChange`는 이미 선택된 항목을 다시 누르면 `undefined`를 넘긴다 — 가드 덕에 선택 해제가 불가능해야 한다(km/mi 중 하나는 항상 선택).

- [ ] **Step 2: 검증**

Run: `npx tsc --noEmit && npm test`
Expected: PASS

수동: 설정 탭에서 km/mi 전환 → 홈·기록 화면 단위 표시가 바뀌는지, 선택 항목 재탭 시 해제되지 않는지, 다크 모드 확인.

- [ ] **Step 3: 커밋**

```bash
git add "app/(tabs)/settings.tsx"
git commit -m "feat(settings): RNR ToggleGroup으로 마이그레이션"
```

---

### Task 6: 기록(히스토리) 화면 마이그레이션

**Files:**
- Modify: `app/(tabs)/history.tsx` (전체 교체)

**Interfaces:**
- Consumes: `Text`, `Separator`, `Skeleton` (Task 4), 기존 `listRuns(): Promise<RunRecord[]>`, `formatDistance`, `formatDuration`, `useSettingsStore`
- Produces: 없음

동작 변경 1건(스펙 승인 범위): 로딩 중 상태를 `runs === null`로 구분해 Skeleton을 표시한다. 기존에는 로딩 중에도 "기록이 없습니다"가 잠깐 보였다.

- [ ] **Step 1: 화면 교체**

```tsx
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { formatDistance, formatDuration } from '@/lib/geo';
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

- [ ] **Step 2: 검증**

Run: `npx tsc --noEmit && npm test`
Expected: PASS

수동: 기록 탭 진입 시 Skeleton → 목록 순서로 보이는지, 항목 탭 → 상세 이동, 빈 목록/미설정 상태 문구, 다크 모드 확인.

- [ ] **Step 3: 커밋**

```bash
git add "app/(tabs)/history.tsx"
git commit -m "feat(history): RNR 컴포넌트로 마이그레이션 및 로딩 스켈레톤 추가"
```

---

### Task 7: 통계 화면 마이그레이션

**Files:**
- Modify: `app/(tabs)/stats.tsx` (전체 교체 — Task 1에서 커밋한 최신 버전 기준)

**Interfaces:**
- Consumes: `Text`, `Card`, `CardHeader`, `CardTitle`, `CardContent` (Task 4), 기존 `WeeklyBarChart`, `weeklyDistances`, `listRuns`
- Produces: 없음

- [ ] **Step 1: 화면 교체**

기존 `useFocusEffect` 데이터 로딩 로직(취소 가드 포함)은 그대로 유지하고 렌더 부분만 교체:

```tsx
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { WeeklyBarChart } from '@/components/WeeklyBarChart';
import { weeklyDistances } from '@/lib/stats';
import { listRuns } from '@/services/runs';

export default function StatsScreen() {
  const [data, setData] = useState(() => weeklyDistances([], new Date()));

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      listRuns().then((runs) => {
        if (!cancelled) setData(weeklyDistances(runs, new Date()));
      });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  return (
    <View className="flex-1 bg-background p-4">
      <Card>
        <CardHeader>
          <CardTitle>이번 주 거리 (km)</CardTitle>
        </CardHeader>
        <CardContent className="gap-2">
          <View className="h-60">
            <WeeklyBarChart data={data} />
          </View>
          <View className="flex-row justify-around">
            {data.map((d) => (
              <Text key={d.day} className="text-xs text-muted-foreground">
                {d.day}
              </Text>
            ))}
          </View>
        </CardContent>
      </Card>
    </View>
  );
}
```

주의: Task 1에서 커밋된 stats.tsx가 위 기준 코드와 다르면(웹 지원 변경분) **데이터/분기 로직은 커밋본을 따르고 스타일링만 교체**한다. `WeeklyBarChart` 내부는 변경 금지.

- [ ] **Step 2: 검증**

Run: `npx tsc --noEmit && npm test`
Expected: PASS (stats 관련 테스트 포함)

수동: 통계 탭에서 차트가 Card 안에 렌더되는지, 요일 라벨 정렬, 다크 모드에서 Card 배경 전환 확인.

- [ ] **Step 3: 커밋**

```bash
git add "app/(tabs)/stats.tsx"
git commit -m "feat(stats): RNR Card로 마이그레이션"
```

---

### Task 8: 러닝 상세 화면 마이그레이션

**Files:**
- Modify: `app/run/[id].tsx` (전체 교체)

**Interfaces:**
- Consumes: `Text` (Task 4), 기존 `RouteMap`, `getRun(id: string): Promise<RunRecord | null>`, `formatDistance`, `formatDuration`, `formatPace`, `paceSecPerKm`, `useSettingsStore`
- Produces: 없음

- [ ] **Step 1: 화면 교체**

```tsx
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/ui/text';
import { RouteMap } from '@/components/RouteMap';
import { formatDistance, formatDuration, formatPace, paceSecPerKm } from '@/lib/geo';
import { getRun } from '@/services/runs';
import { useSettingsStore } from '@/stores/settingsStore';
import type { RoutePoint, RunRecord } from '@/types/run';

export default function RunDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [run, setRun] = useState<RunRecord | null>(null);
  const unit = useSettingsStore((s) => s.unit);

  useEffect(() => {
    let cancelled = false;
    if (id) {
      getRun(id).then((r) => {
        if (!cancelled) setRun(r);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!run) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-muted-foreground">기록을 불러오는 중이거나 찾을 수 없습니다.</Text>
      </View>
    );
  }

  const points: RoutePoint[] =
    run.routeGeojson?.coordinates.map(([lon, lat]) => ({
      latitude: lat,
      longitude: lon,
      timestamp: 0,
    })) ?? [];

  return (
    <View className="flex-1 bg-background">
      <View className="flex-1">
        <RouteMap points={points} />
      </View>
      <View className="gap-2 p-4">
        <Text className="text-base font-semibold">
          {new Date(run.startedAt).toLocaleString('ko-KR')}
        </Text>
        <Text className="text-muted-foreground">
          {formatDistance(run.distanceM, unit)}{unit} ·{' '}
          {formatDuration(run.durationSec * 1000)} ·{' '}
          {formatPace(paceSecPerKm(run.distanceM, run.durationSec * 1000))}
        </Text>
      </View>
    </View>
  );
}
```

- [ ] **Step 2: 검증**

Run: `npx tsc --noEmit && npm test`
Expected: PASS

수동: 기록 탭 → 항목 탭 → 지도 + 요약이 뜨는지, 다크 모드 확인.

- [ ] **Step 3: 커밋**

```bash
git add "app/run/[id].tsx"
git commit -m "feat(run-detail): RNR 컴포넌트로 마이그레이션"
```

---

### Task 9: 홈 화면 마이그레이션 (Button · Card · AlertDialog)

**Files:**
- Modify: `app/(tabs)/index.tsx` (전체 교체)

**Interfaces:**
- Consumes: `Text`, `Button`, `Card`, `CardContent`, `AlertDialog` 계열 (Task 4), 기존 `RouteMap`, `useRunStore`/`elapsedMs`, `useSettingsStore`, `requestPermissions`/`startTracking`/`stopTracking`, `saveRun`, `formatDistance`/`formatDuration`/`formatPace`/`paceSecPerKm`
- Produces: 없음

동작 유지, 표현만 교체: `Alert.alert` 3종(시작 실패, 저장 완료, 저장 실패 선택지)을 하나의 제어형 `AlertDialog`로 대체한다. 저장 실패 시 "유지"(닫기)와 "버리기"(reset) 선택지는 기존과 동일하게 동작해야 한다.

- [ ] **Step 1: 화면 교체**

```tsx
import { useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { RouteMap } from '@/components/RouteMap';
import { formatDistance, formatDuration, formatPace, paceSecPerKm } from '@/lib/geo';
import { requestPermissions, startTracking, stopTracking } from '@/services/location';
import { saveRun } from '@/services/runs';
import { useSettingsStore } from '@/stores/settingsStore';
import { elapsedMs, useRunStore } from '@/stores/runStore';

type DialogState =
  | { type: 'startError'; message: string }
  | { type: 'saved' }
  | { type: 'saveError'; message: string }
  | null;

export default function HomeScreen() {
  const status = useRunStore((s) => s.status);
  const points = useRunStore((s) => s.points);
  const distanceM = useRunStore((s) => s.distanceM);
  const accumulatedMs = useRunStore((s) => s.accumulatedMs);
  const segmentStartedAt = useRunStore((s) => s.segmentStartedAt);
  const unit = useSettingsStore((s) => s.unit);
  const [now, setNow] = useState(() => Date.now());
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);

  useEffect(() => {
    if (status !== 'running') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status]);

  const elapsed = elapsedMs({ accumulatedMs, segmentStartedAt }, now);

  const onStart = async () => {
    const granted = await requestPermissions();
    if (!granted) {
      setPermissionDenied(true);
      return;
    }
    setPermissionDenied(false);
    try {
      await startTracking();
    } catch (e) {
      setDialog({
        type: 'startError',
        message: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    useRunStore.getState().start(Date.now());
    setNow(Date.now());
  };

  const onPause = () => useRunStore.getState().pause(Date.now());

  const onResume = () => {
    useRunStore.getState().resume(Date.now());
    setNow(Date.now());
  };

  const onStop = async () => {
    if (useRunStore.getState().status === 'running') {
      useRunStore.getState().pause(Date.now());
    }
    try {
      await stopTracking();
    } catch {
      // 추적 중지 실패해도 이후 기록 저장 로직은 계속 진행
    }
    const s = useRunStore.getState();
    const stoppedAt = Date.now();
    const durationSec = Math.round(elapsedMs(s, 0) / 1000);
    const result = await saveRun({
      startedAt: s.startedAt ?? stoppedAt,
      durationSec,
      distanceM: s.distanceM,
      points: s.points,
    });
    if (result.ok) {
      useRunStore.getState().reset();
      setDialog({ type: 'saved' });
    } else {
      setDialog({ type: 'saveError', message: result.error });
    }
  };

  return (
    <View className="flex-1">
      <RouteMap points={points} showsUserLocation />
      <Card className="absolute inset-x-4 bottom-6">
        <CardContent className="gap-3 p-4">
          {permissionDenied && (
            <Pressable onPress={() => Linking.openSettings()}>
              <Text className="text-center text-destructive">
                위치 권한이 필요합니다. 눌러서 설정 열기
              </Text>
            </Pressable>
          )}
          <View className="flex-row justify-around">
            <Metric label={`거리(${unit})`} value={formatDistance(distanceM, unit)} />
            <Metric label="시간" value={formatDuration(elapsed)} />
            <Metric label="페이스" value={formatPace(paceSecPerKm(distanceM, elapsed))} />
          </View>
          <View className="flex-row justify-center gap-3">
            {status === 'idle' && (
              <Button size="lg" onPress={onStart}>
                <Text>시작</Text>
              </Button>
            )}
            {status === 'running' && (
              <>
                <Button size="lg" variant="secondary" onPress={onPause}>
                  <Text>일시정지</Text>
                </Button>
                <Button size="lg" variant="destructive" onPress={onStop}>
                  <Text>종료</Text>
                </Button>
              </>
            )}
            {status === 'paused' && (
              <>
                <Button size="lg" onPress={onResume}>
                  <Text>재개</Text>
                </Button>
                <Button size="lg" variant="destructive" onPress={onStop}>
                  <Text>종료</Text>
                </Button>
              </>
            )}
          </View>
        </CardContent>
      </Card>

      <AlertDialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <AlertDialogContent>
          {dialog?.type === 'saved' && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>저장 완료</AlertDialogTitle>
                <AlertDialogDescription>기록 탭에서 확인하세요.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogAction onPress={() => setDialog(null)}>
                  <Text>확인</Text>
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
          {dialog?.type === 'startError' && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>추적을 시작하지 못했습니다</AlertDialogTitle>
                <AlertDialogDescription>{dialog.message}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogAction onPress={() => setDialog(null)}>
                  <Text>확인</Text>
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
          {dialog?.type === 'saveError' && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>저장하지 못했습니다</AlertDialogTitle>
                <AlertDialogDescription>
                  {dialog.message}
                  {'\n'}기록을 버릴까요?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onPress={() => setDialog(null)}>
                  <Text>유지</Text>
                </AlertDialogCancel>
                <AlertDialogAction
                  onPress={() => {
                    useRunStore.getState().reset();
                    setDialog(null);
                  }}
                >
                  <Text>버리기</Text>
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View className="items-center">
      <Text className="text-2xl font-bold">{value}</Text>
      <Text className="text-xs text-muted-foreground">{label}</Text>
    </View>
  );
}
```

주의: RNR `alert-dialog`는 @rn-primitives 기반이라 Trigger 없이 제어형(`open`/`onOpenChange`)을 지원한다. 확신이 없으면 구현 전에 `src/components/ui/alert-dialog.tsx`의 Root prop 타입을 확인하고, prop 이름이 다르면 그에 맞춘다.

- [ ] **Step 2: 검증**

Run: `npx tsc --noEmit && npm test`
Expected: PASS

수동 (iOS 시뮬레이터, 위치 시뮬레이션 켜기):
1. 시작 → 일시정지 → 재개 → 종료 흐름에서 버튼 상태 전환 확인
2. 종료 후 "저장 완료" 다이얼로그 → 확인 → 메트릭 리셋 확인
3. Supabase 미설정(.env 제거) 상태로 종료 → "저장하지 못했습니다" 다이얼로그에서 "유지" 시 기록 유지, "버리기" 시 리셋 확인
4. 다크 모드에서 Card/다이얼로그 확인

- [ ] **Step 3: 커밋**

```bash
git add "app/(tabs)/index.tsx"
git commit -m "feat(home): RNR Button/Card/AlertDialog로 마이그레이션"
```

---

### Task 10: 최종 정리 및 전체 검증

**Files:**
- Verify: `app/**`, `src/components/ui/**`
- Modify: 잔여 StyleSheet/미사용 import 발견 시 해당 파일

**Interfaces:**
- Consumes: Task 1~9 전부
- Produces: 완료된 마이그레이션

- [ ] **Step 1: 잔여 StyleSheet 검사**

Run: `grep -rn "StyleSheet" app/`
Expected: 출력 없음. (`src/components/RouteMap*.tsx`의 StyleSheet는 범위 밖 — 그대로 둔다)

Run: `grep -rn "Alert" app/`
Expected: 출력 없음 (Alert.alert 전부 제거됨)

- [ ] **Step 2: 전체 검증**

Run: `npx tsc --noEmit && npm test && npx expo lint`
Expected: 전부 PASS (lint 에러 0)

- [ ] **Step 3: 수동 통합 확인**

- iOS 시뮬레이터: 5개 화면 순회, 라이트/다크 각각
- `npm run web`: 5개 화면 순회 (지도/차트는 .web 대체 컴포넌트로 렌더)

- [ ] **Step 4: 커밋 (잔여 수정이 있었다면)**

```bash
git add -A
git commit -m "chore: RNR 마이그레이션 마무리 정리"
```
