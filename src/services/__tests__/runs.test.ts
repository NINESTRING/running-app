import { parseRoutePoints, pointsToEwkt, rowToRunRecord, segmentsToJson } from '../runs';

describe('segmentsToJson', () => {
  const p = (t: number, alt: number | null = null) => ({
    latitude: 37.5,
    longitude: 127.0,
    altitude: alt,
    timestamp: t,
  });

  it('세그먼트별 [t, lat, lng, alt] 튜플 배열로 직렬화한다', () => {
    const segments = [
      { start: 0, end: 10_000 },
      { start: 20_000, end: 30_000 },
    ];
    const json = segmentsToJson([p(1000, 12.5), p(9000, null), p(21_000, 13)], segments);
    expect(json).toEqual([
      [
        [1000, 37.5, 127.0, 12.5],
        [9000, 37.5, 127.0, null],
      ],
      [[21_000, 37.5, 127.0, 13]],
    ]);
  });

  it('포인트가 2개 미만이면 null', () => {
    expect(segmentsToJson([], [])).toBeNull();
    expect(segmentsToJson([p(1000)], [{ start: 0, end: 10_000 }])).toBeNull();
  });
});

describe('parseRoutePoints', () => {
  it('직렬화 결과를 RoutePoint 그룹으로 되돌린다 (왕복)', () => {
    const points = [
      { latitude: 37.5, longitude: 127.0, altitude: 12.5, timestamp: 1000 },
      { latitude: 37.6, longitude: 127.1, altitude: null, timestamp: 9000 },
    ];
    const json = segmentsToJson(points, [{ start: 0, end: 10_000 }]);
    expect(parseRoutePoints(json)).toEqual([points]);
  });

  it('형식이 어긋나면 null', () => {
    expect(parseRoutePoints(null)).toBeNull();
    expect(parseRoutePoints('x')).toBeNull();
    expect(parseRoutePoints([[[1, 2]]])).toBeNull(); // 튜플 길이 4 아님
    expect(parseRoutePoints([[['a', 1, 2, 3]]])).toBeNull(); // t가 숫자 아님
    expect(parseRoutePoints([])).toBeNull(); // 빈 그룹 배열
  });
});

describe('pointsToEwkt', () => {
  it('경도 위도 순서의 EWKT LINESTRING 생성', () => {
    const points = [
      { latitude: 37.5, longitude: 127.0, altitude: null, timestamp: 0 },
      { latitude: 37.6, longitude: 127.1, altitude: null, timestamp: 1000 },
    ];
    expect(pointsToEwkt(points)).toBe(
      'SRID=4326;LINESTRING(127 37.5,127.1 37.6)'
    );
  });

  it('좌표가 2개 미만이면 null', () => {
    expect(pointsToEwkt([])).toBeNull();
    expect(
      pointsToEwkt([{ latitude: 1, longitude: 2, altitude: null, timestamp: 0 }])
    ).toBeNull();
  });
});

describe('rowToRunRecord', () => {
  const baseRow = {
    id: 'abc',
    user_id: 'user-1',
    started_at: '2026-08-03T01:00:00Z',
    duration_sec: 600,
    distance_m: 2000,
    route_geojson: null,
    steps: null as number | null,
    route_points: null,
    weather_code: null as number | null,
    temperature_c: null as number | null,
    location_label: null as string | null,
    created_at: '2026-08-03T01:10:00Z',
  };

  it('DB 행을 RunRecord로 변환 (route_geojson 문자열 파싱)', () => {
    const rec = rowToRunRecord({
      ...baseRow,
      route_geojson:
        '{"type":"LineString","coordinates":[[127,37.5],[127.1,37.6]]}',
    });
    expect(rec?.id).toBe('abc');
    expect(rec?.durationSec).toBe(600);
    expect(rec?.routeGeojson?.coordinates).toHaveLength(2);
  });

  it('route_geojson이 null이면 routeGeojson도 null', () => {
    const rec = rowToRunRecord(baseRow);
    expect(rec).not.toBeNull();
    expect(rec?.routeGeojson).toBeNull();
  });

  it('필수 컬럼이 null인 행은 null 반환', () => {
    expect(rowToRunRecord({ ...baseRow, id: null })).toBeNull();
    expect(rowToRunRecord({ ...baseRow, started_at: null })).toBeNull();
  });

  it('steps 컬럼을 매핑', () => {
    const rec = rowToRunRecord({ ...baseRow, steps: 1800 });
    expect(rec?.steps).toBe(1800);
  });

  it('steps가 null이어도 레코드는 유지 (측정 안 된 기록)', () => {
    const rec = rowToRunRecord(baseRow);
    expect(rec).not.toBeNull();
    expect(rec?.steps).toBeNull();
  });

  it('route_points를 routePoints로 파싱한다', () => {
    const rec = rowToRunRecord({
      ...baseRow,
      route_points: [[[1000, 37.5, 127.0, 12.5]]],
    });
    expect(rec?.routePoints).toEqual([
      [{ latitude: 37.5, longitude: 127.0, altitude: 12.5, timestamp: 1000 }],
    ]);
  });

  it('route_points가 null이거나 형식이 어긋나면 routePoints는 null (레코드는 유지)', () => {
    expect(rowToRunRecord(baseRow)?.routePoints).toBeNull();
    const rec = rowToRunRecord({ ...baseRow, route_points: 'broken' });
    expect(rec).not.toBeNull();
    expect(rec?.routePoints).toBeNull();
  });

  it('weather_code·temperature_c를 매핑한다', () => {
    const rec = rowToRunRecord({ ...baseRow, weather_code: 3, temperature_c: 21.4 });
    expect(rec?.weatherCode).toBe(3);
    expect(rec?.temperatureC).toBe(21.4);
  });

  it('날씨가 null이어도 레코드는 유지 (구버전·조회 실패 기록)', () => {
    const rec = rowToRunRecord(baseRow);
    expect(rec).not.toBeNull();
    expect(rec?.weatherCode).toBeNull();
    expect(rec?.temperatureC).toBeNull();
  });

  it('location_label을 매핑한다', () => {
    const rec = rowToRunRecord({ ...baseRow, location_label: '서울 강남구 서초동' });
    expect(rec?.locationLabel).toBe('서울 강남구 서초동');
  });

  it('location_label이 null이어도 레코드는 유지 (구버전·미조회 기록)', () => {
    const rec = rowToRunRecord(baseRow);
    expect(rec).not.toBeNull();
    expect(rec?.locationLabel).toBeNull();
  });
});
