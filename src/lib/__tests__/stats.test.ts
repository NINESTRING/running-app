import { weeklyDistances } from '../stats';

// 2026-08-03은 월요일
const NOW = new Date('2026-08-03T12:00:00+09:00');

describe('weeklyDistances', () => {
  it('7일 배열을 월요일부터 반환', () => {
    const result = weeklyDistances([], NOW);
    expect(result).toHaveLength(7);
    expect(result.map((r) => r.day)).toEqual([
      '월', '화', '수', '목', '금', '토', '일',
    ]);
    expect(result.every((r) => r.km === 0)).toBe(true);
  });

  it('이번 주 러닝을 요일별로 합산', () => {
    const runs = [
      { startedAt: '2026-08-03T07:00:00+09:00', distanceM: 3000 },
      { startedAt: '2026-08-03T20:00:00+09:00', distanceM: 2000 },
    ];
    const result = weeklyDistances(runs, NOW);
    expect(result[0].km).toBeCloseTo(5);
    expect(result[1].km).toBe(0);
  });

  it('지난주 러닝은 제외', () => {
    const runs = [{ startedAt: '2026-07-27T07:00:00+09:00', distanceM: 3000 }];
    const result = weeklyDistances(runs, NOW);
    expect(result.every((r) => r.km === 0)).toBe(true);
  });
});
