import { Platform } from 'react-native';
import { Pedometer } from 'expo-sensors';
import { useRunStore } from '../../stores/runStore';
import {
  backfillSteps,
  startStepCounting,
  stopStepCounting,
} from '../pedometer';

jest.mock('expo-sensors', () => ({
  Pedometer: {
    isAvailableAsync: jest.fn(),
    watchStepCount: jest.fn(),
    getStepCountAsync: jest.fn(),
    requestPermissionsAsync: jest.fn(),
  },
}));

const mocked = Pedometer as jest.Mocked<typeof Pedometer>;

beforeEach(() => {
  jest.clearAllMocks();
  stopStepCounting(); // 이전 테스트의 구독 정리
  useRunStore.getState().reset();
});

describe('startStepCounting / stopStepCounting', () => {
  it('사용 가능하면 구독하고 steps를 0으로 초기화', async () => {
    mocked.isAvailableAsync.mockResolvedValue(true);
    const remove = jest.fn();
    mocked.watchStepCount.mockReturnValue({ remove });
    useRunStore.getState().start(0);

    await startStepCounting();

    expect(useRunStore.getState().steps).toBe(0);
    expect(mocked.watchStepCount).toHaveBeenCalledTimes(1);

    // 콜백이 store로 전달되는지
    const callback = mocked.watchStepCount.mock.calls[0][0];
    callback({ steps: 12 });
    expect(useRunStore.getState().steps).toBe(12);

    stopStepCounting();
    expect(remove).toHaveBeenCalled();
  });

  it('미지원 기기면 구독하지 않고 steps는 null 유지', async () => {
    mocked.isAvailableAsync.mockResolvedValue(false);
    useRunStore.getState().start(0);

    await startStepCounting();

    expect(mocked.watchStepCount).not.toHaveBeenCalled();
    expect(useRunStore.getState().steps).toBeNull();
  });

  it('isAvailableAsync가 throw해도 조용히 무시', async () => {
    mocked.isAvailableAsync.mockRejectedValue(new Error('boom'));
    await expect(startStepCounting()).resolves.toBeUndefined();
  });
});

describe('backfillSteps', () => {
  const segments = [
    { start: 1000, end: 5000 },
    { start: 8000, end: 12_000 },
  ];

  it('iOS에서 세그먼트별 걸음을 합산', async () => {
    Platform.OS = 'ios';
    mocked.getStepCountAsync
      .mockResolvedValueOnce({ steps: 100 })
      .mockResolvedValueOnce({ steps: 50 });

    await expect(backfillSteps(segments)).resolves.toBe(150);
    expect(mocked.getStepCountAsync).toHaveBeenCalledWith(
      new Date(1000),
      new Date(5000)
    );
  });

  it('iOS가 아니면 null', async () => {
    Platform.OS = 'android';
    await expect(backfillSteps(segments)).resolves.toBeNull();
    expect(mocked.getStepCountAsync).not.toHaveBeenCalled();
  });

  it('조회 실패 시 null (라이브 카운트 폴백용)', async () => {
    Platform.OS = 'ios';
    mocked.getStepCountAsync.mockRejectedValue(new Error('denied'));
    await expect(backfillSteps(segments)).resolves.toBeNull();
  });

  it('세그먼트가 없으면 null', async () => {
    Platform.OS = 'ios';
    await expect(backfillSteps([])).resolves.toBeNull();
  });
});
