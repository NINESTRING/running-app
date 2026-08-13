import { weatherLabel } from '../weather';

describe('weatherLabel', () => {
  it.each([
    [0, '☀️', '맑음'],
    [1, '🌤️', '대체로 맑음'],
    [2, '🌤️', '대체로 맑음'],
    [3, '☁️', '흐림'],
    [45, '🌫️', '안개'],
    [48, '🌫️', '안개'],
    [51, '🌧️', '비'],
    [61, '🌧️', '비'],
    [67, '🌧️', '비'],
    [80, '🌧️', '비'],
    [82, '🌧️', '비'],
    [71, '❄️', '눈'],
    [77, '❄️', '눈'],
    [85, '❄️', '눈'],
    [86, '❄️', '눈'],
    [95, '⛈️', '뇌우'],
    [99, '⛈️', '뇌우'],
  ])('코드 %i → %s %s', (code, emoji, label) => {
    expect(weatherLabel(code)).toEqual({ emoji, label });
  });

  it('미지정 코드는 기타로 폴백', () => {
    expect(weatherLabel(42)).toEqual({ emoji: '🌡️', label: '기타' });
    expect(weatherLabel(-1)).toEqual({ emoji: '🌡️', label: '기타' });
  });
});
