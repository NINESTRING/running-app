import { Platform } from 'react-native';
import { setAudioModeAsync } from 'expo-audio';
import * as Speech from 'expo-speech';
import { isVoiceGuideOn } from '../lib/voice';
import { useSettingsStore } from '../stores/settingsStore';

const LANGUAGE = 'ko-KR';

// 오디오 세션은 한 번만 잡으면 된다. 실패하면 false로 남아 다음 호출에서 재시도한다.
let audioConfigured = false;

/**
 * 음성 안내용 오디오 세션을 설정한다.
 *
 * 앱 부팅이 아니라 러닝 시작 시점에 부른다 — 뛰지도 않는 동안 세션을 잡아두면
 * 다른 앱의 음악 재생에 간섭한다.
 */
export async function configureVoiceAudio(): Promise<void> {
  if (Platform.OS === 'web' || audioConfigured) return;
  try {
    await setAudioModeAsync({
      shouldPlayInBackground: true, // 화면이 꺼져 있어도 안내가 나온다
      interruptionMode: 'duckOthers', // 안내 동안만 음악 볼륨이 낮아진다
      playsInSilentMode: true, // iOS 무음 스위치와 무관하게 들린다
    });
    audioConfigured = true;
  } catch (e) {
    // 세션을 못 잡아도 발화 자체는 시도한다 — 러닝을 막을 이유가 없다
    console.warn('[speech] 오디오 모드 설정 실패', e);
  }
}

/**
 * 안내 한 건을 발화한다.
 *
 * Speech.speak()는 발화 중에 부르면 큐에 쌓인다. 안내가 밀리면 3분 전 거리를
 * 읽게 되므로, 발화 전에 stop()으로 오래된 안내를 버리고 최신 것만 말한다.
 */
export function speakCue(text: string): void {
  if (Platform.OS === 'web') return;
  try {
    Speech.stop();
    Speech.speak(text, {
      language: LANGUAGE,
      // iOS: expo-audio가 설정한 세션을 쓰게 한다.
      // 그러지 않으면 더킹·백그라운드 설정이 발화에 적용되지 않는다.
      useApplicationAudioSession: true,
    });
  } catch (e) {
    console.warn('[speech] 발화 실패', e);
  }
}

/**
 * 음성 안내가 켜져 있을 때만 발화한다. 카운트다운·총정리가 쓴다 —
 * 이 둘은 트리거 판정을 거치지 않으므로 켜짐 여부를 직접 확인해야 한다.
 * (주기 안내는 축이 켜져 있어야 트리거되므로 speakCue를 직접 쓴다.)
 */
export function speakIfVoiceGuideOn(text: string | null): void {
  if (text === null) return;
  const { voiceDistanceUnits, voiceTimeMin } = useSettingsStore.getState();
  if (!isVoiceGuideOn(voiceDistanceUnits, voiceTimeMin)) return;
  speakCue(text);
}

/** 진행 중인 발화를 중단한다. 러닝 종료·버리기·카운트다운 취소 시 부른다. */
export function stopSpeaking(): void {
  if (Platform.OS === 'web') return;
  try {
    Speech.stop();
  } catch (e) {
    console.warn('[speech] 발화 중지 실패', e);
  }
}
