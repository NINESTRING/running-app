import {
  formatDistanceKm,
  formatDuration,
  formatPace,
  haversineM,
  paceSecPerKm,
} from '../geo';

describe('haversineM', () => {
  it('위도 1도 차이는 약 111,195m', () => {
    const d = haversineM(
      { latitude: 0, longitude: 0 },
      { latitude: 1, longitude: 0 }
    );
    expect(d).toBeGreaterThan(111000);
    expect(d).toBeLessThan(111400);
  });

  it('같은 지점은 0', () => {
    const p = { latitude: 37.5663, longitude: 126.9779 };
    expect(haversineM(p, p)).toBe(0);
  });
});

describe('paceSecPerKm', () => {
  it('1km를 5분에 달리면 300초/km', () => {
    expect(paceSecPerKm(1000, 300_000)).toBeCloseTo(300);
  });

  it('거리가 10m 미만이면 null', () => {
    expect(paceSecPerKm(5, 60_000)).toBeNull();
  });
});

describe('formatPace', () => {
  it("300초/km는 5'00\"", () => {
    expect(formatPace(300)).toBe(`5'00"`);
  });

  it("null은 --'--\"", () => {
    expect(formatPace(null)).toBe(`--'--"`);
  });

  it('반올림으로 60초가 되면 분으로 올림', () => {
    expect(formatPace(359.7)).toBe(`6'00"`);
  });
});

describe('formatDuration', () => {
  it('1시간 미만은 mm:ss', () => {
    expect(formatDuration(330_000)).toBe('05:30');
  });

  it('1시간 이상은 h:mm:ss', () => {
    expect(formatDuration(3_723_000)).toBe('1:02:03');
  });
});

describe('formatDistanceKm', () => {
  it('미터를 km 소수 2자리로', () => {
    expect(formatDistanceKm(5234)).toBe('5.23');
  });
});
