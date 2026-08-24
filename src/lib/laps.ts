import type { RoutePoint } from '../types/run';
import { bearingDeg, haversineM, headingDiffDeg } from './geo';

// 튜닝 상수 — 근거는 docs/superpowers/specs/2026-08-24-lap-counting-design.md
export const GATE_RADIUS_M = 25; // GPS 오차 ~10m + 트랙 8레인 폭 ~10m
export const MIN_LAP_M = 150; // 200m 실내 트랙까지 지원, 지터 루프 배제
export const HEADING_TOLERANCE_DEG = 90; // 왕복 재통과(~180°)를 확실히 배제
export const CANDIDATE_SPACING_M = 15; // 게이트 반경 25m 대비 충분히 촘촘

// 방위각 계산 기준선 — 원시 GPS 쌍(5m)은 지터에 흔들려 후보점(≥15m)을 앵커로 쓴다
const HEADING_BASE_M = 8;
// 방위각 앵커 탐색 범위: 후보점 간격(~15m) 기준 최근 4개면 최대 ~60m 되돌아본다 —
// MOVE_WINDOW_M과 같은 스케일이라 앵커를 못 찾는 경우가 거의 없다
const HEADING_LOOKBACK_CANDIDATES = 4;
// 전진 판정: 최근 60m 경로에서 직선 변위 30m 미만이면 정지 지터로 보고 판정을 쉰다
const MOVE_WINDOW_M = 60;
const MOVE_MIN_M = 30;
// 세그먼트-원 교차 계산용 위도 1도당 미터 근사. 게이트 반경(25m) 스케일에서는
// 구면 보정 없이도 오차가 무시할 만하다 — 최종 거리 검증은 항상 haversineM으로 한다
const M_PER_LAT_DEG = 111_320;

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
  for (
    let i = candidates.length - 1;
    i >= 0 && i >= candidates.length - HEADING_LOOKBACK_CANDIDATES;
    i--
  ) {
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

/** gate를 원점으로 하는 로컬 평면(x=동, y=북) 미터 오프셋. 근접 반경 스케일 근사 */
function localOffsetM(
  origin: { latitude: number; longitude: number },
  p: { latitude: number; longitude: number }
): { x: number; y: number } {
  const mPerLon = M_PER_LAT_DEG * Math.cos((origin.latitude * Math.PI) / 180);
  return {
    x: (p.longitude - origin.longitude) * mPerLon,
    y: (p.latitude - origin.latitude) * M_PER_LAT_DEG,
  };
}

/**
 * 세그먼트 prev→next가 gate 반경(GATE_RADIUS_M)에 처음 들어오는 진행률 f∈[0,1].
 * prev가 이미 반경 안이면 f=0. 세그먼트가 반경에 전혀 닿지 않으면 hits=false —
 * 원시 포인트 p 하나만 보는 것과 달리, 두 포인트 사이에 GPS 끊김이 있어도 그
 * 사이 직선이 게이트를 스치기만 하면 감지된다.
 *
 * gate 중심 로컬 평면에 투영해 직선-원 교차의 이차방정식을 푼다: A=prev, D=next-prev,
 * |A + tD|² = R² → t²|D|² + 2t(A·D) + (|A|²-R²) = 0. A가 반경 밖일 때 두 실근은
 * 항상 같은 부호(진입점이 t=0 앞쪽에 있으면 두 근 모두 음수)이므로 작은 근이
 * [0,1] 밖이면 이 세그먼트 안에서는 교차가 없다고 본다.
 */
function gateSegmentCrossing(
  gate: { latitude: number; longitude: number },
  prev: { latitude: number; longitude: number },
  next: { latitude: number; longitude: number }
): { hits: boolean; f: number } {
  const R = GATE_RADIUS_M;
  const A = localOffsetM(gate, prev);
  const aMagSq = A.x * A.x + A.y * A.y;
  if (aMagSq <= R * R) return { hits: true, f: 0 };

  const B = localOffsetM(gate, next);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const distSq = dx * dx + dy * dy;
  if (distSq === 0) return { hits: false, f: 0 }; // prev===next, 이미 밖이라 확인됨

  const aDotD = A.x * dx + A.y * dy;
  const disc = aDotD * aDotD - distSq * (aMagSq - R * R);
  if (disc < 0) return { hits: false, f: 0 }; // 세그먼트를 무한히 늘려도 반경에 닿지 않음

  const t = (-aDotD - Math.sqrt(disc)) / distSq;
  if (t < 0 || t > 1) return { hits: false, f: 0 }; // 교차는 이 세그먼트 구간 밖에서 일어남
  return { hits: true, f: t };
}

/**
 * 게이트 반경 진입 시각·거리의 보간 (computeSplits의 경계 보간과 같은 취지).
 * gateSegmentCrossing으로 구한 진행률 f를 시간·거리 델타에 적용한다.
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
  const { hits, f } = gateSegmentCrossing(gate, prev, next);
  // hits=false는 호출부가 이미 통과를 확정한 뒤에만 나올 수 있는 부동소수점 경계
  // 케이스 — 이 경우 통과 시점을 새 포인트(next)로 귀속한다
  const frac = hits ? f : 1;
  return { runMs: prevRunMs + dtMs * frac, cumDistM: prevCumM + ddM * frac };
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
    const dGate = haversineM(next.gate, p); // exit 판정은 점 기준 유지
    if (next.insideGate) {
      if (dGate > GATE_RADIUS_M) next = { ...next, insideGate: false };
    } else {
      // 재진입 판정은 prevLast→p 세그먼트가 게이트 반경에 닿는지로 본다. 점 p만
      // 보면 GPS 끊김(정류장·다리 밑 등 6~10초 통신 단절)으로 반경 안에 원시
      // 포인트가 하나도 찍히지 않을 때 통과 자체를 놓친다.
      const crossing = gateSegmentCrossing(next.gate, prevLast, p);
      if (crossing.hits && heading !== null && moving) {
        const isLap =
          cumDistM - next.lastCrossCumDistM >= MIN_LAP_M &&
          headingDiffDeg(heading, next.gate.headingDeg) <= HEADING_TOLERANCE_DEG;
        // 진입 직후 insideGate는 새 포인트 p 기준(점 판정)으로 정한다 — exit 판정과
        // 짝을 맞춰야 한다. 끊김이 커서 p가 이미 반경 밖으로 나가 있으면(스쳐
        // 지나간 fly-through) 바로 다음 exit→재진입 주기를 기다리게 된다.
        const insideGate = dGate <= GATE_RADIUS_M;
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
            insideGate,
            lastCrossRunMs: cross.runMs,
            lastCrossCumDistM: cross.cumDistM,
          };
        } else {
          // 조건 미달 진입(역방향·최소 거리 미달) — 반경 상태만 갱신, exit 후 재진입 요구 유지
          next = { ...next, insideGate };
        }
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

/** 진행 중인 바퀴. 게이트 확정 전이거나 방금 통과한 직후면 null */
export function currentLap(state: LapState): Lap | null {
  if (state.gate === null) return null;
  const distanceM = state.cumDistM - state.lastCrossCumDistM;
  // splitPaceSec와 같은 바닥 — 통과 직후 보간 잔여값(예: 0.19m/0.12s)이 그대로
  // 노출되어 다운스트림(UI·음성)이 별도 방어를 해야 하는 상황을 막는다
  if (distanceM < 10) return null;
  return {
    index: state.laps.length + 1,
    durationSec: (state.runMs - state.lastCrossRunMs) / 1000,
    distanceM,
  };
}
