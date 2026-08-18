import { METERS_PER_MILE } from './geo';
import { goalDeltaStatus } from './goal';

const UNIT_NOUN: Record<'km' | 'mi', string> = { km: '킬로미터', mi: '마일' };
const UNIT_PER: Record<'km' | 'mi', string> = { km: '킬로미터당', mi: '마일당' };

function unitMeters(unit: 'km' | 'mi'): number {
  return unit === 'mi' ? METERS_PER_MILE : 1000;
}

/**
 * TTS가 읽을 숫자. 소수점 둘째 자리까지 반올림한 뒤 뒤따르는 0을 떨어뜨린다.
 * 화면용 formatDistance는 "5.20"처럼 0을 남기는데, 음성으로는 "오 점 이 영"이 되어 어색하다.
 */
export function speakNumber(n: number): string {
  return String(Number(n.toFixed(2)));
}

/** 경과 시간. "35분 12초", 1시간을 넘으면 "1시간 5분 12초". 초는 0이어도 읽는다. */
export function speakDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts = h > 0 ? [`${h}시간`] : [];
  parts.push(`${m}분`, `${s}초`);
  return parts.join(' ');
}

/** 평균 페이스. 초가 0이면 읽지 않는다. 측정 불가면 "평균 페이스 측정 중". */
export function speakPace(secPerUnit: number | null, unit: 'km' | 'mi'): string {
  if (secPerUnit === null || !Number.isFinite(secPerUnit)) return '평균 페이스 측정 중';
  let min = Math.floor(secPerUnit / 60);
  let sec = Math.round(secPerUnit % 60);
  // 화면용 formatPace와 같은 올림 처리 — 59.7초가 60초로 읽히지 않게 한다
  if (sec === 60) {
    min += 1;
    sec = 0;
  }
  const per = UNIT_PER[unit];
  return sec === 0
    ? `평균 페이스 ${per} ${min}분`
    : `평균 페이스 ${per} ${min}분 ${sec}초`;
}

/**
 * 목표 페이스 대비 편차 문장. null이면 문장 자체가 없다(목표 미설정·경과 30초 미만).
 * 화면의 GoalDeltaLine과 같은 goalDeltaStatus를 쓰므로 데드밴드 판정이 어긋날 수 없다.
 */
export function speakGoalDelta(deltaM: number | null): string | null {
  if (deltaM === null) return null;
  const status = goalDeltaStatus(deltaM);
  if (status === 'onPace') return '목표 페이스를 유지하고 있습니다';
  const m = Math.round(Math.abs(deltaM));
  return status === 'ahead'
    ? `목표보다 ${m}미터 앞서고 있습니다`
    : `목표보다 ${m}미터 뒤쳐져 있습니다`;
}

/** 안내 한 건의 전체 발화문. 트리거가 거리든 시간이든 형태는 같다. */
export function voiceCueText(p: {
  elapsedMs: number;
  distanceM: number;
  unit: 'km' | 'mi';
  paceSecPerUnit: number | null;
  goalDeltaM: number | null;
}): string {
  const sentences = [
    `${speakDuration(p.elapsedMs)} 경과`,
    `${speakNumber(p.distanceM / unitMeters(p.unit))}${UNIT_NOUN[p.unit]}`,
    speakPace(p.paceSecPerUnit, p.unit),
  ];
  const delta = speakGoalDelta(p.goalDeltaM);
  if (delta !== null) sentences.push(delta);
  return `${sentences.join('. ')}.`;
}

