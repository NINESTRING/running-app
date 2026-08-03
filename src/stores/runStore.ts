import { create } from 'zustand';
import { haversineM } from '../lib/geo';
import type { RoutePoint } from '../types/run';

export type RunStatus = 'idle' | 'running' | 'paused';

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
