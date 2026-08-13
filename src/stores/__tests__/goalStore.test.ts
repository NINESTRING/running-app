import AsyncStorage from '@react-native-async-storage/async-storage';

import { useGoalStore } from '../goalStore';

// persist의 setItem은 fire-and-forget이라 마이크로태스크 큐를 비워 저장 완료를 기다린다
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('goalStore', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useGoalStore.setState({ paceSecPerUnit: null, distanceUnits: null });
  });

  test('기본값은 목표 없음(null)', () => {
    expect(useGoalStore.getState().paceSecPerUnit).toBeNull();
    expect(useGoalStore.getState().distanceUnits).toBeNull();
  });

  test('setPace·setDistance로 설정하고 null로 해제한다', () => {
    useGoalStore.getState().setPace(330);
    useGoalStore.getState().setDistance(5);
    expect(useGoalStore.getState().paceSecPerUnit).toBe(330);
    expect(useGoalStore.getState().distanceUnits).toBe(5);

    useGoalStore.getState().setPace(null);
    expect(useGoalStore.getState().paceSecPerUnit).toBeNull();
    expect(useGoalStore.getState().distanceUnits).toBe(5);
  });

  test('변경 사항이 AsyncStorage에 저장된다', async () => {
    useGoalStore.getState().setPace(360);
    useGoalStore.getState().setDistance(10);
    await flush();

    const raw = await AsyncStorage.getItem('goal');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.state.paceSecPerUnit).toBe(360);
    expect(parsed.state.distanceUnits).toBe(10);
  });

  test('저장된 값이 rehydrate로 복원된다', async () => {
    await AsyncStorage.setItem(
      'goal',
      JSON.stringify({ state: { paceSecPerUnit: 300, distanceUnits: 21 }, version: 0 }),
    );

    await useGoalStore.persist.rehydrate();

    expect(useGoalStore.getState().paceSecPerUnit).toBe(300);
    expect(useGoalStore.getState().distanceUnits).toBe(21);
  });

  test('손상된 JSON이 저장되어 있어도 하이드레이션이 기본값으로 완료된다', async () => {
    await AsyncStorage.setItem('goal', 'not-json');

    await expect(useGoalStore.persist.rehydrate()).resolves.not.toThrow();

    expect(useGoalStore.persist.hasHydrated()).toBe(true);
    expect(useGoalStore.getState().paceSecPerUnit).toBeNull();
    expect(useGoalStore.getState().distanceUnits).toBeNull();
  });
});
