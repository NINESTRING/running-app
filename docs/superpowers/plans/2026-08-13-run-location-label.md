# 러닝 기록 위치 라벨 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 러닝 기록에 시작 지점 행정구역 라벨(예: "서울 강남구 서초동")을 자동 기록하고 기록 목록·상세 화면에 표시한다. 과거 기록은 기록 탭에서 lazy 백필한다.

**Architecture:** 날씨 기능(`weather_code`)과 동일한 패턴. Supabase `runs`에 nullable `location_label text` 컬럼 추가 → 저장 시 경로 첫 좌표를 `expo-location` 내장 `reverseGeocodeAsync`로 지오코딩 → 라벨 조합은 순수 함수(`src/lib/location.ts`)로 분리해 유닛 테스트. 과거 기록은 기록 탭 포커스 시 최대 5건씩 순차 백필.

**Tech Stack:** Expo SDK 57 (`expo-location ~57.0.9`), Supabase (linked 원격 프로젝트, CLI 마이그레이션), Jest.

**Spec:** `docs/superpowers/specs/2026-08-13-run-location-label-design.md`

## Global Constraints

- Expo SDK 57 기준. 코드 작성 전 https://docs.expo.dev/versions/v57.0.0/ 문서 확인 (AGENTS.md). `Location.reverseGeocodeAsync`는 SDK 57에서 deprecated 아님 (확인 완료).
- 지오코딩 실패(타임아웃·오류·빈 결과)는 전부 `null`로 수렴한다. throw 금지. 러닝 저장을 막거나 지연시키지 않는다.
- 라벨 형식: "서울 강남구 서초동" (시·구·동). "특별시·광역시·특별자치시·특별자치도" 접미사는 축약, 도(道)는 그대로.
- 테스트 실행: `npm test` (`TZ=Asia/Seoul jest`). 테스트 설명은 기존 스타일대로 한국어.
- main 브랜치에 직접 커밋. 커밋 메시지는 기존 스타일(한국어 + conventional prefix, 예: `feat(history): …`).
- 주석은 기존 코드처럼 한국어로, "왜"를 설명할 때만.

---

### Task 1: DB 마이그레이션 + 타입 재생성

**Files:**
- Create: `supabase/migrations/20260813120000_runs_location_label.sql`
- Modify: `src/types/database.types.ts` (자동 생성)

**Interfaces:**
- Consumes: 없음
- Produces: `runs.location_label text` 컬럼, `runs_with_geojson` 뷰의 `location_label` 컬럼. 이후 태스크의 `row.location_label` 타입 기반.

- [ ] **Step 1: 마이그레이션 파일 작성**

`supabase/migrations/20260813120000_runs_location_label.sql`:

```sql
-- 러닝 시작 지점 행정구역 라벨 (예: '서울 강남구 서초동').
-- null = 미조회·조회 실패·구버전 기록. 기록 탭에서 lazy 백필된다.
alter table public.runs add column location_label text;

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
  location_label,
  created_at
from public.runs;
```

백필은 기존 UPDATE RLS 정책("본인 기록 수정", `20260807083642_fix_runs_update_policy.sql`)으로 충분하므로 정책 변경 없음.

- [ ] **Step 2: 원격 DB에 적용**

Run: `npx supabase db push`
Expected: `20260813120000_runs_location_label.sql` 적용 성공 메시지. (nullable 컬럼 추가라 테이블 리라이트·락 없음)

- [ ] **Step 3: TypeScript 타입 재생성**

Run: `npm run gen:types`
Expected: `src/types/database.types.ts`의 `runs` Row/Insert/Update와 `runs_with_geojson` Row에 `location_label: string | null` 추가됨. `git diff src/types/database.types.ts`로 확인.

- [ ] **Step 4: 기존 테스트 통과 확인**

Run: `npm test`
Expected: 전부 PASS (컬럼 추가만으로는 기존 코드 영향 없음. 단, `src/services/__tests__/runs.test.ts`의 `baseRow`가 실패하면 Task 4에서 고치므로 여기서는 타입 에러 여부만 확인 — `npx tsc --noEmit`도 PASS여야 함. 뷰 Row 타입은 전부 nullable이라 기존 리터럴도 유효)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260813120000_runs_location_label.sql src/types/database.types.ts
git commit -m "feat(db): runs에 location_label 컬럼 추가"
```

---

### Task 2: 라벨 조합 순수 함수 `formatLocationLabel`

**Files:**
- Create: `src/lib/location.ts`
- Test: `src/lib/__tests__/location.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `formatLocationLabel(a: GeocodedAddressParts): string | null`, `interface GeocodedAddressParts { region: string | null; city: string | null; subregion: string | null; district: string | null }` — Task 3이 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/__tests__/location.test.ts`:

```ts
import { formatLocationLabel } from '../location';

