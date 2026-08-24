# 자동 바퀴 수 감지(랩 카운트) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 트랙·공원 반복 코스에서 바퀴 수를 GPS 루프 클로저로 자동 감지해 라이브 표시·바퀴별 랩타임·음성 안내·기록 요약에 반영한다.

**Architecture:** 순수 함수 증분 상태 머신(`src/lib/laps.ts`)이 GPS 포인트를 하나씩 받아 게이트 발견 → 통과 카운트를 수행한다. 라이브는 `runStore.addPoint`에서 구동하고, 저장된 기록은 같은 코드로 배치 재계산한다(스키마 변경 없음). 음성은 기존 `nextVoiceCue` 마일스톤 패턴에 `'lap'` 큐를 추가한다.

**Tech Stack:** Expo 57 / React Native, zustand, jest(jest-expo), react-native-maps

**스펙:** `docs/superpowers/specs/2026-08-24-lap-counting-design.md`

**스펙 대비 구현 보강(승인된 의도 내):** 정지 상태 GPS 지터가 누적 이동거리를 부풀려 가짜 게이트를 만드는 것을 막기 위해 **전진 판정 가드**를 추가한다 — 최근 60m 경로(`MOVE_WINDOW_M`)에서 직선 변위 30m(`MOVE_MIN_M`) 미만이면 게이트 발견·랩 판정을 하지 않는다. 스펙의 "GPS 지터 루프 배제" 요구를 구조적으로 보장하는 구현 세부다.

## Global Constraints

- Expo v57 고정 — 네이티브 API를 새로 쓰기 전 https://docs.expo.dev/versions/v57.0.0/ 확인 (AGENTS.md). 이 기능은 새 네이티브 API 없음.
- 테스트: `npm test` (TZ=Asia/Seoul jest). 특정 파일: `npm test -- src/lib/__tests__/laps.test.ts`
- 타입 검증: `npx tsc --noEmit`
- 커밋: main 직접, 한국어 제목, 프리픽스 예 `feat(laps):` (기존 로그 컨벤션)
- UI 문구는 한국어. 기존 코드의 주석 밀도·스타일(왜를 설명하는 한국어 주석)을 따른다.
- Supabase 스키마 변경 금지 — 바퀴는 저장된 `routePoints`에서 재계산.
- 튜닝 상수: `GATE_RADIUS_M=25`, `MIN_LAP_M=150`, `HEADING_TOLERANCE_DEG=90`, `CANDIDATE_SPACING_M=15` + 구현 상수 `HEADING_BASE_M=8`, `MOVE_WINDOW_M=60`, `MOVE_MIN_M=30`

---

### Task 1: 방위각 유틸 (`bearingDeg`, `headingDiffDeg`)

**Files:**
- Modify: `src/lib/geo.ts` (파일 끝에 추가)
- Test: `src/lib/__tests__/geo.test.ts` (기존 파일에 describe 추가)

**Interfaces:**
- Consumes: 없음
- Produces: `bearingDeg(a: {latitude,longitude}, b: {latitude,longitude}): number` — a→b 진행 방위각, 도 단위 `[0, 360)`, 0=북·시계방향. `headingDiffDeg(a: number, b: number): number` — 두 방위각의 최소 각차 `[0, 180]`.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/__tests__/geo.test.ts`에 추가:

```ts
import { bearingDeg, headingDiffDeg } from '../geo';

describe('bearingDeg', () => {
  const origin = { latitude: 37.5665, longitude: 126.978 };
  it('북쪽은 0도', () => {
    expect(bearingDeg(origin, { latitude: 37.57, longitude: 126.978 })).toBeCloseTo(0, 0);
  });
  it('동쪽은 90도', () => {
    expect(bearingDeg(origin, { latitude: 37.5665, longitude: 126.99 })).toBeCloseTo(90, 0);
  });
  it('남쪽은 180도', () => {
    expect(bearingDeg(origin, { latitude: 37.56, longitude: 126.978 })).toBeCloseTo(180, 0);
  });
  it('서쪽은 270도', () => {
    expect(bearingDeg(origin, { latitude: 37.5665, longitude: 126.97 })).toBeCloseTo(270, 0);
  });
});

