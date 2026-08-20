# 고도 노이즈 보정 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 평지 코스에서 GPS 고도 노이즈가 큰 기복처럼 보이는 문제를 없앤다 — 고도 그래프는 완만하게, 총 상승고도는 현실적인 값으로.

**Architecture:** 고도 계산을 `src/lib/splits.ts`에서 새 모듈 `src/lib/elevation.ts`로 분리한다. 필터는 2단계(중앙값 → 거리 기준 이동평균)이고, 총 상승고도는 임계값 히스테리시스로 합산하며, 차트는 공용 y축 도메인 헬퍼로 최소 표시범위를 보장한다. 모두 저장된 고도 시계열만 쓰는 순수 함수이므로 기존 기록에 소급 적용된다. 스키마 변경·마이그레이션 없음.

**Tech Stack:** TypeScript, Jest, victory-native 41 (`CartesianChart`), react-native-svg (웹 폴백)

## Global Constraints

- 필터 상수: `MEDIAN_WINDOW_HALF = 2`, `SMOOTH_RADIUS_M = 50`, `GAIN_THRESHOLD_M = 5`, `elevationYDomain` 기본 `minSpanM = 40`. 이 값들은 파라미터 스윕 실측으로 확정됐다 — 임의로 바꾸지 말 것.
- `null` 고도 처리 규칙은 기존 동작을 유지한다: 입력이 `null`인 포인트의 출력은 `null`이고, 이웃의 평균·중앙값 계산에서도 제외된다.
- `RunRecord` / `RoutePoint` 타입, Supabase 스키마, 마이그레이션은 건드리지 않는다.
- `splits.ts`에 재export를 남기지 않는다. 옮긴 심볼의 모든 호출부 import를 `@/lib/elevation`으로 갱신한다.
- 테스트 설명과 주석은 한국어로 쓴다 (기존 파일 관례).
- import는 기존 관례를 따른다: `src/` 안의 소스는 상대 경로(`../types/run`), 컴포넌트·앱 화면은 `@/` 별칭.
- 검증 명령: `npm test`, `npx tsc --noEmit`, `npm run lint`.
- 이 작업은 Expo SDK API를 쓰지 않는다(`src/lib`의 순수 함수와 차트 컴포넌트만 수정). `AGENTS.md`의 Expo 문서 확인 요구는 해당되지 않는다.

---

### Task 1: `elevation.ts` 모듈 신설 — 2단계 필터

`smoothAltitudes`를 `splits.ts`에서 새 모듈로 옮기면서 중앙값 필터와 거리 기준 이동평균으로 교체한다. 이 태스크에서는 새 모듈이 자체 테스트로 검증되는 것까지만 하고, `splits.ts`의 기존 함수는 아직 지우지 않는다(Task 2에서 전환).

**Files:**
- Create: `src/lib/elevation.ts`
- Test: `src/lib/__tests__/elevation.test.ts`

**Interfaces:**
- Consumes: `RoutePoint` from `../types/run`, `haversineM` from `./geo`
- Produces:
  - `export const SMOOTH_RADIUS_M = 50`
  - `export function smoothAltitudes(points: RoutePoint[]): (number | null)[]`

- [ ] **Step 1: 테스트 파일을 만들고 실패하는 테스트를 작성한다**

`src/lib/__tests__/elevation.test.ts`:

