export interface WeatherLabel {
  emoji: string;
  label: string;
}

/** WMO weather code를 표시용 이모지·한글 라벨로 변환한다. */
export function weatherLabel(code: number): WeatherLabel {
  if (code === 0) return { emoji: '☀️', label: '맑음' };
  if (code === 1 || code === 2) return { emoji: '🌤', label: '대체로 맑음' };
  if (code === 3) return { emoji: '☁️', label: '흐림' };
  if (code === 45 || code === 48) return { emoji: '🌫', label: '안개' };
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82))
    return { emoji: '🌧', label: '비' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86)
    return { emoji: '❄️', label: '눈' };
  if (code >= 95 && code <= 99) return { emoji: '⛈', label: '뇌우' };
  return { emoji: '🌡', label: '기타' };
}