describe('headingDiffDeg', () => {
  it('같은 방향은 0', () => expect(headingDiffDeg(45, 45)).toBe(0));
  it('반대 방향은 180', () => expect(headingDiffDeg(0, 180)).toBe(180));
  it('360 경계를 감아서 계산한다', () => expect(headingDiffDeg(350, 10)).toBe(20));
  it('순서 무관', () => expect(headingDiffDeg(10, 350)).toBe(20));
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/lib/__tests__/geo.test.ts`
Expected: FAIL — `bearingDeg is not a function` 류

- [ ] **Step 3: 구현**

`src/lib/geo.ts` 끝에 추가:

```ts
/** a → b 진행 방위각 (도). 0 = 북, 시계방향, [0, 360) */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** 두 방위각의 최소 각차 [0, 180] — 360 경계를 감아서 계산 */
export function headingDiffDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- src/lib/__tests__/geo.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/geo.ts src/lib/__tests__/geo.test.ts
git commit -m "feat(geo): 방위각 계산 유틸 bearingDeg·headingDiffDeg 추가"
```

---

### Task 2: 루프 클로저 감지기 `src/lib/laps.ts`

**Files:**
- Create: `src/lib/laps.ts`
- Test: `src/lib/__tests__/laps.test.ts`

**Interfaces:**
- Consumes: `haversineM`, `bearingDeg`, `headingDiffDeg` (Task 1, `src/lib/geo.ts`), `RoutePoint` (`src/types/run.ts`)
- Produces (이후 태스크가 의존):
  - `interface Lap { index: number; durationSec: number; distanceM: number }`
  - `interface Gate { latitude: number; longitude: number; headingDeg: number }`
  - `interface LapState { candidates; lastCandidateCumDistM; last; cumDistM; runMs; gate: Gate | null; laps: Lap[]; insideGate; lastCrossCumDistM; lastCrossRunMs }`
  - `const INITIAL_LAP_STATE: LapState`
  - `advanceLaps(state: LapState, p: RoutePoint, pauseBoundary: boolean): LapState`
  - `computeLaps(groups: RoutePoint[][]): LapState`
  - `currentLap(state: LapState): Lap | null`
  - 상수 `GATE_RADIUS_M`, `MIN_LAP_M`, `HEADING_TOLERANCE_DEG`, `CANDIDATE_SPACING_M`

- [ ] **Step 1: 테스트 픽스처 + 핵심 시나리오 테스트 작성**

`src/lib/__tests__/laps.test.ts` 생성:

```ts
import type { RoutePoint } from '../../types/run';
import { haversineM } from '../geo';
import {
  advanceLaps,
  computeLaps,
  currentLap,
  GATE_RADIUS_M,
  INITIAL_LAP_STATE,
} from '../laps';

const CENTER = { latitude: 37.5665, longitude: 126.978 };
const M_PER_LAT = 111_320;
const M_PER_LON = M_PER_LAT * Math.cos((CENTER.latitude * Math.PI) / 180);

// 로컬 평면 근사 — 미터 오프셋(x=동, y=북)을 위경도로 변환
function at(xM: number, yM: number, timestamp: number): RoutePoint {
  return {
    latitude: CENTER.latitude + yM / M_PER_LAT,
    longitude: CENTER.longitude + xM / M_PER_LON,
    altitude: null,
    timestamp,
  };
}

const STEP_M = 5; // 실제 로깅 간격과 동일 (distanceInterval: 5)
const STEP_MS = 3000; // timeInterval: 3000

const TRACK_RADIUS_M = 63.66; // 둘레 ≈ 400m

/** 반지름 radiusM 원을 반시계로 laps바퀴 도는 포인트열. (radiusM, 0)에서 시작 */
function circlePoints(opts: {
  laps: number;
  radiusM?: number;
  startTs?: number;
  noise?: (i: number) => { dx: number; dy: number };
}): RoutePoint[] {
  const radiusM = opts.radiusM ?? TRACK_RADIUS_M;
  const startTs = opts.startTs ?? 0;
  const stepsPerLap = Math.round((2 * Math.PI * radiusM) / STEP_M);
  const total = Math.round(stepsPerLap * opts.laps);
  const pts: RoutePoint[] = [];
  for (let i = 0; i <= total; i++) {
    const angle = (2 * Math.PI * i) / stepsPerLap;
    const n = opts.noise?.(i) ?? { dx: 0, dy: 0 };
    pts.push(
      at(radiusM * Math.cos(angle) + n.dx, radiusM * Math.sin(angle) + n.dy, startTs + i * STEP_MS)
    );
  }
  return pts;
}

/** (from) → (to) 직선을 5m 간격으로 걷는 포인트열 */
function linePoints(
  from: { x: number; y: number },
  to: { x: number; y: number },
  startTs: number
): RoutePoint[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const steps = Math.max(1, Math.round(Math.hypot(dx, dy) / STEP_M));
  const pts: RoutePoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    pts.push(at(from.x + dx * f, from.y + dy * f, startTs + i * STEP_MS));
  }
  return pts;
}

// 결정적 의사 난수 — 테스트에서 Math.random을 쓰지 않는다
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 포인트열을 증분 피드. pauseBoundaryAt에 있는 인덱스는 일시정지 직후 첫 포인트 */
function feed(points: RoutePoint[], pauseBoundaryAt?: Set<number>) {
  let state = INITIAL_LAP_STATE;
  points.forEach((p, i) => {
    state = advanceLaps(state, p, pauseBoundaryAt?.has(i) ?? false);
  });
  return state;
}

describe('advanceLaps — 루프 발견과 카운트', () => {
  it('400m 트랙 3바퀴를 정확히 센다', () => {
    const state = feed(circlePoints({ laps: 3 }));
    expect(state.laps).toHaveLength(3);
    // 첫 바퀴는 게이트 반경 진입 지점까지라 살짝 짧다 (~375m)
    expect(state.laps[0].distanceM).toBeGreaterThan(340);
    expect(state.laps[0].distanceM).toBeLessThan(430);
    // 이후 바퀴는 온전한 둘레
    for (const lap of state.laps.slice(1)) {
      expect(lap.distanceM).toBeGreaterThan(370);
      expect(lap.distanceM).toBeLessThan(430);
      expect(lap.durationSec).toBeGreaterThan(225);
      expect(lap.durationSec).toBeLessThan(255);
    }
    // 게이트는 트랙 시작점 부근에 잡힌다
    expect(state.gate).not.toBeNull();
    expect(haversineM(state.gate!, at(TRACK_RADIUS_M, 0, 0))).toBeLessThan(GATE_RADIUS_M + 1);
  });

  it('워밍업 직선 이동 후 트랙을 돌아도 감지한다', () => {
    const warmup = linePoints({ x: TRACK_RADIUS_M, y: -250 }, { x: TRACK_RADIUS_M, y: -10 }, 0);
    const lastTs = warmup[warmup.length - 1].timestamp;
    const track = circlePoints({ laps: 2, startTs: lastTs + STEP_MS });
    const state = feed([...warmup, ...track]);
    expect(state.gate).not.toBeNull();
    expect(state.laps).toHaveLength(2);
    // 두 번째 바퀴는 온전한 한 바퀴
    expect(state.laps[1].distanceM).toBeGreaterThan(370);
    expect(state.laps[1].distanceM).toBeLessThan(430);
  });

  it('왕복 코스는 바퀴로 세지 않는다 (방위각 필터)', () => {
    const out = linePoints({ x: 0, y: 0 }, { x: 0, y: 500 }, 0);
    const backTs = out[out.length - 1].timestamp + STEP_MS;
    const back = linePoints({ x: 0, y: 500 }, { x: 0, y: 0 }, backTs);
    const state = feed([...out, ...back]);
    expect(state.gate).toBeNull();
    expect(state.laps).toHaveLength(0);
  });

  it('정지 상태 GPS 지터는 게이트를 만들지 않는다 (전진 판정)', () => {
    const rand = mulberry32(7);
    const pts: RoutePoint[] = [];
    for (let i = 0; i < 300; i++) {
      pts.push(at((rand() - 0.5) * 16, (rand() - 0.5) * 16, i * STEP_MS)); // ±8m 지터
    }
    const state = feed(pts);
    expect(state.gate).toBeNull();
  });

  it('±5m 노이즈가 있어도 3바퀴를 정확히 센다', () => {
    const rand = mulberry32(42);
    const noise = () => ({ dx: (rand() - 0.5) * 10, dy: (rand() - 0.5) * 10 });
    const state = feed(circlePoints({ laps: 3, noise }));
    expect(state.laps).toHaveLength(3);
  });

  it('±10m 노이즈에서도 과잉 카운트는 없다', () => {
    const rand = mulberry32(99);
    const noise = () => ({ dx: (rand() - 0.5) * 20, dy: (rand() - 0.5) * 20 });
    const state = feed(circlePoints({ laps: 3, noise }));
    expect(state.laps.length).toBeLessThanOrEqual(3);
    expect(state.laps.length).toBeGreaterThanOrEqual(2);
  });
});

describe('currentLap', () => {
  it('게이트 확정 전에는 null', () => {
    const state = feed(circlePoints({ laps: 0.5 }));
    expect(currentLap(state)).toBeNull();
  });

  it('진행 중 바퀴의 번호·거리·시간을 반환한다', () => {
    const state = feed(circlePoints({ laps: 2.5 }));
    expect(state.laps).toHaveLength(2);
    const cur = currentLap(state);
    expect(cur).not.toBeNull();
    expect(cur!.index).toBe(3);
    expect(cur!.distanceM).toBeGreaterThan(150);
    expect(cur!.distanceM).toBeLessThan(260);
  });
});

describe('일시정지 처리와 배치 재계산', () => {
  // 첫 바퀴 중간(인덱스 40)에서 60초 일시정지: 이후 타임스탬프가 60초 밀린다
  function pausedRun() {
    const pts = circlePoints({ laps: 2 });
    const k = 40;
    const shifted = pts.map((p, i) =>
      i >= k ? { ...p, timestamp: p.timestamp + 60_000 } : p
    );
    return { shifted, k };
  }

  it('일시정지를 낀 랩의 랩타임은 정지 시간을 제외한다', () => {
    const { shifted, k } = pausedRun();
    const state = feed(shifted, new Set([k]));
    expect(state.laps).toHaveLength(2);
    // 정지 60초가 포함됐다면 ~285초가 된다 — 240초 부근이어야 한다
    expect(state.laps[0].durationSec).toBeGreaterThan(200);
    expect(state.laps[0].durationSec).toBeLessThan(250);
  });

  it('computeLaps(배치)는 증분 피드와 같은 결과를 낸다', () => {
    const { shifted, k } = pausedRun();
    const live = feed(shifted, new Set([k]));
    const batch = computeLaps([shifted.slice(0, k), shifted.slice(k)]);
    expect(batch.laps).toEqual(live.laps);
    expect(batch.gate).toEqual(live.gate);
  });

  it('포인트가 없거나 하나뿐이면 초기 상태에 준한다', () => {
    expect(computeLaps([]).laps).toHaveLength(0);
    expect(computeLaps([[at(0, 0, 0)]]).laps).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/lib/__tests__/laps.test.ts`
Expected: FAIL — `Cannot find module '../laps'`

- [ ] **Step 3: 구현**

`src/lib/laps.ts` 생성:

```ts
import type { RoutePoint } from '../types/run';
import { bearingDeg, haversineM, headingDiffDeg } from './geo';

// 튜닝 상수 — 근거는 docs/superpowers/specs/2026-08-24-lap-counting-design.md
export const GATE_RADIUS_M = 25; // GPS 오차 ~10m + 트랙 8레인 폭 ~10m
export const MIN_LAP_M = 150; // 200m 실내 트랙까지 지원, 지터 루프 배제
export const HEADING_TOLERANCE_DEG = 90; // 왕복 재통과(~180°)를 확실히 배제
export const CANDIDATE_SPACING_M = 15; // 게이트 반경 25m 대비 충분히 촘촘

// 방위각 계산 기준선 — 원시 GPS 쌍(5m)은 지터에 흔들려 후보점(≥15m)을 앵커로 쓴다
const HEADING_BASE_M = 8;
// 전진 판정: 최근 60m 경로에서 직선 변위 30m 미만이면 정지 지터로 보고 판정을 쉰다
const MOVE_WINDOW_M = 60;
const MOVE_MIN_M = 30;

export interface Lap {
  index: number; // 1부터
  durationSec: number; // 일시정지 시간 제외
  distanceM: number; // 경로 누적거리 기준 한 바퀴 거리
}

export interface Gate {
  latitude: number;
  longitude: number;
  headingDeg: number; // 첫 통과 당시 진행 방위각
}

interface Candidate {
  latitude: number;
  longitude: number;
  cumDistM: number; // 이 지점까지의 경로 누적거리
  runMs: number; // 이 지점까지의 누적 이동 시간 (일시정지 제외)
  headingDeg: number | null; // 직전 후보점 → 이 후보점. 첫 후보점은 두 번째 생성 시 백필
}

export interface LapState {
  candidates: Candidate[]; // ~15m 간격 다운샘플 궤적. 방위각 앵커·전진 판정에도 쓴다
  lastCandidateCumDistM: number;
  last: RoutePoint | null;
  cumDistM: number;
  runMs: number;
  gate: Gate | null;
  laps: Lap[];
  insideGate: boolean; // 게이트 반경 안에 있는가 — exit 후 재진입만 랩으로 인정
  lastCrossCumDistM: number; // 마지막 게이트 통과 시점의 누적거리 (보간값)
  lastCrossRunMs: number; // 마지막 게이트 통과 시점의 이동 시간 (보간값)
}

export const INITIAL_LAP_STATE: LapState = {
  candidates: [],
  lastCandidateCumDistM: 0,
  last: null,
  cumDistM: 0,
  runMs: 0,
  gate: null,
  laps: [],
  insideGate: false,
  lastCrossCumDistM: 0,
  lastCrossRunMs: 0,
};

/**
 * 진행 방위각. 마지막 후보점 중 8m 이상 떨어진 것을 앵커로 잡는다.
 * 앵커가 없으면(시작 직후·제자리 지터) null — 그 틱은 게이트 판정을 쉰다.
 */
function headingAt(candidates: Candidate[], p: RoutePoint): number | null {
  for (let i = candidates.length - 1; i >= 0 && i >= candidates.length - 4; i--) {
    if (haversineM(candidates[i], p) >= HEADING_BASE_M) return bearingDeg(candidates[i], p);
  }
  return null;
}

/**
 * 전진 판정: 최근 MOVE_WINDOW_M 경로 구간의 직선 변위가 MOVE_MIN_M 이상인가.
 * 정지 상태 GPS 지터는 누적거리는 쌓지만 변위가 없어 여기서 걸러진다.
 * 후보점 간격이 15m이므로 몇 개만 거슬러 올라가면 끝난다.
 */
function isMovingForward(candidates: Candidate[], p: RoutePoint, cumDistM: number): boolean {
  for (let i = candidates.length - 1; i >= 0; i--) {
    if (candidates[i].cumDistM <= cumDistM - MOVE_WINDOW_M) {
      return haversineM(candidates[i], p) >= MOVE_MIN_M;
    }
  }
  return false;
}

/**
 * 게이트 반경 진입 시각·거리의 선형 보간 (computeSplits의 경계 보간과 같은 취지).
 * 직전 포인트가 이미 반경 안이거나 분모가 0이면 보간 없이 직전 값으로 둔다.
 */
function crossPoint(
  prev: RoutePoint,
  gate: { latitude: number; longitude: number },
  next: RoutePoint,
  prevRunMs: number,
  dtMs: number,
  prevCumM: number,
  ddM: number
): { runMs: number; cumDistM: number } {
  const dPrev = haversineM(prev, gate);
  const dNext = haversineM(next, gate);
  const denom = dPrev - dNext;
  const f =
    dPrev <= GATE_RADIUS_M || denom <= 0
      ? 0
      : Math.min(1, (dPrev - GATE_RADIUS_M) / denom);
  return { runMs: prevRunMs + dtMs * f, cumDistM: prevCumM + ddM * f };
}

/**
 * 포인트 하나로 랩 상태를 전진시킨다. 순수 함수 — 같은 입력열이면 라이브 증분과
 * 배치 재계산의 결과가 같다.
 *
 * pauseBoundary: 직전 포인트와 이 포인트 사이에 일시정지가 있었는가.
 * true면 시간 델타를 0으로 계상한다 (partitionPoints 그룹 경계와 같은 규칙).
 */
export function advanceLaps(state: LapState, p: RoutePoint, pauseBoundary: boolean): LapState {
  if (state.last === null) {
    return {
      ...state,
      last: p,
      candidates: [
        { latitude: p.latitude, longitude: p.longitude, cumDistM: 0, runMs: 0, headingDeg: null },
      ],
    };
  }

  const dd = haversineM(state.last, p);
  const dt = pauseBoundary ? 0 : Math.max(0, p.timestamp - state.last.timestamp);
  const prevLast = state.last;
  const prevRunMs = state.runMs;
  const prevCumM = state.cumDistM;
  const cumDistM = prevCumM + dd;
  const runMs = prevRunMs + dt;

  let next: LapState = { ...state, last: p, cumDistM, runMs };

  const heading = headingAt(next.candidates, p);
  const moving = isMovingForward(next.candidates, p, cumDistM);

  if (next.gate === null) {
    // 1단계 — 루프 발견: 충분히 이전 경로의 후보점에 같은 방향으로 근접했는가
    if (heading !== null && moving) {
      let best: Candidate | null = null;
      let bestD = Infinity;
      for (const c of next.candidates) {
        if (c.headingDeg === null) continue;
        if (cumDistM - c.cumDistM < MIN_LAP_M) continue;
        const d = haversineM(c, p);
        if (d > GATE_RADIUS_M || d >= bestD) continue;
        if (headingDiffDeg(heading, c.headingDeg) > HEADING_TOLERANCE_DEG) continue;
        best = c;
        bestD = d;
      }
      if (best !== null) {
        const cross = crossPoint(prevLast, best, p, prevRunMs, dt, prevCumM, dd);
        next = {
          ...next,
          gate: {
            latitude: best.latitude,
            longitude: best.longitude,
            headingDeg: best.headingDeg as number,
          },
          laps: [
            {
              index: 1,
              durationSec: (cross.runMs - best.runMs) / 1000,
              distanceM: cross.cumDistM - best.cumDistM,
            },
          ],
          insideGate: true,
          lastCrossRunMs: cross.runMs,
          lastCrossCumDistM: cross.cumDistM,
        };
      }
    }
  } else {
    // 2단계 — 카운트: 반경을 나갔다가 같은 방향으로 재진입하면 +1
    const dGate = haversineM(next.gate, p);
    if (next.insideGate) {
      if (dGate > GATE_RADIUS_M) next = { ...next, insideGate: false };
    } else if (dGate <= GATE_RADIUS_M && heading !== null && moving) {
      // 방위각·전진 판정이 불가능한 틱이면 진입 판정 자체를 다음 포인트로 미룬다
      const isLap =
        cumDistM - next.lastCrossCumDistM >= MIN_LAP_M &&
        headingDiffDeg(heading, next.gate.headingDeg) <= HEADING_TOLERANCE_DEG;
      if (isLap) {
        const cross = crossPoint(prevLast, next.gate, p, prevRunMs, dt, prevCumM, dd);
        next = {
          ...next,
          laps: [
            ...next.laps,
            {
              index: next.laps.length + 1,
              durationSec: (cross.runMs - next.lastCrossRunMs) / 1000,
              distanceM: cross.cumDistM - next.lastCrossCumDistM,
            },
          ],
          insideGate: true,
          lastCrossRunMs: cross.runMs,
          lastCrossCumDistM: cross.cumDistM,
        };
      } else {
        // 조건 미달 진입(역방향·최소 거리 미달) — 반경 상태만 갱신, exit 후 재진입 요구 유지
        next = { ...next, insideGate: true };
      }
    }
  }

  // 후보점 다운샘플 — 게이트 확정 후에도 방위각 앵커·전진 판정용으로 계속 쌓는다
  // (20km 러닝도 ~1,300개, 포인트 유입은 3초에 1개라 선형 탐색으로 충분)
  if (cumDistM - next.lastCandidateCumDistM >= CANDIDATE_SPACING_M) {
    const prevCand = next.candidates[next.candidates.length - 1];
    const h = bearingDeg(prevCand, p);
    const candidates = [
      ...next.candidates,
      { latitude: p.latitude, longitude: p.longitude, cumDistM, runMs, headingDeg: h },
    ];
    // 첫 후보점(시작점)의 방위각은 시작 직후 진행 방향으로 백필
    if (candidates[0].headingDeg === null) {
      candidates[0] = { ...candidates[0], headingDeg: h };
    }
    next = { ...next, candidates, lastCandidateCumDistM: cumDistM };
  }

  return next;
}

/**
 * 저장된 기록의 배치 재계산. 그룹 경계 = 일시정지 (RunRecord.routePoints 규칙).
 * 라이브와 같은 advanceLaps를 순서대로 부르므로 결과가 일치한다.
 */
export function computeLaps(groups: RoutePoint[][]): LapState {
  let state = INITIAL_LAP_STATE;
  let firstGroup = true;
  for (const g of groups) {
    let boundary = !firstGroup;
    for (const p of g) {
      state = advanceLaps(state, p, boundary);
      boundary = false;
    }
    firstGroup = false;
  }
  return state;
}

/** 진행 중인 바퀴. 게이트 확정 전이거나 방금 통과한 직후(거리 0)면 null */
export function currentLap(state: LapState): Lap | null {
  if (state.gate === null) return null;
  const distanceM = state.cumDistM - state.lastCrossCumDistM;
  if (distanceM <= 0) return null;
  return {
    index: state.laps.length + 1,
    durationSec: (state.runMs - state.lastCrossRunMs) / 1000,
    distanceM,
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- src/lib/__tests__/laps.test.ts`
Expected: PASS (전체). 개별 실패 시 수치 경계(보간·이산화 오차)를 먼저 의심하되, 테스트의 허용 범위는 행동 요구사항이므로 테스트를 느슨하게 고치지 말고 구현을 고친다.

- [ ] **Step 5: 전체 테스트·타입 확인**

Run: `npm test && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add src/lib/laps.ts src/lib/__tests__/laps.test.ts
git commit -m "feat(laps): 루프 클로저 기반 바퀴 감지기 — 게이트 발견·카운트·보간 랩타임"
```

---

### Task 3: runStore 통합 — 라이브 감지 구동

**Files:**
- Modify: `src/stores/runStore.ts`
- Test: `src/stores/__tests__/runStore.test.ts` (describe 추가)

**Interfaces:**
- Consumes: `advanceLaps`, `INITIAL_LAP_STATE`, `LapState` (Task 2)
- Produces: `RunState.lapState: LapState` — 이후 태스크가 `useRunStore((s) => s.lapState)`로 읽는다. `start`/`reset` 시 `INITIAL_LAP_STATE`로 초기화됨.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/stores/__tests__/runStore.test.ts`에 추가 (기존 테스트 패턴에 맞춰 파일 끝에):

```ts
import { INITIAL_LAP_STATE } from '../../lib/laps';

describe('addPoint 랩 감지 통합', () => {
  const pt = (latitude: number, timestamp: number) => ({
    latitude,
    longitude: 127,
    altitude: null,
    timestamp,
  });

  it('일시정지 경계를 넘는 포인트 쌍의 시간은 랩 상태에 가산되지 않는다', () => {
    useRunStore.getState().start(0);
    useRunStore.getState().addPoint(pt(37.5, 1000));
    useRunStore.getState().addPoint(pt(37.5001, 4000));
    useRunStore.getState().pause(5000);
    useRunStore.getState().resume(65000);
    useRunStore.getState().addPoint(pt(37.5002, 66000));
    const { lapState } = useRunStore.getState();
    // 1000→4000의 3초만 계상 — 4000→66000은 일시정지 경계라 0
    expect(lapState.runMs).toBe(3000);
    expect(lapState.cumDistM).toBeGreaterThan(20);
  });

  it('reset은 랩 상태를 초기화한다', () => {
    useRunStore.getState().start(0);
    useRunStore.getState().addPoint(pt(37.5, 1000));
    useRunStore.getState().reset();
    expect(useRunStore.getState().lapState).toEqual(INITIAL_LAP_STATE);
  });
});
```

(파일 상단에 이미 `useRunStore` import가 있으면 재사용. 각 테스트가 `start()`로 상태를 새로 세우므로 별도 beforeEach 불필요 — 기존 파일에 beforeEach 리셋 패턴이 있으면 그것을 따른다.)

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/stores/__tests__/runStore.test.ts`
Expected: FAIL — `lapState` 부재(undefined)

- [ ] **Step 3: 구현**

`src/stores/runStore.ts` 수정:

1. import 추가:
```ts
import { advanceLaps, INITIAL_LAP_STATE, type LapState } from '../lib/laps';
```

2. `RunState` 인터페이스에 필드 추가 (`segments` 아래):
```ts
  lapState: LapState; // 자동 바퀴 감지 상태 — addPoint마다 전진
```

3. `initial`에 추가:
```ts
  lapState: INITIAL_LAP_STATE,
```

4. `addPoint` 교체:
```ts
  addPoint: (p) => {
    const { status, points, distanceM, segments, lapState } = get();
    if (status !== 'running') return;
    const last = points[points.length - 1];
    const added = last ? haversineM(last, p) : 0;
    // 일시정지 경계 판정 — partitionPoints의 그룹 경계와 같은 규칙.
    // 일시정지 중 포인트는 위 status 가드가 버리므로 마지막 완료 세그먼트만 보면 된다.
    const lastSeg = segments[segments.length - 1];
    const pauseBoundary =
      last !== undefined &&
      lastSeg !== undefined &&
      last.timestamp <= lastSeg.end &&
      p.timestamp > lastSeg.end;
    set({
      points: [...points, p],
      distanceM: distanceM + added,
      lapState: advanceLaps(lapState, p, pauseBoundary),
    });
  },
```

`start`와 `reset`은 `...initial` 스프레드라 자동으로 초기화된다 — 별도 수정 없음.

- [ ] **Step 4: 통과 확인**

Run: `npm test -- src/stores/__tests__/runStore.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/stores/runStore.ts src/stores/__tests__/runStore.test.ts
git commit -m "feat(laps): runStore에 랩 감지 상태 통합 — addPoint에서 증분 구동"
```

---

### Task 4: 음성 안내 — `'lap'` 큐, 설정 토글

**Files:**
- Modify: `src/lib/voice.ts`
- Modify: `src/stores/settingsStore.ts`
- Modify: `src/hooks/useVoiceCues.ts`
- Modify: `src/components/VoiceGuideSection.tsx`
- Test: `src/lib/__tests__/voice.test.ts` (기존 호출부 갱신 + 케이스 추가)

**Interfaces:**
- Consumes: 없음 (이 태스크는 lib·설정 계층만. lapCount 값은 Task 5에서 연결)
- Produces:
  - `VoiceCue = 'lap' | 'distance' | 'time' | null` — 우선순위 랩 > 거리 > 시간
  - `VoiceCueState`에 `lastLapCount: number` 추가 (`INITIAL_VOICE_CUE_STATE`도)
  - `nextVoiceCue(p)`의 p에 `lapCount: number`, `lapOn: boolean` 필수 추가
  - `lapCueText(p: { lapIndex: number; lapDurationMs: number }): string`
  - `voiceSummaryText(p)`의 p에 `lapCount: number | null` 필수 추가
  - `settingsStore`: `voiceLapOn: boolean` (기본 `true`), `setVoiceLapOn(v: boolean)`
  - `useVoiceCues(p)`의 p에 `lapCount: number`, `lastLapDurationMs: number | null` 추가

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/__tests__/voice.test.ts`에 추가:

```ts
describe('lap 큐', () => {
  const base = {
    distanceM: 0,
    elapsedMs: 0,
    unit: 'km' as const,
    distanceUnits: null,
    timeMin: null,
    state: { lastDistanceM: 0, lastElapsedMs: 0, lastLapCount: 0 },
  };

  it('바퀴 수가 늘면 lap 큐를 낸다', () => {
    const { cue, state } = nextVoiceCue({ ...base, lapCount: 1, lapOn: true });
    expect(cue).toBe('lap');
    expect(state.lastLapCount).toBe(1);
  });

  it('lap과 distance가 같은 틱에 걸리면 lap만 말하고 상태는 모두 전진한다', () => {
    const { cue, state } = nextVoiceCue({
      ...base,
      distanceM: 1000,
      distanceUnits: 1,
      lapCount: 1,
      lapOn: true,
    });
    expect(cue).toBe('lap');
    expect(state.lastDistanceM).toBe(1000); // 다음 틱에 distance가 소급 발화되지 않는다
  });

  it('lapOn이 꺼져 있으면 lap 큐를 내지 않는다', () => {
    const { cue, state } = nextVoiceCue({ ...base, lapCount: 2, lapOn: false });
    expect(cue).toBeNull();
    expect(state.lastLapCount).toBe(2); // 꺼져 있어도 기준점은 전진 — 켜는 순간 몰아 읽지 않는다
  });
});

describe('lapCueText', () => {
  it('바퀴 번호와 랩타임을 읽는다', () => {
    expect(lapCueText({ lapIndex: 3, lapDurationMs: 125_000 })).toBe('3바퀴. 랩타임 2분 5초.');
  });
});
```

`voiceSummaryText` describe에 추가:

```ts
  it('바퀴 수가 있으면 한 문장 추가한다', () => {
    const text = voiceSummaryText({
      elapsedMs: 1_800_000,
      distanceM: 4800,
      unit: 'km',
      paceSecPerUnit: 375,
      goalDistanceUnits: null,
      lapCount: 12,
    });
    expect(text).toContain('12바퀴');
  });
```

그리고 **기존 테스트 호출부 갱신**: 기존 `nextVoiceCue(...)` 호출의 인자에 `lapCount: 0, lapOn: false`를, 기존 `state` 리터럴에 `lastLapCount: 0`을, 기존 `voiceSummaryText(...)` 호출에 `lapCount: null`을 추가한다. `lapCueText` import도 추가.

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/lib/__tests__/voice.test.ts`
Expected: FAIL (타입 에러 또는 `lapCueText` 미정의)

- [ ] **Step 3: voice.ts 구현**

`src/lib/voice.ts` 수정:

1. `VoiceCueState`·초기값·`VoiceCue` 교체:
```ts
export interface VoiceCueState {
  lastDistanceM: number;
  lastElapsedMs: number;
  lastLapCount: number;
}

export const INITIAL_VOICE_CUE_STATE: VoiceCueState = {
  lastDistanceM: 0,
  lastElapsedMs: 0,
  lastLapCount: 0,
};

export type VoiceCue = 'lap' | 'distance' | 'time' | null;
```

2. `nextVoiceCue` — 파라미터에 `lapCount: number; lapOn: boolean;` 추가, state 갱신에 `lastLapCount: p.lapCount` 추가, 거리 판정 **앞에** 랩 판정 삽입 (트랙 러닝에서는 랩이 주 관심사 — 우선순위 랩 > 거리 > 시간):
```ts
  const state: VoiceCueState = {
    lastDistanceM: p.distanceM,
    lastElapsedMs: p.elapsedMs,
    lastLapCount: p.lapCount,
  };

  if (p.lapOn && p.lapCount > p.state.lastLapCount) {
    return { state, cue: 'lap' };
  }
```
(기존 distance·time 분기는 그대로 뒤에 둔다.)

3. `lapCueText` 추가 (`voiceCueText` 아래):
```ts
/** 바퀴 완주 안내 한 건의 발화문. "3바퀴. 랩타임 2분 5초." */
export function lapCueText(p: { lapIndex: number; lapDurationMs: number }): string {
  return `${p.lapIndex}바퀴. 랩타임 ${speakDuration(p.lapDurationMs)}.`;
}
```

4. `voiceSummaryText` — 파라미터에 `lapCount: number | null;` 추가, 페이스 문장 뒤에:
```ts
  if (p.lapCount !== null && p.lapCount >= 1) {
    sentences.push(`${p.lapCount}바퀴를 돌았습니다`);
  }
```

- [ ] **Step 4: settingsStore 구현**

`src/stores/settingsStore.ts` — 인터페이스·스토어에 추가:

```ts
  voiceLapOn: boolean; // 바퀴 완주 음성 안내. 거리·시간 안내가 하나라도 켜져 있을 때만 발화
  setVoiceLapOn: (v: boolean) => void;
```
```ts
      voiceLapOn: true,
      setVoiceLapOn: (voiceLapOn) => set({ voiceLapOn }),
```
(persist는 얕은 병합이라 기존 저장본에서 `true`로 복원 — 버전 범프 불필요. 기본 켬이어도 음성 안내 자체가 꺼진 사용자에게는 발화가 없다.)

- [ ] **Step 5: useVoiceCues 연결**

`src/hooks/useVoiceCues.ts` 수정:

1. import에 `lapCueText` 추가.
2. 파라미터 확장:
```ts
export function useVoiceCues(p: {
  status: RunStatus;
  startedAt: number | null;
  distanceM: number;
  elapsedMs: number;
  lapCount: number;
  lastLapDurationMs: number | null;
}): void {
  const { status, startedAt, distanceM, elapsedMs, lapCount, lastLapDurationMs } = p;
```
3. 설정 구독 추가:
```ts
  const voiceLapOn = useSettingsStore((s) => s.voiceLapOn);
```
4. `nextVoiceCue` 호출에 전달 — 바퀴 안내는 음성 안내(거리·시간)가 켜져 있을 때만 발화한다. 그렇지 않으면 기본값 `voiceLapOn: true` 때문에 음성 안내를 끈 사용자에게도 오디오 세션을 잡게 된다:
```ts
      lapCount,
      lapOn: voiceLapOn && isVoiceGuideOn(distanceUnits, timeMin),
```
5. 발화 분기 — 기존 `if (cue === null) return;` 뒤에:
```ts
    if (cue === 'lap') {
      speakCue(
        lapCueText({ lapIndex: lapCount, lapDurationMs: lastLapDurationMs ?? 0 }),
      );
      return;
    }
```
6. 두 번째 useEffect의 의존성 배열에 `lapCount, lastLapDurationMs, voiceLapOn` 추가.

주의: 이 시점에서 `app/(tabs)/index.tsx`의 `useVoiceCues` 호출이 타입 에러가 난다. 이 태스크에서 **임시 최소 연결**로 호출부에 `lapCount: 0, lastLapDurationMs: null`을 넣지 말고, 아래처럼 실제 값을 바로 연결한다 (한 줄 수정으로 충분):

`app/(tabs)/index.tsx`의 selector 목록에 추가:
```ts
  const lapState = useRunStore((s) => s.lapState);
```
`useVoiceCues` 호출 교체:
```ts
  const lastLap = lapState.laps[lapState.laps.length - 1];
  useVoiceCues({
    status,
    startedAt,
    distanceM,
    elapsedMs: elapsed,
    lapCount: lapState.laps.length,
    lastLapDurationMs: lastLap ? Math.round(lastLap.durationSec * 1000) : null,
  });
```

- [ ] **Step 6: VoiceGuideSection 토글 추가**

`src/components/VoiceGuideSection.tsx` — 스토어 구독 추가:
```ts
  const lapOn = useSettingsStore((s) => s.voiceLapOn);
  const setLapOn = useSettingsStore((s) => s.setVoiceLapOn);
```
"시간마다 (분)" 블록 아래에 추가 (기존 ToggleGroup 패턴 그대로):
```tsx
      <View className="gap-2">
        <Text className="text-sm text-muted-foreground">바퀴마다 (루프 감지 시)</Text>
        <ToggleGroup
          type="single"
          value={lapOn ? 'on' : OFF}
          onValueChange={(v) => {
            if (!v) return;
            setLapOn(v === 'on');
          }}
          className="justify-start"
        >
          <ToggleGroupItem value={OFF} isFirst>
            <Text>끔</Text>
          </ToggleGroupItem>
          <ToggleGroupItem value="on" isLast>
            <Text>켬</Text>
          </ToggleGroupItem>
        </ToggleGroup>
      </View>
```

- [ ] **Step 7: 통과 확인**

Run: `npm test && npx tsc --noEmit`
Expected: PASS — voice 신규 케이스 포함 전체. `index.tsx`의 `onStop` 내 `voiceSummaryText` 호출도 `lapCount` 인자가 필요해 타입 에러가 난다면, 이 태스크에서는 `lapCount: null`로 두고 Task 5에서 실제 값으로 교체한다. (tsc가 깨진 채 커밋하지 않는다.)

- [ ] **Step 8: 커밋**

```bash
git add src/lib/voice.ts src/lib/__tests__/voice.test.ts src/stores/settingsStore.ts src/hooks/useVoiceCues.ts src/components/VoiceGuideSection.tsx "app/(tabs)/index.tsx"
git commit -m "feat(voice): 바퀴 완주 음성 안내 — lap 큐(랩>거리>시간), 설정 토글 기본 켬"
```

---

### Task 5: 러닝 화면 라이브 표시 + 지도 게이트 마커

**Files:**
- Modify: `app/(tabs)/index.tsx`
- Modify: `src/components/RouteMap.tsx`
- Modify: `src/components/RouteMap.web.tsx`

**Interfaces:**
- Consumes: `lapState`(Task 3), `currentLap`(Task 2), `voiceSummaryText`의 `lapCount`(Task 4)
- Produces: `RouteMap` Props에 `gate?: { latitude: number; longitude: number } | null` 추가 — Task 6의 상세 화면도 이 prop을 쓴다.

- [ ] **Step 1: RouteMap 게이트 마커**

`src/components/RouteMap.tsx`:
1. import 교체: `import MapView, { Marker, Polyline } from 'react-native-maps';`
2. Props에 추가:
```ts
  /** 랩 게이트 좌표. 루프가 감지되면 마커로 표시 */
  gate?: { latitude: number; longitude: number } | null;
```
3. 함수 시그니처 구조분해에 `gate = null,` 추가.
4. `<Polyline>` 블록 아래에:
```tsx
      {gate && (
        <Marker
          coordinate={gate}
          title="랩 게이트"
          pinColor="#3b82f6"
          anchor={{ x: 0.5, y: 1 }}
        />
      )}
```

`src/components/RouteMap.web.tsx`: Props 인터페이스에 동일한 `gate?: { latitude: number; longitude: number } | null;` 추가 (렌더링은 하지 않음 — 웹 스텁).

- [ ] **Step 2: 러닝 화면 랩 라인**

`app/(tabs)/index.tsx` (Task 4에서 `lapState` selector와 `useVoiceCues` 연결은 이미 완료):

1. import 추가:
```ts
import { currentLap } from '@/lib/laps';
```
2. `extraSec` 계산 아래에 라이브 랩 시간 계산 추가:
```ts
  // 진행 중 바퀴의 라이브 랩타임 — 구간 페이스와 같은 이유로 벽시계 경과를 가산
  const liveLap = currentLap(lapState);
  const liveLapMs = ((liveLap?.durationSec ?? 0) + extraSec) * 1000;
```
3. 상단 카드의 구간 라인(`{liveSplits && (...)}`) 바로 아래에 랩 라인 추가:
```tsx
              {lapState.gate !== null && (
                <Text className="text-center text-lg text-muted-foreground">
                  {`랩 ${lapState.laps.length + 1} · ${formatDuration(liveLapMs)}`}
                </Text>
              )}
```
4. 지도에 게이트 전달 — 홈 화면 `<RouteMap ...>`에 prop 추가:
```tsx
          gate={lapState.gate}
```
5. `onStop`의 음성 요약에 바퀴 수 연결 — `s` 캡처 후:
```ts
    const lapCount = s.lapState.laps.length;
```
`voiceSummaryText` 호출에 (Task 4에서 임시 `lapCount: null`을 넣었다면 교체):
```ts
          lapCount: lapCount >= 1 ? lapCount : null,
```

- [ ] **Step 3: 검증**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: PASS. (컴포넌트 자동 테스트는 없는 코드베이스 — 타입·린트로 검증하고 실기기 확인은 후속 항목으로 남긴다.)

- [ ] **Step 4: 커밋**

```bash
git add "app/(tabs)/index.tsx" src/components/RouteMap.tsx src/components/RouteMap.web.tsx
git commit -m "feat(laps): 러닝 화면 라이브 랩 라인·지도 게이트 마커"
```

---

### Task 6: 기록 상세 — 바퀴 리스트와 총 바퀴 수

**Files:**
- Create: `src/components/LapsList.tsx`
- Modify: `app/run/[id].tsx`

**Interfaces:**
- Consumes: `computeLaps`, `Lap`(Task 2), `RouteMap.gate`(Task 5), `RunRecord.routePoints`
- Produces: `LapsList({ laps: Lap[] })` 컴포넌트

- [ ] **Step 1: LapsList 컴포넌트 작성**

`src/components/LapsList.tsx` 생성 (SplitsList의 상대 막대 패턴 준용):

```tsx
import { View } from 'react-native';
import { Text } from '@/components/ui/text';
import { formatDuration } from '@/lib/geo';
import type { Lap } from '@/lib/laps';

const MIN_BAR_PCT = 30; // 가장 느린 바퀴도 랩타임 텍스트가 들어갈 최소 폭

/** 나이키 스타일 바퀴 리스트: 바퀴 번호 | 랩타임(상대 막대) | 거리 */
export function LapsList({ laps }: { laps: Lap[] }) {
  if (laps.length === 0) return null;
  // 막대 길이는 페이스(초/m) 기준 — 바퀴마다 측정 거리가 조금씩 달라도 공정하게 비교된다
  const paces = laps.map((l) => (l.distanceM > 0 ? l.durationSec / l.distanceM : null));
  const valid = paces.filter((p): p is number => p !== null);
  const fastest = valid.length > 0 ? Math.min(...valid) : null;

  return (
    <View className="gap-2 px-4 pt-6">
      <Text className="text-lg font-semibold">바퀴</Text>
      <View className="flex-row">
        <Text className="w-12 text-xs text-muted-foreground">바퀴</Text>
        <Text className="flex-1 text-xs text-muted-foreground">랩타임</Text>
        <Text className="w-16 text-right text-xs text-muted-foreground">거리</Text>
      </View>
      {laps.map((lap, i) => {
        const pace = paces[i];
        // 빠를수록 긴 막대 (가장 빠른 바퀴 = 100%)
        const widthPct =
          pace !== null && fastest !== null
            ? Math.max((fastest / pace) * 100, MIN_BAR_PCT)
            : MIN_BAR_PCT;
        return (
          <View key={lap.index} className="flex-row items-center">
            <Text className="w-12 font-semibold">{lap.index}</Text>
            <View className="flex-1">
              <View
                className="rounded-md bg-muted px-3 py-2"
                style={{ width: `${widthPct}%` }}
              >
                <Text className="text-sm">{formatDuration(lap.durationSec * 1000)}</Text>
              </View>
            </View>
            <Text className="w-16 text-right text-sm text-muted-foreground">
              {`${Math.round(lap.distanceM)} m`}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
```

- [ ] **Step 2: 상세 화면 연결**

`app/run/[id].tsx` 수정:

1. import 추가:
```ts
import { LapsList } from '@/components/LapsList';
import { computeLaps } from '@/lib/laps';
```
2. `splits` 계산 아래에:
```ts
  // 바퀴는 저장된 경로에서 재계산 — 라이브 감지와 같은 코드라 결과가 일치하고,
  // 스키마 변경 없이 기존 기록에도 소급 적용된다
  const lapResult = run.routePoints ? computeLaps(run.routePoints) : null;
  const laps = lapResult !== null && lapResult.laps.length >= 1 ? lapResult.laps : null;
```
3. 지도에 게이트 표시:
```tsx
        <RouteMap points={points} gate={lapResult?.gate ?? null} />
```
4. 헤더 지표 라인(`<Text className="text-muted-foreground">` 블록)의 고도 표기 뒤에 추가:
```tsx
          {laps !== null && ` · ${laps.length}바퀴`}
```
5. `SplitsList` 렌더링 아래에:
```tsx
      {laps !== null && <LapsList laps={laps} />}
```

- [ ] **Step 3: 검증**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: PASS

- [ ] **Step 4: 커밋**

```bash
git add src/components/LapsList.tsx "app/run/[id].tsx"
git commit -m "feat(laps): 기록 상세에 총 바퀴 수·바퀴별 랩타임 리스트"
```

---

## 완료 후 확인 사항 (자동화 불가 — 후속 메모)

- 실기기(iOS) 확인: 실제 트랙/공원 러닝에서 게이트 발견·카운트·음성 안내 동작. 네이티브 코드 변경은 없으므로 리빌드 불요, JS 번들만 갱신.
- 375pt 화면에서 상단 카드에 구간·랩·목표 3줄이 겹칠 때 지도 가림 정도 확인 (기존 run-metrics-top-panel 후속 항목과 함께).