```ts
import type { RoutePoint } from '../../types/run';
import { smoothAltitudes } from '../elevation';

// 위도 1도 ≈ 111195m. 포인트 간격을 미터로 지정하기 위한 환산 계수
const M_TO_DEG = 1 / 111195;

/** 경도 0 고정, 위도만 spacingM 간격으로 증가하는 포인트 배열 */
function line(
  count: number,
  spacingM: number,
  altAt: (i: number, n: number) => number | null
): RoutePoint[] {
  return Array.from({ length: count }, (_, i) => ({
    latitude: i * spacingM * M_TO_DEG,
    longitude: 0,
    altitude: altAt(i, count),
    timestamp: i * 3000,
  }));
}

function pt(latDeg: number, timestamp: number, altitude: number | null = null): RoutePoint {
  return { latitude: latDeg, longitude: 0, altitude, timestamp };
}

const nonNull = (xs: (number | null)[]): number[] => xs.filter((x): x is number => x !== null);
const span = (xs: (number | null)[]): number => {
  const v = nonNull(xs);
  return Math.max(...v) - Math.min(...v);
};

describe('smoothAltitudes', () => {
  it('거리 기준 윈도우 밖의 포인트는 섞지 않는다', () => {
    // 111m 간격 > 반경 50m → 2단계 이동평균은 자기 자신만 포함,
    // 결과는 1단계 중앙값(윈도우 5)과 같다
    const points = [10, 20, 30, 40, 50].map((a, i) => pt(i * 0.001, i * 1000, a));
    const smoothed = smoothAltitudes(points);
    expect(smoothed[0]).toBeCloseTo(20); // median[10,20,30]
    expect(smoothed[1]).toBeCloseTo(25); // median[10,20,30,40] = (20+30)/2
    expect(smoothed[2]).toBeCloseTo(30);
    expect(smoothed[3]).toBeCloseTo(35);
    expect(smoothed[4]).toBeCloseTo(40);
  });

  it('평지의 ±5m 톱니 노이즈를 3m 미만으로 줄인다', () => {
    // 7m 간격 200포인트 = 1.4km. 원본 진폭 10m
    const points = line(200, 7, (i) => 100 + (i % 2 ? 5 : -5));
    expect(span(smoothAltitudes(points))).toBeLessThan(3);
  });

  it('단발 스파이크를 중앙값 필터가 제거한다', () => {
    const points = line(50, 7, () => 100);
    points[25].altitude = 130;
    const smoothed = smoothAltitudes(points);
    expect(smoothed[25]).toBeCloseTo(100);
  });

  it('완만한 실제 상승은 뭉개지 않는다', () => {
    // 2km에 50m 상승. 양 끝은 중심 이동평균 감쇠로 1m 이내 오차
    const points = line(286, 7, (i, n) => (i * 50) / (n - 1));
    const smoothed = smoothAltitudes(points);
    expect(smoothed[0]).toBeCloseTo(0, 0);
    expect(smoothed[285]).toBeCloseTo(50, 0);
  });

  it('null 고도는 null 유지, 이웃 평균에서는 제외한다', () => {
    const points = [pt(0, 0, 10), pt(0, 1000, null), pt(0, 2000, 20)];
    expect(smoothAltitudes(points)).toEqual([15, null, 15]);
  });

  it('전부 null이면 전부 null', () => {
    expect(smoothAltitudes([pt(0, 0), pt(0, 1000)])).toEqual([null, null]);
  });

  it('빈 배열은 빈 배열', () => {
    expect(smoothAltitudes([])).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npm test -- elevation.test`
Expected: FAIL — `Cannot find module '../elevation'`

- [ ] **Step 3: `src/lib/elevation.ts`를 작성한다**

