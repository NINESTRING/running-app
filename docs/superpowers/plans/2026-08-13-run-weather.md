# 러닝 날씨·기온 기록 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 러닝 시작 시점의 날씨(WMO 코드)와 기온(°C)을 Open-Meteo로 자동 조회해 기록에 저장하고, 상세 화면·히스토리 목록에 표시한다.

**Architecture:** 러닝 시작 시 fire-and-forget으로 날씨를 조회해 `runStore`에 보관하고, 저장 시 `saveRun()`에 함께 넘긴다. 실패하면 저장 시점에 1회 재시도, 그래도 실패하면 `null` 저장 — 날씨가 러닝 저장을 막는 일은 없다. 스펙: `docs/superpowers/specs/2026-08-13-run-weather-design.md`

**Tech Stack:** Expo(React Native) + TypeScript, zustand, Supabase(Postgres), Open-Meteo API(키 불필요), jest(jest-expo)

## Global Constraints

- 테스트 실행은 항상 `npm test` (TZ=Asia/Seoul 고정). 특정 파일만: `npm test -- src/services/__tests__/weather.test.ts`
- 타입 검사: `npx tsc --noEmit`. 린트: `npm run lint`. 각 태스크 커밋 전 둘 다 통과해야 한다.
- 커밋 메시지는 한국어 conventional commit: `feat(weather): …` / `test(weather): …` 형식. 마지막 줄에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 추가.
- 주석·테스트 설명은 기존 코드처럼 한국어로 쓴다.
- 새 Expo API는 사용하지 않는다(기존 `getMyLocation()` 재사용). 날씨 조회는 전역 `fetch` 사용.
- `weather_code`와 `temperature_c`는 항상 함께 기록되거나 함께 `null` (DB check 제약으로 강제).
- Supabase 원격 프로젝트는 CLI로 link되어 있음 (프로젝트 ref `hytckdlqvfmrqpocgzin`).
- **주의:** 작업 시작 시점에 `app/run/[id].tsx`에 커밋 안 된 변경(로딩·미존재 상태 분리)이 있다. 날씨 작업과 무관하므로 **Task 1 시작 전에 별도 커밋**한다: `git add "app/run/[id].tsx" && git commit -m "feat(run): 상세 화면 로딩·미존재 상태 분리"`. 이미 커밋됐다면 건너뛴다.

---

### Task 1: DB 마이그레이션 + 타입 재생성

**Files:**
- Create: `supabase/migrations/20260813000000_runs_weather.sql`
- Modify: `src/types/database.types.ts` (자동 생성으로 갱신)
- Modify: `src/services/__tests__/runs.test.ts:71-81` (baseRow에 새 컬럼 추가 — 타입 오류 방지)

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `runs` 테이블·`runs_with_geojson` 뷰의 `weather_code: number | null`, `temperature_c: number | null` 컬럼. `Tables<'runs_with_geojson'>` 타입에 두 필드 포함.

- [ ] **Step 1: 마이그레이션 파일 작성**

`supabase/migrations/20260813000000_runs_weather.sql`:

```sql
-- 러닝 시작 시점 날씨. null = 조회 실패·구버전 기록.
-- 두 컬럼은 항상 함께 기록되거나 함께 null (원자적 기록).
alter table public.runs add column weather_code smallint
  check (weather_code between 0 and 99);
alter table public.runs add column temperature_c real
  check (temperature_c between -90 and 60);
alter table public.runs add constraint runs_weather_atomic
  check ((weather_code is null) = (temperature_c is null));

-- create or replace는 컬럼 순서 제약이 있어 drop 후 재생성 (의존 객체 없음)
drop view public.runs_with_geojson;
create view public.runs_with_geojson
  with (security_invoker = on) as
select
  id,
  user_id,
  started_at,
  duration_sec,
  distance_m,
  extensions.st_asgeojson(route) as route_geojson,
  route_points,
  steps,
  weather_code,
  temperature_c,
  created_at
from public.runs;
```

