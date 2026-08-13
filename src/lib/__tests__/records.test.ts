import type { RoutePoint, RunRecord } from '../../types/run';
import { bestSegmentTimeSec, personalRecords } from '../records';

// 적도를 따라 경도로만 이동하면 haversine 거리가 정확히 비례한다
const M_PER_DEG = (6371000 * Math.PI) / 180;
function pt(m: number, sec: number): RoutePoint {
  return { latitude: 0, longitude: m / M_PER_DEG, altitude: null, timestamp: sec * 1000 };
}

function run(partial: Partial<RunRecord> & Pick<RunRecord, 'id' | 'startedAt'>): RunRecord {
  return {
    durationSec: 0,
    distanceM: 0,
    steps: null,
    routeGeojson: null,
    routePoints: null,
    ...partial,
  };
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

describe('personalRecords', () => {
  it('빈 배열이면 전부 null', () => {
    const r = personalRecords([]);
    expect(r).toEqual({
      longestDistance: null,
      longestDuration: null,
      best1k: null,
      best1mi: null,
      best5k: null,
      best10k: null,
      bestHalf: null,
      bestFull: null,
    });
  });

  it('최장 거리·시간을 선택하고 동률이면 오래된 기록 유지', () => {
    const runs = [
      run({ id: 'b', startedAt: '2026-02-01T07:00:00+09:00', distanceM: 5000, durationSec: 1500 }),
      run({ id: 'a', startedAt: '2026-01-01T07:00:00+09:00', distanceM: 5000, durationSec: 1200 }),
      run({ id: 'c', startedAt: '2026-03-01T07:00:00+09:00', distanceM: 3000, durationSec: 1500 }),
    ];
    const r = personalRecords(runs);
    expect(r.longestDistance).toMatchObject({ runId: 'a', value: 5000 }); // 동률 → 오래된 a
    expect(r.longestDuration).toMatchObject({ runId: 'b', value: 1500 }); // 동률 → b(2월) < c(3월)
  });

  it('routePoints 없는 기록은 평균 페이스 환산으로 폴백', () => {
    const runs = [
      run({ id: 'a', startedAt: '2026-01-01T07:00:00+09:00', distanceM: 5000, durationSec: 1500 }),
    ];
    const r = personalRecords(runs);
    expect(r.best1k?.value).toBeCloseTo(300, 3); // 1500 × 1000/5000
    expect(r.best5k?.value).toBeCloseTo(1500, 3);
    expect(r.best10k).toBeNull(); // 거리 미달
    expect(r.bestHalf).toBeNull();
    expect(r.bestFull).toBeNull();
  });

  it('routePoints가 있으면 롤링 윈도우가 폴백보다 우선', () => {
    // 전체 2000m/600초(평균 300초/km)지만 후반 1000m는 240초
    const seg = [pt(0, 0), pt(1000, 360), pt(2000, 600)];
    const runs = [
      run({
        id: 'a',
        startedAt: '2026-01-01T07:00:00+09:00',
        distanceM: 2000,
        durationSec: 600,
        routePoints: [seg],
      }),
    ];
    expect(personalRecords(runs).best1k?.value).toBeCloseTo(240, 3);
  });

  it('여러 러닝 중 최단 시간을 선택하고 동률이면 오래된 기록 유지', () => {
    const runs = [
      run({ id: 'new', startedAt: '2026-02-01T07:00:00+09:00', distanceM: 1000, durationSec: 300 }),
      run({ id: 'old', startedAt: '2026-01-01T07:00:00+09:00', distanceM: 1000, durationSec: 300 }),
      run({ id: 'slow', startedAt: '2026-03-01T07:00:00+09:00', distanceM: 1000, durationSec: 400 }),
    ];
    expect(personalRecords(runs).best1k).toMatchObject({ runId: 'old', value: 300 });
  });
});
