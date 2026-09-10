import { useSettingsStore } from '../../stores/settingsStore';
import type { RunRecord } from '../../types/run';
import {
  backfillHeartRate,
  HR_BACKFILL_LIMIT_PER_FOCUS,
  HR_BACKFILL_MAX_AGE_MS,
  isHeartRateBackfillCandidate,
} from '../heartRateBackfill';

const mockFetch = jest.fn();
const mockAvailable = jest.fn(() => true);
const mockUpdate = jest.fn();

// heartRate.ts는 nitro 네이티브 모듈을 import하므로 팩토리로 실제 모듈 로드를 막는다
jest.mock('../heartRate', () => ({
  fetchRunHeartRate: (...a: unknown[]) => mockFetch(...a),
  isHeartRateSourceAvailable: () => mockAvailable(),
}));
jest.mock('../runs', () => ({
  updateRunHeartRate: (...a: unknown[]) => mockUpdate(...a),
}));

const NOW = Date.parse('2026-09-10T09:00:00+09:00');
const HR = { samples: [[0, 120]] as [number, number][], avgHr: 120, maxHr: 120 };

function run(partial: Partial<RunRecord> & Pick<RunRecord, 'id' | 'startedAt'>): RunRecord {
  return {
    durationSec: 600,
    distanceM: 2000,
    steps: null,
    routeGeojson: null,
    routePoints: null,
    weatherCode: null,
    temperatureC: null,
    locationLabel: null,
    heartRate: null,
    ...partial,
  };
}

const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

beforeEach(() => {
  mockFetch.mockReset().mockResolvedValue(HR);
  mockAvailable.mockReset().mockReturnValue(true);
  mockUpdate.mockReset().mockResolvedValue(true);
  useSettingsStore.setState({ healthHeartRateOn: true });
});

describe('isHeartRateBackfillCandidate', () => {
  it('심박이 없고 7일 이내면 true', () => {
    expect(isHeartRateBackfillCandidate(run({ id: 'a', startedAt: iso(3600_000) }), NOW)).toBe(true);
    expect(
      isHeartRateBackfillCandidate(run({ id: 'a', startedAt: iso(HR_BACKFILL_MAX_AGE_MS) }), NOW)
    ).toBe(true); // 경계 포함
  });
  it('7일을 넘기면 false', () => {
    expect(
      isHeartRateBackfillCandidate(run({ id: 'a', startedAt: iso(HR_BACKFILL_MAX_AGE_MS + 1) }), NOW)
    ).toBe(false);
  });
  it('이미 심박이 있으면 false', () => {
    expect(
      isHeartRateBackfillCandidate(run({ id: 'a', startedAt: iso(0), heartRate: HR }), NOW)
    ).toBe(false);
  });
});

