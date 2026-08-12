/** 러닝 중 수집한 걸음 샘플. steps는 일시정지 제외 누적 걸음. */
export interface StepSample {
  timestamp: number; // epoch ms
  steps: number;
}

const WINDOW_MS = 30_000;
const MIN_SPAN_MS = 5_000;

/** 최근 30초 샘플 윈도우에서 실시간 SPM을 파생한다. 데이터 부족 시 null. */
export function cadenceSpm(samples: StepSample[], now: number): number | null {
  const windowed = samples.filter((s) => s.timestamp >= now - WINDOW_MS);
  if (windowed.length < 2) return null;
  const first = windowed[0];
  const last = windowed[windowed.length - 1];
  const spanMs = last.timestamp - first.timestamp;
  if (spanMs < MIN_SPAN_MS) return null;
  return (last.steps - first.steps) / (spanMs / 60_000);
}

/** 저장된 기록의 평균 SPM. steps가 null(측정 안 됨)이거나 시간이 0이면 null. */
export function avgCadenceSpm(
  steps: number | null,
  durationSec: number
): number | null {
  if (steps === null || durationSec <= 0) return null;
  return steps / (durationSec / 60);
}

export function formatCadence(spm: number | null): string {
  return spm === null ? '--' : String(Math.round(spm));
}
