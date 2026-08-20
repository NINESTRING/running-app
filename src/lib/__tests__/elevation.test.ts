import type { RoutePoint } from '../../types/run';
import { smoothAltitudes } from '../elevation';

// 위도 1도 ≈ 111195m. 포인트 간격을 미터로 지정하기 위한 환산 계수
const M_TO_DEG = 1 / 111195;

/** 경도 0 고정, 위도만 spacingM 간격으로 증가하는 포인트 배열 */
function line(
  count: number,
  spacingM: number,
  altAt: (i: number, n: number) => number | null
): RoutePoint[] {
  return Array.from({ length: count }, (_, i) => ({
    latitude: i * spacingM * M_TO_DEG,
    longitude: 0,
    altitude: altAt(i, count),
    timestamp: i * 3000,
  }));
}

function pt(latDeg: number, timestamp: number, altitude: number | null = null): RoutePoint {
  return { latitude: latDeg, longitude: 0, altitude, timestamp };
}

const nonNull = (xs: (number | null)[]): number[] => xs.filter((x): x is number => x !== null);
const span = (xs: (number | null)[]): number => {
  const v = nonNull(xs);
  return Math.max(...v) - Math.min(...v);
};

describe('smoothAltitudes', () => {
  it('거리 기준 윈도우 밖의 포인트는 섞지 않는다', () => {
    // 111m 간격 > 반경 50m → 2단계 이동평균은 자기 자신만 포함,
    // 결과는 1단계 중앙값(윈도우 5)과 같다
    const points = [10, 20, 30, 40, 50].map((a, i) => pt(i * 0.001, i * 1000, a));
    const smoothed = smoothAltitudes(points);
    expect(smoothed[0]).toBeCloseTo(20); // median[10,20,30]
    expect(smoothed[1]).toBeCloseTo(25); // median[10,20,30,40] = (20+30)/2
    expect(smoothed[2]).toBeCloseTo(30);
    expect(smoothed[3]).toBeCloseTo(35);
    expect(smoothed[4]).toBeCloseTo(40);
  });

  it('평지의 ±5m 톱니 노이즈를 3m 미만으로 줄인다', () => {
    // 7m 간격 200포인트 = 1.4km. 원본 진폭 10m
    const points = line(200, 7, (i) => 100 + (i % 2 ? 5 : -5));
    expect(span(smoothAltitudes(points))).toBeLessThan(3);
  });

  it('단발 스파이크를 중앙값 필터가 제거한다', () => {
    const points = line(50, 7, () => 100);
    points[25].altitude = 130;
    const smoothed = smoothAltitudes(points);
    expect(smoothed[25]).toBeCloseTo(100);
  });

  it('완만한 실제 상승은 뭉개지 않는다', () => {
    // 2km에 50m 상승. 양 끝은 중심 이동평균 감쇠로 1m 이내 오차
    const points = line(286, 7, (i, n) => (i * 50) / (n - 1));
    const smoothed = smoothAltitudes(points);
    expect(smoothed[0]).toBeCloseTo(0, 0);
    expect(smoothed[285]).toBeCloseTo(50, 0);
  });

  it('null 고도는 null 유지, 이웃 평균에서는 제외한다', () => {
    const points = [pt(0, 0, 10), pt(0, 1000, null), pt(0, 2000, 20)];
    expect(smoothAltitudes(points)).toEqual([15, null, 15]);
  });

  it('전부 null이면 전부 null', () => {
    expect(smoothAltitudes([pt(0, 0), pt(0, 1000)])).toEqual([null, null]);
  });

  it('빈 배열은 빈 배열', () => {
    expect(smoothAltitudes([])).toEqual([]);
  });
});
