import {
  activeRangesFromRoutePoints,
  filterActiveSamples,
  HR_BUCKET_MS,
  pickDominantSource,
  summarizeHeartRate,
  summarizeRunHeartRate,
  type RawHeartRateSample,
} from '../heartRate';

const T0 = 1_700_000_000_000; // 러닝 시작 epoch ms

const s = (offsetMs: number, bpm: number, sourceId = 'com.xiaomi.wearable'): RawHeartRateSample => ({
  timestamp: T0 + offsetMs,
  bpm,
  sourceId,
});

describe('filterActiveSamples', () => {
  const active = [
    { start: T0, end: T0 + 60_000 },
    { start: T0 + 120_000, end: T0 + 180_000 },
  ];

  it('활동 구간 안 샘플만 남기고 경계는 포함한다', () => {
    const kept = filterActiveSamples(
      [s(0, 120), s(60_000, 125), s(90_000, 130), s(120_000, 135), s(200_000, 140)],
      active
    );
    expect(kept.map((x) => x.bpm)).toEqual([120, 125, 135]);
  });

  it('bpm 범위(30~250) 밖 샘플은 제거한다', () => {
    const kept = filterActiveSamples([s(0, 29), s(1000, 30), s(2000, 250), s(3000, 251)], active);
    expect(kept.map((x) => x.bpm)).toEqual([30, 250]);
  });

  it('활동 구간이 없으면 빈 배열', () => {
    expect(filterActiveSamples([s(0, 120)], [])).toEqual([]);
  });
});

describe('pickDominantSource', () => {
  it('샘플 수가 가장 많은 소스만 남긴다', () => {
    const out = pickDominantSource([
      s(0, 120, 'a'),
      s(1000, 121, 'b'),
      s(2000, 122, 'b'),
      s(3000, 123, 'a'),
      s(4000, 124, 'b'),
    ]);
    expect(out.every((x) => x.sourceId === 'b')).toBe(true);
    expect(out).toHaveLength(3);
  });

  it('동수면 먼저 등장한 소스', () => {
    const out = pickDominantSource([s(0, 120, 'a'), s(1000, 121, 'b')]);
    expect(out.map((x) => x.sourceId)).toEqual(['a']);
  });

  it('빈 입력은 빈 배열', () => {
    expect(pickDominantSource([])).toEqual([]);
  });
});

describe('summarizeHeartRate', () => {
  it('10초 버킷 평균으로 [경과초, bpm]을 만들고 avg·max는 원본 기준이다', () => {
    const out = summarizeHeartRate(
      [s(0, 120), s(4000, 130), s(HR_BUCKET_MS, 150), s(HR_BUCKET_MS + 9000, 160), s(35_000, 100)],
      T0
    );
    expect(out).toEqual({
      samples: [
        [0, 125], // (120+130)/2
        [10, 155], // (150+160)/2
        [30, 100],
      ],
      avgHr: 132, // (120+130+150+160+100)/5 = 132
      maxHr: 160,
    });
  });

  it('버킷 평균과 avg·max는 반올림 정수', () => {
    const out = summarizeHeartRate([s(0, 120), s(1000, 121), s(2000, 121)], T0);
    expect(out?.samples).toEqual([[0, 121]]); // 120.67 → 121
    expect(out?.avgHr).toBe(121);
    expect(out?.maxHr).toBe(121);
  });

  it('startedAt 이전 샘플은 음수 경과초가 되지 않도록 제거한다', () => {
    const out = summarizeHeartRate([s(-5000, 100), s(0, 120)], T0);
    expect(out?.samples).toEqual([[0, 120]]);
    expect(out?.avgHr).toBe(120);
  });

  it('입력 순서가 뒤섞여도 결과는 시간 오름차순', () => {
    const out = summarizeHeartRate([s(20_000, 140), s(0, 120)], T0);
    expect(out?.samples).toEqual([[0, 120], [20, 140]]);
  });

  it('입력이 비면 null', () => {
    expect(summarizeHeartRate([], T0)).toBeNull();
  });
});

describe('activeRangesFromRoutePoints', () => {
  const pt = (t: number) => ({ latitude: 0, longitude: 0, altitude: null, timestamp: t });

  it('각 그룹의 첫·마지막 timestamp를 구간으로 만든다', () => {
    expect(
      activeRangesFromRoutePoints([[pt(1000), pt(5000), pt(9000)], [pt(20_000), pt(25_000)]])
    ).toEqual([
      { start: 1000, end: 9000 },
      { start: 20_000, end: 25_000 },
    ]);
  });

  it('포인트 1개짜리 그룹은 start=end, 빈 그룹은 건너뛴다', () => {
    expect(activeRangesFromRoutePoints([[pt(1000)], [], [pt(3000)]])).toEqual([
      { start: 1000, end: 1000 },
      { start: 3000, end: 3000 },
    ]);
  });
});

describe('summarizeRunHeartRate', () => {
  it('필터 → 소스 선택 → 요약을 차례로 적용한다', () => {
    const active = [{ start: T0, end: T0 + 60_000 }];
    const out = summarizeRunHeartRate(
      [
        s(0, 120, 'band'),
        s(5000, 130, 'band'),
        s(7000, 999, 'band'), // 범위 밖
        s(8000, 90, 'watch'), // 소수 소스
        s(70_000, 170, 'band'), // 활동 구간 밖
      ],
      T0,
      active
    );
    expect(out).toEqual({ samples: [[0, 125]], avgHr: 125, maxHr: 130 });
  });

  it('필터 후 남는 샘플이 없으면 null', () => {
    expect(summarizeRunHeartRate([s(0, 300)], T0, [{ start: T0, end: T0 + 1000 }])).toBeNull();
  });
});
