import AsyncStorage from '@react-native-async-storage/async-storage';

import { useSettingsStore } from '../settingsStore';

// persist의 setItem은 fire-and-forget이라 마이크로태스크 큐를 비워 저장 완료를 기다린다
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('settingsStore', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useSettingsStore.setState({
      unit: 'km',
      theme: 'system',
      voiceDistanceUnits: null,
      voiceTimeMin: null,
    });
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

  test('손상된 JSON이 저장되어 있어도 하이드레이션이 실패하지 않고 기본값으로 완료된다', async () => {
    await AsyncStorage.setItem('settings', 'not-json');

    await expect(useSettingsStore.persist.rehydrate()).resolves.not.toThrow();

    // reject를 삼키기만 하고 hasHydrated를 세우지 않으면 앱이 영구 대기 상태에 빠지므로
    // 실제로 하이드레이션이 "완료" 상태가 되었는지까지 확인한다
    expect(useSettingsStore.persist.hasHydrated()).toBe(true);
    expect(useSettingsStore.getState().unit).toBe('km');
    expect(useSettingsStore.getState().theme).toBe('system');
  });

  // getState()는 beforeEach의 setState가 심어둔 값을 그대로 돌려주므로 이니셜라이저를
  // 지워도 통과한다. getInitialState()는 스토어 생성 시 고정된 초기 상태라 실제로
  // src/stores/settingsStore.ts의 두 필드 초기값을 검증한다.
  test('음성 안내 주기의 기본값은 둘 다 null(끔)이다', () => {
    expect(useSettingsStore.getInitialState().voiceDistanceUnits).toBeNull();
    expect(useSettingsStore.getInitialState().voiceTimeMin).toBeNull();
  });

  test('음성 안내 주기를 변경한다', () => {
    useSettingsStore.getState().setVoiceDistanceUnits(0.5);
    useSettingsStore.getState().setVoiceTimeMin(2);
    expect(useSettingsStore.getState().voiceDistanceUnits).toBe(0.5);
    expect(useSettingsStore.getState().voiceTimeMin).toBe(2);
  });

  test('음성 안내 주기를 null로 되돌려 끌 수 있다', () => {
    useSettingsStore.getState().setVoiceTimeMin(5);
    useSettingsStore.getState().setVoiceTimeMin(null);
    expect(useSettingsStore.getState().voiceTimeMin).toBeNull();
  });

  test('음성 안내 주기가 AsyncStorage에 저장된다', async () => {
    useSettingsStore.getState().setVoiceDistanceUnits(2);
    useSettingsStore.getState().setVoiceTimeMin(1);
    await flush();

    const raw = await AsyncStorage.getItem('settings');
    const parsed = JSON.parse(raw as string);
    expect(parsed.state.voiceDistanceUnits).toBe(2);
    expect(parsed.state.voiceTimeMin).toBe(1);
  });

  // 복원은 저장소를 직접 세팅해서 확인한다. setState로 값을 되돌린 뒤 rehydrate를
  // 부르면 persist의 fire-and-forget setItem이 rehydrate의 읽기와 경쟁한다.
  test('저장된 음성 안내 주기가 rehydrate로 복원된다', async () => {
    await AsyncStorage.setItem(
      'settings',
      JSON.stringify({
        state: { unit: 'km', theme: 'system', voiceDistanceUnits: 0.5, voiceTimeMin: 5 },
        version: 0,
      }),
    );

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState().voiceDistanceUnits).toBe(0.5);
    expect(useSettingsStore.getState().voiceTimeMin).toBe(5);
  });

  // 마이그레이션 없이 필드를 추가했으므로, 기존 사용자의 저장본에 두 키가 없다.
  // persist의 얕은 병합이 초기값(null = 끔)을 남겨야 한다.
  test('두 키가 없는 기존 저장본은 병합으로 null(끔)이 된다', async () => {
    await AsyncStorage.setItem(
      'settings',
      JSON.stringify({ state: { unit: 'mi', theme: 'dark' }, version: 0 }),
    );

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState().unit).toBe('mi');
    expect(useSettingsStore.getState().voiceDistanceUnits).toBeNull();
    expect(useSettingsStore.getState().voiceTimeMin).toBeNull();
  });
});
