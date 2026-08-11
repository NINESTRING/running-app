# 앱 버전 표시 + 버전 이력 DB 보관 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 설정 페이지에 앱 버전을 표시하고, Supabase의 `app_versions` 테이블과 비교해 "새 버전 있음" 배지를 보여주며, 버전별 변경 사항 화면을 제공한다.

**Architecture:** Supabase에 읽기 전용 `app_versions` 테이블을 추가한다. 앱은 `expo-application`으로 설치된 버전을 읽고, 순수 함수 `compareSemver`로 DB 최신 버전과 비교한다. 설정 페이지의 "앱 정보" 섹션에서 버전과 배지를 보여주고, 누르면 `app/changelog.tsx` 화면으로 이동한다.

**Tech Stack:** Expo SDK 57 (expo-router, expo-application, expo-constants), Supabase (RLS, 생성 타입), NativeWind, jest-expo

**스펙:** `docs/superpowers/specs/2026-08-11-app-version-changelog-design.md`

## Global Constraints

- Expo 코드를 작성하기 전에 반드시 해당 버전 문서를 확인한다: https://docs.expo.dev/versions/v57.0.0/ (AGENTS.md 규칙)
- 사용자 노출 문구·주석·커밋 메시지는 한국어, 커밋은 conventional commits 형식 (예: `feat(settings): ...`)
- Supabase 클라이언트(`src/services/supabase.ts`의 `supabase`)는 `null`일 수 있다 — 모든 서비스 함수는 null 가드 + try/catch로 조용히 실패한다 (`src/services/runs.ts` 패턴)
- 테스트: `npm test` (TZ=Asia/Seoul jest), 린트: `npm run lint`, 타입 체크: `npx tsc --noEmit`
- 원격 Supabase 프로젝트: `hytckdlqvfmrqpocgzin` (이미 링크됨). 마이그레이션 적용은 `npx supabase db push`, 타입 재생성은 `npm run gen:types`

---

### Task 1: `app_versions` 테이블 마이그레이션 + 타입 재생성 + 릴리스 절차 문서화

**Files:**
- Create: `supabase/migrations/20260811000000_app_versions.sql`
- Modify: `src/types/database.types.ts` (자동 생성 — `npm run gen:types`로 갱신)
- Modify: `README.md` (릴리스 절차 추가)

**Interfaces:**
- Produces: `public.app_versions` 테이블 (`version text pk`, `notes text not null`, `released_at timestamptz not null default now()`), 생성 타입 `Tables<'app_versions'>` → `{ version: string; notes: string; released_at: string }`

- [ ] **Step 1: 마이그레이션 파일 작성**

`supabase/migrations/20260811000000_app_versions.sql`:

```sql
-- 앱 버전 이력: 설정 페이지의 버전 비교·변경 사항 표시에 사용
create table public.app_versions (
  version text primary key,
  notes text not null,
  released_at timestamptz not null default now()
);

alter table public.app_versions enable row level security;

-- 버전 정보는 공개 데이터 — 로그인 전(anon)에도 조회 가능해야 배지 표시가 로그인 완료를 기다리지 않음
create policy "누구나 버전 조회" on public.app_versions
  for select to anon, authenticated using (true);

-- insert/update/delete 정책 없음: 버전 등록은 마이그레이션 또는 대시보드(service role)에서만

-- E'...' 문자열이라야 \n이 실제 줄바꿈으로 저장됨 (일반 '...'에서는 문자 그대로 저장)
insert into public.app_versions (version, notes) values
  ('1.0.0', E'첫 릴리스\n- 러닝 기록·지도·통계\n- 익명/구글 로그인');
```

- [ ] **Step 2: 원격에 적용**

Run: `npx supabase db push`
Expected: `20260811000000_app_versions.sql` 적용 성공 메시지

- [ ] **Step 3: 타입 재생성 및 확인**

Run: `npm run gen:types && grep -A 8 "app_versions" src/types/database.types.ts | head -20`
Expected: `app_versions` 아래 `Row: { notes: string; released_at: string; version: string }` 형태가 보임

- [ ] **Step 4: 시드 데이터 확인**

Run: `npx supabase db pull --dry-run 2>/dev/null; echo "select * from public.app_versions;" | npx supabase db query 2>/dev/null || true`

`supabase db query`가 없는 CLI 버전이면 Supabase MCP의 `execute_sql`로 `select * from public.app_versions;`를 실행해 `1.0.0` 행과 `notes`에 실제 줄바꿈이 들어갔는지 확인한다.
Expected: `1.0.0` 행 1건

- [ ] **Step 5: README에 릴리스 절차 추가**

`README.md` 끝에 추가:

```markdown
## 릴리스 절차

새 버전을 낼 때마다:

1. `app.json`의 `expo.version`을 올린다.
2. `app_versions` 테이블에 새 행을 추가한다 (마이그레이션 파일 또는 Supabase 대시보드).
   - `version`: app.json과 동일한 semver 문자열
   - `notes`: 변경 사항 (줄바꿈으로 항목 구분)
```

- [ ] **Step 6: 커밋**

