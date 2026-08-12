import type { RoutePoint } from '../../types/run';
import {
  computeSplits,
  elevationGainM,
  elevationProfile,
  partitionPoints,
  smoothAltitudes,
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