- [ ] **Step 2: 원격에 적용**

Run: `supabase db push`
Expected: `20260813000000_runs_weather.sql` 적용 성공. (CLI 로그인 문제로 실패하면 Supabase MCP `apply_migration`으로 동일 SQL을 적용하고, 마이그레이션 파일은 그대로 커밋한다.)

- [ ] **Step 3: 타입 재생성**

Run: `npm run gen:types`
Expected: `src/types/database.types.ts`의 `runs`·`runs_with_geojson`에 `weather_code`, `temperature_c` 필드가 생김. `git diff src/types/database.types.ts`로 확인.

- [ ] **Step 4: 기존 테스트의 baseRow 갱신**

`src/services/__tests__/runs.test.ts`의 `describe('rowToRunRecord')` 안 `baseRow`에 두 필드 추가 (뷰 타입이 필드를 요구하므로 없으면 `tsc` 실패):

```ts
  const baseRow = {
    id: 'abc',
    user_id: 'user-1',
    started_at: '2026-08-03T01:00:00Z',
    duration_sec: 600,
    distance_m: 2000,
    route_geojson: null,
    steps: null as number | null,
    route_points: null,
    weather_code: null as number | null,
    temperature_c: null as number | null,
    created_at: '2026-08-03T01:10:00Z',
  };
```

- [ ] **Step 5: 검증 후 커밋**

Run: `npx tsc --noEmit && npm test`
Expected: 모두 통과.

```bash
git add supabase/migrations/20260813000000_runs_weather.sql src/types/database.types.ts src/services/__tests__/runs.test.ts
git commit -m "feat(weather): runs 테이블에 weather_code·temperature_c 컬럼 추가"
```

---

### Task 2: RunRecord·FinishedRun 날씨 필드 매핑

**Files:**
- Modify: `src/types/run.ts` (RunRecord)
- Modify: `src/services/runs.ts` (FinishedRun, rowToRunRecord, saveRun)
- Test: `src/services/__tests__/runs.test.ts`

**Interfaces:**
- Consumes: Task 1의 뷰 컬럼 `weather_code`, `temperature_c`
- Produces:
  - `RunRecord.weatherCode: number | null`, `RunRecord.temperatureC: number | null`
  - `FinishedRun.weatherCode: number | null`, `FinishedRun.temperatureC: number | null`
  - `saveRun()`이 insert에 `weather_code`, `temperature_c` 포함

- [ ] **Step 1: 실패하는 테스트 작성**

`src/services/__tests__/runs.test.ts`의 `describe('rowToRunRecord')` 끝에 추가:

```ts
  it('weather_code·temperature_c를 매핑한다', () => {
    const rec = rowToRunRecord({ ...baseRow, weather_code: 3, temperature_c: 21.4 });
    expect(rec?.weatherCode).toBe(3);
    expect(rec?.temperatureC).toBe(21.4);
  });

  it('날씨가 null이어도 레코드는 유지 (구버전·조회 실패 기록)', () => {
    const rec = rowToRunRecord(baseRow);
    expect(rec).not.toBeNull();
    expect(rec?.weatherCode).toBeNull();
    expect(rec?.temperatureC).toBeNull();
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/services/__tests__/runs.test.ts`
Expected: FAIL — `rec?.weatherCode`가 `undefined` (필드 미구현)

- [ ] **Step 3: 구현**

`src/types/run.ts`의 `RunRecord`에 추가:

```ts
  weatherCode: number | null; // WMO weather code. null = 조회 실패·구버전 기록
  temperatureC: number | null; // °C. weatherCode와 항상 함께 기록되거나 함께 null
```

`src/services/runs.ts`:

`FinishedRun`에 추가:

```ts
  weatherCode: number | null; // WMO weather code. null = 조회 실패
  temperatureC: number | null; // °C
```

`rowToRunRecord()` 반환 객체에 추가:

```ts
    weatherCode: row.weather_code ?? null,
    temperatureC: row.temperature_c ?? null,
```

`saveRun()`의 insert 객체에 추가:

```ts
      weather_code: run.weatherCode,
      temperature_c: run.temperatureC,
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- src/services/__tests__/runs.test.ts`
Expected: PASS. 단, `app/(tabs)/index.tsx`의 `saveRun()` 호출부가 새 필수 필드 누락으로 `npx tsc --noEmit`이 실패한다 — 이번 태스크에서 임시로 채운다:

`app/(tabs)/index.tsx`의 `saveRun({...})` 인자에 추가 (Task 6에서 실제 값으로 교체):

```ts
      weatherCode: null,
      temperatureC: null,
```

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/types/run.ts src/services/runs.ts src/services/__tests__/runs.test.ts "app/(tabs)/index.tsx"
git commit -m "feat(weather): RunRecord·FinishedRun에 날씨 필드 추가"
```

---

### Task 3: Open-Meteo 날씨 조회 서비스

**Files:**
- Create: `src/services/weather.ts`
- Test: `src/services/__tests__/weather.test.ts`

**Interfaces:**
- Consumes: 없음 (전역 fetch만 사용)
- Produces:

```ts
export interface CurrentWeather {
  weatherCode: number; // WMO weather code
  temperatureC: number;
}
export function fetchCurrentWeather(
  latitude: number,
  longitude: number
): Promise<CurrentWeather | null>;
```

- [ ] **Step 1: 실패하는 테스트 작성**

`src/services/__tests__/weather.test.ts`:

```ts
import { fetchCurrentWeather } from '../weather';

const okResponse = (body: unknown) =>
  ({ ok: true, json: async () => body }) as Response;

describe('fetchCurrentWeather', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('현재 날씨 코드·기온을 파싱한다', async () => {
    global.fetch = jest.fn(async () =>
      okResponse({ current: { temperature_2m: 21.4, weather_code: 3 } })
    );
    await expect(fetchCurrentWeather(37.5, 127.0)).resolves.toEqual({
      weatherCode: 3,
      temperatureC: 21.4,
    });
  });

  it('요청 URL에 좌표와 current 파라미터를 포함한다', async () => {
    const spy = jest.fn(async () =>
      okResponse({ current: { temperature_2m: 0, weather_code: 0 } })
    );
    global.fetch = spy;
    await fetchCurrentWeather(37.5, 127.0);
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain('latitude=37.5');
    expect(url).toContain('longitude=127');
    expect(url).toContain('current=temperature_2m,weather_code');
  });

  it('HTTP 오류면 null', async () => {
    global.fetch = jest.fn(async () => ({ ok: false }) as Response);
    await expect(fetchCurrentWeather(37.5, 127.0)).resolves.toBeNull();
  });

  it('네트워크 오류면 null', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('network');
    });
    await expect(fetchCurrentWeather(37.5, 127.0)).resolves.toBeNull();
  });

  it('응답 필드가 없거나 형식이 어긋나면 null', async () => {
    global.fetch = jest.fn(async () => okResponse({}));
    await expect(fetchCurrentWeather(37.5, 127.0)).resolves.toBeNull();

    global.fetch = jest.fn(async () =>
      okResponse({ current: { temperature_2m: '21', weather_code: 3 } })
    );
    await expect(fetchCurrentWeather(37.5, 127.0)).resolves.toBeNull();
  });

  it('5초 내 응답이 없으면 abort되어 null', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('Aborted'))
          );
        })
    ) as jest.MockedFunction<typeof fetch>;
    const promise = fetchCurrentWeather(37.5, 127.0);
    jest.advanceTimersByTime(5000);
    await expect(promise).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/services/__tests__/weather.test.ts`
Expected: FAIL — `Cannot find module '../weather'`

- [ ] **Step 3: 구현**

`src/services/weather.ts`:

```ts
export interface CurrentWeather {
  weatherCode: number; // WMO weather code
  temperatureC: number;
}