describe('formatLocationLabel', () => {
  it('시·구·동을 공백으로 연결한다 (Android식: subregion에 구)', () => {
    expect(
      formatLocationLabel({
        region: '서울특별시',
        city: null,
        subregion: '강남구',
        district: '서초동',
      })
    ).toBe('서울 강남구 서초동');
  });

  it('city가 있으면 subregion보다 우선한다 (iOS식)', () => {
    expect(
      formatLocationLabel({
        region: '서울특별시',
        city: '강남구',
        subregion: '서울',
        district: '서초동',
      })
    ).toBe('서울 강남구 서초동');
  });

  it('광역시·특별자치시·특별자치도 접미사를 축약한다', () => {
    expect(
      formatLocationLabel({
        region: '부산광역시',
        city: null,
        subregion: '해운대구',
        district: '우동',
      })
    ).toBe('부산 해운대구 우동');
    expect(
      formatLocationLabel({
        region: '세종특별자치시',
        city: null,
        subregion: null,
        district: '보람동',
      })
    ).toBe('세종 보람동');
    expect(
      formatLocationLabel({
        region: '제주특별자치도',
        city: '제주시',
        subregion: null,
        district: '이도이동',
      })
    ).toBe('제주 제주시 이도이동');
  });

  it('도(道)는 축약하지 않는다', () => {
    expect(
      formatLocationLabel({
        region: '경기도',
        city: '성남시',
        subregion: null,
        district: '정자동',
      })
    ).toBe('경기도 성남시 정자동');
  });

  it('null·공백 파트는 생략한다', () => {
    expect(
      formatLocationLabel({
        region: '서울특별시',
        city: null,
        subregion: null,
        district: null,
      })
    ).toBe('서울');
    expect(
      formatLocationLabel({ region: null, city: '강남구', subregion: null, district: ' ' })
    ).toBe('강남구');
  });

  it('인접 중복 파트는 하나만 남긴다', () => {
    expect(
      formatLocationLabel({
        region: '서울특별시',
        city: '서울',
        subregion: null,
        district: '서초동',
      })
    ).toBe('서울 서초동');
  });

  it('모든 파트가 없으면 null', () => {
    expect(
      formatLocationLabel({ region: null, city: null, subregion: null, district: null })
    ).toBeNull();
    expect(
      formatLocationLabel({ region: '', city: null, subregion: '', district: null })
    ).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/lib/__tests__/location.test.ts`
Expected: FAIL — `Cannot find module '../location'`

- [ ] **Step 3: 구현**

`src/lib/location.ts`:

```ts
export interface GeocodedAddressParts {
  region: string | null; // 시/도 (예: "서울특별시")
  city: string | null; // 시/구 — 플랫폼에 따라 채워지는 필드가 다름 (iOS 위주)
  subregion: string | null; // 구 — Android 폴백
  district: string | null; // 동 (예: "서초동")
}

// endsWith 매칭이므로 긴 접미사를 먼저 검사한다
const REGION_SUFFIXES = ['특별자치시', '특별자치도', '특별시', '광역시'];

function shortenRegion(name: string): string {
  for (const suffix of REGION_SUFFIXES) {
    if (name.endsWith(suffix) && name.length > suffix.length) {
      return name.slice(0, -suffix.length);
    }
  }
  return name;
}

/**
 * reverseGeocode 결과를 "서울 강남구 서초동" 형태로 조합한다.
 * iOS(Apple)·Android(Google)가 필드를 다르게 채우므로 구는 city ?? subregion 폴백.
 * 유효한 파트가 하나도 없으면 null.
 */
export function formatLocationLabel(a: GeocodedAddressParts): string | null {
  const parts = [a.region, a.city ?? a.subregion, a.district]
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .map((p) => shortenRegion(p.trim()));
  const deduped = parts.filter((p, i) => p !== parts[i - 1]);
  return deduped.length > 0 ? deduped.join(' ') : null;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- src/lib/__tests__/location.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/location.ts src/lib/__tests__/location.test.ts
git commit -m "feat(location): 행정구역 라벨 조합 순수 함수 추가"
```

---

### Task 3: 지오코딩 서비스 `fetchLocationLabel`

**Files:**
- Create: `src/services/geocoding.ts`
- Test: `src/services/__tests__/geocoding.test.ts`

**Interfaces:**
- Consumes: Task 2의 `formatLocationLabel`, `expo-location`의 `reverseGeocodeAsync`
- Produces: `fetchLocationLabel(latitude: number, longitude: number): Promise<string | null>` — Task 5(저장)·Task 7(백필)이 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/services/__tests__/geocoding.test.ts`:

```ts
import * as Location from 'expo-location';
import { fetchLocationLabel } from '../geocoding';

jest.mock('expo-location', () => ({
  reverseGeocodeAsync: jest.fn(),
}));

const mockReverse = Location.reverseGeocodeAsync as jest.MockedFunction<
  typeof Location.reverseGeocodeAsync
>;

const address = (over: Record<string, unknown>) =>
  ({
    region: null,
    city: null,
    subregion: null,
    district: null,
    country: null,
    isoCountryCode: null,
    name: null,
    postalCode: null,
    street: null,
    streetNumber: null,
    timezone: null,
    formattedAddress: null,
    ...over,
  }) as Location.LocationGeocodedAddress;

describe('fetchLocationLabel', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('첫 결과를 라벨로 조합한다', async () => {
    mockReverse.mockResolvedValue([
      address({ region: '서울특별시', subregion: '강남구', district: '서초동' }),
    ]);
    await expect(fetchLocationLabel(37.49, 127.01)).resolves.toBe('서울 강남구 서초동');
    expect(mockReverse).toHaveBeenCalledWith({ latitude: 37.49, longitude: 127.01 });
  });

  it('결과가 비어 있으면 null', async () => {
    mockReverse.mockResolvedValue([]);
    await expect(fetchLocationLabel(37.49, 127.01)).resolves.toBeNull();
  });

  it('주소 필드가 전부 비어 있으면 null', async () => {
    mockReverse.mockResolvedValue([address({})]);
    await expect(fetchLocationLabel(37.49, 127.01)).resolves.toBeNull();
  });

  it('지오코더가 throw하면 null', async () => {
    mockReverse.mockRejectedValue(new Error('geocoder unavailable'));
    await expect(fetchLocationLabel(37.49, 127.01)).resolves.toBeNull();
  });

  it('5초 내 응답이 없으면 null', async () => {
    jest.useFakeTimers();
    mockReverse.mockReturnValue(new Promise(() => {}));
    const promise = fetchLocationLabel(37.49, 127.01);
    jest.advanceTimersByTime(5000);
    await expect(promise).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/services/__tests__/geocoding.test.ts`
Expected: FAIL — `Cannot find module '../geocoding'`

- [ ] **Step 3: 구현**

`src/services/geocoding.ts`:

```ts
import * as Location from 'expo-location';
import { formatLocationLabel } from '../lib/location';

const TIMEOUT_MS = 5000;

/**
 * 좌표를 "서울 강남구 서초동" 형태의 행정구역 라벨로 변환한다.
 * OS 지오코더 사용(API 키 불필요). 타임아웃·오류·빈 결과 등 모든 실패는 null — throw하지 않는다.
 * 위치 권한은 러닝 기능에서 이미 확보된 상태를 전제한다 (새로 요청하지 않음).
 */
export async function fetchLocationLabel(
  latitude: number,
  longitude: number
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // reverseGeocodeAsync는 abort를 지원하지 않아 race로 타임아웃만 건다
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), TIMEOUT_MS);
    });
    const results = await Promise.race([
      Location.reverseGeocodeAsync({ latitude, longitude }),
      timeout,
    ]);
    const first = results?.[0];
    if (!first) return null;
    return formatLocationLabel({
      region: first.region,
      city: first.city,
      subregion: first.subregion,
      district: first.district,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- src/services/__tests__/geocoding.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/geocoding.ts src/services/__tests__/geocoding.test.ts
git commit -m "feat(geocoding): 좌표→행정구역 라벨 서비스 추가"
```

---

### Task 4: 타입·저장·조회·업데이트 경로 확장

**Files:**
- Modify: `src/types/run.ts` (RunRecord)
- Modify: `src/services/runs.ts` (FinishedRun, saveRun, rowToRunRecord, 신규 updateRunLocationLabel)
- Test: `src/services/__tests__/runs.test.ts`

**Interfaces:**
- Consumes: Task 1의 `location_label` 컬럼 타입
- Produces:
  - `RunRecord.locationLabel: string | null`
  - `FinishedRun.locationLabel: string | null` — Task 5가 사용
  - `updateRunLocationLabel(id: string, label: string): Promise<boolean>` — Task 7이 사용

- [ ] **Step 1: 실패하는 테스트 작성**

`src/services/__tests__/runs.test.ts`의 `baseRow`(70행 부근)에 필드 추가:

```ts
  const baseRow = {
    // …기존 필드 유지…
    weather_code: null as number | null,
    temperature_c: null as number | null,
    location_label: null as string | null,
    created_at: '2026-08-03T01:10:00Z',
  };
```

`describe('rowToRunRecord', …)` 블록 끝에 테스트 추가:

```ts
  it('location_label을 매핑한다', () => {
    const rec = rowToRunRecord({ ...baseRow, location_label: '서울 강남구 서초동' });
    expect(rec?.locationLabel).toBe('서울 강남구 서초동');
  });

  it('location_label이 null이어도 레코드는 유지 (구버전·미조회 기록)', () => {
    const rec = rowToRunRecord(baseRow);
    expect(rec).not.toBeNull();
    expect(rec?.locationLabel).toBeNull();
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/services/__tests__/runs.test.ts`
Expected: FAIL — `locationLabel`이 `undefined` (RunRecord에 필드 없음 → TS 에러로 먼저 실패할 수 있음. 어느 쪽이든 실패 확인)

- [ ] **Step 3: 구현**

`src/types/run.ts`의 `RunRecord` 마지막에 추가:

```ts
  locationLabel: string | null; // 시작 지점 행정구역 라벨 (예: "서울 강남구 서초동"). null = 미조회·조회 실패·구버전 기록
```

`src/services/runs.ts`:

`FinishedRun`(6-15행)에 추가:

```ts
  locationLabel: string | null; // 시작 지점 행정구역 라벨. null = 조회 실패·경로 없음
```

`rowToRunRecord`의 반환 객체(87-97행)에 추가:

```ts
    locationLabel: row.location_label ?? null,
```

`saveRun`의 insert 객체(107-116행)에 추가:

```ts
      location_label: run.locationLabel,
```

파일 끝에 신규 함수 추가:

```ts
/** 과거 기록 lazy 백필용 — location_label만 갱신. 실패 시 false (다음 기회에 재시도). */
export async function updateRunLocationLabel(
  id: string,
  label: string
): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase
      .from('runs')
      .update({ location_label: label })
      .eq('id', id);
    return !error;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- src/services/__tests__/runs.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: 에러 정확히 1개 — `app/(tabs)/index.tsx`의 `saveRun()` 호출에서 `locationLabel` 프로퍼티 누락. 이것은 의도된 중간 상태로 Task 5가 바로 채운다. 이 태스크에서 `index.tsx`를 건드리지 말 것. 다른 에러가 있으면 이 태스크의 구현을 고친다.

- [ ] **Step 5: Commit**

```bash
git add src/types/run.ts src/services/runs.ts src/services/__tests__/runs.test.ts
git commit -m "feat(runs): location_label 저장·조회·백필 업데이트 경로 추가"
```

---

### Task 5: 저장 시 지오코딩 (`onStop`)

**Files:**
- Modify: `app/(tabs)/index.tsx` (`onStop`, import)

**Interfaces:**
- Consumes: Task 3의 `fetchLocationLabel`, Task 4의 `FinishedRun.locationLabel`
- Produces: 새 러닝 기록에 `location_label` 저장됨

- [ ] **Step 1: onStop 수정**

`app/(tabs)/index.tsx` import에 추가:

```ts
import { fetchLocationLabel } from '@/services/geocoding';
```

`onStop`의 `Promise.all`(175-183행)을 다음으로 교체:

```ts
    const firstPoint = s.points[0];
    const [steps, weather, locationLabel] = await Promise.all([
      // iOS: CMPedometer 이력으로 백필 (화면 꺼짐 구간 보정). 실패·Android는 라이브 카운트.
      backfillSteps(s.segments).then((b) => b ?? s.steps),
      // 시작 시 조회 실패 시 마지막 GPS 좌표로 1회 재시도 — 백필과 병렬이라 저장을 추가 지연시키지 않음
      resolveRunWeather(
        { weatherCode: s.weatherCode, temperatureC: s.temperatureC },
        s.points[s.points.length - 1]
      ),
      // 시작 지점 행정구역 라벨 — 위치는 시간에 안 민감하므로 저장 시점에 조회
      firstPoint
        ? fetchLocationLabel(firstPoint.latitude, firstPoint.longitude)
        : Promise.resolve<string | null>(null),
    ]);
```

`saveRun({ … })` 호출(184-193행)에 필드 추가:

```ts
      weatherCode: weather.weatherCode,
      temperatureC: weather.temperatureC,
      locationLabel,
```

- [ ] **Step 2: 타입·테스트 확인**

Run: `npx tsc --noEmit && npm test`
Expected: 둘 다 PASS (Task 4에서 남았던 tsc 에러 해소)

- [ ] **Step 3: Commit**

```bash
git add "app/(tabs)/index.tsx"
git commit -m "feat(run): 저장 시 시작 지점 위치 라벨 기록"
```

---

### Task 6: 목록·상세 화면 표시

**Files:**
- Modify: `app/(tabs)/history.tsx` (renderItem, 89-105행)
- Modify: `app/run/[id].tsx` (77-91행)

**Interfaces:**
- Consumes: Task 4의 `RunRecord.locationLabel`
- Produces: 사용자에게 보이는 라벨 (null이면 줄 생략)

- [ ] **Step 1: 목록 행 셋째 줄 추가**

`app/(tabs)/history.tsx`의 `renderItem` Pressable 안, 둘째 `<Text>`(97-103행) 바로 뒤에:

```tsx
          {item.locationLabel !== null && (
            <Text className="text-sm text-muted-foreground">{item.locationLabel}</Text>
          )}
```

- [ ] **Step 2: 상세 화면에 라벨 추가**

`app/run/[id].tsx`의 날짜 `<Text>`(78-80행) 바로 뒤에:

```tsx
        {run.locationLabel !== null && (
          <Text className="text-sm text-muted-foreground">{run.locationLabel}</Text>
        )}
```

- [ ] **Step 3: 타입·린트 확인**

Run: `npx tsc --noEmit && npm run lint`
Expected: 둘 다 PASS

- [ ] **Step 4: Commit**

```bash
git add "app/(tabs)/history.tsx" "app/run/[id].tsx"
git commit -m "feat(history): 기록 목록·상세에 위치 라벨 표시"
```

---

### Task 7: 과거 기록 lazy 백필

**Files:**
- Modify: `src/lib/history.ts` (신규 `startCoords`)
- Modify: `app/(tabs)/history.tsx` (useFocusEffect, 22-32행)
- Test: `src/lib/__tests__/history.test.ts`

**Interfaces:**
- Consumes: Task 3의 `fetchLocationLabel`, Task 4의 `updateRunLocationLabel`
- Produces: `startCoords(run: RunRecord): { latitude: number; longitude: number } | null`

- [ ] **Step 1: startCoords 실패하는 테스트 작성**

`src/lib/__tests__/history.test.ts`에 추가 (파일 상단 import에 `startCoords` 추가, `RunRecord` 픽스처는 기존 헬퍼가 있으면 재사용하고 없으면 아래 헬퍼 사용):

```ts
import { startCoords } from '../history';
import type { RunRecord } from '../../types/run';

const baseRun: RunRecord = {
  id: 'r1',
  startedAt: '2026-08-13T07:00:00+09:00',
  durationSec: 600,
  distanceM: 2000,
  steps: null,
  routeGeojson: null,
  routePoints: null,
  weatherCode: null,
  temperatureC: null,
  locationLabel: null,
};

describe('startCoords', () => {
  it('원본 시계열의 첫 포인트를 반환한다', () => {
    const run: RunRecord = {
      ...baseRun,
      routePoints: [
        [{ latitude: 37.49, longitude: 127.01, altitude: null, timestamp: 1000 }],
      ],
      routeGeojson: { type: 'LineString', coordinates: [[126.9, 37.5]] },
    };
    expect(startCoords(run)).toEqual({ latitude: 37.49, longitude: 127.01 });
  });

  it('시계열이 없으면 GeoJSON 첫 좌표로 폴백한다 ([lng, lat] 순서 뒤집기)', () => {
    const run: RunRecord = {
      ...baseRun,
      routeGeojson: { type: 'LineString', coordinates: [[127.01, 37.49]] },
    };
    expect(startCoords(run)).toEqual({ latitude: 37.49, longitude: 127.01 });
  });

  it('첫 그룹이 비어 있으면 GeoJSON으로 폴백한다', () => {
    const run: RunRecord = {
      ...baseRun,
      routePoints: [[]],
      routeGeojson: { type: 'LineString', coordinates: [[127.01, 37.49]] },
    };
    expect(startCoords(run)).toEqual({ latitude: 37.49, longitude: 127.01 });
  });

  it('경로가 전혀 없으면 null', () => {
    expect(startCoords(baseRun)).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/lib/__tests__/history.test.ts`
Expected: FAIL — `startCoords`가 export되지 않음

- [ ] **Step 3: startCoords 구현**

`src/lib/history.ts` 끝에 추가:

```ts
/** 위치 라벨 백필용 시작 좌표. 원본 시계열 우선, 구버전 기록은 GeoJSON 폴백. 경로 없으면 null. */
export function startCoords(
  run: RunRecord
): { latitude: number; longitude: number } | null {
  const p = run.routePoints?.[0]?.[0];
  if (p) return { latitude: p.latitude, longitude: p.longitude };
  const c = run.routeGeojson?.coordinates[0];
  return c ? { latitude: c[1], longitude: c[0] } : null;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- src/lib/__tests__/history.test.ts`
Expected: PASS

- [ ] **Step 5: history 화면에 백필 연결**

`app/(tabs)/history.tsx` import에 추가:

```ts
import type { Dispatch, SetStateAction } from 'react';
import { startCoords } from '@/lib/history'; // 기존 history import 줄에 합침
import { fetchLocationLabel } from '@/services/geocoding';
import { listRuns, updateRunLocationLabel } from '@/services/runs'; // 기존 줄 수정
```

`useFocusEffect`(22-32행)를 다음으로 교체:

```ts
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      listRuns().then((r) => {
        if (cancelled) return;
        setRuns(r);
        void backfillLocationLabels(r, () => cancelled, setRuns);
      });
      return () => {
        cancelled = true;
      };
    }, [])
  );
```

파일 하단(컴포넌트 밖)에 추가:

```ts
// 기기 지오코더 부하를 고려한 포커스당 백필 상한
const BACKFILL_LIMIT_PER_FOCUS = 5;

// 라벨 없는 과거 기록을 화면이 떠 있는 동안 조용히 채운다 — 실패는 무시(다음 포커스에서 재시도)
async function backfillLocationLabels(
  runs: RunRecord[],
  isCancelled: () => boolean,
  setRuns: Dispatch<SetStateAction<RunRecord[] | null>>
) {
  const targets = runs
    .filter((r) => r.locationLabel === null && startCoords(r) !== null)
    .slice(0, BACKFILL_LIMIT_PER_FOCUS); // listRuns가 최신순이므로 최근 기록부터
  for (const run of targets) {
    if (isCancelled()) return;
    const coords = startCoords(run);
    if (!coords) continue;
    const label = await fetchLocationLabel(coords.latitude, coords.longitude);
    if (label === null) continue;
    if (!(await updateRunLocationLabel(run.id, label))) continue;
    if (isCancelled()) return;
    setRuns((prev) =>
      prev ? prev.map((x) => (x.id === run.id ? { ...x, locationLabel: label } : x)) : prev
    );
  }
}
```

- [ ] **Step 6: 전체 확인**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: 전부 PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/history.ts src/lib/__tests__/history.test.ts "app/(tabs)/history.tsx"
git commit -m "feat(history): 과거 기록 위치 라벨 lazy 백필"
```

---

## 수동 검증 (실기기)

자동화 불가 항목 — 구현 완료 후 iOS 실기기에서:

1. 새 러닝 저장 → 기록 탭 목록 행 셋째 줄과 상세 화면에 위치 라벨 표시 확인.
2. 과거 기록(라벨 없음)이 기록 탭 진입 후 잠시 뒤 라벨이 채워지는지 확인 (포커스당 최대 5건).
3. 비행기 모드에서 러닝 저장 → 라벨 없이 정상 저장되는지 확인.
