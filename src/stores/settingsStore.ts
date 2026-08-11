import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';

export type ThemePreference = 'system' | 'light' | 'dark';

interface SettingsState {
  unit: 'km' | 'mi';
  theme: ThemePreference;
  setUnit: (unit: 'km' | 'mi') => void;
  setTheme: (theme: ThemePreference) => void;
}

// zustand의 createJSONStorage는 저장된 문자열을 넘겨받은 뒤 자체적으로 JSON.parse를 수행하는데,
// 이 파싱은 우리가 감싼 getItem 바깥(persist 내부)에서 일어나 손상된 JSON은 여전히 reject로 전파된다.
// hydrate()는 그 reject를 조용히 삼키기만 하고 hasHydrated를 true로 만들지 않으므로,
// 네이티브 읽기 오류든 손상된 JSON이든 이 getItem 안에서 직접 파싱까지 끝내고 실패 시 null을 반환해야
// 앱이 빈 화면에 영구히 멈추지 않는다.
const safeStorage: PersistStorage<SettingsState> = {
  getItem: async (name) => {
    try {
      const raw = await AsyncStorage.getItem(name);
      if (raw === null) return null;
      return JSON.parse(raw) as StorageValue<SettingsState>;
    } catch {
      return null;
    }
  },
  setItem: (name, value) => AsyncStorage.setItem(name, JSON.stringify(value)),
  removeItem: (name) => AsyncStorage.removeItem(name),
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      unit: 'km',
      theme: 'system',
      setUnit: (unit) => set({ unit }),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'settings',
      version: 0,
      storage: safeStorage,
    },
  ),
);