```ts
import type { RoutePoint } from '../types/run';
import { haversineM } from './geo';

/** 1단계 중앙값 필터 윈도우 반폭 (윈도우 5 = 중심 ±2) */
const MEDIAN_WINDOW_HALF = 2;
/** 2단계 이동평균 윈도우 반경. 거리 기준이라 러너 속도와 무관하게 강도가 일정하다 */
export const SMOOTH_RADIUS_M = 50;

/** 윈도우 내 null이 아닌 값들의 중앙값. 값이 없으면 null */
function medianAt(alts: (number | null)[], i: number): number | null {
  const from = Math.max(0, i - MEDIAN_WINDOW_HALF);
  const to = Math.min(alts.length - 1, i + MEDIAN_WINDOW_HALF);
  const w: number[] = [];
  for (let j = from; j <= to; j++) {
    const a = alts[j];
    if (a !== null) w.push(a);
  }
  if (w.length === 0) return null;
  w.sort((x, y) => x - y);
  const mid = w.length >> 1;
  return w.length % 2 === 1 ? w[mid] : (w[mid - 1] + w[mid]) / 2;
}

/**
 * GPS 고도 노이즈를 흡수하는 2단계 필터.
 * 1단계: 윈도우 5 중앙값 — 단발 스파이크 제거.
 * 2단계: 누적 거리 ±SMOOTH_RADIUS_M 이내 이웃의 평균 — 잔여 노이즈 평탄화.
 *
 * 저주파 드리프트(수백 m~km 주기)는 이 필터로 제거되지 않는다. 드리프트는
 * elevationGainM의 히스테리시스 임계값에서, 그래프 인상은 elevationYDomain의
 * 최소 표시범위에서 각각 처리한다.
 *
 * 고도가 null인 포인트는 null을 유지하고 이웃 계산에서도 제외한다.
 * 일시정지 구간 경계는 특별 취급하지 않는다 — 일시정지 중 이동 거리도 누적
 * 거리에 포함되어 윈도우가 그만큼 넓어지는데, 평탄화 방향으로만 작용한다.
 */
export function smoothAltitudes(points: RoutePoint[]): (number | null)[] {
  const raw = points.map((p) => p.altitude);
  const median = raw.map((_, i) => medianAt(raw, i));

  // 누적 거리는 단조 증가 — two-pointer로 윈도우를 밀며 부분합을 갱신해 O(n)
  const cum = new Array<number>(points.length);
  for (let i = 0; i < points.length; i++) {
    cum[i] = i === 0 ? 0 : cum[i - 1] + haversineM(points[i - 1], points[i]);
  }

  const out = new Array<number | null>(points.length);
  let lo = 0;
  let hi = -1; // [lo, hi] 폐구간이 현재 윈도우
  let sum = 0;
  let count = 0;
  for (let i = 0; i < points.length; i++) {
    while (hi + 1 < points.length && cum[hi + 1] - cum[i] <= SMOOTH_RADIUS_M) {
      hi++;
      const a = median[hi];
      if (a !== null) {
        sum += a;
        count++;
      }
    }
    while (lo <= hi && cum[i] - cum[lo] > SMOOTH_RADIUS_M) {
      const a = median[lo];
      if (a !== null) {
        sum -= a;
        count--;
      }
      lo++;
    }
    out[i] = median[i] === null || count === 0 ? null : sum / count;
  }
  return out;
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `npm test -- elevation.test`
Expected: PASS (7 tests)

부동소수점 누적 오차로 `toBeCloseTo`가 흔들리면 구현이 아니라 two-pointer 부분합을 의심할 것. `sum`을 매번 다시 더하는 O(n·w) 버전으로 바꿔 값이 달라지는지 비교해 원인을 좁힌다.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/elevation.ts src/lib/__tests__/elevation.test.ts
git commit -m "feat(elevation): 중앙값 + 거리 기준 이동평균 2단계 고도 필터"
```

---

### Task 2: 고도 함수를 `elevation.ts`로 이관하고 상승고도에 히스테리시스 적용

`splits.ts`에 남은 고도 함수를 옮기고, `elevationGainM`의 합산 규칙을 임계값 히스테리시스로 바꾼다. 이관과 규칙 변경을 한 태스크로 묶는 이유는, 이관만 한 중간 상태를 따로 커밋해도 리뷰어가 판단할 게 없기 때문이다.

**Files:**
- Modify: `src/lib/elevation.ts` (함수 추가)
- Modify: `src/lib/splits.ts` (고도 함수 제거, `smoothAltitudes` import)
- Modify: `src/lib/__tests__/elevation.test.ts` (테스트 추가)
- Modify: `src/lib/__tests__/splits.test.ts` (고도 테스트 이관·기대값 갱신)
- Modify: `src/components/SplitsList.tsx:4` (import 경로)
- Modify: `src/components/ElevationChart.tsx:2` (import 경로)
- Modify: `src/components/ElevationChart.web.tsx:3` (import 경로)
- Modify: `app/run/[id].tsx:10` (import 경로)

**Interfaces:**
- Consumes: Task 1의 `smoothAltitudes(points: RoutePoint[]): (number | null)[]`
- Produces (모두 `src/lib/elevation.ts`에서 export):
  - `export const GAIN_THRESHOLD_M = 5`
  - `export interface ProfilePoint { distanceM: number; altitudeM: number }`
  - `export function elevationGainM(groups: RoutePoint[][]): number | null`
  - `export function elevationProfile(groups: RoutePoint[][]): ProfilePoint[]`
  - `export function formatElevationDelta(deltaM: number | null): string`
