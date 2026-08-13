import type { RoutePoint } from '../types/run';

export interface CurrentWeather {
  weatherCode: number; // WMO weather code
  temperatureC: number;
}

const TIMEOUT_MS = 5000;

/**
 * Open-Meteo로 현재 날씨를 1회 조회한다. API 키 불필요.
 * HTTP 오류·타임아웃·형식 이상 등 모든 실패는 null — throw하지 않는다.
 */
export async function fetchCurrentWeather(
  latitude: number,
  longitude: number
): Promise<CurrentWeather | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,weather_code`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      current?: { temperature_2m?: unknown; weather_code?: unknown };
    };
    const code = json.current?.weather_code;
    const temp = json.current?.temperature_2m;
    if (typeof code !== 'number' || typeof temp !== 'number') return null;
    // DB check 제약(weather_code 0~99, temperature_c -90~60)을 미러링 — 범위 밖 응답은 조회 실패로 취급
    if (!Number.isFinite(code) || code < 0 || code > 99) return null;
    if (!Number.isFinite(temp) || temp < -90 || temp > 60) return null;
    return { weatherCode: code, temperatureC: temp };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 저장 직전 러닝에 기록할 날씨를 결정한다.
 * 시작 시 조회값이 있으면 그대로, 없으면 마지막 GPS 좌표로 1회 재시도.
 * 좌표가 없거나 재시도가 실패하면 둘 다 null (원자적 쌍 — 부분 기록 없음).
 */
export async function resolveRunWeather(
  stored: { weatherCode: number | null; temperatureC: number | null },
  lastPoint: Pick<RoutePoint, 'latitude' | 'longitude'> | undefined
): Promise<{ weatherCode: number | null; temperatureC: number | null }> {
  if (stored.weatherCode !== null && stored.temperatureC !== null) return stored;
  if (!lastPoint) return { weatherCode: null, temperatureC: null };
  const w = await fetchCurrentWeather(lastPoint.latitude, lastPoint.longitude);
  return w
    ? { weatherCode: w.weatherCode, temperatureC: w.temperatureC }
    : { weatherCode: null, temperatureC: null };
}
