import { create } from 'zustand';
import { haversineM } from '../lib/geo';
import type { RoutePoint } from '../types/run';

export type RunStatus = 'idle' | 'running' | 'paused' | 'saving';

export interface RunState {
  status: RunStatus;
  points: RoutePoint[];
  distanceM: number;
  startedAt: number | null;
  accumulatedMs: number;
  segmentStartedAt: number | null;
  start: (now: number) => void;
  pause: (now: number) => void;
  resume: (now: number) => void;
  addPoint: (p: RoutePoint) => void;
  beginSave: (now: number) => boolean;
  failSave: () => void;
  reset: () => void;
}

const initial = {
  status: 'idle' as RunStatus,
  points: [] as RoutePoint[],
  distanceM: 0,
  startedAt: null as number | null,
  accumulatedMs: 0,
  segmentStartedAt: null as number | null,
};

export const useRunStore = create<RunState>((set, get) => ({
  ...initial,

  start: (now) =>
    set({ ...initial, status: 'running', startedAt: now, segmentStartedAt: now }),

  pause: (now) => {
    const { status, segmentStartedAt, accumulatedMs } = get();
    if (status !== 'running' || segmentStartedAt === null) return;
    set({
      status: 'paused',
      accumulatedMs: accumulatedMs + (now - segmentStartedAt),
      segmentStartedAt: null,
    });
  },

  resume: (now) => {
    if (get().status !== 'paused') return;
    set({ status: 'running', segmentStartedAt: now });
  },

  addPoint: (p) => {
    const { status, points, distanceM } = get();
    if (status !== 'running') return;
    const last = points[points.length - 1];
    const added = last ? haversineM(last, p) : 0;
    set({ points: [...points, p], distanceM: distanceM + added });
  },

  // 저장이 진행되는 동안 재진입(종료 버튼 중복 탭)을 막는 단방향 게이트.
  beginSave: (now) => {
    const { status, segmentStartedAt, accumulatedMs } = get();
    if (status === 'running' && segmentStartedAt !== null) {
      set({
        status: 'saving',
        accumulatedMs: accumulatedMs + (now - segmentStartedAt),
        segmentStartedAt: null,
      });
      return true;
    }
    if (status === 'paused') {
      set({ status: 'saving' });
      return true;
    }
    return false;
  },

  failSave: () => {
    if (get().status !== 'saving') return;
    set({ status: 'paused' });
  },

  reset: () => set({ ...initial }),
}));

export function elapsedMs(
  state: Pick<RunState, 'accumulatedMs' | 'segmentStartedAt'>,
  now: number
): number {
  return (
    state.accumulatedMs +
    (state.segmentStartedAt !== null ? now - state.segmentStartedAt : 0)
  );
}
