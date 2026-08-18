import { Platform } from 'react-native';

// jest.mock 팩토리는 스코프 밖 변수를 참조할 수 없지만 `mock` 접두사는 예외다.
// 아래 테스트는 jest.resetModules()로 speech.ts를 매번 새로 불러오는데,
// 목 함수 인스턴스는 모듈 리셋과 무관하게 유지되어야 호출 횟수를 셀 수 있다.
const mockSpeak = jest.fn();
const mockStop = jest.fn();
const mockSetAudioMode = jest.fn();

jest.mock('expo-speech', () => ({
  speak: (...args: unknown[]) => mockSpeak(...args),
  stop: (...args: unknown[]) => mockStop(...args),
}));

jest.mock('expo-audio', () => ({
  setAudioModeAsync: (...args: unknown[]) => mockSetAudioMode(...args),
}));

let speech: typeof import('../speech');
let settings: typeof import('../../stores/settingsStore');

beforeEach(() => {
  jest.resetModules();
  // clearAllMocks가 아니라 resetAllMocks — 앞선 테스트가 심어둔 throw 구현이
  // 다음 테스트로 새지 않아야 한다(clearAllMocks는 호출 기록만 지운다).
  jest.resetAllMocks();
  mockSetAudioMode.mockResolvedValue(undefined);
  Platform.OS = 'ios';
  // 두 모듈을 같은 resetModules 뒤에 require 해야 speech.ts가 보는 스토어와
  // 테스트가 조작하는 스토어가 같은 인스턴스가 된다.
  speech = require('../speech');
  settings = require('../../stores/settingsStore');
});

describe('speakCue', () => {
  it('넘긴 문장을 ko-KR로 발화한다', () => {
    speech.speakCue('5킬로미터');

    expect(mockSpeak).toHaveBeenCalledTimes(1);
    expect(mockSpeak.mock.calls[0][0]).toBe('5킬로미터');
    expect(mockSpeak.mock.calls[0][1]).toMatchObject({ language: 'ko-KR' });
  });

  it('발화 전에 stop을 불러 밀린 안내를 버린다', () => {
    speech.speakCue('5킬로미터');

    expect(mockStop).toHaveBeenCalled();
    expect(mockStop.mock.invocationCallOrder[0]).toBeLessThan(
      mockSpeak.mock.invocationCallOrder[0],
    );
  });

  it('speak가 throw해도 밖으로 던지지 않는다', () => {
    mockSpeak.mockImplementation(() => {
      throw new Error('TTS 엔진 없음');
    });

    expect(() => speech.speakCue('5킬로미터')).not.toThrow();
  });

  it('web에서는 아무것도 하지 않는다', () => {
    Platform.OS = 'web';

    speech.speakCue('5킬로미터');

    expect(mockSpeak).not.toHaveBeenCalled();
  });
});

describe('speakIfVoiceGuideOn', () => {
  it('두 축 모두 끔이면 발화하지 않는다', () => {
    settings.useSettingsStore.setState({ voiceDistanceUnits: null, voiceTimeMin: null });

    speech.speakIfVoiceGuideOn('시작');

    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it('한 축이라도 켜져 있으면 발화한다', () => {
    settings.useSettingsStore.setState({ voiceDistanceUnits: null, voiceTimeMin: 1 });

    speech.speakIfVoiceGuideOn('시작');

    expect(mockSpeak).toHaveBeenCalledTimes(1);
    expect(mockSpeak.mock.calls[0][0]).toBe('시작');
  });

  it('null이면 아무것도 하지 않는다', () => {
    settings.useSettingsStore.setState({ voiceDistanceUnits: 1, voiceTimeMin: 1 });

    speech.speakIfVoiceGuideOn(null);

    expect(mockSpeak).not.toHaveBeenCalled();
  });
});

describe('stopSpeaking', () => {
  it('stop을 부른다', () => {
    speech.stopSpeaking();

    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('stop이 throw해도 밖으로 던지지 않는다', () => {
    mockStop.mockImplementation(() => {
      throw new Error('중지 실패');
    });

    expect(() => speech.stopSpeaking()).not.toThrow();
  });
});

describe('configureVoiceAudio', () => {
  it('백그라운드 재생·더킹·무음 모드 재생을 켠다', async () => {
    await speech.configureVoiceAudio();

    expect(mockSetAudioMode).toHaveBeenCalledWith({
      shouldPlayInBackground: true,
      interruptionMode: 'duckOthers',
      playsInSilentMode: true,
    });
  });

  it('두 번 불러도 오디오 모드는 한 번만 설정한다', async () => {
    await speech.configureVoiceAudio();
    await speech.configureVoiceAudio();

    expect(mockSetAudioMode).toHaveBeenCalledTimes(1);
  });

  it('실패하면 다음 호출에서 다시 시도한다', async () => {
    mockSetAudioMode.mockRejectedValueOnce(new Error('세션 획득 실패'));

    await expect(speech.configureVoiceAudio()).resolves.toBeUndefined();
    await speech.configureVoiceAudio();

    expect(mockSetAudioMode).toHaveBeenCalledTimes(2);
  });

  it('web에서는 아무것도 하지 않는다', async () => {
    Platform.OS = 'web';

    await speech.configureVoiceAudio();

    expect(mockSetAudioMode).not.toHaveBeenCalled();
  });
});
