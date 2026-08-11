import {
  formatDistance,
  formatDistanceKm,
  formatDuration,
  formatPace,
  haversineM,
  paceSecPerKm,
  regionForRoute,
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

describe('regionForRoute', () => {
  it('빈 배열이면 null', () => {
    expect(regionForRoute([])).toBeNull();
  });

  it('점 1개면 그 점을 중심으로 최소 델타 사용', () => {
    const region = regionForRoute([{ latitude: 37.33, longitude: -122.03 }]);
    expect(region).toEqual({
      latitude: 37.33,
      longitude: -122.03,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    });
  });

  it('여러 점이면 경계 상자 중심을 가리킨다', () => {
    const region = regionForRoute([
      { latitude: 37.33, longitude: -122.03 },
      { latitude: 37.35, longitude: -122.01 },
    ]);
    expect(region?.latitude).toBeCloseTo(37.34);
    expect(region?.longitude).toBeCloseTo(-122.02);
  });

  it('델타는 경로 폭에 여유를 더한 값 (padding 1.4배)', () => {
    const region = regionForRoute([
      { latitude: 37.3, longitude: -122.1 },
      { latitude: 37.4, longitude: -122.0 },
    ]);
    expect(region?.latitudeDelta).toBeCloseTo(0.1 * 1.4);
    expect(region?.longitudeDelta).toBeCloseTo(0.1 * 1.4);
  });

  it('경로 폭이 아주 좁아도 최소 델타 0.01을 보장', () => {
    const region = regionForRoute([
      { latitude: 37.33, longitude: -122.03 },
      { latitude: 37.3301, longitude: -122.0301 },
    ]);
    expect(region?.latitudeDelta).toBe(0.01);
    expect(region?.longitudeDelta).toBe(0.01);
  });
});

describe('formatDistance', () => {
  it('km 단위는 소수 2자리 km', () => {
    expect(formatDistance(5000, 'km')).toBe('5.00');
  });

  it('mi 단위는 마일로 변환한 소수 2자리', () => {
    expect(formatDistance(5000, 'mi')).toBe('3.11');
  });

  it('km 단위는 반올림된 소수 2자리', () => {
    expect(formatDistance(5234, 'km')).toBe('5.23');
  });
});
