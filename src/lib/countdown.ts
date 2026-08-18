/** 카운트다운 시작 숫자 */
export const COUNTDOWN_START = 3;
/** 숫자 하나가 머무는 시간 */
export const COUNTDOWN_TICK_MS = 1000;
/** tick 0("시작!")부터 오버레이가 사라지기까지 — 이 구간에서 러닝은 이미 진행 중이다 */
export const COUNTDOWN_EXIT_MS = 500;

/** 다음 틱 값. 3→2→1→0("시작!")로 내려간다. */
export function nextCountdown(tick: number): number {
  return tick - 1;
}

/**
 * 취소 가능 구간인지. 숫자 구간(3·2·1)만 참이다.
 * 0은 "시작!" — 러닝이 이미 시작됐으므로 취소하면 안 된다. null은 카운트다운 중이 아니다.
 */
export function isCancellable(tick: number | null): boolean {
  return tick !== null && tick > 0;
}