- `src/lib/splits.ts`는 `ProfilePoint`, `elevationGainM`, `elevationProfile`, `formatElevationDelta`, `smoothAltitudes`를 더 이상 export하지 않는다. `computeSplits`, `Split`, `SplitsResult`, `splitPaceSec`, `splitDistanceFor`, `partitionPoints`, `liveExtraSec`, `liveSplitPaceSec`, `SPLIT_KM_M`, `SPLIT_MI_M`, `TimeRange`는 그대로 유지한다.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`src/lib/__tests__/elevation.test.ts` 맨 위 import를 확장한다:

```ts
import {
  elevationGainM,
  elevationProfile,
  formatElevationDelta,
  smoothAltitudes,
} from '../elevation';
```

파일 끝에 다음 `describe` 블록들을 추가한다. `line`·`pt`는 Task 1에서 정의한 헬퍼를 그대로 쓴다.

```ts
// 위도 0.001도 ≈ 111.195m (적도, 경도 0 고정)
const STEP_M = 111.195;

/** 저주파 드리프트 노이즈 — 실제 GPS 고도 오차처럼 수백 m 주기로 천천히 흐른다 */
const drift = (i: number): number =>
  3 * Math.sin(i * 0.07) + 2 * Math.sin(i * 0.23 + 1) + 2.5 * Math.sin(i * 0.011);

describe('elevationGainM', () => {
  it('평지의 저주파 드리프트 노이즈는 상승으로 계상하지 않는다', () => {
    // 이 케이스가 이 기능의 존재 이유다. 임계값 3m에서는 15.2m가 나왔다.
    const points = line(286, 7, (i) => 100 + drift(i));
    expect(elevationGainM([points])).toBe(0);
  });

  it('평지의 톱니 노이즈도 상승으로 계상하지 않는다', () => {
    const points = line(200, 7, (i) => 100 + (i % 2 ? 5 : -5));
    expect(elevationGainM([points])).toBe(0);
  });

  it('완만한 실제 상승은 보존한다', () => {
    // 2km에 50m. 히스테리시스 임계값 미달분과 이동평균 양 끝 감쇠로 약 8% 손실
    const points = line(286, 7, (i, n) => (i * 50) / (n - 1));
    const gain = elevationGainM([points]);
    expect(gain).toBeGreaterThan(45);
    expect(gain).toBeLessThanOrEqual(50);
  });

  it('임계값을 넘는 상승만 합산한다', () => {
    // 111m 간격이라 이동평균은 무연산. 스무딩 후 [2,3,4,6,8,10,12,14,15,16]
    // 기준점 2 → 8(+6) → 14(+6). 나머지는 임계값 5m 미달 → 12
    const points = Array.from({ length: 10 }, (_, i) => pt(i * 0.001, i * 10_000, i * 2));
    expect(elevationGainM([points])).toBeCloseTo(12);
  });

  it('내리막은 합산하지 않는다', () => {
    const alts = [10, 10, 10, 0, 0, 0];
    const points = alts.map((a, i) => pt(i * 0.001, i * 10_000, a));
    expect(elevationGainM([points])).toBe(0);
  });

  it('유효 고도가 2개 미만이면 null', () => {
    expect(elevationGainM([[pt(0, 0), pt(0.001, 1000)]])).toBeNull();
    expect(elevationGainM([])).toBeNull();
  });

  it('일시정지로 나뉜 다중 그룹도 이어서 합산한다', () => {
    // 그룹 경계를 가로질러 단조 증가: flat [0,10,20,20,30,40]
    // 스무딩 후 [10,15,20,20,25,30] → 기준점 10 → 20(+10) → 30(+10) = 20
    const g1 = [pt(0, 0, 0), pt(0.001, 10_000, 10), pt(0.002, 20_000, 20)];
    const g2 = [pt(0.002, 120_000, 20), pt(0.003, 130_000, 30), pt(0.004, 140_000, 40)];
    expect(elevationGainM([g1, g2])).toBeCloseTo(20);
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
    expect(profile[1].altitudeM).toBeCloseTo(20);
  });

  it('고도 null 포인트는 제외하되 거리는 누적한다', () => {
    const points = [pt(0, 0, 10), pt(0.001, 1000, null), pt(0.002, 2000, 10)];
    const profile = elevationProfile([points]);
    expect(profile).toHaveLength(2);
    expect(profile[1].distanceM).toBeCloseTo(2 * STEP_M, 0);
  });

  it('일시정지로 나뉜 다중 그룹에서도 거리를 이어서 누적한다', () => {
    const g1 = [pt(0, 0, 10), pt(0.001, 10_000, 10)];
    const g2 = [pt(0.001, 120_000, 10), pt(0.002, 130_000, 10)];
    const profile = elevationProfile([g1, g2]);
    expect(profile).toHaveLength(4);
    expect(profile[3].distanceM).toBeCloseTo(2 * STEP_M, 0);
  });
});

describe('formatElevationDelta', () => {
  it('상승은 + 부호를 붙인다', () => {
    expect(formatElevationDelta(4.4)).toBe('+4 m');
  });

  it('하강은 - 부호를 붙인다', () => {
    expect(formatElevationDelta(-5.3)).toBe('-5 m');
  });

  it('0으로 반올림되면 무부호', () => {
    expect(formatElevationDelta(0.2)).toBe('0 m');
    expect(formatElevationDelta(-0.4)).toBe('0 m');
  });

  it('null은 대시', () => {
    expect(formatElevationDelta(null)).toBe('—');
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npm test -- elevation.test`
Expected: FAIL — `elevationGainM is not a function` (아직 `elevation.ts`에 없음)

