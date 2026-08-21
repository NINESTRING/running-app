import type { RoutePoint } from '../../types/run';
import {
  elevationGainM,
  elevationProfile,
  elevationYDomain,
  formatElevationDelta,
  smoothAltitudes,
} from '../elevation';

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
    // 실측 0.647 / 49.353 — 중심 이동평균의 양 끝 감쇠는 구조적이라 1m 이내로 본다
    expect(smoothed[0]).toBeLessThan(1);
    expect(smoothed[285]).toBeGreaterThan(49);
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

// 위도 0.001도 ≈ 111.195m (적도, 경도 0 고정)
const STEP_M = 111.195;

/** 저주파 드리프트 노이즈 — 실제 GPS 고도 오차처럼 수백 m 주기로 천천히 흐른다 */
const drift = (i: number): number =>
  3 * Math.sin(i * 0.07) + 2 * Math.sin(i * 0.23 + 1) + 2.5 * Math.sin(i * 0.011);

describe('elevationGainM', () => {
  it('평지의 저주파 드리프트 노이즈는 상승으로 계상하지 않는다', () => {
    // 이 케이스가 이 기능의 존재 이유다. 임계값 3m에서는 15.2m가 나왔다.
    const points = line(286, 7, (i) => 100 + drift(i));
    expect(elevationGainM([points])).toBe(0);
  });

  it('평지의 톱니 노이즈도 상승으로 계상하지 않는다', () => {
    const points = line(200, 7, (i) => 100 + (i % 2 ? 5 : -5));
    expect(elevationGainM([points])).toBe(0);
  });

  it('완만한 실제 상승은 보존한다', () => {
    // 2km에 50m. 히스테리시스 임계값 미달분과 이동평균 양 끝 감쇠로 약 8% 손실
    const points = line(286, 7, (i, n) => (i * 50) / (n - 1));
    const gain = elevationGainM([points]);
    expect(gain).toBeGreaterThan(45);
    expect(gain).toBeLessThanOrEqual(50);
  });

  it('임계값을 넘는 상승만 합산한다', () => {
    // 111m 간격이라 이동평균은 무연산. 스무딩 후 [2,3,4,6,8,10,12,14,15,16]
    // 기준점 2 → 8(+6) → 14(+6). 나머지는 임계값 5m 미달 → 12
    const points = Array.from({ length: 10 }, (_, i) => pt(i * 0.001, i * 10_000, i * 2));
    expect(elevationGainM([points])).toBeCloseTo(12);
  });

  it('내리막은 합산하지 않는다', () => {
    const alts = [10, 10, 10, 0, 0, 0];
    const points = alts.map((a, i) => pt(i * 0.001, i * 10_000, a));
    expect(elevationGainM([points])).toBe(0);
  });

  it('상승 후 같은 높이로 하강하면 상승분만 계상한다', () => {
    // 1km에 30m 오르고 1km에 30m 내려온다. 총 이동 고도차는 60m지만 상승은 30m
    const up = line(143, 7, (i) => (i * 30) / 142);
    const down = line(143, 7, (i) => 30 - (i * 30) / 142).map((p, i) => ({
      ...p,
      latitude: (143 + i) * 7 * M_TO_DEG,
      timestamp: (143 + i) * 3000,
    }));
    const gain = elevationGainM([[...up, ...down]]);
    expect(gain).toBeGreaterThan(24); // 실측 25.418
    expect(gain).toBeLessThanOrEqual(30);
  });

  it('유효 고도가 2개 미만이면 null', () => {
    expect(elevationGainM([[pt(0, 0), pt(0.001, 1000)]])).toBeNull();
    expect(elevationGainM([])).toBeNull();
  });

  it('일시정지로 나뉜 다중 그룹도 이어서 합산한다', () => {
    // 그룹 경계를 가로질러 단조 증가: flat [0,10,20,20,30,40]
    // 스무딩 후 [10,15,20,20,25,30] → 기준점 10 → 20(+10) → 30(+10) = 20
    const g1 = [pt(0, 0, 0), pt(0.001, 10_000, 10), pt(0.002, 20_000, 20)];
    const g2 = [pt(0.002, 120_000, 20), pt(0.003, 130_000, 30), pt(0.004, 140_000, 40)];
    expect(elevationGainM([g1, g2])).toBeCloseTo(20);
  });
});

