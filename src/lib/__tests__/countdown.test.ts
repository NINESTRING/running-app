import {
  COUNTDOWN_EXIT_MS,
  COUNTDOWN_START,
  COUNTDOWN_TICK_MS,
  isCancellable,
  nextCountdown,
} from '../countdown';

describe('상수', () => {
  test('스펙에 고정된 타이밍 값', () => {
    expect(COUNTDOWN_START).toBe(3);
    expect(COUNTDOWN_TICK_MS).toBe(1000);
    expect(COUNTDOWN_EXIT_MS).toBe(500);
  });
});

describe('nextCountdown', () => {
  test('3 → 2', () => {
    expect(nextCountdown(3)).toBe(2);
  });

  test('2 → 1', () => {
    expect(nextCountdown(2)).toBe(1);
  });

  test('1 → 0(= 시작!, 러닝 시작 시점)', () => {
    expect(nextCountdown(1)).toBe(0);
  });

  test('시작 값부터 0까지 COUNTDOWN_START번 만에 도달한다', () => {
    let tick = COUNTDOWN_START;
    let steps = 0;
    while (tick > 0) {
      tick = nextCountdown(tick);
      steps += 1;
    }
    expect(steps).toBe(COUNTDOWN_START);
    expect(tick).toBe(0);
  });
});

describe('isCancellable', () => {
  test('숫자 구간(3·2·1)은 취소 가능', () => {
    expect(isCancellable(3)).toBe(true);
    expect(isCancellable(2)).toBe(true);
    expect(isCancellable(1)).toBe(true);
  });

  test('0("시작!")은 취소 불가 — 러닝이 이미 시작됐다', () => {
    expect(isCancellable(0)).toBe(false);
  });

  test('null(카운트다운 중 아님)은 취소 불가', () => {
    expect(isCancellable(null)).toBe(false);
  });
});
