import { elapsedMs, useRunStore } from '../runStore';

const P1 = { latitude: 0, longitude: 0, timestamp: 1000 };
const P2 = { latitude: 1, longitude: 0, timestamp: 2000 }; // P1에서 약 111,195m

beforeEach(() => {
  useRunStore.getState().reset();
});

describe('runStore', () => {
  it('초기 상태는 idle', () => {
    const s = useRunStore.getState();
    expect(s.status).toBe('idle');
    expect(s.points).toEqual([]);
    expect(s.distanceM).toBe(0);
  });

  it('start로 running 전환 및 초기화', () => {
    useRunStore.getState().start(10_000);
    const s = useRunStore.getState();
    expect(s.status).toBe('running');
    expect(s.startedAt).toBe(10_000);
    expect(s.segmentStartedAt).toBe(10_000);
  });

  it('running 중 addPoint는 좌표 추가 + 거리 누적', () => {
    const store = useRunStore.getState();
    store.start(0);
    store.addPoint(P1);
    store.addPoint(P2);
    const s = useRunStore.getState();
    expect(s.points).toHaveLength(2);
    expect(s.distanceM).toBeGreaterThan(111000);
  });

  it('첫 좌표는 거리를 더하지 않는다', () => {
    const store = useRunStore.getState();
    store.start(0);
    store.addPoint(P1);
    expect(useRunStore.getState().distanceM).toBe(0);
  });

  it('paused 상태에서는 addPoint 무시', () => {
    const store = useRunStore.getState();
    store.start(0);
    store.addPoint(P1);
    store.pause(5000);
    store.addPoint(P2);
    expect(useRunStore.getState().points).toHaveLength(1);
  });

  it('pause/resume이 경과 시간을 올바르게 누적', () => {
    const store = useRunStore.getState();
    store.start(0);
    store.pause(5000); // 5초 달림
    expect(elapsedMs(useRunStore.getState(), 8000)).toBe(5000); // 정지 중엔 안 늘어남
    useRunStore.getState().resume(10_000);
    expect(elapsedMs(useRunStore.getState(), 13_000)).toBe(8000); // 5초 + 3초
  });

  it('idle에서 pause/resume은 무시', () => {
    useRunStore.getState().pause(100);
    expect(useRunStore.getState().status).toBe('idle');
    useRunStore.getState().resume(200);
    expect(useRunStore.getState().status).toBe('idle');
  });

  it('running에서 beginSave는 경과 시간 누적 후 saving 전환, true 반환', () => {
    const store = useRunStore.getState();
    store.start(0);
    expect(useRunStore.getState().beginSave(5000)).toBe(true);
    const s = useRunStore.getState();
    expect(s.status).toBe('saving');
    expect(elapsedMs(s, 9000)).toBe(5000); // saving 중엔 시간이 늘지 않음
  });

  it('paused에서 beginSave는 saving 전환, true 반환', () => {
    const store = useRunStore.getState();
    store.start(0);
    store.pause(5000);
    expect(useRunStore.getState().beginSave(7000)).toBe(true);
    expect(useRunStore.getState().status).toBe('saving');
  });

  it('saving 중 beginSave 재호출은 false 반환 (중복 저장 가드)', () => {
    const store = useRunStore.getState();
    store.start(0);
    store.beginSave(5000);
    expect(useRunStore.getState().beginSave(5100)).toBe(false);
    expect(useRunStore.getState().status).toBe('saving');
  });

  it('idle에서 beginSave는 false 반환', () => {
    expect(useRunStore.getState().beginSave(100)).toBe(false);
    expect(useRunStore.getState().status).toBe('idle');
  });

  it('failSave는 saving에서 paused로 복귀 (기록 유지)', () => {
    const store = useRunStore.getState();
    store.start(0);
    store.addPoint(P1);
    store.beginSave(5000);
    useRunStore.getState().failSave();
    const s = useRunStore.getState();
    expect(s.status).toBe('paused');
    expect(s.points).toHaveLength(1);
    expect(elapsedMs(s, 9000)).toBe(5000);
  });

  it('saving 중 addPoint 무시', () => {
    const store = useRunStore.getState();
    store.start(0);
    store.addPoint(P1);
    store.beginSave(5000);
    useRunStore.getState().addPoint(P2);
    expect(useRunStore.getState().points).toHaveLength(1);
  });

  it('reset은 idle로 되돌림', () => {
    const store = useRunStore.getState();
    store.start(0);
    store.addPoint(P1);
    store.reset();
    const s = useRunStore.getState();
    expect(s.status).toBe('idle');
    expect(s.points).toEqual([]);
    expect(s.distanceM).toBe(0);
    expect(s.startedAt).toBeNull();
  });
});

