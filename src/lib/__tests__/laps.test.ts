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

  it('게이트 통과 구간의 GPS 끊김에도 바퀴를 놓치지 않는다 (세그먼트 기준 판정)', () => {
    const pts = circlePoints({ laps: 4 });
    const stepsPerLap = Math.round((2 * Math.PI * TRACK_RADIUS_M) / STEP_M);
    const boundary = 2 * stepsPerLap; // 2→3바퀴 전환(재진입) 지점 — 게이트 최초 발견은 건너뜀
    // half=5(10 스텝, 편측 25m)면 생존한 최근접 포인트가 게이트에서 현 스트레이트
    // 코드 기준 ~30m(직선거리 ~29.7m)로 25m 반경 밖에 남는다 — 점 기준 판정이면
    // 통과를 놓쳐 [374, 797, 399] 3바퀴로 병합됨을 사전에 구버전으로 확인했다.
    const dropHalfWidth = 5;
    const dropped = pts.filter(
      (_, i) => i < boundary - dropHalfWidth || i > boundary + dropHalfWidth
    );
    const state = feed(dropped);
    expect(state.laps).toHaveLength(4);
    for (const lap of state.laps) {
      expect(lap.distanceM).toBeGreaterThan(340);
      expect(lap.distanceM).toBeLessThan(460);
    }
  });

  it('200m 실내 트랙 3바퀴를 정확히 센다', () => {
    const state = feed(circlePoints({ laps: 3, radiusM: 31.83 }));
    expect(state.laps).toHaveLength(3);
  });
});

describe('advanceLaps — 순수성', () => {
  it('같은 입력으로 두 번 호출해도 결과가 같고, 원래 상태는 바뀌지 않는다', () => {
    const s = feed(circlePoints({ laps: 1.5 }));
    const sSnapshot = JSON.parse(JSON.stringify(s));
    const p = at(TRACK_RADIUS_M + 3, 5, s.last!.timestamp + STEP_MS);

    const r1 = advanceLaps(s, p, false);
    const r2 = advanceLaps(s, p, false);

    expect(r1).toEqual(r2);
    expect(s).toEqual(sSnapshot);
  });

  it('INITIAL_LAP_STATE는 3바퀴 피드 후에도 변하지 않는다', () => {
    const snapshot = JSON.parse(JSON.stringify(INITIAL_LAP_STATE));
    feed(circlePoints({ laps: 3 }));
    expect(INITIAL_LAP_STATE).toEqual(snapshot);
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
