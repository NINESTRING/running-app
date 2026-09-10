import { fetchRunHeartRate, isHeartRateSourceAvailable, requestHeartRateAccess } from '../heartRate';

// jest.mock 팩토리는 스코프 밖 변수를 참조할 수 없지만 `mock` 접두사는 예외다.
const mockHk = {
  isHealthDataAvailable: jest.fn(() => true),
  requestAuthorization: jest.fn<Promise<boolean>, unknown[]>(async () => true),
  queryQuantitySamples: jest.fn<Promise<unknown[]>, unknown[]>(async () => []),
};

// nitro 네이티브 모듈은 jest에서 로드할 수 없다 — 팩토리로 실제 모듈 로드를 막는다
jest.mock('@kingstinct/react-native-healthkit', () => ({
  isHealthDataAvailable: () => mockHk.isHealthDataAvailable(),
  requestAuthorization: (...args: unknown[]) => mockHk.requestAuthorization(...args),
  queryQuantitySamples: (...args: unknown[]) => mockHk.queryQuantitySamples(...args),
}));

const T0 = 1_700_000_000_000;
const hkSample = (offsetMs: number, bpm: number, bundleIdentifier = 'com.xiaomi.wearable') => ({
  startDate: new Date(T0 + offsetMs),
  endDate: new Date(T0 + offsetMs),
  quantity: bpm,
  unit: 'count/min',
  sourceRevision: { source: { name: 'Mi Fitness', bundleIdentifier } },
});

beforeEach(() => {
  mockHk.isHealthDataAvailable.mockReset().mockReturnValue(true);
  mockHk.requestAuthorization.mockReset().mockResolvedValue(true);
  mockHk.queryQuantitySamples.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('isHeartRateSourceAvailable', () => {
  it('HealthKit이 사용 가능하면 true', () => {
    expect(isHeartRateSourceAvailable()).toBe(true);
  });
  it('HealthKit이 없으면(iPad 등) false', () => {
    mockHk.isHealthDataAvailable.mockReturnValue(false);
    expect(isHeartRateSourceAvailable()).toBe(false);
  });
  it('네이티브 호출이 throw해도 false', () => {
    mockHk.isHealthDataAvailable.mockImplementation(() => {
      throw new Error('no native');
    });
    expect(isHeartRateSourceAvailable()).toBe(false);
  });
});

describe('requestHeartRateAccess', () => {
  it('심박 읽기 권한만 요청하고 true', async () => {
    await expect(requestHeartRateAccess()).resolves.toBe(true);
    expect(mockHk.requestAuthorization).toHaveBeenCalledWith({
      toRead: ['HKQuantityTypeIdentifierHeartRate'],
    });
  });
  it('HealthKit이 없으면 요청 없이 false', async () => {
    mockHk.isHealthDataAvailable.mockReturnValue(false);
    await expect(requestHeartRateAccess()).resolves.toBe(false);
    expect(mockHk.requestAuthorization).not.toHaveBeenCalled();
  });
  it('요청이 throw하면 false', async () => {
    mockHk.requestAuthorization.mockRejectedValue(new Error('denied'));
    await expect(requestHeartRateAccess()).resolves.toBe(false);
  });
});

describe('fetchRunHeartRate', () => {
  const params = { startedAt: T0, endedAt: T0 + 60_000, active: [{ start: T0, end: T0 + 60_000 }] };

  it('구간을 count/min 단위·오름차순·무제한으로 조회해 요약한다', async () => {
    mockHk.queryQuantitySamples.mockResolvedValue([hkSample(0, 120), hkSample(5000, 130)]);
    await expect(fetchRunHeartRate(params)).resolves.toEqual({
      samples: [[0, 125]],
      avgHr: 125,
      maxHr: 130,
    });
    expect(mockHk.queryQuantitySamples).toHaveBeenCalledWith('HKQuantityTypeIdentifierHeartRate', {
      filter: { date: { startDate: new Date(T0), endDate: new Date(T0 + 60_000) } },
      unit: 'count/min',
      limit: 0,
      ascending: true,
    });
  });

  it('소스 bundleIdentifier를 sourceId로 넘겨 지배 소스만 남긴다', async () => {
    mockHk.queryQuantitySamples.mockResolvedValue([
      hkSample(0, 120, 'band'),
      hkSample(1000, 121, 'band'),
      hkSample(2000, 60, 'watch'),
    ]);
    const out = await fetchRunHeartRate(params);
    expect(out?.avgHr).toBe(121); // watch 60은 제외
  });

  it('startDate가 숫자(epoch ms)로 와도 처리한다', async () => {
    mockHk.queryQuantitySamples.mockResolvedValue([{ ...hkSample(0, 120), startDate: T0 }]);
    await expect(fetchRunHeartRate(params)).resolves.toEqual({
      samples: [[0, 120]],
      avgHr: 120,
      maxHr: 120,
    });
  });

  it('샘플이 없으면 null', async () => {
    await expect(fetchRunHeartRate(params)).resolves.toBeNull();
  });

  it('HealthKit이 없으면 조회 없이 null', async () => {
    mockHk.isHealthDataAvailable.mockReturnValue(false);
    await expect(fetchRunHeartRate(params)).resolves.toBeNull();
    expect(mockHk.queryQuantitySamples).not.toHaveBeenCalled();
  });

  it('활동 구간이 비면 조회 없이 null', async () => {
    await expect(fetchRunHeartRate({ ...params, active: [] })).resolves.toBeNull();
    expect(mockHk.queryQuantitySamples).not.toHaveBeenCalled();
  });

  it('조회가 throw하면 null', async () => {
    mockHk.queryQuantitySamples.mockRejectedValue(new Error('boom'));
    await expect(fetchRunHeartRate(params)).resolves.toBeNull();
  });

  it('5초 안에 응답이 없으면 null', async () => {
    jest.useFakeTimers();
    mockHk.queryQuantitySamples.mockReturnValue(new Promise(() => {}));
    const p = fetchRunHeartRate(params);
    jest.advanceTimersByTime(5000);
    await expect(p).resolves.toBeNull();
  });
});