- [ ] **Step 3: `src/lib/elevation.ts`에 함수를 추가한다**

파일 끝에 이어 붙인다. `haversineM`은 이미 import되어 있다.

```ts
/**
 * 총 상승고도 히스테리시스 임계값.
 * 스무딩 후에도 남는 저주파 드리프트 진폭(약 ±4m)을 넘어야 드리프트가 상승으로
 * 계상되지 않는다. 실측: 임계값 3m에서 평지 2km가 15.2m, 5m에서 0m.
 */
export const GAIN_THRESHOLD_M = 5;

/**
 * 총 상승고도. 기준점에서 GAIN_THRESHOLD_M 이상 올라간 분만 합산하고,
 * 그만큼 내려가면 상승분 없이 기준점만 옮긴다. 평지 노이즈는 임계값을 넘지
 * 못해 0으로 유지되고, 완만한 실제 언덕은 상승분이 계속 누적된다.
 *
 * 유효 고도가 2개 미만이면 null.
 *
 * 한계: 완만한 실제 상승은 약 8%, 롤링힐은 약 25% 과소 계상된다. 기압계나 DEM
 * 없이 고도 시계열만으로는 드리프트와 완만한 언덕을 구분할 수 없어, 과대 계상을
 * 없애는 대가로 받아들인 손실이다.
 */
export function elevationGainM(groups: RoutePoint[][]): number | null {
  const alts = smoothAltitudes(groups.flat()).filter(
    (a): a is number => a !== null
  );
  if (alts.length < 2) return null;
  let gain = 0;
  let ref = alts[0];
  for (let i = 1; i < alts.length; i++) {
    const a = alts[i];
    if (a - ref > GAIN_THRESHOLD_M) {
      gain += a - ref;
      ref = a;
    } else if (ref - a > GAIN_THRESHOLD_M) {
      ref = a;
    }
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

/** 구간 고도 변화 표기: 상승 +N m, 하강 -N m, 0은 무부호, null은 — */
export function formatElevationDelta(deltaM: number | null): string {
  if (deltaM === null) return '—';
  const r = Math.round(deltaM);
  return r > 0 ? `+${r} m` : `${r} m`; // String(-0) === '0'이라 -0도 '0 m'
}
```

- [ ] **Step 4: 새 테스트가 통과하는지 확인한다**

Run: `npm test -- elevation.test`
Expected: PASS (22 tests)

- [ ] **Step 5: `splits.ts`에서 고도 함수를 제거한다**

`src/lib/splits.ts`에서 다음을 삭제한다: `SMOOTH_WINDOW_HALF` 상수, `smoothAltitudes` 함수, `formatElevationDelta` 함수, `elevationGainM` 함수, `ProfilePoint` 인터페이스, `elevationProfile` 함수.

파일 상단 import를 이렇게 바꾼다:

```ts
import type { RoutePoint } from '../types/run';
import { smoothAltitudes } from './elevation';
import { haversineM, METERS_PER_MILE } from './geo';
```

`computeSplits` 본문은 그대로 둔다 — `smoothAltitudes(flat)` 호출이 이제 새 모듈을 가리킨다.

