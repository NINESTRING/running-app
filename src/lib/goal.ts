import { formatPace, METERS_PER_MILE } from './geo';

export const PACE_STEP_SEC = 15;
export const PACE_MIN_SEC = 180; // 3'00"
export const PACE_MAX_SEC = 600; // 10'00"
export const DEFAULT_PACE_SEC = 360; // 6'00"

export const DISTANCE_STEP_UNITS = 0.5;
export const DISTANCE_MIN_UNITS = 0.5;
export const DISTANCE_MAX_UNITS = 50;
export const DEFAULT_DISTANCE_UNITS = 5;

// GPS 워밍업 요동을 피하기 위한 표시 유예
const MIN_ELAPSED_MS = 30_000;
// 색상 깜빡임을 막는 데드밴드
const DEADBAND_M = 10;

export type GoalDeltaStatus = 'ahead' | 'behind' | 'onPace';

/** 목표 페이스 대비 편차(m). 양수 = 앞섬, 음수 = 뒤쳐짐. 경과 30초 미만이면 null */
export function goalDeltaM(params: {
  distanceM: number;
  elapsedMs: number; // 일시정지 제외 경과 시간
  paceSecPerUnit: number;
  unit: 'km' | 'mi';
}): number | null {
  if (params.elapsedMs < MIN_ELAPSED_MS) return null;
  const unitM = params.unit === 'mi' ? METERS_PER_MILE : 1000;
  const expectedM = (params.elapsedMs / 1000 / params.paceSecPerUnit) * unitM;
  return params.distanceM - expectedM;
}

export function goalDeltaStatus(deltaM: number): GoalDeltaStatus {
  if (deltaM > DEADBAND_M) return 'ahead';
  if (deltaM < -DEADBAND_M) return 'behind';
  return 'onPace';
}

export function clampPaceSec(sec: number): number {
  return Math.min(PACE_MAX_SEC, Math.max(PACE_MIN_SEC, sec));
}

export function clampDistanceUnits(units: number): number {
  return Math.min(DISTANCE_MAX_UNITS, Math.max(DISTANCE_MIN_UNITS, units));
}

/** idle 카드용 목표 요약. 예: 5'30"/km · 5.00km */
export function goalSummary(
  paceSecPerUnit: number | null,
  distanceUnits: number | null,
  unit: 'km' | 'mi',
): string {
  const parts: string[] = [];
  if (paceSecPerUnit !== null) parts.push(`${formatPace(paceSecPerUnit)}/${unit}`);
  if (distanceUnits !== null) parts.push(`${distanceUnits.toFixed(2)}${unit}`);
  return parts.length > 0 ? parts.join(' · ') : '목표 없음';
}
