export interface RoutePoint {
  latitude: number;
  longitude: number;
  timestamp: number; // epoch ms
}

export interface RunRecord {
  id: string;
  startedAt: string; // ISO 8601
  durationSec: number;
  distanceM: number;
  steps: number | null; // null = 측정 안 됨
  routeGeojson: { type: 'LineString'; coordinates: [number, number][] } | null;
}