- [ ] **Step 6: 호출부 import 경로를 갱신한다**

`src/components/SplitsList.tsx` 4번째 줄:

```ts
import { formatElevationDelta } from '@/lib/elevation';
import { splitPaceSec, type Split } from '@/lib/splits';
```

`src/components/ElevationChart.tsx` 2번째 줄:

```ts
import type { ProfilePoint } from '@/lib/elevation';
```

`src/components/ElevationChart.web.tsx` 3번째 줄:

```ts
import type { ProfilePoint } from '@/lib/elevation';
```

`app/run/[id].tsx` 10번째 줄:

```ts
import { elevationGainM, elevationProfile } from '@/lib/elevation';
import { computeSplits, splitDistanceFor } from '@/lib/splits';
```

- [ ] **Step 7: 잔여 참조가 없는지 확인한다**

Run: `grep -rn "smoothAltitudes\|elevationGainM\|elevationProfile\|formatElevationDelta\|ProfilePoint" src app | grep -v "lib/elevation\|__tests__/elevation"`

Expected: `splits.ts`의 `import { smoothAltitudes } from './elevation'` 한 줄과 Step 6에서 고친 4개 파일의 `@/lib/elevation` import만 보인다. `from '@/lib/splits'` 또는 `from '../splits'`로 이 심볼들을 가져오는 줄이 하나라도 남아 있으면 고친다.

- [ ] **Step 8: `splits.test.ts`에서 고도 테스트를 제거한다**

`src/lib/__tests__/splits.test.ts`에서 `describe('smoothAltitudes')`, `describe('formatElevationDelta')`, `describe('elevationGainM')`, `describe('elevationProfile')` 블록 전체를 삭제한다 (Task 2 Step 1에서 `elevation.test.ts`로 옮겼다).

import를 정리한다 — 삭제한 블록에서만 쓰던 심볼을 뺀다:

```ts
import {
  computeSplits,
  liveExtraSec,
  liveSplitPaceSec,
  partitionPoints,
  splitDistanceFor,
  splitPaceSec,
} from '../splits';
```

`describe('computeSplits')` 블록의 고도 관련 테스트 3개(`구간 고도 변화 = 경계 보간된 스무딩 고도 차이`, `단조 경사에서 구간 델타의 합 = 스무딩 고도의 처음↔끝 차이`, `고도가 전부 null이면 elevationDeltaM은 null`)는 **그대로 남긴다**. 위도 0.001도(약 111m) 간격이라 ±50m 이동평균이 무연산이 되고 데이터가 선형이라 중앙값 = 평균이므로, 기대값이 바뀌지 않는다.

`STEP_M` 상수는 `computeSplits` 테스트가 계속 쓰므로 남긴다.

- [ ] **Step 9: 전체 테스트와 타입 체크를 돌린다**

Run: `npm test`
Expected: PASS — 전부 통과

Run: `npx tsc --noEmit`
Expected: 출력 없음

`splits.test.ts`에서 미사용 import 경고가 나면 Step 8의 import 정리를 다시 확인한다. `computeSplits` 고도 테스트가 실패하면 기대값을 임의로 고치지 말고, 왜 스무딩 결과가 달라졌는지 먼저 확인할 것 — Task 1 구현의 버그 신호다.

- [ ] **Step 10: 커밋**

```bash
git add src/lib/elevation.ts src/lib/splits.ts src/lib/__tests__/elevation.test.ts src/lib/__tests__/splits.test.ts src/components/SplitsList.tsx src/components/ElevationChart.tsx src/components/ElevationChart.web.tsx "app/run/[id].tsx"
git commit -m "feat(elevation): 총 상승고도 히스테리시스 + 고도 계산 모듈 분리"
```

---

### Task 3: 차트 y축 최소 표시범위

평지 잔여 드리프트가 차트 높이를 가득 채우지 않도록 y 도메인에 최소 폭을 보장한다. native/web 두 차트가 같은 규칙을 쓰게 공용 헬퍼로 둔다.

**Files:**
- Modify: `src/lib/elevation.ts` (헬퍼 추가)
- Modify: `src/lib/__tests__/elevation.test.ts` (테스트 추가)
- Modify: `src/components/ElevationChart.tsx`
- Modify: `src/components/ElevationChart.web.tsx`