const TIMEOUT_MS = 5000;

/**
 * Open-Meteo로 현재 날씨를 1회 조회한다. API 키 불필요.
 * HTTP 오류·타임아웃·형식 이상 등 모든 실패는 null — throw하지 않는다.
 */
export async function fetchCurrentWeather(
  latitude: number,
  longitude: number
): Promise<CurrentWeather | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,weather_code`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      current?: { temperature_2m?: unknown; weather_code?: unknown };
    };
    const code = json.current?.weather_code;
    const temp = json.current?.temperature_2m;
    if (typeof code !== 'number' || typeof temp !== 'number') return null;
    return { weatherCode: code, temperatureC: temp };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- src/services/__tests__/weather.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/services/weather.ts src/services/__tests__/weather.test.ts
git commit -m "feat(weather): Open-Meteo 현재 날씨 조회 서비스"
```

---

### Task 4: WMO 코드 → 이모지·라벨 매핑 유틸

**Files:**
- Create: `src/lib/weather.ts`
- Test: `src/lib/__tests__/weather.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:

```ts
export interface WeatherLabel {
  emoji: string;
  label: string;
}
export function weatherLabel(code: number): WeatherLabel;
```

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/__tests__/weather.test.ts`:

```ts
import { weatherLabel } from '../weather';

describe('weatherLabel', () => {
  it.each([
    [0, '☀️', '맑음'],
    [1, '🌤', '대체로 맑음'],
    [2, '🌤', '대체로 맑음'],
    [3, '☁️', '흐림'],
    [45, '🌫', '안개'],
    [48, '🌫', '안개'],
    [51, '🌧', '비'],
    [61, '🌧', '비'],
    [67, '🌧', '비'],
    [80, '🌧', '비'],
    [82, '🌧', '비'],
    [71, '❄️', '눈'],
    [77, '❄️', '눈'],
    [85, '❄️', '눈'],
    [86, '❄️', '눈'],
    [95, '⛈', '뇌우'],
    [99, '⛈', '뇌우'],
  ])('코드 %i → %s %s', (code, emoji, label) => {
    expect(weatherLabel(code)).toEqual({ emoji, label });
  });

  it('미지정 코드는 기타로 폴백', () => {
    expect(weatherLabel(42)).toEqual({ emoji: '🌡', label: '기타' });
    expect(weatherLabel(-1)).toEqual({ emoji: '🌡', label: '기타' });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/lib/__tests__/weather.test.ts`
Expected: FAIL — `Cannot find module '../weather'`

- [ ] **Step 3: 구현**

`src/lib/weather.ts`:

```ts
export interface WeatherLabel {
  emoji: string;
  label: string;
}

/** WMO weather code를 표시용 이모지·한글 라벨로 변환한다. */
export function weatherLabel(code: number): WeatherLabel {
  if (code === 0) return { emoji: '☀️', label: '맑음' };
  if (code === 1 || code === 2) return { emoji: '🌤', label: '대체로 맑음' };
  if (code === 3) return { emoji: '☁️', label: '흐림' };
  if (code === 45 || code === 48) return { emoji: '🌫', label: '안개' };
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82))
    return { emoji: '🌧', label: '비' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86)
    return { emoji: '❄️', label: '눈' };
  if (code >= 95 && code <= 99) return { emoji: '⛈', label: '뇌우' };
  return { emoji: '🌡', label: '기타' };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- src/lib/__tests__/weather.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/weather.ts src/lib/__tests__/weather.test.ts
git commit -m "feat(weather): WMO 코드 이모지·한글 라벨 매핑"
```

---

### Task 5: runStore 날씨 상태 + setWeather 액션