// 한글 수사 0~10. TTS가 "3"을 읽는 방식에 기대지 않고 직접 적는다.
const SINO_NUMBERS = ['영', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구', '십'];

/**
 * 시작 카운트다운 한 틱의 발화. `0`은 러닝이 시작되는 순간이라 "시작"으로 읽는다.
 * COUNTDOWN_START를 늘려도 10까지는 동작하고, 그 밖은 null(무음)이다.
 */
export function countdownCueText(tick: number): string | null {
  if (tick === 0) return '시작';
  if (!Number.isInteger(tick) || tick < 0) return null;
  return SINO_NUMBERS[tick] ?? null;
}

// 목적격 조사는 받침 유무를 따른다 — "킬로미터를", "마일을"
const UNIT_OBJECT: Record<'km' | 'mi', string> = { km: '를', mi: '을' };

/**
 * 러닝 저장 성공 후 읽는 총정리.
 *
 * 목표 **거리**가 설정되어 있을 때만 마지막 문장이 붙는다. 달리는 동안에는
 * 목표 페이스가 관심사지만, 끝나고 나서는 목표 거리를 채웠는지가 관심사다.
 */
export function voiceSummaryText(p: {
  elapsedMs: number;
  distanceM: number;
  unit: 'km' | 'mi';
  paceSecPerUnit: number | null;
  goalDistanceUnits: number | null;
}): string {
  const unitM = unitMeters(p.unit);
  const noun = UNIT_NOUN[p.unit];
  const sentences = [
    '수고하셨습니다',
    `총 ${speakDuration(p.elapsedMs)}, ${speakNumber(p.distanceM / unitM)}${noun}`,
    speakPace(p.paceSecPerUnit, p.unit),
  ];

  if (p.goalDistanceUnits !== null) {
    const goalM = p.goalDistanceUnits * unitM;
    const goalNoun = `${speakNumber(p.goalDistanceUnits)}${noun}`;
    sentences.push(
      p.distanceM >= goalM
        ? `목표 ${goalNoun}${UNIT_OBJECT[p.unit]} 달성했습니다`
        : `목표 ${goalNoun}에 ${Math.round(goalM - p.distanceM)}미터 못 미쳤습니다`,
    );
  }

  return `${sentences.join('. ')}.`;
}

/** 음성 안내가 켜져 있는가. 두 축 중 하나라도 켜져 있으면 켜진 것이다. */
export function isVoiceGuideOn(
  distanceUnits: number | null,
  timeMin: number | null,
): boolean {
  return distanceUnits !== null || timeMin !== null;
}

/**
 * 안내 트리거 판정 상태. 마일스톤 "번호"가 아니라 마지막으로 판정한 원값을 들고 있다 —
 * 러닝 중 간격 설정을 바꿔도 번호의 의미가 달라지지 않아야 하기 때문이다.
 */
export interface VoiceCueState {
  lastDistanceM: number;
  lastElapsedMs: number;
}

export const INITIAL_VOICE_CUE_STATE: VoiceCueState = {
  lastDistanceM: 0,
  lastElapsedMs: 0,
};

export type VoiceCue = 'distance' | 'time' | null;

/**
 * 이번 틱에 안내를 내보낼지 판정한다.
 *
 * 반환 state는 cue 여부와 무관하게 **항상 현재 값으로 갱신**된다. 이 규칙 하나가
 * 세 가지를 동시에 처리한다:
 * - 거리·시간이 같은 틱에 걸려도 발화는 한 번 (시간 축 기준점도 함께 밀린다)
 * - 백그라운드에서 마일스톤 여러 개가 지나가도 밀린 안내를 몰아 읽지 않는다
 * - 러닝 중 축을 껐다 켜거나 간격을 바꿔도 다음 마일스톤부터 울린다
 */
export function nextVoiceCue(p: {
  distanceM: number;
  elapsedMs: number;
  unit: 'km' | 'mi';
  distanceUnits: number | null; // null = 거리 안내 끔
  timeMin: number | null; // null = 시간 안내 끔
  state: VoiceCueState;
}): { state: VoiceCueState; cue: VoiceCue } {
  const state: VoiceCueState = {
    lastDistanceM: p.distanceM,
    lastElapsedMs: p.elapsedMs,
  };

  if (p.distanceUnits !== null) {
    const step = p.distanceUnits * unitMeters(p.unit);
    if (Math.floor(p.distanceM / step) > Math.floor(p.state.lastDistanceM / step)) {
      return { state, cue: 'distance' };
    }
  }

  if (p.timeMin !== null) {
    const step = p.timeMin * 60_000;
    if (Math.floor(p.elapsedMs / step) > Math.floor(p.state.lastElapsedMs / step)) {
      return { state, cue: 'time' };
    }
  }

  return { state, cue: null };
}
