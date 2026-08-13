import type { RoutePoint } from '../../types/run';
import { bestSegmentTimeSec } from '../records';

// 적도를 따라 경도로만 이동하면 haversine 거리가 정확히 비례한다
const M_PER_DEG = (6371000 * Math.PI) / 180;
function pt(m: number, sec: number): RoutePoint {
  return { latitude: 0, longitude: m / M_PER_DEG, altitude: null, timestamp: sec * 1000 };
}

describe('bestSegmentTimeSec', () => {
  it('등속 주행에서 보간 포함 정확한 시간', () => {
    // 0m/0s → 600m/180s → 1200m/360s (등속 3.33m/s)
    const seg = [pt(0, 0), pt(600, 180), pt(1200, 360)];
    // 1000m 최단: 600→1200 구간에서 400m 보간 → 300초
    expect(bestSegmentTimeSec([seg], 1000)).toBeCloseTo(300, 3);
  });

  it('중간 가속 구간을 정확히 선택', () => {
    // 0~500m 느림(300초), 500~1500m 빠름(240초), 1500~2000m 느림(300초)
    const seg = [pt(0, 0), pt(500, 300), pt(1500, 540), pt(2000, 840)];
    expect(bestSegmentTimeSec([seg], 1000)).toBeCloseTo(240, 3);
  });

  it('세그먼트를 건너뛰는 구간은 불인정', () => {
    // 각 600m 세그먼트 2개 — 어느 쪽도 1000m 미달
    const seg1 = [pt(0, 0), pt(600, 180)];
    const seg2 = [pt(0, 1000), pt(600, 1180)];
    expect(bestSegmentTimeSec([seg1, seg2], 1000)).toBeNull();
  });

  it('여러 세그먼트 중 가장 빠른 것을 선택', () => {
    const slow = [pt(0, 0), pt(600, 180)]; // 500m ≈ 150초
    const fast = [pt(0, 1000), pt(600, 1120)]; // 500m ≈ 100초
    expect(bestSegmentTimeSec([slow, fast], 500)).toBeCloseTo(100, 3);
  });

  it('포인트 2개 미만 세그먼트는 무시', () => {
    expect(bestSegmentTimeSec([[pt(0, 0)], []], 100)).toBeNull();
  });

  it('타임스탬프 역행은 0으로 클램프', () => {
    // 10s → 5s(역행, 델타 0 처리) → 20s
    const seg = [pt(0, 10), pt(500, 5), pt(1000, 20)];
    expect(bestSegmentTimeSec([seg], 1000)).toBeCloseTo(15, 3);
  });
});
