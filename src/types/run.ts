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
  weatherCode: number | null; // 러닝 시작 시점 날씨 (시작 시 조회 실패 시 종료 시점 값). WMO weather code. null = 조회 실패·구버전 기록
  temperatureC: number | null; // °C. weatherCode와 항상 함께 기록되거나 함께 null
  locationLabel: string | null; // 시작 지점 행정구역 라벨 (예: "서울 강남구 서초동"). null = 미조회·조회 실패·구버전 기록
}