describe('backfillHeartRate', () => {
  const pt = (t: number) => ({ latitude: 0, longitude: 0, altitude: null, timestamp: t });
  const started = NOW - 3600_000;
  // 1그룹: 첫 포인트가 시작 10초 뒤(정지 후 출발 지연) ~ 300초. 2그룹: 400초 ~ 550초.
  // durationSec=500 → 커버 시간(클램프 후 300_000 + 150_000 = 450_000ms)보다 50_000ms 많아
  // 마지막 구간 끝이 550_000 → 600_000으로 늘어난다. 숫자를 손으로 검산할 수 있게 고른 값.
  const withPoints = run({
    id: 'r1',
    startedAt: new Date(started).toISOString(),
    durationSec: 500,
    routePoints: [[pt(started + 10_000), pt(started + 300_000)], [pt(started + 400_000), pt(started + 550_000)]],
  });

  it('routePoints 그룹으로 활동 구간을 만들되 첫 시작을 startedAt까지 당기고 durationSec만큼 끝을 늘려 조회하고, 저장 성공 시 onFilled를 부른다', async () => {
    const onFilled = jest.fn();
    await backfillHeartRate([withPoints], { limit: 5, isCancelled: () => false, onFilled });
    expect(mockFetch).toHaveBeenCalledWith({
      startedAt: started,
      endedAt: started + 600_000,
      active: [
        { start: started, end: started + 300_000 },
        { start: started + 400_000, end: started + 600_000 },
      ],
    });
    expect(mockUpdate).toHaveBeenCalledWith('r1', HR);
    expect(onFilled).toHaveBeenCalledWith('r1', HR);
  });

  it('첫 그룹이 startedAt 이후에 시작하면 첫 구간 시작을 startedAt으로 당긴다(연장 없이)', async () => {
    // 단일 그룹, durationSec을 클램프 후 커버 시간과 정확히 같게 잡아 연장(uncovered=0)과 분리해 확인
    const s = NOW - 3600_000;
    const r = run({
      id: 'clamp',
      startedAt: new Date(s).toISOString(),
      durationSec: 200,
      routePoints: [[pt(s + 5_000), pt(s + 200_000)]],
    });
    await backfillHeartRate([r], { limit: 5, isCancelled: () => false, onFilled: jest.fn() });
    expect(mockFetch).toHaveBeenCalledWith({
      startedAt: s,
      endedAt: s + 200_000,
      active: [{ start: s, end: s + 200_000 }],
    });
  });

  it('durationSec이 커버 시간보다 짧으면 늘리지 않는다(uncovered=0)', async () => {
    const s = NOW - 3600_000;
    const r = run({
      id: 'short',
      startedAt: new Date(s).toISOString(),
      durationSec: 100, // 커버 시간(300_000ms)보다 훨씬 짧다
      routePoints: [[pt(s), pt(s + 300_000)]],
    });
    await backfillHeartRate([r], { limit: 5, isCancelled: () => false, onFilled: jest.fn() });
    expect(mockFetch).toHaveBeenCalledWith({
      startedAt: s,
      endedAt: s + 300_000,
      active: [{ start: s, end: s + 300_000 }],
    });
  });

  it('routePoints가 없으면 startedAt~startedAt+durationSec 단일 구간', async () => {
    const r = run({ id: 'r2', startedAt: new Date(started).toISOString(), durationSec: 600 });
    await backfillHeartRate([r], { limit: 5, isCancelled: () => false, onFilled: jest.fn() });
    expect(mockFetch).toHaveBeenCalledWith({
      startedAt: started,
      endedAt: started + 600_000,
      active: [{ start: started, end: started + 600_000 }],
    });
  });

  it('후보만, 최대 limit개만 처리한다', async () => {
    const runs = [
      run({ id: 'old', startedAt: iso(HR_BACKFILL_MAX_AGE_MS + 1) }),
      run({ id: 'has', startedAt: iso(1000), heartRate: HR }),
      run({ id: 'a', startedAt: iso(2000) }),
      run({ id: 'b', startedAt: iso(3000) }),
      run({ id: 'c', startedAt: iso(4000) }),
    ];
    await backfillHeartRate(runs, { limit: 2, isCancelled: () => false, onFilled: jest.fn() });
    expect(mockUpdate.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
    expect(HR_BACKFILL_LIMIT_PER_FOCUS).toBe(5);
  });

  it('조회가 null이면 저장·콜백 없이 다음으로 넘어간다', async () => {
    mockFetch.mockResolvedValueOnce(null).mockResolvedValueOnce(HR);
    const onFilled = jest.fn();
    await backfillHeartRate(
      [run({ id: 'a', startedAt: iso(1000) }), run({ id: 'b', startedAt: iso(2000) })],
      { limit: 5, isCancelled: () => false, onFilled }
    );
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(onFilled).toHaveBeenCalledWith('b', HR);
  });

  it('저장 실패면 onFilled를 부르지 않는다', async () => {
    mockUpdate.mockResolvedValue(false);
    const onFilled = jest.fn();
    await backfillHeartRate([run({ id: 'a', startedAt: iso(1000) })], {
      limit: 5,
      isCancelled: () => false,
      onFilled,
    });
    expect(onFilled).not.toHaveBeenCalled();
  });

  it('취소되면 저장 후에도 onFilled를 부르지 않고 멈춘다', async () => {
    let cancelled = false;
    mockUpdate.mockImplementation(async () => {
      cancelled = true;
      return true;
    });
    const onFilled = jest.fn();
    await backfillHeartRate(
      [run({ id: 'a', startedAt: iso(1000) }), run({ id: 'b', startedAt: iso(2000) })],
      { limit: 5, isCancelled: () => cancelled, onFilled }
    );
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(onFilled).not.toHaveBeenCalled();
  });

  it('토글이 꺼져 있으면 아무것도 하지 않는다', async () => {
    useSettingsStore.setState({ healthHeartRateOn: false });
    await backfillHeartRate([run({ id: 'a', startedAt: iso(1000) })], {
      limit: 5,
      isCancelled: () => false,
      onFilled: jest.fn(),
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('HealthKit이 없으면 아무것도 하지 않는다', async () => {
    mockAvailable.mockReturnValue(false);
    await backfillHeartRate([run({ id: 'a', startedAt: iso(1000) })], {
      limit: 5,
      isCancelled: () => false,
      onFilled: jest.fn(),
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