**Files:**
- Modify: `src/stores/runStore.ts`
- Test: `src/stores/__tests__/runStore.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `RunState.weatherCode: number | null`, `RunState.temperatureC: number | null`
  - `RunState.setWeather(startedAt: number, weatherCode: number, temperatureC: number): void` — store의 현재 `startedAt`과 일치할 때만 반영

- [ ] **Step 1: 실패하는 테스트 작성**

`src/stores/__tests__/runStore.test.ts` 끝에 추가 (기존 파일의 beforeEach/reset 패턴을 따라 각 테스트 시작 시 store를 초기화):

```ts
describe('setWeather', () => {
  beforeEach(() => useRunStore.getState().reset());

  it('startedAt이 일치하면 날씨를 반영한다', () => {
    useRunStore.getState().start(1000);
    useRunStore.getState().setWeather(1000, 3, 21.4);
    expect(useRunStore.getState().weatherCode).toBe(3);
    expect(useRunStore.getState().temperatureC).toBe(21.4);
  });

  it('startedAt이 다르면 무시한다 (늦은 응답이 다음 러닝 오염 방지)', () => {
    useRunStore.getState().start(1000);
    useRunStore.getState().setWeather(999, 3, 21.4);
    expect(useRunStore.getState().weatherCode).toBeNull();
    expect(useRunStore.getState().temperatureC).toBeNull();
  });

  it('reset 후에는 무시한다', () => {
    useRunStore.getState().start(1000);
    useRunStore.getState().reset();
    useRunStore.getState().setWeather(1000, 3, 21.4);
    expect(useRunStore.getState().weatherCode).toBeNull();
  });

  it('start()가 이전 날씨를 초기화한다', () => {
    useRunStore.getState().start(1000);
    useRunStore.getState().setWeather(1000, 3, 21.4);
    useRunStore.getState().start(2000);
    expect(useRunStore.getState().weatherCode).toBeNull();
    expect(useRunStore.getState().temperatureC).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/stores/__tests__/runStore.test.ts`
Expected: FAIL — `setWeather is not a function`

- [ ] **Step 3: 구현**

`src/stores/runStore.ts`:

`RunState` 인터페이스에 추가 (상태는 `segments` 아래, 액션은 `beginSave` 위):

```ts
  weatherCode: number | null; // WMO weather code. null = 아직 조회 전·실패
  temperatureC: number | null; // °C
  setWeather: (startedAt: number, weatherCode: number, temperatureC: number) => void;
```

`initial` 객체에 추가:

```ts
  weatherCode: null as number | null,
  temperatureC: null as number | null,
```

스토어에 액션 추가 (`beginSave` 위):

```ts
  // 조회를 시작한 러닝(startedAt)이 여전히 현재 러닝일 때만 반영 —
  // 늦게 도착한 응답이 reset 후 상태나 다음 러닝을 오염시키지 않는다.
  setWeather: (startedAt, weatherCode, temperatureC) => {
    if (get().startedAt !== startedAt) return;
    set({ weatherCode, temperatureC });
  },
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- src/stores/__tests__/runStore.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/stores/runStore.ts src/stores/__tests__/runStore.test.ts
git commit -m "feat(weather): runStore에 날씨 상태·setWeather 액션 추가"
```

---

### Task 6: 시작·저장 흐름 연결

**Files:**
- Modify: `app/(tabs)/index.tsx` (`onStart`, `onStop`, Task 2에서 넣은 임시 `null` 교체)

**Interfaces:**
- Consumes:
  - Task 3 `fetchCurrentWeather(lat, lng): Promise<CurrentWeather | null>`
  - Task 5 `useRunStore.getState().setWeather(startedAt, weatherCode, temperatureC)`, `weatherCode`/`temperatureC` 상태
  - 기존 `getMyLocation()` (`@/services/location`)
- Produces: 저장되는 러닝에 날씨 포함 (UI 표시는 Task 7)

- [ ] **Step 1: 시작 시 fire-and-forget 조회 추가**

`app/(tabs)/index.tsx`에 import 추가:

```ts
import { fetchCurrentWeather } from '@/services/weather';
```

(`getMyLocation`은 이미 import되어 있으면 재사용, 없으면 `@/services/location`에서 추가.)

컴포넌트 안에 헬퍼 추가 후 `onStart`에서 `useRunStore.getState().start(Date.now())` 다음 줄에 `void fetchWeatherForRun();` 호출:

```ts
  // 러닝 시작 시점 날씨를 백그라운드로 조회 — 실패해도 러닝 흐름에 영향 없음
  const fetchWeatherForRun = async () => {
    const startedAt = useRunStore.getState().startedAt;
    if (startedAt === null) return;
    const loc = await getMyLocation();
    if (loc.status !== 'granted') return;
    const w = await fetchCurrentWeather(loc.coords.latitude, loc.coords.longitude);
    if (w) useRunStore.getState().setWeather(startedAt, w.weatherCode, w.temperatureC);
  };
```

- [ ] **Step 2: 저장 시 폴백 재시도 + saveRun에 전달**

`onStop`에서 `const steps = …` 다음, `saveRun({…})` 호출 전에 추가하고, Task 2에서 넣은 임시 `weatherCode: null, temperatureC: null`을 실제 값으로 교체:

```ts
    // 시작 시 조회가 실패했으면 마지막 GPS 좌표로 1회 재시도. 실패해도 저장은 계속.
    let weatherCode = s.weatherCode;
    let temperatureC = s.temperatureC;
    if (weatherCode === null || temperatureC === null) {
      const last = s.points[s.points.length - 1];
      const w = last
        ? await fetchCurrentWeather(last.latitude, last.longitude)
        : null;
      if (w) {
        weatherCode = w.weatherCode;
        temperatureC = w.temperatureC;
      }
    }
```

`saveRun` 인자:

```ts
      weatherCode,
      temperatureC,
```

- [ ] **Step 3: 검증**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: 모두 통과.

- [ ] **Step 4: 커밋**

```bash
git add "app/(tabs)/index.tsx"
git commit -m "feat(weather): 러닝 시작·저장 시 날씨 조회 연결"
```

---

### Task 7: 상세·히스토리 화면 표시

**Files:**
- Modify: `app/run/[id].tsx` (메타 라인)
- Modify: `app/(tabs)/history.tsx` (목록 항목 둘째 줄)

**Interfaces:**
- Consumes:
  - Task 2 `RunRecord.weatherCode`, `RunRecord.temperatureC`
  - Task 4 `weatherLabel(code): { emoji, label }` (`@/lib/weather`)
- Produces: 사용자에게 보이는 날씨 표시 (최종 태스크)

- [ ] **Step 1: 상세 화면 메타 라인에 추가**

`app/run/[id].tsx`에 import 추가:

```ts
import { weatherLabel } from '@/lib/weather';
```

메타 라인 `<Text className="text-muted-foreground">` 내부, `{gain !== null && …}` 다음에 추가:

```tsx
          {run.weatherCode !== null &&
            run.temperatureC !== null &&
            ` · ${weatherLabel(run.weatherCode).emoji} ${Math.round(run.temperatureC)}°C`}
```

- [ ] **Step 2: 히스토리 목록에 추가**

`app/(tabs)/history.tsx`에 import 추가:

```ts
import { weatherLabel } from '@/lib/weather';
```

`renderItem`의 둘째 `<Text className="text-muted-foreground">` 내부 끝에 추가:

```tsx
            {item.weatherCode !== null &&
              item.temperatureC !== null &&
              ` · ${weatherLabel(item.weatherCode).emoji} ${Math.round(item.temperatureC)}°`}
```

- [ ] **Step 3: 검증**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: 모두 통과.

- [ ] **Step 4: 커밋**

```bash
git add "app/run/[id].tsx" "app/(tabs)/history.tsx"
git commit -m "feat(weather): 상세·히스토리 화면에 날씨·기온 표시"
```