describe('elevationProfile', () => {
  it('누적 거리 × 스무딩 고도 시리즈를 만든다', () => {
    const points = [pt(0, 0, 10), pt(0.001, 1000, 20), pt(0.002, 2000, 30)];
    const profile = elevationProfile([points]);
    expect(profile).toHaveLength(3);
    expect(profile[0].distanceM).toBe(0);
    expect(profile[1].distanceM).toBeCloseTo(STEP_M, 0);
    expect(profile[2].distanceM).toBeCloseTo(2 * STEP_M, 0);
    expect(profile[1].altitudeM).toBeCloseTo(20);
  });

  it('고도 null 포인트는 제외하되 거리는 누적한다', () => {
    const points = [pt(0, 0, 10), pt(0.001, 1000, null), pt(0.002, 2000, 10)];
    const profile = elevationProfile([points]);
    expect(profile).toHaveLength(2);
    expect(profile[1].distanceM).toBeCloseTo(2 * STEP_M, 0);
  });

  it('일시정지로 나뉜 다중 그룹에서도 거리를 이어서 누적한다', () => {
    const g1 = [pt(0, 0, 10), pt(0.001, 10_000, 10)];
    const g2 = [pt(0.001, 120_000, 10), pt(0.002, 130_000, 10)];
    const profile = elevationProfile([g1, g2]);
    expect(profile).toHaveLength(4);
    expect(profile[3].distanceM).toBeCloseTo(2 * STEP_M, 0);
  });
});

describe('formatElevationDelta', () => {
  it('5m 노이즈 바닥 이내면 0m — elevationGainM과 같은 임계값', () => {
    expect(formatElevationDelta(4.4)).toBe('0 m');
  });

  it('바닥보다 살짝 안쪽(4.9m)도 0m', () => {
    expect(formatElevationDelta(4.9)).toBe('0 m');
  });

  it('바닥 값과 정확히 같으면(5.0m) 0m — strictly greater만 통과', () => {
    expect(formatElevationDelta(5.0)).toBe('0 m');
    expect(formatElevationDelta(-5.0)).toBe('0 m');
  });

  it('바닥을 살짝 벗어나면(양) + 부호로 표시', () => {
    expect(formatElevationDelta(5.4)).toBe('+5 m');
  });

  it('바닥을 살짝 벗어나면(음) - 부호로 표시', () => {
    expect(formatElevationDelta(-5.3)).toBe('-5 m');
  });

  it('0으로 반올림되면 무부호', () => {
    expect(formatElevationDelta(0.2)).toBe('0 m');
    expect(formatElevationDelta(-0.4)).toBe('0 m');
  });

  it('null은 대시', () => {
    expect(formatElevationDelta(null)).toBe('—');
  });
});

describe('elevationYDomain', () => {
  it('범위가 최소 폭보다 좁으면 중앙값 기준으로 넓힌다', () => {
    const profile = [
      { distanceM: 0, altitudeM: 99.5 },
      { distanceM: 10, altitudeM: 100.5 },
    ];
    expect(elevationYDomain(profile)).toEqual([80, 120]);
  });

  it('실제 언덕은 min/max를 그대로 쓴다', () => {
    const profile = [
      { distanceM: 0, altitudeM: 20 },
      { distanceM: 10, altitudeM: 100 },
    ];
    expect(elevationYDomain(profile)).toEqual([20, 100]);
  });

  it('경계: 범위가 최소 폭과 정확히 같으면 그대로 쓴다', () => {
    const profile = [
      { distanceM: 0, altitudeM: 100 },
      { distanceM: 10, altitudeM: 140 },
    ];
    expect(elevationYDomain(profile)).toEqual([100, 140]);
  });

  it('minSpanM을 지정할 수 있다', () => {
    const profile = [
      { distanceM: 0, altitudeM: 100 },
      { distanceM: 10, altitudeM: 101 },
    ];
    expect(elevationYDomain(profile, 10)).toEqual([95.5, 105.5]);
  });

  it('빈 프로필은 [0, minSpanM]', () => {
    expect(elevationYDomain([])).toEqual([0, 40]);
  });

  it('평지 드리프트 코스는 잔여 진폭이 차트 높이의 30% 미만이 된다', () => {
    // 이 최소 폭을 두는 이유 — 스무딩만으로는 드리프트가 남아 그래프를 가득 채운다
    const profile = elevationProfile([line(286, 7, (i) => 100 + drift(i))]);
    const [lo, hi] = elevationYDomain(profile);
    const alts = profile.map((p) => p.altitudeM);
    const residual = Math.max(...alts) - Math.min(...alts);
    expect(residual / (hi - lo)).toBeLessThan(0.3);
  });
});
