import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createSafeStorage } from '../lib/persist';

export type ThemePreference = 'system' | 'light' | 'dark';

// 음성 안내 주기. 거리 값은 goalStore와 같은 규칙 —
// 현재 단위(km/mi) 기준 수치이며, 단위를 바꿔도 숫자는 변환하지 않는다.
export type VoiceDistanceUnits = 0.5 | 1 | 2;
export type VoiceTimeMin = 1 | 2 | 5;

interface SettingsState {
  unit: 'km' | 'mi';
  theme: ThemePreference;
  voiceDistanceUnits: VoiceDistanceUnits | null; // null = 끔
  voiceTimeMin: VoiceTimeMin | null; // null = 끔
  setUnit: (unit: 'km' | 'mi') => void;
  setTheme: (theme: ThemePreference) => void;
  setVoiceDistanceUnits: (v: VoiceDistanceUnits | null) => void;
  setVoiceTimeMin: (v: VoiceTimeMin | null) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      unit: 'km',
      theme: 'system',
      voiceDistanceUnits: null,
      voiceTimeMin: null,
      setUnit: (unit) => set({ unit }),
      setTheme: (theme) => set({ theme }),
      setVoiceDistanceUnits: (voiceDistanceUnits) => set({ voiceDistanceUnits }),
      setVoiceTimeMin: (voiceTimeMin) => set({ voiceTimeMin }),
    }),
    {
      // 기존 저장본에는 voice* 키가 없다. persist가 초기 상태 위에 얕은 병합을 하므로
      // 두 필드는 null(끔)로 복원된다 — 버전 올림·마이그레이션 불필요.
      name: 'settings',
      version: 0,
      storage: createSafeStorage<SettingsState>(),
    },
  ),
);
