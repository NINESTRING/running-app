import AsyncStorage from '@react-native-async-storage/async-storage';

import { useSettingsStore } from '../settingsStore';

// persist의 setItem은 fire-and-forget이라 마이크로태스크 큐를 비워 저장 완료를 기다린다
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('settingsStore', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useSettingsStore.setState({ unit: 'km', theme: 'system' });
  });

  test('기본값은 unit=km, theme=system이다', () => {
    expect(useSettingsStore.getState().unit).toBe('km');
    expect(useSettingsStore.getState().theme).toBe('system');
  });

  test('setTheme으로 테마를 변경한다', () => {
    useSettingsStore.getState().setTheme('dark');
    expect(useSettingsStore.getState().theme).toBe('dark');
  });

  test('setUnit으로 단위를 변경한다', () => {
    useSettingsStore.getState().setUnit('mi');
    expect(useSettingsStore.getState().unit).toBe('mi');
  });

  test('변경 사항이 AsyncStorage에 저장된다', async () => {
    useSettingsStore.getState().setTheme('dark');
    useSettingsStore.getState().setUnit('mi');
    await flush();

    const raw = await AsyncStorage.getItem('settings');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.state.theme).toBe('dark');
    expect(parsed.state.unit).toBe('mi');
  });

  test('저장된 값이 rehydrate로 복원된다', async () => {
    await AsyncStorage.setItem(
      'settings',
      JSON.stringify({ state: { unit: 'mi', theme: 'dark' }, version: 0 }),
    );

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState().unit).toBe('mi');
    expect(useSettingsStore.getState().theme).toBe('dark');
  });
});
