import { getInstalledVersion } from '../version';
import * as Application from 'expo-application';
import Constants from 'expo-constants';

jest.mock('expo-application');
jest.mock('expo-constants');

describe('getInstalledVersion', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('nativeApplicationVersion이 있으면 그것을 반환', () => {
    (Application.nativeApplicationVersion as any) = '2.0.0';
    (Constants.expoConfig as any) = { version: '1.0.0' };

    expect(getInstalledVersion()).toBe('2.0.0');
  });

  it('nativeApplicationVersion이 null이면 Constants.expoConfig.version 반환', () => {
    (Application.nativeApplicationVersion as any) = null;
    (Constants.expoConfig as any) = { version: '1.5.0' };

    expect(getInstalledVersion()).toBe('1.5.0');
  });

  it('nativeApplicationVersion과 Constants.expoConfig.version이 모두 null/undefined이면 null 반환', () => {
    (Application.nativeApplicationVersion as any) = null;
    (Constants.expoConfig as any) = null;

    expect(getInstalledVersion()).toBeNull();
  });

  it('Constants.expoConfig가 undefined이고 nativeApplicationVersion이 null이면 null 반환', () => {
    (Application.nativeApplicationVersion as any) = null;
    (Constants.expoConfig as any) = undefined;

    expect(getInstalledVersion()).toBeNull();
  });
});
