import * as Location from 'expo-location';
import { useRunStore } from '../../stores/runStore';
import {
  getInitialCoords,
  getMyLocation,
  myLocationAction,
  type MyLocationResult,
} from '../location';

// location.ts는 모듈 로드 시 defineTask를 실행하므로 expo-task-manager도 목 처리.
// 콜백을 캡처해 트래킹 태스크 본문을 직접 검증한다.
let mockTrackingTask:
  | ((body: { data: unknown; error: unknown }) => Promise<void>)
  | undefined;
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn((_name: string, cb: never) => {
    mockTrackingTask = cb;
  }),
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
  hasStartedLocationUpdatesAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3, BestForNavigation: 6 },
}));

const requestForeground = Location.requestForegroundPermissionsAsync as jest.Mock;
const getCurrentPosition = Location.getCurrentPositionAsync as jest.Mock;
const getForeground = Location.getForegroundPermissionsAsync as jest.Mock;
const getLastKnown = Location.getLastKnownPositionAsync as jest.Mock;

describe('run-tracking 태스크', () => {
  beforeEach(() => {
    useRunStore.getState().reset();
  });

  afterEach(() => {
    useRunStore.getState().reset();
  });

  it('위치 배열을 고도 포함 RoutePoint로 스토어에 추가한다 (고도 없으면 null)', async () => {
    useRunStore.getState().start(0);
    await mockTrackingTask!({
      data: {
        locations: [
          { coords: { latitude: 37.5, longitude: 127.0, altitude: 42.5 }, timestamp: 1000 },
          { coords: { latitude: 37.5001, longitude: 127.0, altitude: null }, timestamp: 4000 },
          { coords: { latitude: 37.5002, longitude: 127.0 }, timestamp: 7000 },
        ],
      },
      error: null,
    });
    expect(useRunStore.getState().points).toEqual([
      { latitude: 37.5, longitude: 127.0, altitude: 42.5, timestamp: 1000 },
      { latitude: 37.5001, longitude: 127.0, altitude: null, timestamp: 4000 },
      { latitude: 37.5002, longitude: 127.0, altitude: null, timestamp: 7000 },
    ]);
  });

  it('error가 있으면 아무것도 추가하지 않는다', async () => {
    useRunStore.getState().start(0);
    await mockTrackingTask!({ data: null, error: { message: 'boom' } });
    expect(useRunStore.getState().points).toEqual([]);
  });
});

describe('getMyLocation', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('권한이 허용되면 현재 좌표를 반환한다', async () => {
    requestForeground.mockResolvedValue({ status: 'granted' });
    getCurrentPosition.mockResolvedValue({
      coords: { latitude: 37.5663, longitude: 126.9779 },
    });

    const result = await getMyLocation();

    expect(result).toEqual({
      status: 'granted',
      coords: { latitude: 37.5663, longitude: 126.9779 },
    });
    expect(getCurrentPosition).toHaveBeenCalledWith({
      accuracy: Location.Accuracy.Balanced,
    });
  });

  it('권한이 거부되면 denied를 반환하고 위치를 조회하지 않는다', async () => {
    requestForeground.mockResolvedValue({ status: 'denied' });

    const result = await getMyLocation();

    expect(result).toEqual({ status: 'denied' });
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('위치 조회가 실패하면 unavailable을 반환한다', async () => {
    requestForeground.mockResolvedValue({ status: 'granted' });
    getCurrentPosition.mockRejectedValue(new Error('location services disabled'));

    const result = await getMyLocation();

    expect(result).toEqual({ status: 'unavailable' });
  });

  it('권한 요청 자체가 실패하면 unavailable을 반환한다', async () => {
    requestForeground.mockRejectedValue(new Error('permission request in progress'));

    const result = await getMyLocation();

    expect(result).toEqual({ status: 'unavailable' });
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });
});

describe('myLocationAction', () => {
  const coords = { latitude: 37.5663, longitude: 126.9779 };
  const granted: MyLocationResult = { status: 'granted', coords };
  const denied: MyLocationResult = { status: 'denied' };
  const unavailable: MyLocationResult = { status: 'unavailable' };

  it('허용되면 마운트 시에도 animate를 반환한다', () => {
    expect(myLocationAction(granted, false)).toEqual({ kind: 'animate', coords });
  });

  it('허용되면 버튼 탭 시에도 animate를 반환한다', () => {
    expect(myLocationAction(granted, true)).toEqual({ kind: 'animate', coords });
  });

  it('거부되고 버튼 탭이면 showDenied를 반환한다', () => {
    expect(myLocationAction(denied, true)).toEqual({ kind: 'showDenied' });
  });

  it('거부되고 마운트 시면 ignore를 반환한다', () => {
    expect(myLocationAction(denied, false)).toEqual({ kind: 'ignore' });
  });

  it('unavailable이면 버튼 탭 여부와 무관하게 ignore를 반환한다', () => {
    expect(myLocationAction(unavailable, true)).toEqual({ kind: 'ignore' });
    expect(myLocationAction(unavailable, false)).toEqual({ kind: 'ignore' });
  });
});

describe('getInitialCoords', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('권한이 있고 캐시 위치가 있으면 좌표를 반환한다', async () => {
    getForeground.mockResolvedValue({ status: 'granted' });
    getLastKnown.mockResolvedValue({
      coords: { latitude: 37.5663, longitude: 126.9779 },
    });

    const result = await getInitialCoords();

    expect(result).toEqual({ latitude: 37.5663, longitude: 126.9779 });
    expect(requestForeground).not.toHaveBeenCalled();
  });

  it('권한이 없으면 null을 반환하고 캐시 위치를 조회하지 않는다', async () => {
    getForeground.mockResolvedValue({ status: 'denied' });

    const result = await getInitialCoords();

    expect(result).toBeNull();
    expect(getLastKnown).not.toHaveBeenCalled();
  });

  it('캐시 위치가 없으면 null을 반환한다', async () => {
    getForeground.mockResolvedValue({ status: 'granted' });
    getLastKnown.mockResolvedValue(null);

    const result = await getInitialCoords();

    expect(result).toBeNull();
  });

  it('조회가 실패하면 null을 반환한다', async () => {
    getForeground.mockResolvedValue({ status: 'granted' });
    getLastKnown.mockRejectedValue(new Error('location unavailable'));

    const result = await getInitialCoords();

    expect(result).toBeNull();
  });
});
