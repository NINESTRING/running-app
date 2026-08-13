export interface RoutePoint {
  latitude: number;
  longitude: number;
  altitude: number | null; // 미터, WGS84 타원체 기준. null = 기기 미제공(웹 등)
  timestamp: number; // epoch ms
}

export interface RunRecord {
  id: string;
  startedAt: string; // ISO 8601
  durationSec: number;
  distanceM: number;
  steps: number | null; // null = 측정 안 됨
  routeGeojson: { type: 'LineString'; coordinates: [number, number][] } | null;
  routePoints: RoutePoint[][] | null; // 세그먼트별 원본 시계열. null = 구버전 기록·파싱 실패
  weatherCode: number | null; // WMO weather code. null = 조회 실패·구버전 기록
  temperatureC: number | null; // °C. weatherCode와 항상 함께 기록되거나 함께 null
}
