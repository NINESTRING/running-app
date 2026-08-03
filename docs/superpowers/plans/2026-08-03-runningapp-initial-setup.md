# 런닝앱 초기 세팅 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** React Native + Expo 런닝앱 스캐폴드 + GPS 추적이 실제 동작하는 핵심 화면 뼈대를 만든다.

**Architecture:** Expo Router 파일 기반 라우팅(탭 4개 + 상세 화면). GPS는 expo-location + expo-task-manager 백그라운드 태스크가 Zustand `runStore`에 좌표를 공급하고, 화면은 스토어를 구독한다. 순수 로직(거리/페이스/주간 통계/EWKT 변환)은 `src/lib`·`src/stores`에 분리해 jest-expo로 유닛 테스트한다. Supabase는 클라이언트 + 마이그레이션 SQL만 준비 (프로젝트 미생성).

**Tech Stack:** Expo (최신 SDK, TypeScript), Expo Router, expo-location, expo-task-manager, react-native-maps, Zustand, victory-native(Skia), @supabase/supabase-js, jest-expo, EAS Build

## Global Constraints

- 작업 디렉토리: `/Users/ninestring/work/runningapp.v1` (git 저장소 이미 초기화됨, `docs/`만 존재)
- 스펙: `docs/superpowers/specs/2026-08-03-runningapp-initial-setup-design.md`
- TypeScript strict 모드 (Expo 템플릿 기본값 유지), 모든 소스는 `.ts`/`.tsx`
- 환경 변수는 `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` — 이 두 이름 그대로 사용
- Supabase 미설정 시 앱은 크래시 없이 동작해야 함 (클라이언트 `null` 허용)
- 백그라운드 태스크 이름: `run-tracking` (상수 `RUN_TRACKING_TASK`)
- 테이블: `public.runs`, 조회용 뷰: `public.runs_with_geojson`
- 커밋은 태스크마다 1회 이상, conventional commit 형식 (`feat:`, `test:`, `chore:` 등)
- 네이티브 모듈 설치는 반드시 `npx expo install` 사용 (버전 호환 자동 맞춤)

---

### Task 1: Expo 프로젝트 스캐폴드 생성

**Files:**
- Create: Expo default 템플릿 전체 (`package.json`, `app.json`, `tsconfig.json`, `assets/` 등)
- Create: `app/_layout.tsx`, `app/(tabs)/_layout.tsx`, `app/(tabs)/index.tsx` (최소 버전)
- Modify: `.gitignore` (`.env` 추가)

**Interfaces:**
- Consumes: 없음
- Produces: 동작하는 Expo Router 프로젝트. 이후 모든 태스크가 이 위에 쌓임.

- [ ] **Step 1: 임시 디렉토리에 템플릿 생성 후 프로젝트 루트로 이동**

현재 디렉토리가 비어있지 않으므로(`docs/`, `.git`) 임시 위치에 만들고 rsync한다.

```bash
cd /Users/ninestring/work/runningapp.v1
SCRATCH=/private/tmp/claude-501/-Users-ninestring-work-runningapp-v1/e7cd8478-b4ff-4acd-9341-8e7dcde49aff/scratchpad
npx create-expo-app@latest "$SCRATCH/rn-scaffold" --template default --no-install
rsync -a --exclude .git "$SCRATCH/rn-scaffold/" .
rm -rf "$SCRATCH/rn-scaffold"
npm install
```

- [ ] **Step 2: 템플릿 예제 코드 제거**

default 템플릿의 예제 화면/컴포넌트를 삭제한다 (assets, package.json, 설정 파일은 유지):

```bash
rm -rf app components constants hooks scripts
```

`package.json`의 `scripts`에서 `reset-project` 항목이 있으면 삭제한다.

- [ ] **Step 3: 최소 라우팅 구조 작성**

`app/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}
```

`app/(tabs)/_layout.tsx`:

```tsx
import { Tabs } from 'expo-router';

export default function TabLayout() {
  return (
    <Tabs>
      <Tabs.Screen name="index" options={{ title: '홈' }} />
    </Tabs>
  );
}
```

`app/(tabs)/index.tsx`:

```tsx
import { Text, View } from 'react-native';

export default function HomeScreen() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>런닝앱</Text>
    </View>
  );
}
```

- [ ] **Step 4: .gitignore에 .env 추가**

`.gitignore` 끝에 다음 줄 추가 (템플릿에 이미 있으면 생략):

```
.env
```

- [ ] **Step 5: 타입 체크로 검증**

```bash
npx tsc --noEmit
```

