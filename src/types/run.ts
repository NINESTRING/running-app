export interface RoutePoint {
  latitude: number;
  longitude: number;
  altitude: number | null; // 미터, WGS84 타원체 기준. null = 기기 미제공(웹 등)
  timestamp: number; // epoch ms
}

// [러닝 시작 기준 벽시계 경과초, bpm]. 일시정지 구간 샘플은 제외되지만 경과초는 압축하지 않는다.
export type HeartRateSample = [elapsedSec: number, bpm: number];

export interface HeartRateSummary {
  samples: HeartRateSample[]; // 길이 ≥ 1, 시간 오름차순, 10초 버킷 평균
  avgHr: number; // 정수 bpm — 원본 샘플 평균(버킷 평균이 아님)
  maxHr: number; // 정수 bpm — 원본 샘플 최대
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
  heartRate: HeartRateSummary | null; // 건강 앱(HealthKit) 러닝 구간 심박. null = 미조회·데이터 없음·구버전 기록
}
