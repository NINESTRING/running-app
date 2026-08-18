import { useEffect, useRef } from 'react';

import { paceSecPerUnit } from '@/lib/geo';
import { goalDeltaM } from '@/lib/goal';
import {
  INITIAL_VOICE_CUE_STATE,
  isVoiceGuideOn,
  nextVoiceCue,
  voiceCueText,
  type VoiceCueState,
} from '@/lib/voice';
import { configureVoiceAudio, speakCue } from '@/services/speech';
import { useGoalStore } from '@/stores/goalStore';
import type { RunStatus } from '@/stores/runStore';
import { useSettingsStore } from '@/stores/settingsStore';

/**
 * 설정한 거리·시간 주기마다 진행 상황을 발화한다.
 *
 * 러닝 화면이 이미 1초 간격으로 리렌더되므로 별도 타이머를 두지 않고 그 틱에 얹는다.
 * 판정 상태는 화면에 반영될 이유가 없어 useRef에 둔다 — state로 두면 매초 리렌더가 한 번 더 돈다.
 */
export function useVoiceCues(p: {
  status: RunStatus;
  startedAt: number | null;
  distanceM: number;
  elapsedMs: number;
}): void {
  const { status, startedAt, distanceM, elapsedMs } = p;
  const unit = useSettingsStore((s) => s.unit);
  const distanceUnits = useSettingsStore((s) => s.voiceDistanceUnits);
  const timeMin = useSettingsStore((s) => s.voiceTimeMin);
  const goalPaceSec = useGoalStore((s) => s.paceSecPerUnit);

  const cueStateRef = useRef<VoiceCueState>(INITIAL_VOICE_CUE_STATE);
  // 새 러닝을 알아보는 유일한 신호 — runStore.start()가 startedAt을 새로 세운다
  const runIdRef = useRef<number | null>(null);

  // 러닝 도중에 설정에서 음성 안내를 처음 켜는 경우를 위한 보강.
  // 평소에는 onStart()가 이미 세션을 잡아둔 뒤라 멱등 호출로 끝난다.
  // idle에서는 부르지 않는다 — 안 뛰는 동안 세션을 잡으면 다른 앱 음악에 간섭한다.
  useEffect(() => {
    if (status !== 'running' || !isVoiceGuideOn(distanceUnits, timeMin)) return;
    void configureVoiceAudio();
  }, [status, distanceUnits, timeMin]);

  useEffect(() => {
    if (startedAt !== runIdRef.current) {
      runIdRef.current = startedAt;
      cueStateRef.current = INITIAL_VOICE_CUE_STATE;
    }
    // 일시정지 중에는 두 값이 얼어 있어 어차피 마일스톤이 오르지 않지만,
    // 명시적으로 막아 saving 구간까지 함께 조용해진다.
    if (status !== 'running') return;

    const { state, cue } = nextVoiceCue({
      distanceM,
      elapsedMs,
      unit,
      distanceUnits,
      timeMin,
      state: cueStateRef.current,
    });
    cueStateRef.current = state;
    if (cue === null) return;

    speakCue(
      voiceCueText({
        elapsedMs,
        distanceM,
        unit,
        paceSecPerUnit: paceSecPerUnit(distanceM, elapsedMs, unit),
        // 화면의 GoalDeltaLine과 같은 계산 — 눈으로 본 값과 귀로 들은 값이 어긋날 수 없다
        goalDeltaM:
          goalPaceSec === null
            ? null
            : goalDeltaM({ distanceM, elapsedMs, paceSecPerUnit: goalPaceSec, unit }),
      }),
    );
  }, [status, startedAt, distanceM, elapsedMs, unit, distanceUnits, timeMin, goalPaceSec]);
}