**Interfaces:**
- Consumes: Task 2의 `ProfilePoint { distanceM: number; altitudeM: number }`
- Produces: `export function elevationYDomain(profile: ProfilePoint[], minSpanM?: number): [number, number]`

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`src/lib/__tests__/elevation.test.ts`의 import에 `elevationYDomain`을 추가하고, 파일 끝에 다음을 붙인다:

```ts
describe('elevationYDomain', () => {
  it('범위가 최소 폭보다 좁으면 중앙값 기준으로 넓힌다', () => {
    const profile = [
      { distanceM: 0, altitudeM: 99.5 },
      { distanceM: 10, altitudeM: 100.5 },
    ];
    expect(elevationYDomain(profile)).toEqual([80, 120]);
  });

  it('실제 언덕은 min/max를 그대로 쓴다', () => {
    const profile = [
      { distanceM: 0, altitudeM: 20 },
      { distanceM: 10, altitudeM: 100 },
    ];
    expect(elevationYDomain(profile)).toEqual([20, 100]);
  });

  it('경계: 범위가 최소 폭과 정확히 같으면 그대로 쓴다', () => {
    const profile = [
      { distanceM: 0, altitudeM: 100 },
      { distanceM: 10, altitudeM: 140 },
    ];
    expect(elevationYDomain(profile)).toEqual([100, 140]);
  });

  it('minSpanM을 지정할 수 있다', () => {
    const profile = [
      { distanceM: 0, altitudeM: 100 },
      { distanceM: 10, altitudeM: 101 },
    ];
    expect(elevationYDomain(profile, 10)).toEqual([95.5, 105.5]);
  });

  it('빈 프로필은 [0, minSpanM]', () => {
    expect(elevationYDomain([])).toEqual([0, 40]);
  });

  it('평지 드리프트 코스는 잔여 진폭이 차트 높이의 30% 미만이 된다', () => {
    // 이 최소 폭을 두는 이유 — 스무딩만으로는 드리프트가 남아 그래프를 가득 채운다
    const profile = elevationProfile([line(286, 7, (i) => 100 + drift(i))]);
    const [lo, hi] = elevationYDomain(profile);
    const alts = profile.map((p) => p.altitudeM);
    const residual = Math.max(...alts) - Math.min(...alts);
    expect(residual / (hi - lo)).toBeLessThan(0.3);
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npm test -- elevation.test`
Expected: FAIL — `elevationYDomain is not a function`

- [ ] **Step 3: 헬퍼를 구현한다**

`src/lib/elevation.ts` 끝에 추가한다:

```ts
/**
 * 고도 차트 y축 기본 최소 표시범위(m).
 * 스무딩 후에도 저주파 드리프트가 남으므로(평지 2km에서 약 8.6m) 최소 폭 없이
 * min/max에 맞추면 평지도 차트 높이를 가득 채워 큰 기복처럼 보인다. 40m면
 * 그 잔여 진폭이 높이의 약 21%로 완만한 물결이 되고, 실제 지형은 손실이 없다.
 */
const DEFAULT_MIN_SPAN_M = 40;

/**
 * 고도 차트 y 도메인 [min, max]. 프로필 고도 범위가 minSpanM 미만이면
 * 중앙값을 중심으로 minSpanM 폭까지 넓힌다. 그 이상이면 실제 min/max.
 * native/web 차트가 같은 규칙을 쓰도록 공용으로 둔다.
 */
export function elevationYDomain(
  profile: ProfilePoint[],
  minSpanM: number = DEFAULT_MIN_SPAN_M
): [number, number] {
  if (profile.length === 0) return [0, minSpanM];
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of profile) {
    if (p.altitudeM < lo) lo = p.altitudeM;
    if (p.altitudeM > hi) hi = p.altitudeM;
  }
  if (hi - lo < minSpanM) {
    const center = (lo + hi) / 2;
    return [center - minSpanM / 2, center + minSpanM / 2];
  }
  return [lo, hi];
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `npm test -- elevation.test`
Expected: PASS (28 tests)

- [ ] **Step 5: native 차트에 도메인을 적용한다**

`src/components/ElevationChart.tsx` 전체를 이렇게 바꾼다:

```tsx
import { CartesianChart, Line } from 'victory-native';
import { elevationYDomain, type ProfilePoint } from '@/lib/elevation';

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
  // y축에 최소 표시범위를 주지 않으면 평지의 잔여 노이즈가 차트를 가득 채운다
  const [yMin, yMax] = elevationYDomain(profile);
  return (
    <CartesianChart
      data={data}
      xKey="distance"
      yKeys={['altitude']}
      domain={{ y: [yMin, yMax] }}
    >
      {({ points }) => (
        <Line points={points.altitude} color="#3b82f6" strokeWidth={2} />
      )}
    </CartesianChart>
  );
}
```

- [ ] **Step 6: web 차트에 도메인을 적용한다**

`src/components/ElevationChart.web.tsx` 전체를 이렇게 바꾼다:

```tsx
import { View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { elevationYDomain, type ProfilePoint } from '@/lib/elevation';

interface Props {
  profile: ProfilePoint[];
}

// victory-native는 Skia(CanvasKit WASM) 기반이라 웹에서 동작하지 않는다.
// 웹 번들에서는 SVG 폴리라인으로 대체한다.
export function ElevationChart({ profile }: Props) {
  if (profile.length < 2) return null;
  const maxD = profile[profile.length - 1].distanceM || 1;
  // native 차트와 같은 y 도메인 규칙 — 최소 표시범위를 보장한다
  const [minA, maxA] = elevationYDomain(profile);
  const range = maxA - minA || 1;
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

- [ ] **Step 7: 전체 검증을 돌린다**

Run: `npm test`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: 출력 없음

Run: `npm run lint`
Expected: 에러 없음

`domain` prop에서 타입 에러가 나면 설치된 victory-native 41의 `CartesianChart` prop 타입을 확인한다: `node_modules/victory-native/dist/cartesian/CartesianChart.d.ts`에서 `domain`의 정의를 읽고 그 형태에 맞춘다. 값 자체(`[yMin, yMax]`)는 바꾸지 말 것.

- [ ] **Step 8: 커밋**

```bash
git add src/lib/elevation.ts src/lib/__tests__/elevation.test.ts src/components/ElevationChart.tsx src/components/ElevationChart.web.tsx
git commit -m "fix(ui): 고도 차트 y축 최소 표시범위 40m — 평지 노이즈 확대 방지"
```

---

### Task 4: 실기기 확인

순수 함수 테스트로는 "그래프가 현실적으로 보이는가"를 검증할 수 없다. 이 태스크는 코드 변경 없이 사람이 눈으로 확인하는 단계다.

**Files:** 없음 (확인만)

- [ ] **Step 1: 앱을 실기기에 올린다**

Run: `npm run ios`

프로비저닝이 만료됐거나 Debug/Release 프리빌트 충돌이 나면 `docs/`의 실기기 빌드 트러블슈팅 문서를 먼저 볼 것. 이 변경은 네이티브 코드를 건드리지 않으므로 리빌드 없이 기존 dev build에 Fast Refresh만으로도 확인 가능하다.

- [ ] **Step 2: 문제의 기록을 확인한다**

2026-08-14 하남 미사동 2.02km 기록의 상세 화면을 연다. 확인 항목:

- 고도 그래프가 완만해졌는가 (이전: 화면 높이를 가득 채우는 진동)
- 총 상승고도가 `↑15 m`에서 한 자리 수로 내려갔는가
- 구간 리스트의 고도 변화 값이 `+1 m` / `0 m` 수준으로 안정적인가

- [ ] **Step 3: 실제 언덕이 있는 기록을 확인한다**

고저차가 있는 코스의 기록을 열어 언덕이 여전히 그래프에 보이고 총 상승고도가 0이 아닌지 확인한다. 해당 기록이 없으면 이 단계는 건너뛰고, 건너뛴 사실을 남긴다.

- [ ] **Step 4: 결과를 기록한다**

확인 결과를 이 계획 파일 아래에 한 단락으로 적고 커밋한다. 기대와 다른 결과가 나오면 상수를 임의로 바꾸지 말고 실제 관측값(총 상승고도, 그래프 인상)을 적어 보고할 것 — 상수 재조정은 사람의 판단이 필요하다.

```bash
git add docs/superpowers/plans/2026-08-20-elevation-smoothing.md
git commit -m "docs(plan): 고도 보정 실기기 확인 결과"
```