```bash
git add supabase/migrations/20260811000000_app_versions.sql src/types/database.types.ts README.md
git commit -m "feat(db): app_versions 테이블 추가 — 버전 이력·변경 사항 보관"
```

---

### Task 2: 버전 비교·읽기 유틸 (`src/lib/version.ts`)

**Files:**
- Create: `src/lib/version.ts`
- Test: `src/lib/__tests__/version.test.ts`

**Interfaces:**
- Produces:
  - `compareSemver(a: string, b: string): number` — a<b → -1, a===b → 0, a>b → 1
  - `getInstalledVersion(): string | null` — 네이티브는 바이너리 버전, 웹은 app.json 버전

- [ ] **Step 1: expo-application 설치**

Run: `npx expo install expo-application`
Expected: package.json dependencies에 `expo-application` 추가됨

- [ ] **Step 2: 실패하는 테스트 작성**

`src/lib/__tests__/version.test.ts`:

```ts
import { compareSemver } from '../version';

describe('compareSemver', () => {
  it('낮은 버전이면 -1', () => {
    expect(compareSemver('1.0.0', '1.1.0')).toBe(-1);
    expect(compareSemver('1.9.0', '2.0.0')).toBe(-1);
  });

  it('같은 버전이면 0', () => {
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
  });

  it('높은 버전이면 1', () => {
    expect(compareSemver('2.0.0', '1.9.9')).toBe(1);
  });

  it('두 자리 숫자를 문자열이 아닌 숫자로 비교', () => {
    expect(compareSemver('1.10.0', '1.9.0')).toBe(1);
  });

  it('자릿수가 달라도 비교 가능', () => {
    expect(compareSemver('1.0', '1.0.0')).toBe(0);
    expect(compareSemver('1.0', '1.0.1')).toBe(-1);
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm test -- version.test`
Expected: FAIL — `Cannot find module '../version'`

- [ ] **Step 4: 구현**

`src/lib/version.ts`:

```ts
import * as Application from 'expo-application';
import Constants from 'expo-constants';

// "1.2.3" 형태의 semver 문자열 비교: a<b → -1, a===b → 0, a>b → 1
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// 설치된 앱 버전 — 네이티브는 실제 바이너리 버전(웹에서는 null이라 app.json 버전으로 폴백)
export function getInstalledVersion(): string | null {
  return (
    Application.nativeApplicationVersion ??
    Constants.expoConfig?.version ??
    null
  );
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test -- version.test`
Expected: PASS 5건

만약 `expo-application` import 때문에 jest가 실패하면(네이티브 모듈 미해석), 테스트 파일 상단에 `jest.mock('expo-application', () => ({ nativeApplicationVersion: null }));`를 추가한다.

- [ ] **Step 6: 전체 테스트·린트 확인 후 커밋**

Run: `npm test && npm run lint`
Expected: 전부 PASS

```bash
git add package.json package-lock.json ios src/lib/version.ts src/lib/__tests__/version.test.ts
git commit -m "feat(lib): semver 비교·설치 버전 읽기 유틸 추가"
```

(`npx expo install`이 ios/ 아래 Podfile.lock 등을 갱신했으면 함께 커밋)

---

### Task 3: 버전 조회 서비스 (`src/services/appVersions.ts`)

**Files:**
- Create: `src/services/appVersions.ts`

**Interfaces:**
- Consumes: `Tables<'app_versions'>` (Task 1), `supabase` 클라이언트
- Produces:
  - `type AppVersionRow = { version: string; notes: string; released_at: string }` (생성 타입 별칭)
  - `fetchLatestVersion(): Promise<AppVersionRow | null>`
  - `fetchVersionHistory(): Promise<AppVersionRow[]>` — `released_at` 내림차순

이 태스크는 Supabase I/O 래퍼만 있고 순수 로직이 없어 단위 테스트를 만들지 않는다 (`runs.ts`의 fetcher들과 동일한 프로젝트 관례).

- [ ] **Step 1: 서비스 구현**

`src/services/appVersions.ts`:

```ts
import type { Tables } from '../types/database.types';
import { supabase } from './supabase';

export type AppVersionRow = Tables<'app_versions'>;

// 최신 버전 1건 — 실패하면 null (배지를 안 띄우는 조용한 실패)
export async function fetchLatestVersion(): Promise<AppVersionRow | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('app_versions')
      .select('*')
      .order('released_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

// 전체 버전 이력 — released_at 내림차순, 실패하면 빈 배열
export async function fetchVersionHistory(): Promise<AppVersionRow[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('app_versions')
      .select('*')
      .order('released_at', { ascending: false });
    if (error || !data) return [];
    return data;
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: 타입 체크 후 커밋**

Run: `npx tsc --noEmit`
Expected: 에러 없음 (Task 1의 타입 재생성이 선행되어야 함)

```bash
git add src/services/appVersions.ts
git commit -m "feat(services): app_versions 조회 서비스 추가"
```

---

### Task 4: 설정 페이지 "앱 정보" 섹션

**Files:**
- Create: `src/components/AppInfoSection.tsx`
- Modify: `app/(tabs)/settings.tsx`
- Modify: `app/_layout.tsx` (changelog 라우트 등록 — 화면 자체는 Task 5)

**Interfaces:**
- Consumes: `compareSemver`, `getInstalledVersion` (Task 2), `fetchLatestVersion` (Task 3)
- Produces: `AppInfoSection` 컴포넌트 (props 없음)

- [ ] **Step 1: AppInfoSection 컴포넌트 작성**

`src/components/AppInfoSection.tsx`:

```tsx
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { compareSemver, getInstalledVersion } from '@/lib/version';
import { fetchLatestVersion } from '@/services/appVersions';

