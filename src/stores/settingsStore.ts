import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createSafeStorage } from '../lib/persist';

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
      version: 0,
      storage: createSafeStorage<SettingsState>(),
    },
  ),
);
