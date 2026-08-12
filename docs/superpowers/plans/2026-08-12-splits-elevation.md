# 구간(스플릿) 페이스 · 고도 표시 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) 문법으로 진행을 추적한다.

**Goal:** 러닝 기록을 1km/1mi 구간으로 나눠 구간별 페이스·고도 변화를 저장 없이 원본 GPS 시계열에서 계산해 표시하고, 총 상승고도·고도 그래프·러닝 중 실시간 구간 페이스를 제공한다.

**Architecture:** GPS 포인트에 고도를 추가 수집하고, 저장 시 `runs.route_points` JSONB 컬럼에 세그먼트(일시정지로 나뉜 러닝 구간)별 `[t, lat, lng, alt]` 튜플 배열로 원본을 저장한다. 구간·고도·그래프 계산은 전부 클라이언트 순수 함수(`src/lib/splits.ts`)로 하며, 라이브(홈)와 저장 기록(상세) 양쪽에서 재사용한다.

**Tech Stack:** Expo 57 (expo-location), Supabase(PostGIS + JSONB), Zustand, victory-native + Skia(차트), react-native-svg(웹 차트 폴백), Jest(jest-expo).

**Spec:** `docs/superpowers/specs/2026-08-12-splits-elevation-design.md`

## Global Constraints

