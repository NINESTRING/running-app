import { weeklyDistances, periodBuckets } from '../stats';

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

// 2026-08-03은 월요일, 2026-08-01은 토요일. "오늘"은 2026-08-05(수)로 고정
const WED = new Date('2026-08-05T12:00:00+09:00');

describe('periodBuckets', () => {
  it('week: 월~일 7개 버킷, 요일별 합산, 지난주 제외', () => {
    const runs = [
      { startedAt: '2026-08-03T07:00:00+09:00', distanceM: 3000 }, // 월
      { startedAt: '2026-08-03T20:00:00+09:00', distanceM: 2000 }, // 월
      { startedAt: '2026-08-09T07:00:00+09:00', distanceM: 1000 }, // 일
      { startedAt: '2026-07-27T07:00:00+09:00', distanceM: 9000 }, // 지난주 월
    ];
    const result = periodBuckets(runs, 'week', WED);
    expect(result.map((b) => b.label)).toEqual(['월', '화', '수', '목', '금', '토', '일']);
    expect(result[0].distanceM).toBe(5000);
    expect(result[6].distanceM).toBe(1000);
    expect(result[1].distanceM).toBe(0);
    expect(result[0].start).toEqual(new Date('2026-08-03T00:00:00+09:00'));
  });

  it('month: 1일부터 월요일 경계로 분할, 시작일 라벨, 버킷 합 = 월 총거리', () => {
    const runs = [
      { startedAt: '2026-08-01T07:00:00+09:00', distanceM: 1000 }, // 첫 부분 주(1~2일)
      { startedAt: '2026-08-09T07:00:00+09:00', distanceM: 2000 }, // 3일 시작 주
      { startedAt: '2026-08-31T07:00:00+09:00', distanceM: 4000 }, // 31일 시작 주
      { startedAt: '2026-07-31T07:00:00+09:00', distanceM: 9000 }, // 7월 — 제외
    ];
    const result = periodBuckets(runs, 'month', WED);
    // 2026년 8월: 1(토), 3(월), 10, 17, 24, 31 시작 — 6개 버킷
    expect(result.map((b) => b.label)).toEqual(['1일', '3일', '10일', '17일', '24일', '31일']);
    expect(result[0].distanceM).toBe(1000);
    expect(result[1].distanceM).toBe(2000);
    expect(result[5].distanceM).toBe(4000);
    expect(result.reduce((s, b) => s + b.distanceM, 0)).toBe(7000);
  });

  it('year: 12개 월 버킷, 다른 해 제외', () => {
    const runs = [
      { startedAt: '2026-03-15T07:00:00+09:00', distanceM: 5000 },
      { startedAt: '2026-08-01T07:00:00+09:00', distanceM: 3000 },
      { startedAt: '2025-12-31T07:00:00+09:00', distanceM: 9000 }, // 제외
    ];
    const result = periodBuckets(runs, 'year', WED);
    expect(result).toHaveLength(12);
    expect(result.map((b) => b.label)).toEqual([
      '1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월',
    ]);
    expect(result[2].distanceM).toBe(5000);
    expect(result[7].distanceM).toBe(3000);
    expect(result[11].distanceM).toBe(0);
  });

  it('all: 첫 기록 연도부터 현재 연도까지 연도별 버킷', () => {
    const runs = [
      { startedAt: '2024-05-01T07:00:00+09:00', distanceM: 1000 },
      { startedAt: '2026-08-01T07:00:00+09:00', distanceM: 2000 },
    ];
    const result = periodBuckets(runs, 'all', WED);
    expect(result.map((b) => b.label)).toEqual(['2024', '2025', '2026']);
    expect(result[0].distanceM).toBe(1000);
    expect(result[1].distanceM).toBe(0);
    expect(result[2].distanceM).toBe(2000);
  });

  it('all: 기록이 없으면 현재 연도 1개', () => {
    const result = periodBuckets([], 'all', WED);
    expect(result.map((b) => b.label)).toEqual(['2026']);
    expect(result[0].distanceM).toBe(0);
  });
});
