import type { RoutePoint } from '../../types/run';
import {
  computeSplits,
  liveExtraSec,
  liveSplitPaceSec,
  partitionPoints,
  splitDistanceFor,
  splitPaceSec,
} from '../splits';

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
    // 등속이므로 진행 중 구간 시간 = 잔여 거리 / 속도
    expect(current!.durationSec).toBeCloseTo((19 * STEP_M - 2000) / 11.1195, 1);
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
    // 시작 고도 = smoothed[0] = (0+2+4)/3 = 2 (스무딩 경계 클램프),
    // 1000m 경계는 8~9번째 포인트 사이 f≈0.9932 → 보간 고도 = 16 + 2f ≈ 17.99
    // → 델타 ≈ 15.99
    expect(completed[0].elevationDeltaM).toBeCloseTo(15.99, 1);
  });

  it('단조 경사에서 구간 델타의 합 = 스무딩 고도의 처음↔끝 차이', () => {
    // 델타는 텔레스코프: 각 구간 시작 고도 = 직전 구간 경계 보간 고도
    const points = Array.from({ length: 20 }, (_, i) =>
      pt(i * 0.001, i * 10_000, i * 2)
    );
    const { completed, current } = computeSplits([points], 1000);
    const total =
      completed.reduce((sum, s) => sum + (s.elevationDeltaM ?? 0), 0) +
      (current?.elevationDeltaM ?? 0);
    // smoothed[19] = (34+36+38)/3 = 36, smoothed[0] = 2 → 합 34
    expect(total).toBeCloseTo(34, 5);
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

  it('시간이 0 이하이면 null (일시정지 중 이동 후 재개 직후)', () => {
    const s = { index: 2, distanceM: 50, durationSec: 0, elevationDeltaM: null };
    expect(splitPaceSec(s, 1000)).toBeNull();
  });
});

describe('liveSplitPaceSec', () => {
  const s = { index: 2, distanceM: 500, durationSec: 150, elevationDeltaM: null };

  it('마지막 포인트 이후 경과 시간을 가산해 환산한다', () => {
    // (150 + 50)초에 500m → 1000m 환산 400초
    expect(liveSplitPaceSec(s, 1000, 50)).toBeCloseTo(400);
  });

  it('음수 경과 시간은 0으로 클램프한다', () => {
    expect(liveSplitPaceSec(s, 1000, -5)).toBeCloseTo(300);
  });

  it('null 구간은 null', () => {
    expect(liveSplitPaceSec(null, 1000, 10)).toBeNull();
  });
});

describe('liveExtraSec', () => {
  it('러닝 중에는 마지막 포인트 이후 경과 시간', () => {
    expect(liveExtraSec(true, 10_000, 7000, 1000)).toBeCloseTo(3);
  });

  it('재개 직후에는 세그먼트 시작이 앵커 — 일시정지 시간을 가산하지 않는다', () => {
    // 마지막 포인트 t=5초(일시정지 전), 재개 t=60초, 현재 t=65초 → 5초만 가산
    expect(liveExtraSec(true, 65_000, 5000, 60_000)).toBeCloseTo(5);
  });

  it('러닝 중이 아니면 0 (일시정지 중 페이스 동결)', () => {
    expect(liveExtraSec(false, 65_000, 5000, null)).toBe(0);
  });

  it('앵커 정보가 없으면 0', () => {
    expect(liveExtraSec(true, 10_000, undefined, null)).toBe(0);
  });

  it('시계 역행은 0으로 클램프', () => {
    expect(liveExtraSec(true, 6000, 7000, 1000)).toBe(0);
  });
});

