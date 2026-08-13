import { METERS_PER_MILE } from '../geo';
import {
  clampDistanceUnits,
  clampPaceSec,
  DISTANCE_MAX_UNITS,
  DISTANCE_MIN_UNITS,
  goalDeltaM,
  goalDeltaStatus,
  goalSummary,
  PACE_MAX_SEC,
  PACE_MIN_SEC,
} from '../goal';

describe('goalDeltaM', () => {
  test('목표보다 느리면 음수(뒤쳐짐)', () => {
    // 6'00"/km 목표, 60초 경과 → 기대 166.67m, 실제 100m → 약 -66.7m
    const d = goalDeltaM({ distanceM: 100, elapsedMs: 60_000, paceSecPerUnit: 360, unit: 'km' });
    expect(d).toBeCloseTo(100 - (60 / 360) * 1000, 1);
  });

  test('목표보다 빠르면 양수(앞섬)', () => {
    const d = goalDeltaM({ distanceM: 250, elapsedMs: 60_000, paceSecPerUnit: 360, unit: 'km' });
    expect(d).toBeCloseTo(250 - (60 / 360) * 1000, 1);
  });

  test('경과 30초 미만이면 null(초반 가드)', () => {
    expect(
      goalDeltaM({ distanceM: 100, elapsedMs: 29_999, paceSecPerUnit: 360, unit: 'km' }),
    ).toBeNull();
  });

  test('정확히 30초부터 계산한다', () => {
    expect(
      goalDeltaM({ distanceM: 100, elapsedMs: 30_000, paceSecPerUnit: 360, unit: 'km' }),
    ).not.toBeNull();
  });

  test('mi 단위는 METERS_PER_MILE 기준으로 계산한다', () => {
    // 8'00"/mi 목표, 120초 경과 → 기대 0.25mi. 실제도 0.25mi면 편차 0
    const d = goalDeltaM({
      distanceM: (120 / 480) * METERS_PER_MILE,
      elapsedMs: 120_000,
      paceSecPerUnit: 480,
      unit: 'mi',
    });
    expect(d).toBeCloseTo(0, 6);
  });
});

describe('goalDeltaStatus', () => {
  test('±10m 이내는 onPace(경계 포함)', () => {
    expect(goalDeltaStatus(0)).toBe('onPace');
    expect(goalDeltaStatus(10)).toBe('onPace');
    expect(goalDeltaStatus(-10)).toBe('onPace');
  });

  test('+10m 초과는 ahead, -10m 미만은 behind', () => {
    expect(goalDeltaStatus(10.1)).toBe('ahead');
    expect(goalDeltaStatus(-10.1)).toBe('behind');
  });
});

describe('클램프', () => {
  test('페이스는 최소·최대로 클램프된다', () => {
    expect(clampPaceSec(0)).toBe(PACE_MIN_SEC);
    expect(clampPaceSec(9999)).toBe(PACE_MAX_SEC);
    expect(clampPaceSec(360)).toBe(360);
  });

  test('거리는 최소·최대로 클램프된다', () => {
    expect(clampDistanceUnits(0)).toBe(DISTANCE_MIN_UNITS);
    expect(clampDistanceUnits(999)).toBe(DISTANCE_MAX_UNITS);
    expect(clampDistanceUnits(5)).toBe(5);
  });
});

describe('goalSummary', () => {
  test('둘 다 없으면 "목표 없음"', () => {
    expect(goalSummary(null, null, 'km')).toBe('목표 없음');
  });

  test('둘 다 있으면 페이스 · 거리', () => {
    expect(goalSummary(330, 5, 'km')).toBe(`5'30"/km · 5.00km`);
  });

  test('페이스만 있으면 페이스만', () => {
    expect(goalSummary(330, null, 'km')).toBe(`5'30"/km`);
  });

  test('거리만 있으면 거리만(단위 반영)', () => {
    expect(goalSummary(null, 5, 'mi')).toBe('5.00mi');
  });
});
