import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createSafeStorage } from '../lib/persist';

// 러닝 목표. DB에 올리지 않고 폰 로컬에만 저장한다.
// 값은 현재 단위(km/mi) 기준 — 단위를 바꿔도 숫자는 변환하지 않는다.
interface GoalState {
  paceSecPerUnit: number | null; // 목표 페이스(초/단위). null = 미설정
  distanceUnits: number | null; // 목표 거리(단위 수치, 예: 5 = 5km). null = 미설정
  setPace: (v: number | null) => void;
  setDistance: (v: number | null) => void;
}

export const useGoalStore = create<GoalState>()(
  persist(
    (set) => ({
      paceSecPerUnit: null,
      distanceUnits: null,
      setPace: (paceSecPerUnit) => set({ paceSecPerUnit }),
      setDistance: (distanceUnits) => set({ distanceUnits }),
    }),
    {
      name: 'goal',
      version: 0,
      storage: createSafeStorage<GoalState>(),
    },
  ),
);
