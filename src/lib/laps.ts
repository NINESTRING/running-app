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
