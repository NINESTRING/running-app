import { create } from 'zustand';
import type { StepSample } from '../lib/cadence';
import { haversineM } from '../lib/geo';
import type { RoutePoint } from '../types/run';

export type RunStatus = 'idle' | 'running' | 'paused' | 'saving';

export interface RunSegment {
  start: number; // epoch ms
  end: number; // epoch ms
}

export interface RunState {
  status: RunStatus;
  points: RoutePoint[];
  distanceM: number;
  startedAt: number | null;
  accumulatedMs: number;
  segmentStartedAt: number | null;
  steps: number | null; // 일시정지 제외 누적 걸음. null = 측정 안 됨
  lastStepReading: number; // pedometer 구독 누적치의 마지막 값 (델타 계산용)
  stepSamples: StepSample[]; // 최근 60초 — 라이브 SPM용
  segments: RunSegment[]; // 완료된 러닝 세그먼트 — iOS 백필용
  weatherCode: number | null; // WMO weather code. null = 아직 조회 전·실패
  temperatureC: number | null; // °C
  start: (now: number) => void;
  pause: (now: number) => void;
  resume: (now: number) => void;
  addPoint: (p: RoutePoint) => void;
  beginStepTracking: () => void;
  addStepReading: (cumulative: number, now: number) => void;
  setWeather: (startedAt: number, weatherCode: number, temperatureC: number) => void;
  beginSave: (now: number) => boolean;
  failSave: () => void;
  reset: () => void;
}

const SAMPLE_RETENTION_MS = 60_000;

const initial = {
  status: 'idle' as RunStatus,
  points: [] as RoutePoint[],
  distanceM: 0,
  startedAt: null as number | null,
  accumulatedMs: 0,
  segmentStartedAt: null as number | null,
  steps: null as number | null,
  lastStepReading: 0,
  stepSamples: [] as StepSample[],
  segments: [] as RunSegment[],
  weatherCode: null as number | null,
  temperatureC: null as number | null,
};

export const useRunStore = create<RunState>((set, get) => ({
  ...initial,

  start: (now) =>
    set({ ...initial, status: 'running', startedAt: now, segmentStartedAt: now }),

  pause: (now) => {
    const { status, segmentStartedAt, accumulatedMs, segments } = get();
    if (status !== 'running' || segmentStartedAt === null) return;
    set({
      status: 'paused',
      accumulatedMs: accumulatedMs + (now - segmentStartedAt),
      segmentStartedAt: null,
      segments: [...segments, { start: segmentStartedAt, end: now }],
      stepSamples: [],
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

  beginStepTracking: () => set({ steps: 0, lastStepReading: 0 }),

  addStepReading: (cumulative, now) => {
    const { status, steps, lastStepReading, stepSamples } = get();
    const delta = Math.max(0, cumulative - lastStepReading);
    // 일시정지·저장 중 걸음은 버리되, 누적치 기준점은 갱신해 소급 가산을 막는다.
    // steps가 null이면 beginStepTracking() 이전(또는 잔존 구독)이므로 non-running과 동일하게 처리 —
    // null→0 전환은 오직 beginStepTracking()만 할 수 있다.
    if (status !== 'running' || steps === null) {
      set({ lastStepReading: cumulative });
      return;
    }
    const nextSteps = (steps ?? 0) + delta;
    const nextSamples = [
      ...stepSamples,
      { timestamp: now, steps: nextSteps },
    ].filter((s) => s.timestamp >= now - SAMPLE_RETENTION_MS);
    set({
      steps: nextSteps,
      lastStepReading: cumulative,
      stepSamples: nextSamples,
    });
  },

  // 조회를 시작한 러닝(startedAt)이 여전히 현재 러닝일 때만 반영 —
  // 늦게 도착한 응답이 reset 후 상태나 다음 러닝을 오염시키지 않는다.
  setWeather: (startedAt, weatherCode, temperatureC) => {
    if (get().startedAt !== startedAt) return;
    set({ weatherCode, temperatureC });
  },

  // 저장이 진행되는 동안 재진입(종료 버튼 중복 탭)을 막는 단방향 게이트.
  beginSave: (now) => {
    const { status, segmentStartedAt, accumulatedMs, segments } = get();
    if (status === 'running' && segmentStartedAt !== null) {
      set({
        status: 'saving',
        accumulatedMs: accumulatedMs + (now - segmentStartedAt),
        segmentStartedAt: null,
        segments: [...segments, { start: segmentStartedAt, end: now }],
        stepSamples: [],
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
