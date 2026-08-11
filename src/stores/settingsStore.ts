import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ThemePreference = 'system' | 'light' | 'dark';

interface SettingsState {
  unit: 'km' | 'mi';
  theme: ThemePreference;
  setUnit: (unit: 'km' | 'mi') => void;
  setTheme: (theme: ThemePreference) => void;
}

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
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
