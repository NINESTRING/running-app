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
    return { weatherCode: code, temperatureC: temp };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
