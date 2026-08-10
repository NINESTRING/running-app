import * as Location from 'expo-location';
import { getMyLocation } from '../location';

// location.ts는 모듈 로드 시 defineTask를 실행하므로 expo-task-manager도 목 처리
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
  hasStartedLocationUpdatesAsync: jest.fn(),
  Accuracy: { Balanced: 3, BestForNavigation: 6 },
}));

const requestForeground = Location.requestForegroundPermissionsAsync as jest.Mock;
const getCurrentPosition = Location.getCurrentPositionAsync as jest.Mock;

describe('getMyLocation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
