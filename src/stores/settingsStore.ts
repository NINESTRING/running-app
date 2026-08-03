import { create } from 'zustand';

interface SettingsState {
  unit: 'km' | 'mi';
  setUnit: (unit: 'km' | 'mi') => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  unit: 'km',
  setUnit: (unit) => set({ unit }),
}));
