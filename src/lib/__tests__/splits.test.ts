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