Expected: 에러 없음 (exit 0)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: Expo Router 기반 프로젝트 스캐폴드 생성"
```

---

### Task 2: 의존성 설치 + 테스트 인프라

**Files:**
- Modify: `package.json` (의존성, jest 설정, test 스크립트)
- Create: `src/lib/__tests__/smoke.test.ts` (인프라 검증용, Task 3에서 대체 가능)

**Interfaces:**
- Consumes: Task 1 스캐폴드
- Produces: `npm test` 실행 가능. 이후 모든 TDD 태스크가 사용.

- [ ] **Step 1: 런타임 의존성 설치**

```bash
npx expo install expo-location expo-task-manager react-native-maps expo-dev-client @shopify/react-native-skia react-native-reanimated react-native-gesture-handler
npm install zustand victory-native @supabase/supabase-js
```

(reanimated/gesture-handler는 템플릿에 이미 있을 수 있음 — `expo install`이 버전만 맞춰줌)

- [ ] **Step 2: 테스트 의존성 설치**

```bash
npx expo install jest-expo jest @types/jest -- --save-dev
```

- [ ] **Step 3: package.json에 jest 설정 추가**

`package.json`에 추가:

```json
{
  "scripts": {
    "test": "jest"
  },
  "jest": {
    "preset": "jest-expo",
    "transformIgnorePatterns": [
      "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|victory-native|@shopify/react-native-skia|zustand)"
    ]
  }
}
```

- [ ] **Step 4: 스모크 테스트 작성**

`src/lib/__tests__/smoke.test.ts`:

```ts
describe('테스트 인프라', () => {
  it('jest-expo 프리셋이 동작한다', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: 테스트 실행 확인**

```bash
npm test
```

Expected: 1 passed

- [ ] **Step 6: 타입 체크**

```bash
npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: 핵심 의존성 설치 및 jest-expo 테스트 인프라 구성"
```

---

### Task 3: 거리/페이스 계산 (`src/lib/geo.ts`)

**Files:**
- Create: `src/types/run.ts`
- Create: `src/lib/geo.ts`
- Test: `src/lib/__tests__/geo.test.ts`
- Delete: `src/lib/__tests__/smoke.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `RoutePoint { latitude: number; longitude: number; timestamp: number }` (timestamp는 epoch ms)
  - `haversineM(a, b): number` — 두 좌표 간 미터 거리 (a, b는 `{latitude, longitude}`)
  - `paceSecPerKm(distanceM: number, elapsedMs: number): number | null` — 거리 10m 미만이면 null
  - `formatPace(secPerKm: number | null): string` — 예: `5'30"`, null이면 `--'--"`
  - `formatDuration(ms: number): string` — 예: `05:30`, `1:02:03`
  - `formatDistanceKm(m: number): string` — 예: `5.23`

- [ ] **Step 1: 타입 정의 작성**

`src/types/run.ts`:

```ts
export interface RoutePoint {
  latitude: number;
  longitude: number;
  timestamp: number; // epoch ms
}

export interface RunRecord {
  id: string;
  startedAt: string; // ISO 8601
  durationSec: number;
  distanceM: number;
  routeGeojson: { type: 'LineString'; coordinates: [number, number][] } | null;
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/lib/__tests__/geo.test.ts`:

```ts
import {
  formatDistanceKm,
  formatDuration,
  formatPace,
  haversineM,
  paceSecPerKm,
} from '../geo';

describe('haversineM', () => {
  it('위도 1도 차이는 약 111,195m', () => {
    const d = haversineM(
      { latitude: 0, longitude: 0 },
      { latitude: 1, longitude: 0 }
    );
    expect(d).toBeGreaterThan(111000);
    expect(d).toBeLessThan(111400);
  });

  it('같은 지점은 0', () => {
    const p = { latitude: 37.5663, longitude: 126.9779 };
    expect(haversineM(p, p)).toBe(0);
  });
});

describe('paceSecPerKm', () => {
  it('1km를 5분에 달리면 300초/km', () => {
    expect(paceSecPerKm(1000, 300_000)).toBeCloseTo(300);
  });

  it('거리가 10m 미만이면 null', () => {
    expect(paceSecPerKm(5, 60_000)).toBeNull();
  });
});

describe('formatPace', () => {
  it("300초/km는 5'00\"", () => {
    expect(formatPace(300)).toBe(`5'00"`);
  });

  it("null은 --'--\"", () => {
    expect(formatPace(null)).toBe(`--'--"`);
  });

  it('반올림으로 60초가 되면 분으로 올림', () => {
    expect(formatPace(359.7)).toBe(`6'00"`);
  });
});

describe('formatDuration', () => {
  it('1시간 미만은 mm:ss', () => {
    expect(formatDuration(330_000)).toBe('05:30');
  });

  it('1시간 이상은 h:mm:ss', () => {
    expect(formatDuration(3_723_000)).toBe('1:02:03');
  });
});