describe('runStore 케이던스', () => {
  it('beginStepTracking은 steps를 null에서 0으로 초기화', () => {
    const store = useRunStore.getState();
    store.start(0);
    expect(useRunStore.getState().steps).toBeNull();
    useRunStore.getState().beginStepTracking();
    expect(useRunStore.getState().steps).toBe(0);
  });

  it('running 중 addStepReading은 델타를 누적하고 샘플을 push', () => {
    const store = useRunStore.getState();
    store.start(0);
    store.beginStepTracking();
    useRunStore.getState().addStepReading(10, 5000);
    useRunStore.getState().addStepReading(25, 10_000);
    const s = useRunStore.getState();
    expect(s.steps).toBe(25);
    expect(s.stepSamples).toEqual([
      { timestamp: 5000, steps: 10 },
      { timestamp: 10_000, steps: 25 },
    ]);
  });

  it('60초보다 오래된 샘플은 prune', () => {
    const store = useRunStore.getState();
    store.start(0);
    store.beginStepTracking();
    useRunStore.getState().addStepReading(10, 5000);
    useRunStore.getState().addStepReading(200, 70_000);
    expect(useRunStore.getState().stepSamples).toEqual([
      { timestamp: 70_000, steps: 200 },
    ]);
  });

  it('paused 중 걸음은 버리되 lastStepReading은 갱신 (재개 후 소급 가산 방지)', () => {
    const store = useRunStore.getState();
    store.start(0);
    store.beginStepTracking();
    useRunStore.getState().addStepReading(10, 5000);
    useRunStore.getState().pause(6000);
    useRunStore.getState().addStepReading(50, 10_000); // 일시정지 중 40걸음
    expect(useRunStore.getState().steps).toBe(10);
    expect(useRunStore.getState().stepSamples).toEqual([]);
    useRunStore.getState().resume(12_000);
    useRunStore.getState().addStepReading(60, 15_000); // 재개 후 10걸음만 가산
    expect(useRunStore.getState().steps).toBe(20);
  });

  it('누적치가 줄어든 이상 델타는 0으로 클램프', () => {
    const store = useRunStore.getState();
    store.start(0);
    store.beginStepTracking();
    useRunStore.getState().addStepReading(10, 5000);
    useRunStore.getState().addStepReading(3, 10_000);
    expect(useRunStore.getState().steps).toBe(10);
  });

  it('pause는 running 세그먼트를 기록하고 샘플을 비운다', () => {
    const store = useRunStore.getState();
    store.start(1000);
    store.beginStepTracking();
    useRunStore.getState().addStepReading(10, 3000);
    useRunStore.getState().pause(5000);
    const s = useRunStore.getState();
    expect(s.segments).toEqual([{ start: 1000, end: 5000 }]);
    expect(s.stepSamples).toEqual([]);
  });

  it('running에서 beginSave는 마지막 세그먼트까지 기록', () => {
    const store = useRunStore.getState();
    store.start(1000);
    store.pause(5000);
    useRunStore.getState().resume(8000);
    useRunStore.getState().beginSave(12_000);
    expect(useRunStore.getState().segments).toEqual([
      { start: 1000, end: 5000 },
      { start: 8000, end: 12_000 },
    ]);
  });

  it('paused에서 beginSave는 세그먼트를 추가하지 않는다', () => {
    const store = useRunStore.getState();
    store.start(1000);
    store.pause(5000);
    useRunStore.getState().beginSave(7000);
    expect(useRunStore.getState().segments).toEqual([
      { start: 1000, end: 5000 },
    ]);
  });

  it('beginStepTracking 없이 addStepReading이 와도 steps는 null 유지', () => {
    const store = useRunStore.getState();
    store.start(0);
    useRunStore.getState().addStepReading(10, 5000);
    const s = useRunStore.getState();
    expect(s.steps).toBeNull();
    expect(s.lastStepReading).toBe(10);
    expect(s.stepSamples).toEqual([]);
  });

  it('start/reset은 케이던스 상태를 초기화', () => {
    const store = useRunStore.getState();
    store.start(0);
    store.beginStepTracking();
    useRunStore.getState().addStepReading(10, 5000);
    useRunStore.getState().pause(6000);
    useRunStore.getState().start(20_000);
    const s = useRunStore.getState();
    expect(s.steps).toBeNull();
    expect(s.lastStepReading).toBe(0);
    expect(s.stepSamples).toEqual([]);
    expect(s.segments).toEqual([]);
  });
});