- 코드 작성 전 Expo v57 문서(https://docs.expo.dev/versions/v57.0.0/) 기준으로 API를 확인한다 (AGENTS.md). 이 계획 작성 시점에 확인된 사실: `LocationObjectCoords.altitude`는 `number | null`(미터, WGS84 타원체 기준, 웹에서 null 가능), `LocationObject.timestamp`는 epoch ms.
- 테스트 실행: `npm test` (전체), `npm test -- <파일경로>` (단일 파일). jest-expo 프리셋, TZ=Asia/Seoul.
- 타입 체크: `npx tsc --noEmit`. 린트: `npm run lint`.
- import 규칙: `src/lib`·`src/services`는 상대 경로(예: `./geo`, `../types/run`), `src/components`와 `app/`은 `@/*` 별칭(→ `src/*`)을 주로 사용. 새 코드는 주변 파일 스타일을 따른다.
- UI 문구·코드 주석은 한국어. 커밋 메시지는 `feat(splits): …` 형식의 한국어 제목.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 푸터를 넣는다.
- 마일 환산: 1 mi = 1609.344 m. (기존 `formatDistance`의 표시용 0.621371과 별개)
- 과거 기록(`route_points` null)은 구간/고도 UI를 숨기고 기존 화면(지도+요약)을 유지한다.

## 파일 구조

| 파일 | 역할 |
|------|------|
| `src/types/run.ts` (수정) | `RoutePoint.altitude`, `RunRecord.routePoints` 추가 |
| `src/services/location.ts` (수정) | 트래킹 태스크에서 고도 수집 |
| `supabase/migrations/20260812100000_runs_route_points.sql` (생성) | JSONB 컬럼 + 뷰 재생성 |
| `src/types/database.types.ts` (재생성) | `npm run gen:types` 산출물 |
| `src/lib/splits.ts` (생성) | 순수 계산: 파티셔닝·스무딩·구간·상승고도·프로필 |
| `src/lib/__tests__/splits.test.ts` (생성) | splits 단위 테스트 |
| `src/services/runs.ts` (수정) | JSONB 직렬화/파싱, 저장·조회 반영 |
| `src/services/__tests__/runs.test.ts` (수정) | 직렬화/파싱 테스트 추가 |
| `src/components/SplitsList.tsx` (생성) | 나이키 스타일 구간 리스트 (표시 전용) |
| `src/components/ElevationChart.tsx` (생성) | 고도 라인 차트 (victory-native) |
| `src/components/ElevationChart.web.tsx` (생성) | 웹 폴백 (react-native-svg Polyline) |
| `app/run/[id].tsx` (수정) | 상세 화면: ScrollView 재구성 + 구간/고도 통합 |
| `app/(tabs)/index.tsx` (수정) | 홈: 저장 시 segments 전달 + 실시간 구간 표시 |

---

### Task 1: RoutePoint에 고도 추가 + 트래킹 태스크에서 수집

**Files:**
- Modify: `src/types/run.ts`
- Modify: `src/services/location.ts:11-17`
- Modify: `src/stores/__tests__/runStore.test.ts:3-4` (픽스처 컴파일 수정)
- Modify: `src/services/__tests__/runs.test.ts:5-18` (픽스처 컴파일 수정)
- Modify: `app/run/[id].tsx:37-42` (GeoJSON 폴백 매핑 컴파일 수정)

**Interfaces:**
- Produces: `RoutePoint`에 `altitude: number | null` 필드. 이후 모든 Task가 이 타입을 사용한다.

- [ ] **Step 1: 타입 변경**

`src/types/run.ts`의 `RoutePoint`를 다음으로 교체:

```ts
export interface RoutePoint {
  latitude: number;
  longitude: number;
  altitude: number | null; // 미터, WGS84 타원체 기준. null = 기기 미제공(웹 등)
  timestamp: number; // epoch ms
}
```

- [ ] **Step 2: 트래킹 태스크에서 고도 수집**

`src/services/location.ts`의 `defineTask` 내 `addPoint` 호출을 다음으로 교체:

```ts
    addPoint({
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      altitude: loc.coords.altitude ?? null,
      timestamp: loc.timestamp,
    });
```

- [ ] **Step 3: 컴파일 깨지는 기존 RoutePoint 리터럴 수정**

- `src/stores/__tests__/runStore.test.ts:3-4`:

```ts
const P1 = { latitude: 0, longitude: 0, altitude: null, timestamp: 1000 };
const P2 = { latitude: 1, longitude: 0, altitude: null, timestamp: 2000 }; // P1에서 약 111,195m
```

- `src/services/__tests__/runs.test.ts`의 `pointsToEwkt` 픽스처 3곳에 `altitude: null` 추가 (예: `{ latitude: 37.5, longitude: 127.0, altitude: null, timestamp: 0 }`).
- `app/run/[id].tsx:37-42`의 GeoJSON → RoutePoint 매핑에 `altitude: null` 추가:

```ts
  const points: RoutePoint[] =
    run.routeGeojson?.coordinates.map(([lon, lat]) => ({
      latitude: lat,
      longitude: lon,
      altitude: null,
      timestamp: 0,
    })) ?? [];
```

- [ ] **Step 4: 검증**

Run: `npx tsc --noEmit && npm test`
Expected: 타입 에러 0, 전체 테스트 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types/run.ts src/services/location.ts src/stores/__tests__/runStore.test.ts src/services/__tests__/runs.test.ts "app/run/[id].tsx"
git commit -m "feat(splits): RoutePoint에 고도 추가·트래킹 태스크에서 수집

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: DB 마이그레이션 — runs.route_points JSONB + 뷰 재생성

**Files:**
- Create: `supabase/migrations/20260812100000_runs_route_points.sql`
- Regenerate: `src/types/database.types.ts`

**Interfaces:**
- Produces: `runs.route_points jsonb` 컬럼, `runs_with_geojson` 뷰의 `route_points` 컬럼. Task 5의 insert/select가 이 컬럼을 사용한다.

- [ ] **Step 1: 마이그레이션 파일 작성**

`supabase/migrations/20260812100000_runs_route_points.sql`:

```sql
-- 원본 GPS 시계열. 세그먼트(일시정지로 나뉜 러닝 구간)별 [t, lat, lng, alt] 튜플 배열:
-- [[[t,lat,lng,alt], ...], ...]. t = epoch ms, alt = 미터(null 가능). null = 구버전 기록.
alter table public.runs add column route_points jsonb;

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
  created_at
from public.runs;
```

- [ ] **Step 2: 원격에 적용**

Run: `npx supabase db push`
Expected: `20260812100000_runs_route_points.sql` 적용 성공. (CLI 인증 문제로 실패하면 Supabase MCP `apply_migration` 도구로 동일 SQL을 적용한다 — 원격 프로젝트 `hytckdlqvfmrqpocgzin`.)

- [ ] **Step 3: 타입 재생성 및 확인**

Run: `npm run gen:types && grep -n "route_points" src/types/database.types.ts`
Expected: `runs` 테이블과 `runs_with_geojson` 뷰 타입 양쪽에 `route_points: Json | null` 존재.

- [ ] **Step 4: 검증**

Run: `npx tsc --noEmit && npm test`
Expected: PASS (아직 사용처 없음 — 재생성된 타입이 기존 코드를 깨지 않는지 확인).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260812100000_runs_route_points.sql src/types/database.types.ts
git commit -m "feat(splits): runs.route_points JSONB 컬럼·뷰 마이그레이션

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: splits.ts — 포인트 파티셔닝 + 고도 스무딩

**Files:**
- Create: `src/lib/splits.ts`
- Create: `src/lib/__tests__/splits.test.ts`

**Interfaces:**
- Consumes: `RoutePoint` (Task 1), `haversineM` (`src/lib/geo.ts`).
- Produces (Task 4·5·6·8이 사용):
  - `partitionPoints(points: RoutePoint[], segments: {start: number; end: number}[]): RoutePoint[][]`
  - `smoothAltitudes(points: RoutePoint[]): (number | null)[]`
  - 상수 `SPLIT_KM_M = 1000`, `SPLIT_MI_M = 1609.344`, `splitDistanceFor(unit: 'km' | 'mi'): number`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/__tests__/splits.test.ts`:

```ts
import type { RoutePoint } from '../../types/run';
import { partitionPoints, smoothAltitudes, splitDistanceFor } from '../splits';

// 적도 위 경도 0 고정, 위도만 증가 — 0.001도 ≈ 111.195m
function pt(latDeg: number, timestamp: number, altitude: number | null = null): RoutePoint {
  return { latitude: latDeg, longitude: 0, altitude, timestamp };
}

describe('splitDistanceFor', () => {
  it('km는 1000m, mi는 1609.344m', () => {
    expect(splitDistanceFor('km')).toBe(1000);
    expect(splitDistanceFor('mi')).toBeCloseTo(1609.344);
  });
});

describe('partitionPoints', () => {
  const segments = [
    { start: 0, end: 10_000 },
    { start: 20_000, end: 30_000 },
  ];

  it('완료된 세그먼트 시간 구간대로 그룹을 나눈다', () => {
    const points = [pt(0, 1000), pt(0.001, 9000), pt(0.002, 21_000), pt(0.003, 29_000)];
    const groups = partitionPoints(points, segments);
    expect(groups).toHaveLength(2);
    expect(groups[0].map((p) => p.timestamp)).toEqual([1000, 9000]);
    expect(groups[1].map((p) => p.timestamp)).toEqual([21_000, 29_000]);
  });

  it('마지막 세그먼트 이후 포인트는 진행 중 그룹으로 묶는다', () => {
    const points = [pt(0, 5000), pt(0.001, 35_000), pt(0.002, 36_000)];
    const groups = partitionPoints(points, segments);
    expect(groups).toHaveLength(2);
    expect(groups[1].map((p) => p.timestamp)).toEqual([35_000, 36_000]);
  });

  it('빈 그룹은 제거한다', () => {
    const points = [pt(0, 25_000)];
    const groups = partitionPoints(points, segments);
    expect(groups).toHaveLength(1);
  });

  it('포인트가 없으면 빈 배열', () => {
    expect(partitionPoints([], segments)).toEqual([]);
  });
});

describe('smoothAltitudes', () => {
  it('윈도우 5(±2) 이동평균을 적용한다', () => {
    const points = [10, 20, 30, 40, 50].map((a, i) => pt(0, i * 1000, a));
    const smoothed = smoothAltitudes(points);
    expect(smoothed[0]).toBeCloseTo(20); // (10+20+30)/3
    expect(smoothed[2]).toBeCloseTo(30); // (10+20+30+40+50)/5
    expect(smoothed[4]).toBeCloseTo(40); // (30+40+50)/3
  });

  it('null 고도는 null 유지, 이웃 평균에서는 제외한다', () => {
    const points = [pt(0, 0, 10), pt(0, 1000, null), pt(0, 2000, 20)];
    expect(smoothAltitudes(points)).toEqual([15, null, 15]);
  });

  it('전부 null이면 전부 null', () => {
    const points = [pt(0, 0), pt(0, 1000)];
    expect(smoothAltitudes(points)).toEqual([null, null]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/lib/__tests__/splits.test.ts`
Expected: FAIL — `Cannot find module '../splits'`.

- [ ] **Step 3: 구현**

`src/lib/splits.ts`:

```ts
import type { RoutePoint } from '../types/run';

export const SPLIT_KM_M = 1000;
export const SPLIT_MI_M = 1609.344;

export function splitDistanceFor(unit: 'km' | 'mi'): number {
  return unit === 'mi' ? SPLIT_MI_M : SPLIT_KM_M;
}

// runStore.RunSegment와 구조 호환 (stores 역참조를 피하기 위한 구조적 타입)
export interface TimeRange {
  start: number; // epoch ms
  end: number; // epoch ms
}

/**
 * flat 포인트 배열을 완료된 세그먼트 시간 구간별 그룹으로 나눈다.
 * 마지막 세그먼트 이후 포인트(진행 중 러닝)는 별도 그룹으로 묶고, 빈 그룹은 제거한다.
 * 포인트·세그먼트 모두 시간 오름차순 전제.
 */
export function partitionPoints(
  points: RoutePoint[],
  segments: TimeRange[]
): RoutePoint[][] {
  const groups: RoutePoint[][] = Array.from(
    { length: segments.length + 1 },
    () => []
  );
  let si = 0;
  for (const p of points) {
    while (si < segments.length && p.timestamp > segments[si].end) si++;
    groups[si].push(p);
  }
  return groups.filter((g) => g.length > 0);
}

const SMOOTH_WINDOW_HALF = 2; // 이동평균 윈도우 5 (중심 ±2)

/**
 * GPS 고도 노이즈(±5~10m)를 흡수하는 이동평균.
 * 고도가 null인 포인트는 null을 유지하고 이웃 평균 계산에서도 제외한다.
 */
export function smoothAltitudes(points: RoutePoint[]): (number | null)[] {
  return points.map((p, i) => {
    if (p.altitude === null) return null;
    let sum = 0;
    let n = 0;
    const from = Math.max(0, i - SMOOTH_WINDOW_HALF);
    const to = Math.min(points.length - 1, i + SMOOTH_WINDOW_HALF);
    for (let j = from; j <= to; j++) {
      const a = points[j].altitude;
      if (a !== null) {
        sum += a;
        n++;
      }
    }
    return sum / n;
  });
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- src/lib/__tests__/splits.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/splits.ts src/lib/__tests__/splits.test.ts
git commit -m "feat(splits): 포인트 세그먼트 파티셔닝·고도 이동평균

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: splits.ts — 구간 계산·상승고도·프로필·페이스

**Files:**
- Modify: `src/lib/splits.ts`
- Modify: `src/lib/__tests__/splits.test.ts`

**Interfaces:**
- Consumes: Task 3의 `partitionPoints`, `smoothAltitudes`.
- Produces (Task 5·6·8이 사용):

```ts
export interface Split {
  index: number;            // 1부터
  distanceM: number;        // 완료 구간 = splitDistanceM, 진행 중 구간은 현재까지 누적
  durationSec: number;      // 일시정지 시간 제외
  elevationDeltaM: number | null; // 구간 끝 − 시작 고도(스무딩 후). 고도 없으면 null
}
export interface SplitsResult {
  completed: Split[];
  current: Split | null;    // 진행 중 미완료 구간. 이동 거리가 0이면 null
}
export function computeSplits(groups: RoutePoint[][], splitDistanceM: number): SplitsResult;
export function splitPaceSec(split: Split | null, splitDistanceM: number): number | null;
export function elevationGainM(groups: RoutePoint[][]): number | null;
export interface ProfilePoint { distanceM: number; altitudeM: number }
export function elevationProfile(groups: RoutePoint[][]): ProfilePoint[];
```

- [ ] **Step 1: 실패하는 테스트 추가**

`src/lib/__tests__/splits.test.ts`에 다음 describe들을 추가 (기존 `pt` 헬퍼 재사용):

```ts
import {
  computeSplits,
  elevationGainM,
  elevationProfile,
  splitPaceSec,
} from '../splits';

// 위도 0.001도 ≈ 111.195m (적도, 경도 0 고정)
const STEP_M = 111.195;

describe('computeSplits', () => {
  it('등속 주행에서 구간 경계를 선형 보간한다', () => {
    // 10초마다 0.001도(≈111.195m) — 속도 11.1195 m/s, 1000m 도달 ≈ 89.93초
    const points = Array.from({ length: 20 }, (_, i) => pt(i * 0.001, i * 10_000));
    const { completed, current } = computeSplits([points], 1000);
    expect(completed).toHaveLength(2);
    expect(completed[0].durationSec).toBeCloseTo(1000 / 11.1195, 1);
    expect(completed[1].durationSec).toBeCloseTo(1000 / 11.1195, 1);
    expect(completed[0].distanceM).toBe(1000);
    // 19개 인터벌 ≈ 2112.7m → 잔여 ≈ 112.7m
    expect(current).not.toBeNull();
    expect(current!.index).toBe(3);
    expect(current!.distanceM).toBeCloseTo(19 * STEP_M - 2000, 0);
  });

  it('포인트 한 쌍이 여러 구간 경계를 넘으면 모두 분할한다', () => {
    // 2포인트, 거리 ≈ 2223.9m, 180초 — 구간 2개 완료 + 잔여
    const points = [pt(0, 0), pt(0.02, 180_000)];
    const { completed, current } = computeSplits([points], 1000);
    expect(completed).toHaveLength(2);
    const total = 0.02 / 0.001 * STEP_M; // ≈ 2223.9
    expect(completed[0].durationSec).toBeCloseTo((1000 / total) * 180, 1);
    expect(current!.distanceM).toBeCloseTo(total - 2000, 0);
  });

  it('세그먼트 경계(일시정지)를 넘는 쌍은 거리만 합산하고 시간은 0', () => {
    // 그룹1: 500m를 60초에, (일시정지 100초), 그룹2: 600m를 60초에
    const g1 = [pt(0, 0), pt(0.0045, 60_000)]; // ≈ 500.4m
    const g2 = [pt(0.0045, 160_000), pt(0.0099, 220_000)]; // ≈ 600.5m, 재개 지점 동일
    const { completed } = computeSplits([g1, g2], 1000);
    expect(completed).toHaveLength(1);
    // 일시정지 100초는 제외 — 구간 시간은 60 + (잔여 499.6m / 600.5m) * 60 ≈ 109.9초
    expect(completed[0].durationSec).toBeGreaterThan(100);
    expect(completed[0].durationSec).toBeLessThan(115);
  });

  it('구간 고도 변화 = 경계 보간된 스무딩 고도 차이', () => {
    // 일정 경사: 포인트마다 +2m
    const points = Array.from({ length: 20 }, (_, i) =>
      pt(i * 0.001, i * 10_000, i * 2)
    );
    const { completed } = computeSplits([points], 1000);
    // 1000m ≈ 8.993 인터벌 → 고도 변화 ≈ 8.993 * 2 ≈ 18 (스무딩은 선형 데이터 중앙부에서 원본과 동일)
    expect(completed[0].elevationDeltaM).toBeGreaterThan(15);
    expect(completed[0].elevationDeltaM).toBeLessThan(20);
  });

  it('고도가 전부 null이면 elevationDeltaM은 null', () => {
    const points = Array.from({ length: 20 }, (_, i) => pt(i * 0.001, i * 10_000));
    const { completed } = computeSplits([points], 1000);
    expect(completed[0].elevationDeltaM).toBeNull();
  });

  it('포인트 2개 미만이면 빈 결과', () => {
    expect(computeSplits([], 1000)).toEqual({ completed: [], current: null });
    expect(computeSplits([[pt(0, 0)]], 1000)).toEqual({ completed: [], current: null });
  });
});

describe('splitPaceSec', () => {
  it('완료 구간은 durationSec 그대로 (거리 = 구간 길이)', () => {
    const s = { index: 1, distanceM: 1000, durationSec: 300, elevationDeltaM: null };
    expect(splitPaceSec(s, 1000)).toBeCloseTo(300);
  });

  it('진행 중 구간은 구간 길이 기준으로 환산한다', () => {
    const s = { index: 2, distanceM: 500, durationSec: 150, elevationDeltaM: null };
    expect(splitPaceSec(s, 1000)).toBeCloseTo(300);
  });

  it('거리 10m 미만 또는 null이면 null', () => {
    const s = { index: 1, distanceM: 5, durationSec: 10, elevationDeltaM: null };
    expect(splitPaceSec(s, 1000)).toBeNull();
    expect(splitPaceSec(null, 1000)).toBeNull();
  });
});

describe('elevationGainM', () => {
  it('스무딩 후 양의 변화만 합산한다', () => {
    // 단조 증가 0..18m: 스무딩 경계 효과로 총합은 양 끝 평균 차이
    const points = Array.from({ length: 10 }, (_, i) => pt(i * 0.001, i * 10_000, i * 2));
    // smoothed[0] = (0+2+4)/3 = 2, smoothed[9] = (14+16+18)/3 = 16 → gain 14
    expect(elevationGainM([points])).toBeCloseTo(14);
  });

  it('내리막은 합산하지 않는다', () => {
    const alts = [10, 10, 10, 0, 0, 0]; // 스무딩 후에도 순증가 없음
    const points = alts.map((a, i) => pt(i * 0.001, i * 10_000, a));
    expect(elevationGainM([points])).toBe(0);
  });

  it('유효 고도가 2개 미만이면 null', () => {
    expect(elevationGainM([[pt(0, 0), pt(0.001, 1000)]])).toBeNull();
    expect(elevationGainM([])).toBeNull();
  });
});

describe('elevationProfile', () => {
  it('누적 거리 × 스무딩 고도 시리즈를 만든다', () => {
    const points = [pt(0, 0, 10), pt(0.001, 1000, 20), pt(0.002, 2000, 30)];
    const profile = elevationProfile([points]);
    expect(profile).toHaveLength(3);
    expect(profile[0].distanceM).toBe(0);
    expect(profile[1].distanceM).toBeCloseTo(STEP_M, 0);
    expect(profile[2].distanceM).toBeCloseTo(2 * STEP_M, 0);
    expect(profile[1].altitudeM).toBeCloseTo(20); // (10+20+30)/3
  });

  it('고도 null 포인트는 제외하되 거리는 누적한다', () => {
    const points = [pt(0, 0, 10), pt(0.001, 1000, null), pt(0.002, 2000, 10)];
    const profile = elevationProfile([points]);
    expect(profile).toHaveLength(2);
    expect(profile[1].distanceM).toBeCloseTo(2 * STEP_M, 0);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/lib/__tests__/splits.test.ts`
Expected: FAIL — `computeSplits` 등 미정의.

- [ ] **Step 3: 구현**

`src/lib/splits.ts`에 추가:

```ts
import { haversineM } from './geo';

export interface Split {
  index: number; // 1부터
  distanceM: number; // 완료 구간 = splitDistanceM, 진행 중 구간은 현재까지 누적
  durationSec: number; // 일시정지 시간 제외
  elevationDeltaM: number | null; // 구간 끝 − 시작 고도(스무딩 후). 고도 없으면 null
}

export interface SplitsResult {
  completed: Split[];
  current: Split | null; // 진행 중 미완료 구간. 이동 거리가 0이면 null
}

/**
 * 세그먼트 그룹 포인트를 splitDistanceM 단위 구간으로 나눈다.
 * - 같은 그룹 내 연속 쌍: 거리 = 하버사인, 시간 = timestamp 차이.
 * - 그룹 경계를 넘는 쌍: 거리만 합산, 시간 0 (일시정지 제외 — 라이브 distanceM 누적과 동일 규칙).
 * - 구간 경계가 쌍 중간에 걸치면 시각·고도를 선형 보간한다.
 */
export function computeSplits(
  groups: RoutePoint[][],
  splitDistanceM: number
): SplitsResult {
  const flat = groups.flat();
  if (flat.length < 2) return { completed: [], current: null };
  const smoothed = smoothAltitudes(flat);
  // 그룹 첫 포인트의 flat 인덱스 — 직전 쌍이 세그먼트 경계임을 표시
  const groupStartIdx = new Set<number>();
  let acc = 0;
  for (const g of groups) {
    groupStartIdx.add(acc);
    acc += g.length;
  }

  const completed: Split[] = [];
  let dist = 0;
  let durMs = 0;
  let startAlt = smoothed[0];
  let index = 1;

  for (let i = 1; i < flat.length; i++) {
    let dd = haversineM(flat[i - 1], flat[i]);
    let dt = groupStartIdx.has(i) ? 0 : flat[i].timestamp - flat[i - 1].timestamp;
    let fromAlt = smoothed[i - 1];
    const toAlt = smoothed[i];
    // 한 쌍이 여러 구간 경계를 넘을 수 있다
    while (dd > 0 && dist + dd >= splitDistanceM) {
      const need = splitDistanceM - dist;
      const f = need / dd;
      const tCross = dt * f;
      const altCross =
        fromAlt !== null && toAlt !== null
          ? fromAlt + (toAlt - fromAlt) * f
          : (toAlt ?? fromAlt);
      completed.push({
        index,
        distanceM: splitDistanceM,
        durationSec: (durMs + tCross) / 1000,
        elevationDeltaM:
          startAlt !== null && altCross !== null ? altCross - startAlt : null,
      });
      index++;
      dd -= need;
      dt -= tCross;
      dist = 0;
      durMs = 0;
      startAlt = altCross;
      fromAlt = altCross;
    }
    dist += dd;
    durMs += dt;
  }

  const endAlt = smoothed[flat.length - 1];
  const current =
    dist > 0
      ? {
          index,
          distanceM: dist,
          durationSec: durMs / 1000,
          elevationDeltaM:
            startAlt !== null && endAlt !== null ? endAlt - startAlt : null,
        }
      : null;
  return { completed, current };
}

/** 구간 페이스(초/구간단위). 진행 중 구간은 구간 길이 기준 환산. 거리 10m 미만이면 null */
export function splitPaceSec(
  split: Split | null,
  splitDistanceM: number
): number | null {
  if (!split || split.distanceM < 10) return null;
  return (split.durationSec * splitDistanceM) / split.distanceM;
}

/** 총 상승고도: 스무딩 후 양(+)의 변화만 합산. 유효 고도가 2개 미만이면 null */
export function elevationGainM(groups: RoutePoint[][]): number | null {
  const alts = smoothAltitudes(groups.flat()).filter(
    (a): a is number => a !== null
  );
  if (alts.length < 2) return null;
  let gain = 0;
  for (let i = 1; i < alts.length; i++) {
    const d = alts[i] - alts[i - 1];
    if (d > 0) gain += d;
  }
  return gain;
}

export interface ProfilePoint {
  distanceM: number;
  altitudeM: number;
}

/** 고도 그래프용 누적 거리 × 스무딩 고도 시리즈. 고도 null 포인트는 제외(거리는 누적). */
export function elevationProfile(groups: RoutePoint[][]): ProfilePoint[] {
  const flat = groups.flat();
  const smoothed = smoothAltitudes(flat);
  const out: ProfilePoint[] = [];
  let dist = 0;
  for (let i = 0; i < flat.length; i++) {
    if (i > 0) dist += haversineM(flat[i - 1], flat[i]);
    const a = smoothed[i];
    if (a !== null) out.push({ distanceM: dist, altitudeM: a });
  }
  return out;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- src/lib/__tests__/splits.test.ts`
Expected: PASS. 실패 시 보간·경계 수식을 테스트 기대값에 맞게 수정 (테스트 기대값은 물리적으로 도출된 값이므로 구현을 고친다).

- [ ] **Step 5: Commit**

```bash
git add src/lib/splits.ts src/lib/__tests__/splits.test.ts
git commit -m "feat(splits): 구간 분할·페이스·상승고도·고도 프로필 계산

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: runs.ts — JSONB 직렬화/파싱과 저장·조회 연결

**Files:**
- Modify: `src/services/runs.ts`
- Modify: `src/types/run.ts` (`RunRecord.routePoints`)
- Modify: `src/services/__tests__/runs.test.ts`
- Modify: `app/(tabs)/index.tsx:142-148` (`saveRun`에 segments 전달)

**Interfaces:**
- Consumes: `partitionPoints`, `TimeRange` (Task 3), `runs.route_points` 컬럼 타입 (Task 2).
- Produces:
  - `RunRecord.routePoints: RoutePoint[][] | null` (Task 6이 사용)
  - `FinishedRun.segments: TimeRange[]`
  - `segmentsToJson(points: RoutePoint[], segments: TimeRange[]): RoutePointsJson | null`
  - `parseRoutePoints(json: unknown): RoutePoint[][] | null`

- [ ] **Step 1: 실패하는 테스트 추가**

`src/services/__tests__/runs.test.ts`에 추가:

```ts
import { parseRoutePoints, segmentsToJson } from '../runs';

describe('segmentsToJson', () => {
  const p = (t: number, alt: number | null = null) => ({
    latitude: 37.5,
    longitude: 127.0,
    altitude: alt,
    timestamp: t,
  });

  it('세그먼트별 [t, lat, lng, alt] 튜플 배열로 직렬화한다', () => {
    const segments = [
      { start: 0, end: 10_000 },
      { start: 20_000, end: 30_000 },
    ];
    const json = segmentsToJson([p(1000, 12.5), p(9000, null), p(21_000, 13)], segments);
    expect(json).toEqual([
      [
        [1000, 37.5, 127.0, 12.5],
        [9000, 37.5, 127.0, null],
      ],
      [[21_000, 37.5, 127.0, 13]],
    ]);
  });

  it('포인트가 2개 미만이면 null', () => {
    expect(segmentsToJson([], [])).toBeNull();
    expect(segmentsToJson([p(1000)], [{ start: 0, end: 10_000 }])).toBeNull();
  });
});

describe('parseRoutePoints', () => {
  it('직렬화 결과를 RoutePoint 그룹으로 되돌린다 (왕복)', () => {
    const points = [
      { latitude: 37.5, longitude: 127.0, altitude: 12.5, timestamp: 1000 },
      { latitude: 37.6, longitude: 127.1, altitude: null, timestamp: 9000 },
    ];
    const json = segmentsToJson(points, [{ start: 0, end: 10_000 }]);
    expect(parseRoutePoints(json)).toEqual([points]);
  });

  it('형식이 어긋나면 null', () => {
    expect(parseRoutePoints(null)).toBeNull();
    expect(parseRoutePoints('x')).toBeNull();
    expect(parseRoutePoints([[[1, 2]]])).toBeNull(); // 튜플 길이 4 아님
    expect(parseRoutePoints([[['a', 1, 2, 3]]])).toBeNull(); // t가 숫자 아님
    expect(parseRoutePoints([])).toBeNull(); // 빈 그룹 배열
  });
});

describe('rowToRunRecord — route_points', () => {
  // 기존 baseRow에 route_points: null 필드를 추가해 재사용한다 (Step 2 참고)
  it('route_points를 routePoints로 파싱한다', () => {
    const rec = rowToRunRecord({
      ...baseRow,
      route_points: [[[1000, 37.5, 127.0, 12.5]]],
    });
    expect(rec?.routePoints).toEqual([
      [{ latitude: 37.5, longitude: 127.0, altitude: 12.5, timestamp: 1000 }],
    ]);
  });

  it('route_points가 null이거나 형식이 어긋나면 routePoints는 null (레코드는 유지)', () => {
    expect(rowToRunRecord(baseRow)?.routePoints).toBeNull();
    const rec = rowToRunRecord({ ...baseRow, route_points: 'broken' });
    expect(rec).not.toBeNull();
    expect(rec?.routePoints).toBeNull();
  });
});
```

주의: 기존 `baseRow` 픽스처(`runs.test.ts:23-32`)에 `route_points: null` 필드를 추가해야 뷰 Row 타입과 맞는다. `baseRow`는 기존 `describe('rowToRunRecord')` 블록 안에 선언되어 있으므로, 위 `rowToRunRecord — route_points` 테스트들은 별도 describe 대신 기존 `describe('rowToRunRecord')` 블록 안에 `it`으로 추가한다.

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/services/__tests__/runs.test.ts`
Expected: FAIL — `segmentsToJson`, `parseRoutePoints` 미정의.

- [ ] **Step 3: 구현**

`src/types/run.ts`의 `RunRecord`에 필드 추가:

```ts
export interface RunRecord {
  id: string;
  startedAt: string; // ISO 8601
  durationSec: number;
  distanceM: number;
  steps: number | null; // null = 측정 안 됨
  routeGeojson: { type: 'LineString'; coordinates: [number, number][] } | null;
  routePoints: RoutePoint[][] | null; // 세그먼트별 원본 시계열. null = 구버전 기록·파싱 실패
}
```

`src/services/runs.ts` 수정:

```ts
import { partitionPoints, type TimeRange } from '../lib/splits';

export interface FinishedRun {
  startedAt: number; // epoch ms
  durationSec: number;
  distanceM: number;
  steps: number | null; // null = 측정 안 됨
  points: RoutePoint[];
  segments: TimeRange[]; // 완료된 러닝 세그먼트 — 일시정지 제외 구간 계산용
}

// [t, lat, lng, alt] 튜플의 세그먼트별 배열 (route_points JSONB 포맷)
export type RoutePointsJson = [number, number, number, number | null][][];

export function segmentsToJson(
  points: RoutePoint[],
  segments: TimeRange[]
): RoutePointsJson | null {
  if (points.length < 2) return null;
  return partitionPoints(points, segments).map((g) =>
    g.map((p): [number, number, number, number | null] => [
      p.timestamp,
      p.latitude,
      p.longitude,
      p.altitude,
    ])
  );
}

export function parseRoutePoints(json: unknown): RoutePoint[][] | null {
  if (!Array.isArray(json) || json.length === 0) return null;
  const groups: RoutePoint[][] = [];
  for (const g of json) {
    if (!Array.isArray(g)) return null;
    const pts: RoutePoint[] = [];
    for (const t of g) {
      if (!Array.isArray(t) || t.length !== 4) return null;
      const [ts, lat, lng, alt] = t;
      if (
        typeof ts !== 'number' ||
        typeof lat !== 'number' ||
        typeof lng !== 'number' ||
        (typeof alt !== 'number' && alt !== null)
      ) {
        return null;
      }
      pts.push({ timestamp: ts, latitude: lat, longitude: lng, altitude: alt });
    }
    groups.push(pts);
  }
  return groups;
}
```

`rowToRunRecord` 반환 객체에 추가:

```ts
    routePoints: parseRoutePoints(row.route_points),
```

`saveRun`의 insert에 추가:

```ts
      route_points: segmentsToJson(run.points, run.segments),
```

`app/(tabs)/index.tsx`의 `onStop` 내 `saveRun` 호출에 segments 전달:

```ts
    const result = await saveRun({
      startedAt: s.startedAt ?? stoppedAt,
      durationSec,
      distanceM: s.distanceM,
      steps,
      points: s.points,
      segments: s.segments,
    });
```

(`beginSave`가 마지막 세그먼트를 닫은 뒤이므로 `s.segments`는 전체 러닝을 커버한다.)

- [ ] **Step 4: 검증**

Run: `npx tsc --noEmit && npm test`
Expected: 전체 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/runs.ts src/types/run.ts src/services/__tests__/runs.test.ts "app/(tabs)/index.tsx"
git commit -m "feat(splits): 원본 GPS 시계열을 route_points JSONB로 저장·조회

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 기록 상세 — 구간 리스트 + 총 상승고도

**Files:**
- Create: `src/components/SplitsList.tsx`
- Modify: `app/run/[id].tsx`

**Interfaces:**
- Consumes: `computeSplits`, `splitPaceSec`, `elevationGainM`, `splitDistanceFor`, `Split` (Task 4), `RunRecord.routePoints` (Task 5).
- Produces: `SplitsList({ completed, current, splitDistanceM, unit })` 컴포넌트 (표시 전용).

- [ ] **Step 1: SplitsList 컴포넌트 작성**

`src/components/SplitsList.tsx`:

```tsx
import { View } from 'react-native';
import { Text } from '@/components/ui/text';
import { formatPace } from '@/lib/geo';
import { splitPaceSec, type Split } from '@/lib/splits';

interface Props {
  completed: Split[];
  current: Split | null;
  splitDistanceM: number;
  unit: 'km' | 'mi';
}

const MIN_BAR_PCT = 30; // 가장 느린 구간도 페이스 텍스트가 들어갈 최소 폭

/** 나이키 스타일 구간 리스트: 구간 번호 | 페이스(상대 막대) | 고도 변화 */
export function SplitsList({ completed, current, splitDistanceM, unit }: Props) {
  const rows = [
    ...completed.map((s) => ({ split: s, label: String(s.index) })),
    // 진행 중(잔여) 구간은 부분 거리로 표기 (예: 0.4)
    ...(current
      ? [{ split: current, label: (current.distanceM / splitDistanceM).toFixed(1) }]
      : []),
  ];
  if (rows.length === 0) return null;

  const paces = rows.map(({ split }) => splitPaceSec(split, splitDistanceM));
  const valid = paces.filter((p): p is number => p !== null);
  const fastest = valid.length > 0 ? Math.min(...valid) : null;
  const showElevation = rows.some(({ split }) => split.elevationDeltaM !== null);

  return (
    <View className="gap-2 px-4 pt-2">
      <Text className="text-lg font-semibold">구간</Text>
      <View className="flex-row">
        <Text className="w-12 text-xs text-muted-foreground">
          {unit === 'mi' ? 'Mi' : 'Km'}
        </Text>
        <Text className="flex-1 text-xs text-muted-foreground">평균 페이스</Text>
        {showElevation && (
          <Text className="w-16 text-right text-xs text-muted-foreground">고도</Text>
        )}
      </View>
      {rows.map(({ split, label }, i) => {
        const pace = paces[i];
        // 빠를수록 긴 막대 (가장 빠른 구간 = 100%)
        const widthPct =
          pace !== null && fastest !== null
            ? Math.max((fastest / pace) * 100, MIN_BAR_PCT)
            : MIN_BAR_PCT;
        return (
          <View key={split.index} className="flex-row items-center">
            <Text className="w-12 font-semibold">{label}</Text>
            <View className="flex-1">
              <View
                className="rounded-md bg-muted px-3 py-2"
                style={{ width: `${widthPct}%` }}
              >
                <Text className="text-sm">{formatPace(pace)}</Text>
              </View>
            </View>
            {showElevation && (
              <Text className="w-16 text-right text-sm text-muted-foreground">
                {split.elevationDeltaM === null
                  ? '—'
                  : `${Math.round(split.elevationDeltaM)} m`}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}
```

- [ ] **Step 2: 상세 화면 재구성**

`app/run/[id].tsx`를 다음으로 교체 (로딩 분기·데이터 로드는 기존 유지):

```tsx
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { RouteMap } from '@/components/RouteMap';
import { SplitsList } from '@/components/SplitsList';
import { avgCadenceSpm, formatCadence } from '@/lib/cadence';
import { formatDistance, formatDuration, formatPace, paceSecPerKm } from '@/lib/geo';
import { computeSplits, elevationGainM, splitDistanceFor } from '@/lib/splits';
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

  // 지도는 원본 시계열 우선, 구버전 기록은 GeoJSON 폴백
  const points: RoutePoint[] =
    run.routePoints?.flat() ??
    run.routeGeojson?.coordinates.map(([lon, lat]) => ({
      latitude: lat,
      longitude: lon,
      altitude: null,
      timestamp: 0,
    })) ??
    [];

  const avgCadence = avgCadenceSpm(run.steps, run.durationSec);
  const splitDistanceM = splitDistanceFor(unit);
  const splits = run.routePoints
    ? computeSplits(run.routePoints, splitDistanceM)
    : null;
  const gain = run.routePoints ? elevationGainM(run.routePoints) : null;

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingBottom: 32 }}
    >
      <View className="h-72">
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
          {avgCadence !== null && ` · ${formatCadence(avgCadence)} spm`}
          {gain !== null && ` · ↑ ${Math.round(gain)} m`}
        </Text>
      </View>
      {splits && (
        <SplitsList
          completed={splits.completed}
          current={splits.current}
          splitDistanceM={splitDistanceM}
          unit={unit}
        />
      )}
    </ScrollView>
  );
}
```

- [ ] **Step 3: 검증**

Run: `npx tsc --noEmit && npm test && npm run lint`
Expected: 모두 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/SplitsList.tsx "app/run/[id].tsx"
git commit -m "feat(splits): 기록 상세에 나이키 스타일 구간 리스트·총 상승고도

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 고도 그래프 — ElevationChart

**Files:**
- Create: `src/components/ElevationChart.tsx`
- Create: `src/components/ElevationChart.web.tsx`
- Modify: `app/run/[id].tsx` (Task 6 결과에 통합)

**Interfaces:**
- Consumes: `elevationProfile`, `ProfilePoint` (Task 4).
- Produces: `ElevationChart({ profile: ProfilePoint[] })` — 포인트 2개 미만이면 자체적으로 null 렌더.

- [ ] **Step 1: 네이티브 차트 (victory-native — WeeklyBarChart 패턴)**

`src/components/ElevationChart.tsx`:

```tsx
import { CartesianChart, Line } from 'victory-native';
import type { ProfilePoint } from '@/lib/splits';

interface Props {
  profile: ProfilePoint[];
}

/** 거리 × 고도 라인 차트. 유효 포인트가 2개 미만이면 렌더하지 않는다. */
export function ElevationChart({ profile }: Props) {
  if (profile.length < 2) return null;
  const data = profile.map((p) => ({
    distance: p.distanceM,
    altitude: p.altitudeM,
  }));
  return (
    <CartesianChart data={data} xKey="distance" yKeys={['altitude']}>
      {({ points }) => (
        <Line points={points.altitude} color="#3b82f6" strokeWidth={2} />
      )}
    </CartesianChart>
  );
}
```

- [ ] **Step 2: 웹 폴백 (react-native-svg Polyline)**

`src/components/ElevationChart.web.tsx`:

```tsx
import { View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import type { ProfilePoint } from '@/lib/splits';

interface Props {
  profile: ProfilePoint[];
}

// victory-native는 Skia(CanvasKit WASM) 기반이라 웹에서 동작하지 않는다.
// 웹 번들에서는 SVG 폴리라인으로 대체한다.
export function ElevationChart({ profile }: Props) {
  if (profile.length < 2) return null;
  const maxD = profile[profile.length - 1].distanceM || 1;
  const alts = profile.map((p) => p.altitudeM);
  const minA = Math.min(...alts);
  const range = Math.max(...alts) - minA || 1;
  const points = profile
    .map(
      (p) =>
        `${(p.distanceM / maxD) * 100},${40 - ((p.altitudeM - minA) / range) * 36 - 2}`
    )
    .join(' ');
  return (
    <View style={{ flex: 1 }}>
      <Svg width="100%" height="100%" viewBox="0 0 100 40" preserveAspectRatio="none">
        <Polyline
          points={points}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={0.8}
        />
      </Svg>
    </View>
  );
}
```

- [ ] **Step 3: 상세 화면에 통합**

`app/run/[id].tsx`에서:

- import 추가: `import { ElevationChart } from '@/components/ElevationChart';` 그리고 `elevationProfile`을 `@/lib/splits` import에 추가.
- 계산 추가 (Task 6에서 만든 `gain` 아래):

```tsx
  const profile = run.routePoints ? elevationProfile(run.routePoints) : [];
```

- 요약 `<View className="gap-2 p-4">` 블록과 `<SplitsList …/>` 사이에 삽입:

```tsx
      {profile.length >= 2 && (
        <View className="h-40 px-4 pb-2">
          <ElevationChart profile={profile} />
        </View>
      )}
```

- [ ] **Step 4: 검증**

Run: `npx tsc --noEmit && npm test && npm run lint`
Expected: 모두 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ElevationChart.tsx src/components/ElevationChart.web.tsx "app/run/[id].tsx"
git commit -m "feat(splits): 기록 상세에 거리×고도 프로필 차트

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: 홈 — 러닝 중 실시간 현재 구간 표시

**Files:**
- Modify: `app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: `computeSplits`, `partitionPoints`, `splitPaceSec`, `splitDistanceFor` (Task 3·4), runStore의 `points`·`segments`.

- [ ] **Step 1: 구현**

`app/(tabs)/index.tsx`에서:

- import 추가:

```tsx
import {
  computeSplits,
  partitionPoints,
  splitDistanceFor,
  splitPaceSec,
} from '@/lib/splits';
```

- 스토어 구독 추가 (기존 `stepSamples` 구독 아래):

```tsx
  const segments = useRunStore((s) => s.segments);
```

- `const elapsed = …` 아래에 계산 추가 (매초 `now` 갱신·포인트 추가 시 재계산됨. 포인트 수천 개에 O(n)이라 부담 없음):

```tsx
  // 러닝·일시정지 중 현재 구간 번호와 실시간 구간 페이스
  const splitDistanceM = splitDistanceFor(unit);
  const liveSplits =
    status === 'running' || status === 'paused'
      ? computeSplits(partitionPoints(points, segments), splitDistanceM)
      : null;
```

- JSX: 지표 행(`<View className="flex-row justify-around">…</View>`) 바로 아래에 삽입:

```tsx
            {liveSplits && (
              <Text className="text-center text-sm text-muted-foreground">
                {`구간 ${liveSplits.completed.length + 1} · ${formatPace(
                  splitPaceSec(liveSplits.current, splitDistanceM)
                )}`}
              </Text>
            )}
```

(구간 경계를 막 넘어 `current`가 null이거나 이동 10m 미만이면 `formatPace(null)` → `--'--"`.)

- [ ] **Step 2: 검증**

Run: `npx tsc --noEmit && npm test && npm run lint`
Expected: 모두 PASS.

- [ ] **Step 3: Commit**

```bash
git add "app/(tabs)/index.tsx"
git commit -m "feat(splits): 홈 화면에 러닝 중 현재 구간·실시간 구간 페이스

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: 전체 검증 + 실기기 수동 테스트

**Files:** 없음 (검증 전용)

- [ ] **Step 1: 전체 자동 검증**

Run: `npx tsc --noEmit && npm test && npm run lint`
Expected: 모두 PASS.

- [ ] **Step 2: 실기기 수동 테스트 체크리스트**

Expo Go는 백그라운드 위치가 안 되므로 dev build로 실행한다 (`npm run ios` — 프로비저닝 7일 만료 시 재실행). 시뮬레이터는 Features > Location > City Run으로 고도 포함 GPS를 시뮬레이션할 수 있다.

1. 러닝 시작 → 홈에 `구간 1 · --'--"` 표시, 이동하면 페이스 갱신.
2. 1구간(1km) 경과 → `구간 2 · …`로 넘어감.
3. 일시정지 → 재개 → 종료 저장 성공.
4. 기록 상세: 구간 리스트(페이스 막대·고도 변화), 요약에 `↑ N m`, 고도 그래프 표시.
5. 설정에서 mi로 전환 → 같은 기록의 구간이 마일 기준으로 재계산되는지 확인.
6. 과거 기록(route_points 없는 기록이 남아 있다면) 열기 → 지도+요약만 표시, 크래시 없음.
7. Supabase 대시보드(또는 MCP `execute_sql`)에서 새 기록의 `route_points`가 세그먼트 그룹 배열로 저장됐는지 확인.

- [ ] **Step 3: 이슈가 있으면 수정 후 해당 Task의 검증을 다시 수행**

수동 테스트에서 발견된 문제는 수정 → `npx tsc --noEmit && npm test` 재실행 → 별도 커밋(`fix(splits): …`).