describe('formatDistanceKm', () => {
  it('미터를 km 소수 2자리로', () => {
    expect(formatDistanceKm(5234)).toBe('5.23');
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

```bash
npx jest src/lib/__tests__/geo.test.ts
```

Expected: FAIL — `Cannot find module '../geo'`

- [ ] **Step 4: 구현**

`src/lib/geo.ts`:

```ts
const EARTH_RADIUS_M = 6371000;

type LatLng = { latitude: number; longitude: number };

export function haversineM(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(s));
}

export function paceSecPerKm(distanceM: number, elapsedMs: number): number | null {
  if (distanceM < 10) return null;
  return elapsedMs / 1000 / (distanceM / 1000);
}

export function formatPace(secPerKm: number | null): string {
  if (secPerKm === null || !Number.isFinite(secPerKm)) return `--'--"`;
  let min = Math.floor(secPerKm / 60);
  let sec = Math.round(secPerKm % 60);
  if (sec === 60) {
    min += 1;
    sec = 0;
  }
  return `${min}'${String(sec).padStart(2, '0')}"`;
}

export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDistanceKm(m: number): string {
  return (m / 1000).toFixed(2);
}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
npx jest src/lib/__tests__/geo.test.ts
```

Expected: PASS (전체)

- [ ] **Step 6: 스모크 테스트 삭제 후 커밋**

```bash
rm src/lib/__tests__/smoke.test.ts
git add -A
git commit -m "feat: 거리(haversine)·페이스 계산 및 포맷 유틸"
```

---

### Task 4: 러닝 세션 스토어 (`src/stores/runStore.ts`)

**Files:**
- Create: `src/stores/runStore.ts`
- Test: `src/stores/__tests__/runStore.test.ts`

**Interfaces:**
- Consumes: `haversineM` (Task 3), `RoutePoint` (Task 3)
- Produces:
  - `useRunStore` — Zustand 스토어. 상태: `status: 'idle' | 'running' | 'paused'`, `points: RoutePoint[]`, `distanceM: number`, `startedAt: number | null`, `accumulatedMs: number`, `segmentStartedAt: number | null`
  - 액션: `start(now: number)`, `pause(now: number)`, `resume(now: number)`, `addPoint(p: RoutePoint)`, `reset()`
  - `elapsedMs(state, now: number): number` — 일시정지를 제외한 경과 시간 (state는 `{accumulatedMs, segmentStartedAt}`)

- [ ] **Step 1: 실패하는 테스트 작성**

`src/stores/__tests__/runStore.test.ts`:

```ts
import { elapsedMs, useRunStore } from '../runStore';

const P1 = { latitude: 0, longitude: 0, timestamp: 1000 };
const P2 = { latitude: 1, longitude: 0, timestamp: 2000 }; // P1에서 약 111,195m

beforeEach(() => {
  useRunStore.getState().reset();
});

describe('runStore', () => {
  it('초기 상태는 idle', () => {
    const s = useRunStore.getState();
    expect(s.status).toBe('idle');
    expect(s.points).toEqual([]);
    expect(s.distanceM).toBe(0);
  });

  it('start로 running 전환 및 초기화', () => {
    useRunStore.getState().start(10_000);
    const s = useRunStore.getState();
    expect(s.status).toBe('running');
    expect(s.startedAt).toBe(10_000);
    expect(s.segmentStartedAt).toBe(10_000);
  });

  it('running 중 addPoint는 좌표 추가 + 거리 누적', () => {
    const store = useRunStore.getState();
    store.start(0);
    store.addPoint(P1);
    store.addPoint(P2);
    const s = useRunStore.getState();
    expect(s.points).toHaveLength(2);
    expect(s.distanceM).toBeGreaterThan(111000);
  });

  it('첫 좌표는 거리를 더하지 않는다', () => {
    const store = useRunStore.getState();
    store.start(0);
    store.addPoint(P1);
    expect(useRunStore.getState().distanceM).toBe(0);
  });

  it('paused 상태에서는 addPoint 무시', () => {
    const store = useRunStore.getState();
    store.start(0);
    store.addPoint(P1);
    store.pause(5000);
    store.addPoint(P2);
    expect(useRunStore.getState().points).toHaveLength(1);
  });

  it('pause/resume이 경과 시간을 올바르게 누적', () => {
    const store = useRunStore.getState();
    store.start(0);
    store.pause(5000); // 5초 달림
    expect(elapsedMs(useRunStore.getState(), 8000)).toBe(5000); // 정지 중엔 안 늘어남
    useRunStore.getState().resume(10_000);
    expect(elapsedMs(useRunStore.getState(), 13_000)).toBe(8000); // 5초 + 3초
  });

  it('idle에서 pause/resume은 무시', () => {
    useRunStore.getState().pause(100);
    expect(useRunStore.getState().status).toBe('idle');
    useRunStore.getState().resume(200);
    expect(useRunStore.getState().status).toBe('idle');
  });

  it('reset은 idle로 되돌림', () => {
    const store = useRunStore.getState();
    store.start(0);
    store.addPoint(P1);
    store.reset();
    const s = useRunStore.getState();
    expect(s.status).toBe('idle');
    expect(s.points).toEqual([]);
    expect(s.distanceM).toBe(0);
    expect(s.startedAt).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx jest src/stores/__tests__/runStore.test.ts
```

Expected: FAIL — `Cannot find module '../runStore'`

- [ ] **Step 3: 구현**

`src/stores/runStore.ts`:

```ts
import { create } from 'zustand';
import { haversineM } from '../lib/geo';
import type { RoutePoint } from '../types/run';

export type RunStatus = 'idle' | 'running' | 'paused';

export interface RunState {
  status: RunStatus;
  points: RoutePoint[];
  distanceM: number;
  startedAt: number | null;
  accumulatedMs: number;
  segmentStartedAt: number | null;
  start: (now: number) => void;
  pause: (now: number) => void;
  resume: (now: number) => void;
  addPoint: (p: RoutePoint) => void;
  reset: () => void;
}

const initial = {
  status: 'idle' as RunStatus,
  points: [] as RoutePoint[],
  distanceM: 0,
  startedAt: null as number | null,
  accumulatedMs: 0,
  segmentStartedAt: null as number | null,
};

export const useRunStore = create<RunState>((set, get) => ({
  ...initial,

  start: (now) =>
    set({ ...initial, status: 'running', startedAt: now, segmentStartedAt: now }),

  pause: (now) => {
    const { status, segmentStartedAt, accumulatedMs } = get();
    if (status !== 'running' || segmentStartedAt === null) return;
    set({
      status: 'paused',
      accumulatedMs: accumulatedMs + (now - segmentStartedAt),
      segmentStartedAt: null,
    });
  },

  resume: (now) => {
    if (get().status !== 'paused') return;
    set({ status: 'running', segmentStartedAt: now });
  },

  addPoint: (p) => {
    const { status, points, distanceM } = get();
    if (status !== 'running') return;
    const last = points[points.length - 1];
    const added = last ? haversineM(last, p) : 0;
    set({ points: [...points, p], distanceM: distanceM + added });
  },

  reset: () => set({ ...initial }),
}));

export function elapsedMs(
  state: Pick<RunState, 'accumulatedMs' | 'segmentStartedAt'>,
  now: number
): number {
  return (
    state.accumulatedMs +
    (state.segmentStartedAt !== null ? now - state.segmentStartedAt : 0)
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx jest src/stores/__tests__/runStore.test.ts
```

Expected: PASS (전체)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 러닝 세션 Zustand 스토어 (상태 전이·거리 누적·경과 시간)"
```

---

### Task 5: Supabase 클라이언트 + 러닝 기록 저장/조회

**Files:**
- Create: `src/services/supabase.ts`
- Create: `src/services/runs.ts`
- Create: `.env.example`
- Test: `src/services/__tests__/runs.test.ts`

**Interfaces:**
- Consumes: `RoutePoint`, `RunRecord` (Task 3)
- Produces:
  - `supabase: SupabaseClient | null` — env 미설정이면 null
  - `pointsToEwkt(points: RoutePoint[]): string | null` — 2개 미만이면 null, 형식: `SRID=4326;LINESTRING(lon lat,lon lat,...)`
  - `saveRun(run: FinishedRun): Promise<{ ok: boolean; error?: string }>` — `FinishedRun { startedAt: number; durationSec: number; distanceM: number; points: RoutePoint[] }`
  - `listRuns(): Promise<RunRecord[]>` — 미설정이면 빈 배열
  - `getRun(id: string): Promise<RunRecord | null>`

- [ ] **Step 1: 실패하는 테스트 작성 (순수 변환 로직만)**

`src/services/__tests__/runs.test.ts`:

```ts
import { pointsToEwkt, rowToRunRecord } from '../runs';

describe('pointsToEwkt', () => {
  it('경도 위도 순서의 EWKT LINESTRING 생성', () => {
    const points = [
      { latitude: 37.5, longitude: 127.0, timestamp: 0 },
      { latitude: 37.6, longitude: 127.1, timestamp: 1000 },
    ];
    expect(pointsToEwkt(points)).toBe(
      'SRID=4326;LINESTRING(127 37.5,127.1 37.6)'
    );
  });

  it('좌표가 2개 미만이면 null', () => {
    expect(pointsToEwkt([])).toBeNull();
    expect(
      pointsToEwkt([{ latitude: 1, longitude: 2, timestamp: 0 }])
    ).toBeNull();
  });
});

describe('rowToRunRecord', () => {
  it('DB 행을 RunRecord로 변환 (route_geojson 문자열 파싱)', () => {
    const rec = rowToRunRecord({
      id: 'abc',
      started_at: '2026-08-03T01:00:00Z',
      duration_sec: 600,
      distance_m: 2000,
      route_geojson: '{"type":"LineString","coordinates":[[127,37.5],[127.1,37.6]]}',
    });
    expect(rec.id).toBe('abc');
    expect(rec.durationSec).toBe(600);
    expect(rec.routeGeojson?.coordinates).toHaveLength(2);
  });

  it('route_geojson이 null이면 routeGeojson도 null', () => {
    const rec = rowToRunRecord({
      id: 'abc',
      started_at: '2026-08-03T01:00:00Z',
      duration_sec: 600,
      distance_m: 2000,
      route_geojson: null,
    });
    expect(rec.routeGeojson).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx jest src/services/__tests__/runs.test.ts
```

Expected: FAIL — `Cannot find module '../runs'`

- [ ] **Step 3: 구현**

`src/services/supabase.ts`:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;
```

`src/services/runs.ts`:

```ts
import type { RoutePoint, RunRecord } from '../types/run';
import { supabase } from './supabase';

export interface FinishedRun {
  startedAt: number; // epoch ms
  durationSec: number;
  distanceM: number;
  points: RoutePoint[];
}

export function pointsToEwkt(points: RoutePoint[]): string | null {
  if (points.length < 2) return null;
  const coords = points.map((p) => `${p.longitude} ${p.latitude}`).join(',');
  return `SRID=4326;LINESTRING(${coords})`;
}

interface RunRow {
  id: string;
  started_at: string;
  duration_sec: number;
  distance_m: number;
  route_geojson: string | null;
}

export function rowToRunRecord(row: RunRow): RunRecord {
  return {
    id: row.id,
    startedAt: row.started_at,
    durationSec: row.duration_sec,
    distanceM: row.distance_m,
    routeGeojson: row.route_geojson ? JSON.parse(row.route_geojson) : null,
  };
}

export async function saveRun(
  run: FinishedRun
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) {
    return { ok: false, error: 'Supabase가 설정되지 않았습니다 (.env 확인)' };
  }
  const { error } = await supabase.from('runs').insert({
    started_at: new Date(run.startedAt).toISOString(),
    duration_sec: run.durationSec,
    distance_m: run.distanceM,
    route: pointsToEwkt(run.points),
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function listRuns(): Promise<RunRecord[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('runs_with_geojson')
    .select('*')
    .order('started_at', { ascending: false });
  if (error || !data) return [];
  return (data as RunRow[]).map(rowToRunRecord);
}

export async function getRun(id: string): Promise<RunRecord | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('runs_with_geojson')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !data) return null;
  return rowToRunRecord(data as RunRow);
}
```

`.env.example`:

```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx jest src/services/__tests__/runs.test.ts
```

Expected: PASS (전체)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: Supabase 클라이언트 및 러닝 기록 저장/조회 서비스"
```

---

### Task 6: 백그라운드 위치 추적 (`src/services/location.ts` + 권한 설정)

**Files:**
- Create: `src/services/location.ts`
- Modify: `app.json` (expo-location plugin, iOS 백그라운드 모드)
- Modify: `app/_layout.tsx` (태스크 등록 import)

**Interfaces:**
- Consumes: `useRunStore.addPoint` (Task 4)
- Produces:
  - `RUN_TRACKING_TASK = 'run-tracking'`
  - `requestPermissions(): Promise<boolean>` — 포그라운드 권한 필수, 백그라운드는 best-effort
  - `startTracking(): Promise<void>`
  - `stopTracking(): Promise<void>` — 시작 안 됐으면 no-op

네이티브 API 의존이라 유닛 테스트 없음. 좌표→스토어 로직은 Task 4에서 이미 테스트됨. 검증은 타입 체크 + Task 12의 수동 확인.

- [ ] **Step 1: 구현**

`src/services/location.ts`:

```ts
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { useRunStore } from '../stores/runStore';

export const RUN_TRACKING_TASK = 'run-tracking';

TaskManager.defineTask(RUN_TRACKING_TASK, ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  const { addPoint } = useRunStore.getState();
  for (const loc of locations) {
    addPoint({
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      timestamp: loc.timestamp,
    });
  }
});

export async function requestPermissions(): Promise<boolean> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return false;
  // 백그라운드 권한은 거부돼도 포그라운드 추적은 가능하므로 차단하지 않음
  await Location.requestBackgroundPermissionsAsync();
  return true;
}

export async function startTracking(): Promise<void> {
  await Location.startLocationUpdatesAsync(RUN_TRACKING_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 3000,
    distanceInterval: 5,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: '러닝 기록 중',
      notificationBody: '경로를 기록하고 있습니다.',
    },
  });
}

export async function stopTracking(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(RUN_TRACKING_TASK)) {
    await Location.stopLocationUpdatesAsync(RUN_TRACKING_TASK);
  }
}
```

- [ ] **Step 2: app.json 권한 설정**

`app.json`의 `expo` 객체에서:

`plugins` 배열에 추가 (기존 `expo-router` 등 유지):

```json
[
  "expo-location",
  {
    "locationAlwaysAndWhenInUsePermission": "러닝 경로 기록을 위해 위치 정보를 사용합니다.",
    "locationWhenInUsePermission": "러닝 경로 기록을 위해 위치 정보를 사용합니다.",
    "isAndroidBackgroundLocationEnabled": true,
    "isAndroidForegroundServiceEnabled": true
  }
]
```

`ios` 객체에 추가 (기존 키 유지):

```json
"ios": {
  "infoPlist": {
    "UIBackgroundModes": ["location"]
  }
}
```

- [ ] **Step 3: 루트 레이아웃에서 태스크 등록**

`app/_layout.tsx` 최상단에 import 추가 (TaskManager.defineTask는 모듈 로드 시점에 실행되어야 함):

```tsx
import '../src/services/location';
import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}
```

- [ ] **Step 4: 검증**

```bash
npx tsc --noEmit && npm test
```

Expected: 타입 에러 없음, 기존 테스트 전체 PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: expo-task-manager 백그라운드 위치 추적 및 권한 설정"
```

---

### Task 7: 지도 컴포넌트 (`src/components/RouteMap.tsx`)

**Files:**
- Create: `src/components/RouteMap.tsx`

**Interfaces:**
- Consumes: `RoutePoint` (Task 3)
- Produces: `RouteMap({ points, showsUserLocation? })` — 경로 폴리라인 + 마지막 좌표 중심 표시. 부모 View를 가득 채움 (absoluteFill).

네이티브 컴포넌트라 유닛 테스트 없음. 타입 체크로 검증.

- [ ] **Step 1: 구현**

`src/components/RouteMap.tsx`:

```tsx
import { StyleSheet } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import type { RoutePoint } from '../types/run';

interface Props {
  points: RoutePoint[];
  showsUserLocation?: boolean;
}

const DEFAULT_REGION = {
  latitude: 37.5663, // 서울시청
  longitude: 126.9779,
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};

export function RouteMap({ points, showsUserLocation = false }: Props) {
  const last = points[points.length - 1];
  return (
    <MapView
      style={StyleSheet.absoluteFill}
      showsUserLocation={showsUserLocation}
      initialRegion={DEFAULT_REGION}
      region={
        last
          ? {
              latitude: last.latitude,
              longitude: last.longitude,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            }
          : undefined
      }
    >
      {points.length >= 2 && (
        <Polyline
          coordinates={points.map((p) => ({
            latitude: p.latitude,
            longitude: p.longitude,
          }))}
          strokeWidth={4}
          strokeColor="#3b82f6"
        />
      )}
    </MapView>
  );
}
```

- [ ] **Step 2: 검증 및 커밋**

```bash
npx tsc --noEmit
git add -A
git commit -m "feat: 경로 폴리라인 지도 컴포넌트 RouteMap"
```

---

### Task 8: 탭 레이아웃 + 홈 화면 (추적 UI)

**Files:**
- Modify: `app/(tabs)/_layout.tsx` (탭 4개)
- Modify: `app/(tabs)/index.tsx` (홈: 지도 + 추적 컨트롤)
- Create: `app/(tabs)/history.tsx`, `app/(tabs)/stats.tsx`, `app/(tabs)/settings.tsx` (임시 플레이스홀더 — Task 9, 10에서 구현)

**Interfaces:**
- Consumes: `RouteMap` (Task 7), `useRunStore`/`elapsedMs` (Task 4), geo 포맷 함수 (Task 3), `requestPermissions`/`startTracking`/`stopTracking` (Task 6), `saveRun` (Task 5)
- Produces: 탭 라우트 `index`, `history`, `stats`, `settings`. 홈 화면에서 시작→일시정지→재개→종료 전체 흐름 동작.

- [ ] **Step 1: 탭 레이아웃 작성**

`app/(tabs)/_layout.tsx`:

```tsx
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#3b82f6' }}>
      <Tabs.Screen
        name="index"
        options={{
          title: '홈',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="play-circle" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: '기록',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: '통계',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bar-chart" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '설정',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
```

- [ ] **Step 2: 나머지 탭 플레이스홀더 생성**

`app/(tabs)/history.tsx`, `app/(tabs)/stats.tsx`, `app/(tabs)/settings.tsx` 각각 (컴포넌트 이름만 `HistoryScreen`/`StatsScreen`/`SettingsScreen`으로 다르게):

```tsx
import { Text, View } from 'react-native';

export default function HistoryScreen() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>준비 중</Text>
    </View>
  );
}
```

- [ ] **Step 3: 홈 화면 구현**

`app/(tabs)/index.tsx`:

```tsx
import { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { RouteMap } from '../../src/components/RouteMap';
import {
  formatDistanceKm,
  formatDuration,
  formatPace,
  paceSecPerKm,
} from '../../src/lib/geo';
import {
  requestPermissions,
  startTracking,
  stopTracking,
} from '../../src/services/location';
import { saveRun } from '../../src/services/runs';
import { elapsedMs, useRunStore } from '../../src/stores/runStore';

export default function HomeScreen() {
  const status = useRunStore((s) => s.status);
  const points = useRunStore((s) => s.points);
  const distanceM = useRunStore((s) => s.distanceM);
  const accumulatedMs = useRunStore((s) => s.accumulatedMs);
  const segmentStartedAt = useRunStore((s) => s.segmentStartedAt);
  const [now, setNow] = useState(() => Date.now());
  const [permissionDenied, setPermissionDenied] = useState(false);

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
    useRunStore.getState().start(Date.now());
    setNow(Date.now());
    await startTracking();
  };

  const onPause = () => useRunStore.getState().pause(Date.now());

  const onResume = () => {
    useRunStore.getState().resume(Date.now());
    setNow(Date.now());
  };

  const onStop = async () => {
    await stopTracking();
    const s = useRunStore.getState();
    const stoppedAt = Date.now();
    const durationSec = Math.round(elapsedMs(s, s.status === 'running' ? stoppedAt : 0) / 1000);
    const result = await saveRun({
      startedAt: s.startedAt ?? stoppedAt,
      durationSec,
      distanceM: s.distanceM,
      points: s.points,
    });
    Alert.alert(
      result.ok ? '저장 완료' : '저장하지 못했습니다',
      result.ok ? '기록 탭에서 확인하세요.' : result.error
    );
    useRunStore.getState().reset();
  };

  return (
    <View style={styles.container}>
      <RouteMap points={points} showsUserLocation />
      <View style={styles.panel}>
        {permissionDenied && (
          <Pressable onPress={() => Linking.openSettings()}>
            <Text style={styles.warn}>
              위치 권한이 필요합니다. 눌러서 설정 열기
            </Text>
          </Pressable>
        )}
        <View style={styles.metrics}>
          <Metric label="거리(km)" value={formatDistanceKm(distanceM)} />
          <Metric label="시간" value={formatDuration(elapsed)} />
          <Metric label="페이스" value={formatPace(paceSecPerKm(distanceM, elapsed))} />
        </View>
        <View style={styles.buttons}>
          {status === 'idle' && (
            <Button label="시작" onPress={onStart} color="#3b82f6" />
          )}
          {status === 'running' && (
            <>
              <Button label="일시정지" onPress={onPause} color="#f59e0b" />
              <Button label="종료" onPress={onStop} color="#ef4444" />
            </>
          )}
          {status === 'paused' && (
            <>
              <Button label="재개" onPress={onResume} color="#3b82f6" />
              <Button label="종료" onPress={onStop} color="#ef4444" />
            </>
          )}
        </View>
      </View>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function Button({
  label,
  onPress,
  color,
}: {
  label: string;
  onPress: () => void;
  color: string;
}) {
  return (
    <Pressable style={[styles.button, { backgroundColor: color }]} onPress={onPress}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  panel: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  warn: { color: '#ef4444', textAlign: 'center' },
  metrics: { flexDirection: 'row', justifyContent: 'space-around' },
  metric: { alignItems: 'center' },
  metricValue: { fontSize: 24, fontWeight: '700' },
  metricLabel: { fontSize: 12, color: '#6b7280' },
  buttons: { flexDirection: 'row', gap: 12, justifyContent: 'center' },
  button: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 24,
  },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600' },
});
```

주의: `onStop`의 `durationSec` 계산 — 일시정지 상태에서 종료하면 `segmentStartedAt`이 null이므로 `elapsedMs(s, 아무 값)`은 `accumulatedMs`만 반환한다. running 중 종료면 `stoppedAt`을 넘겨 현재 구간을 포함한다. 위 코드가 그 로직이다.

- [ ] **Step 4: 검증**

```bash
npx tsc --noEmit && npm test
```

Expected: 타입 에러 없음, 테스트 전체 PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 탭 4개 레이아웃 및 홈 화면 러닝 추적 UI"
```

---

### Task 9: 기록 목록 + 러닝 상세 화면

**Files:**
- Modify: `app/(tabs)/history.tsx`
- Create: `app/run/[id].tsx`
- Modify: `app/_layout.tsx` (상세 화면 Stack.Screen 추가)

**Interfaces:**
- Consumes: `listRuns`/`getRun` (Task 5), `RunRecord` (Task 3), `RouteMap` (Task 7), geo 포맷 함수 (Task 3)
- Produces: `/run/[id]` 라우트. 기록 탭에서 항목 탭 → 상세로 이동.

- [ ] **Step 1: 기록 목록 구현**

`app/(tabs)/history.tsx`:

```tsx
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDistanceKm, formatDuration } from '../../src/lib/geo';
import { listRuns } from '../../src/services/runs';
import { supabase } from '../../src/services/supabase';
import type { RunRecord } from '../../src/types/run';

export default function HistoryScreen() {
  const router = useRouter();
  const [runs, setRuns] = useState<RunRecord[]>([]);

  useFocusEffect(
    useCallback(() => {
      listRuns().then(setRuns);
    }, [])
  );

  if (!supabase) {
    return (
      <View style={styles.center}>
        <Text style={styles.dim}>
          Supabase가 설정되지 않았습니다.{'\n'}.env에 URL과 키를 넣어주세요.
        </Text>
      </View>
    );
  }

  if (runs.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.dim}>아직 러닝 기록이 없습니다.</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={runs}
      keyExtractor={(r) => r.id}
      renderItem={({ item }) => (
        <Pressable
          style={styles.row}
          onPress={() => router.push(`/run/${item.id}`)}
        >
          <Text style={styles.rowTitle}>
            {new Date(item.startedAt).toLocaleDateString('ko-KR')}
          </Text>
          <Text style={styles.dim}>
            {formatDistanceKm(item.distanceM)}km ·{' '}
            {formatDuration(item.durationSec * 1000)}
          </Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  dim: { color: '#6b7280', textAlign: 'center' },
  row: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
    gap: 4,
  },
  rowTitle: { fontSize: 16, fontWeight: '600' },
});
```

- [ ] **Step 2: 상세 화면 구현**

`app/run/[id].tsx`:

```tsx
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RouteMap } from '../../src/components/RouteMap';
import {
  formatDistanceKm,
  formatDuration,
  formatPace,
  paceSecPerKm,
} from '../../src/lib/geo';
import { getRun } from '../../src/services/runs';
import type { RoutePoint, RunRecord } from '../../src/types/run';

export default function RunDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [run, setRun] = useState<RunRecord | null>(null);

  useEffect(() => {
    if (id) getRun(id).then(setRun);
  }, [id]);

  if (!run) {
    return (
      <View style={styles.center}>
        <Text style={styles.dim}>기록을 불러오는 중이거나 찾을 수 없습니다.</Text>
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
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <RouteMap points={points} />
      </View>
      <View style={styles.summary}>
        <Text style={styles.title}>
          {new Date(run.startedAt).toLocaleString('ko-KR')}
        </Text>
        <Text>
          {formatDistanceKm(run.distanceM)}km ·{' '}
          {formatDuration(run.durationSec * 1000)} ·{' '}
          {formatPace(paceSecPerKm(run.distanceM, run.durationSec * 1000))}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dim: { color: '#6b7280' },
  summary: { padding: 16, gap: 8 },
  title: { fontSize: 16, fontWeight: '600' },
});
```

- [ ] **Step 3: 루트 레이아웃에 상세 화면 추가**

`app/_layout.tsx`의 Stack에 추가:

```tsx
<Stack.Screen name="run/[id]" options={{ title: '러닝 상세' }} />
```

- [ ] **Step 4: 검증 및 커밋**

```bash
npx tsc --noEmit && npm test
git add -A
git commit -m "feat: 러닝 기록 목록 및 상세 화면"
```

---

### Task 10: 통계 화면 (주간 차트) + 설정 화면

**Files:**
- Create: `src/lib/stats.ts`
- Create: `src/stores/settingsStore.ts`
- Modify: `app/(tabs)/stats.tsx`
- Modify: `app/(tabs)/settings.tsx`
- Test: `src/lib/__tests__/stats.test.ts`

**Interfaces:**
- Consumes: `RunRecord` (Task 3), `listRuns` (Task 5)
- Produces:
  - `weeklyDistances(runs, now: Date): { day: string; km: number }[]` — 월요일 시작 7일, 라벨 `['월','화','수','목','금','토','일']`
  - `useSettingsStore` — `{ unit: 'km' | 'mi'; setUnit(u) }`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/__tests__/stats.test.ts`:

```ts
import { weeklyDistances } from '../stats';

// 2026-08-03은 월요일
const NOW = new Date('2026-08-03T12:00:00+09:00');

describe('weeklyDistances', () => {
  it('7일 배열을 월요일부터 반환', () => {
    const result = weeklyDistances([], NOW);
    expect(result).toHaveLength(7);
    expect(result.map((r) => r.day)).toEqual([
      '월', '화', '수', '목', '금', '토', '일',
    ]);
    expect(result.every((r) => r.km === 0)).toBe(true);
  });

  it('이번 주 러닝을 요일별로 합산', () => {
    const runs = [
      { startedAt: '2026-08-03T07:00:00+09:00', distanceM: 3000 },
      { startedAt: '2026-08-03T20:00:00+09:00', distanceM: 2000 },
    ];
    const result = weeklyDistances(runs, NOW);
    expect(result[0].km).toBeCloseTo(5);
    expect(result[1].km).toBe(0);
  });

  it('지난주 러닝은 제외', () => {
    const runs = [{ startedAt: '2026-07-27T07:00:00+09:00', distanceM: 3000 }];
    const result = weeklyDistances(runs, NOW);
    expect(result.every((r) => r.km === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx jest src/lib/__tests__/stats.test.ts
```

Expected: FAIL — `Cannot find module '../stats'`

- [ ] **Step 3: 구현**

`src/lib/stats.ts`:

```ts
import type { RunRecord } from '../types/run';

const DAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'];
const DAY_MS = 86_400_000;

export function weeklyDistances(
  runs: Pick<RunRecord, 'startedAt' | 'distanceM'>[],
  now: Date
): { day: string; km: number }[] {
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  const dow = (weekStart.getDay() + 6) % 7; // 월=0
  weekStart.setDate(weekStart.getDate() - dow);

  const out = DAY_LABELS.map((day) => ({ day, km: 0 }));
  for (const run of runs) {
    const idx = Math.floor(
      (new Date(run.startedAt).getTime() - weekStart.getTime()) / DAY_MS
    );
    if (idx >= 0 && idx < 7) out[idx].km += run.distanceM / 1000;
  }
  return out;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx jest src/lib/__tests__/stats.test.ts
```

Expected: PASS (전체)

- [ ] **Step 5: 설정 스토어 + 화면 구현**

`src/stores/settingsStore.ts`:

```ts
import { create } from 'zustand';

interface SettingsState {
  unit: 'km' | 'mi';
  setUnit: (unit: 'km' | 'mi') => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  unit: 'km',
  setUnit: (unit) => set({ unit }),
}));
```

`app/(tabs)/settings.tsx`:

```tsx
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSettingsStore } from '../../src/stores/settingsStore';

export default function SettingsScreen() {
  const unit = useSettingsStore((s) => s.unit);
  const setUnit = useSettingsStore((s) => s.setUnit);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>거리 단위</Text>
      <View style={styles.row}>
        {(['km', 'mi'] as const).map((u) => (
          <Pressable
            key={u}
            style={[styles.option, unit === u && styles.selected]}
            onPress={() => setUnit(u)}
          >
            <Text style={unit === u ? styles.selectedText : undefined}>{u}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  label: { fontSize: 16, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 8 },
  option: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  selected: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  selectedText: { color: 'white', fontWeight: '600' },
});
```

- [ ] **Step 6: 통계 화면 구현**

`app/(tabs)/stats.tsx`:

```tsx
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Bar, CartesianChart } from 'victory-native';
import { weeklyDistances } from '../../src/lib/stats';
import { listRuns } from '../../src/services/runs';

export default function StatsScreen() {
  const [data, setData] = useState(() => weeklyDistances([], new Date()));

  useFocusEffect(
    useCallback(() => {
      listRuns().then((runs) => setData(weeklyDistances(runs, new Date())));
    }, [])
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>이번 주 거리 (km)</Text>
      <View style={styles.chart}>
        <CartesianChart data={data} xKey="day" yKeys={['km']}>
          {({ points, chartBounds }) => (
            <Bar
              points={points.km}
              chartBounds={chartBounds}
              color="#3b82f6"
              roundedCorners={{ topLeft: 4, topRight: 4 }}
            />
          )}
        </CartesianChart>
      </View>
      <View style={styles.labels}>
        {data.map((d) => (
          <Text key={d.day} style={styles.dayLabel}>
            {d.day}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 8 },
  title: { fontSize: 16, fontWeight: '600' },
  chart: { height: 240 },
  labels: { flexDirection: 'row', justifyContent: 'space-around' },
  dayLabel: { fontSize: 12, color: '#6b7280' },
});
```

(victory-native의 축 라벨은 Skia 폰트 로딩이 필요하므로 뼈대에서는 요일 라벨을 RN Text로 차트 아래 표시)

- [ ] **Step 7: 검증 및 커밋**

```bash
npx tsc --noEmit && npm test
git add -A
git commit -m "feat: 주간 거리 통계 차트 및 설정 화면"
```

---

### Task 11: Supabase 마이그레이션 SQL + EAS 설정 + README

**Files:**
- Create: `supabase/migrations/0001_init.sql`
- Create: `eas.json`
- Create: `README.md`

**Interfaces:**
- Consumes: Task 5의 테이블/뷰/컬럼 이름 (`runs`, `runs_with_geojson`, `route`, `route_geojson` 등)
- Produces: Supabase 프로젝트 생성 후 바로 적용 가능한 스키마. EAS 빌드 프로필.

- [ ] **Step 1: 마이그레이션 SQL 작성**

`supabase/migrations/0001_init.sql`:

```sql
-- PostGIS 확장 (Supabase 대시보드 Extensions에서도 활성화 가능)
create extension if not exists postgis;

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id),
  started_at timestamptz not null,
  duration_sec integer not null check (duration_sec >= 0),
  distance_m double precision not null check (distance_m >= 0),
  route geography (linestring, 4326),
  created_at timestamptz not null default now()
);

alter table public.runs enable row level security;

create policy "본인 기록 조회" on public.runs
  for select using (auth.uid() = user_id);

create policy "본인 기록 생성" on public.runs
  for insert with check (auth.uid() = user_id);

create policy "본인 기록 수정" on public.runs
  for update using (auth.uid() = user_id);

create policy "본인 기록 삭제" on public.runs
  for delete using (auth.uid() = user_id);

-- 앱 조회용: route를 GeoJSON 문자열로 변환해 반환
create view public.runs_with_geojson
  with (security_invoker = on) as
select
  id,
  user_id,
  started_at,
  duration_sec,
  distance_m,
  st_asgeojson(route) as route_geojson,
  created_at
from public.runs;
```

- [ ] **Step 2: eas.json 작성**

`eas.json`:

```json
{
  "cli": {
    "appVersionSource": "remote"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal"
    },
    "production": {
      "autoIncrement": true
    }
  },
  "submit": {
    "production": {}
  }
}
```

- [ ] **Step 3: README 작성**

`README.md`:

```markdown
# 런닝앱

React Native + Expo 기반 GPS 러닝 트래커.

## 스택

Expo (TypeScript) · Expo Router · expo-location + expo-task-manager ·
react-native-maps · Zustand · victory-native · Supabase (PostGIS) · EAS Build

## 시작하기

```bash
npm install
npx expo start
```

- 기본 UI 확인은 Expo Go로 가능.
- **백그라운드 위치 추적은 dev build 필요**: `eas build --profile development --platform ios` (또는 android) 후 설치.
- Android에서 지도를 보려면 Google Maps API 키가 필요 (`app.json` → `android.config.googleMaps.apiKey`).

## Supabase 연결

1. [supabase.com](https://supabase.com)에서 프로젝트 생성
2. SQL Editor에서 `supabase/migrations/0001_init.sql` 실행
3. `.env.example`을 `.env`로 복사하고 URL/anon key 입력
4. 재시작: `npx expo start --clear`

주의: `runs` 테이블은 RLS로 보호되므로 실제 저장은 로그인(추후 구현) 후 가능.

## 테스트

```bash
npm test           # jest 유닛 테스트
npx tsc --noEmit   # 타입 체크
```

## 구조

- `app/` — Expo Router 화면 (탭: 홈/기록/통계/설정, `run/[id]` 상세)
- `src/lib/` — 순수 로직 (거리·페이스·주간 통계)
- `src/stores/` — Zustand 스토어
- `src/services/` — 위치 추적, Supabase
- `supabase/migrations/` — DB 스키마
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: Supabase 마이그레이션 SQL, EAS 빌드 프로필, README"
```

---

### Task 12: 최종 검증

**Files:** 없음 (검증만)

- [ ] **Step 1: 전체 테스트 + 타입 체크**

```bash
npx tsc --noEmit && npm test
```

Expected: 타입 에러 없음, 테스트 스위트 4개(geo, runStore, runs, stats) 전체 PASS

- [ ] **Step 2: Expo 프로젝트 건강 검진**

```bash
npx expo-doctor
```

Expected: 치명적 이슈 없음 (경고는 기록만 하고 통과 처리)

- [ ] **Step 3: 번들 빌드 확인 (네이티브 없이 JS 번들만)**

```bash
SCRATCH=/private/tmp/claude-501/-Users-ninestring-work-runningapp-v1/e7cd8478-b4ff-4acd-9341-8e7dcde49aff/scratchpad
npx expo export --platform ios --output-dir "$SCRATCH/expo-export-check"
rm -rf "$SCRATCH/expo-export-check"
```

Expected: 번들 에러 없이 export 성공 — 라우트/임포트가 실제로 연결되는지 확인하는 가장 저렴한 방법

- [ ] **Step 4: 남은 변경 사항 있으면 커밋**

```bash
git status --short
git add -A && git commit -m "chore: 초기 세팅 마무리" || echo "nothing to commit"
```
