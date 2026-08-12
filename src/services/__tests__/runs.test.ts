import { pointsToEwkt, rowToRunRecord } from '../runs';

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
});
