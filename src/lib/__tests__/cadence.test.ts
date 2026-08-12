import { avgCadenceSpm, cadenceSpm, formatCadence } from '../cadence';

describe('cadenceSpm', () => {
  it('최근 30초 윈도우의 걸음 증가량으로 SPM 계산', () => {
    // 10초 스팬 동안 30걸음 → 180 SPM
    const samples = [
      { timestamp: 10_000, steps: 100 },
      { timestamp: 15_000, steps: 115 },
      { timestamp: 20_000, steps: 130 },
    ];
    expect(cadenceSpm(samples, 20_000)).toBeCloseTo(180);
  });

  it('30초보다 오래된 샘플은 제외', () => {
    // 오래된 샘플(t=0)은 무시되고 t=40k~50k 구간(10초, 20걸음 → 120 SPM)만 사용
    const samples = [
      { timestamp: 0, steps: 0 },
      { timestamp: 40_000, steps: 100 },
      { timestamp: 50_000, steps: 120 },
    ];
    expect(cadenceSpm(samples, 50_000)).toBeCloseTo(120);
  });

  it('샘플 2개 미만이면 null', () => {
    expect(cadenceSpm([], 10_000)).toBeNull();
    expect(cadenceSpm([{ timestamp: 10_000, steps: 5 }], 10_000)).toBeNull();
  });

  it('샘플 스팬이 5초 미만이면 null', () => {
    const samples = [
      { timestamp: 10_000, steps: 10 },
      { timestamp: 13_000, steps: 20 },
    ];
    expect(cadenceSpm(samples, 13_000)).toBeNull();
  });
});

describe('avgCadenceSpm', () => {
  it('총 걸음과 시간으로 평균 SPM 계산', () => {
    // 1800걸음 / 10분 → 180 SPM
    expect(avgCadenceSpm(1800, 600)).toBeCloseTo(180);
  });

  it('steps가 null이면 null', () => {
    expect(avgCadenceSpm(null, 600)).toBeNull();
  });

  it('duration이 0 이하면 null', () => {
    expect(avgCadenceSpm(100, 0)).toBeNull();
  });
});

describe('formatCadence', () => {
  it('null은 -- 로 표시', () => {
    expect(formatCadence(null)).toBe('--');
  });

  it('반올림 정수 문자열', () => {
    expect(formatCadence(179.6)).toBe('180');
  });
});