export function AppInfoSection() {
  const router = useRouter();
  const installed = getInstalledVersion();
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (!installed) return;
    let cancelled = false;
    fetchLatestVersion().then((latest) => {
      if (cancelled || !latest) return;
      setUpdateAvailable(compareSemver(installed, latest.version) < 0);
    });
    return () => {
      cancelled = true;
    };
  }, [installed]);

  return (
    <View className="gap-3">
      <Text className="text-base font-semibold">앱 정보</Text>
      <Pressable
        className="flex-row items-center justify-between active:opacity-70"
        onPress={() => router.push('/changelog')}
        accessibilityRole="button"
        accessibilityLabel="버전 정보와 변경 사항 보기"
      >
        <Text className="text-muted-foreground">
          버전 {installed ?? '알 수 없음'}
        </Text>
        {updateAvailable ? (
          <Text className="text-sm font-medium text-primary">새 버전 있음</Text>
        ) : null}
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 2: 설정 페이지에 섹션 추가**

`app/(tabs)/settings.tsx` — import 추가:

```tsx
import { AppInfoSection } from '@/components/AppInfoSection';
```

거리 단위 `</View>` 닫는 태그 다음(루트 View 안 마지막)에 추가:

```tsx
      <AppInfoSection />
```

- [ ] **Step 3: changelog 라우트 등록**

`app/_layout.tsx`의 Stack 안, `run/[id]` 스크린 다음에 추가:

```tsx
        <Stack.Screen name="changelog" options={{ title: '변경 사항' }} />
```

- [ ] **Step 4: 타입·린트 확인 후 커밋**

Run: `npx tsc --noEmit && npm run lint`
Expected: 에러 없음 (changelog 화면 파일은 Task 5에서 생성 — expo-router 라우트 등록만으로는 타입 에러가 나지 않지만, `router.push('/changelog')`가 typed routes에서 에러가 나면 Task 5를 먼저 만든 뒤 이 스텝을 재실행)

```bash
git add src/components/AppInfoSection.tsx "app/(tabs)/settings.tsx" app/_layout.tsx
git commit -m "feat(settings): 앱 정보 섹션 — 버전 표시와 새 버전 배지"
```

---

### Task 5: 변경 사항 화면 (`app/changelog.tsx`)

**Files:**
- Create: `app/changelog.tsx`

**Interfaces:**
- Consumes: `fetchVersionHistory`, `AppVersionRow` (Task 3)

- [ ] **Step 1: 화면 구현**

`app/changelog.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';

import { Text } from '@/components/ui/text';
import {
  fetchVersionHistory,
  type AppVersionRow,
} from '@/services/appVersions';

export default function ChangelogScreen() {
  const [versions, setVersions] = useState<AppVersionRow[] | null>(null);

  useEffect(() => {
    fetchVersionHistory().then(setVersions);
  }, []);

  if (versions === null) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  // 시드로 항상 1건 이상 있으므로, 빈 배열은 사실상 조회 실패(오프라인 등)를 의미
  if (versions.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-4">
        <Text className="text-muted-foreground">
          변경 사항을 불러오지 못했어요. 네트워크를 확인해 주세요.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      className="flex-1 bg-background"
      contentContainerClassName="gap-6 p-4"
      data={versions}
      keyExtractor={(v) => v.version}
      renderItem={({ item }) => (
        <View className="gap-1">
          <View className="flex-row items-baseline gap-2">
            <Text className="text-base font-semibold">{item.version}</Text>
            <Text className="text-sm text-muted-foreground">
              {new Date(item.released_at).toLocaleDateString('ko-KR')}
            </Text>
          </View>
          <Text className="text-sm">{item.notes}</Text>
        </View>
      )}
    />
  );
}
```

- [ ] **Step 2: 전체 검증**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: 전부 PASS

- [ ] **Step 3: 수동 확인 (가능한 환경에서)**

Run: `npm run web` 후 브라우저에서 설정 탭 → "버전 1.0.0" 표시 확인, 행 클릭 → 변경 사항 화면에 `1.0.0` 항목 표시 확인. 배지는 DB 최신이 1.0.0과 같으므로 안 보이는 게 정상.
(웹 실행이 어려우면 생략하고 사용자에게 iOS 기기 확인을 요청)

- [ ] **Step 4: 커밋**

```bash
git add app/changelog.tsx
git commit -m "feat(changelog): 버전별 변경 사항 화면 추가"
```
