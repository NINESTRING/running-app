import { METERS_PER_MILE } from '../geo';
import {
  countdownCueText,
  isVoiceGuideOn,
  speakDuration,
  speakGoalDelta,
  speakNumber,
  speakPace,
  voiceCueText,
  voiceSummaryText,
} from '../voice';

describe('speakNumber', () => {
  test('소수점 뒤 0을 떨어뜨린다', () => {
    expect(speakNumber(5.2)).toBe('5.2');
    expect(speakNumber(5)).toBe('5');
    expect(speakNumber(0)).toBe('0');
  });

  test('소수점 셋째 자리에서 반올림한다', () => {
    expect(speakNumber(5.199)).toBe('5.2');
    // 12.345처럼 정확히 반올림 경계에 놓인 값은 부동소수점 표현 때문에
    // toFixed 결과가 직관과 어긋난다. 경계를 피한 값으로 검증한다.
    expect(speakNumber(12.344)).toBe('12.34');
    expect(speakNumber(12.346)).toBe('12.35');
  });
});

describe('speakDuration', () => {
  test('1시간 미만은 분·초만 읽는다', () => {
    expect(speakDuration(35 * 60_000 + 12_000)).toBe('35분 12초');
  });

  test('초가 0이어도 생략하지 않는다', () => {
    expect(speakDuration(60_000)).toBe('1분 0초');
  });

  test('1시간을 넘으면 시간이 붙는다', () => {
    expect(speakDuration(3600_000 + 5 * 60_000 + 12_000)).toBe('1시간 5분 12초');
  });

  test('밀리초는 버린다', () => {
    expect(speakDuration(60_999)).toBe('1분 0초');
  });
});

describe('speakPace', () => {
  test('km 단위', () => {
    expect(speakPace(405, 'km')).toBe('평균 페이스 킬로미터당 6분 45초');
  });

  test('mi 단위', () => {
    expect(speakPace(652, 'mi')).toBe('평균 페이스 마일당 10분 52초');
  });

  test('초가 0이면 초를 읽지 않는다', () => {
    expect(speakPace(360, 'km')).toBe('평균 페이스 킬로미터당 6분');
  });

  test('반올림으로 초가 60이 되면 분을 올린다', () => {
    expect(speakPace(359.7, 'km')).toBe('평균 페이스 킬로미터당 6분');
  });

  test('null이면 측정 중', () => {
    expect(speakPace(null, 'km')).toBe('평균 페이스 측정 중');
  });

  test('Infinity도 측정 중으로 처리한다', () => {
    expect(speakPace(Infinity, 'km')).toBe('평균 페이스 측정 중');
  });
});

describe('speakGoalDelta', () => {
  test('앞섬', () => {
    expect(speakGoalDelta(120)).toBe('목표보다 120미터 앞서고 있습니다');
  });

  test('뒤쳐짐은 절댓값으로 읽는다', () => {
    expect(speakGoalDelta(-80)).toBe('목표보다 80미터 뒤쳐져 있습니다');
  });

  test('데드밴드(±10m) 안이면 유지', () => {
    expect(speakGoalDelta(5)).toBe('목표 페이스를 유지하고 있습니다');
    expect(speakGoalDelta(-10)).toBe('목표 페이스를 유지하고 있습니다');
  });

  test('null이면 문장이 없다', () => {
    expect(speakGoalDelta(null)).toBeNull();
  });
});

describe('voiceCueText', () => {
  test('목표 편차가 있으면 네 문장', () => {
    expect(
      voiceCueText({
        elapsedMs: 35 * 60_000 + 12_000,
        distanceM: 5200,
        unit: 'km',
        paceSecPerUnit: 405,
        goalDeltaM: 120,
      }),
    ).toBe(
      '35분 12초 경과. 5.2킬로미터. 평균 페이스 킬로미터당 6분 45초. 목표보다 120미터 앞서고 있습니다.',
    );
  });

  test('목표 편차가 null이면 마지막 문장이 빠진다', () => {
    expect(
      voiceCueText({
        elapsedMs: 35 * 60_000 + 12_000,
        distanceM: 5200,
        unit: 'km',
        paceSecPerUnit: 405,
        goalDeltaM: null,
      }),
    ).toBe('35분 12초 경과. 5.2킬로미터. 평균 페이스 킬로미터당 6분 45초.');
  });

  test('페이스가 null이면 측정 중으로 읽는다', () => {
    expect(
      voiceCueText({
        elapsedMs: 60_000,
        distanceM: 4,
        unit: 'km',
        paceSecPerUnit: null,
        goalDeltaM: null,
      }),
    ).toBe('1분 0초 경과. 0킬로미터. 평균 페이스 측정 중.');
  });

  test('mi 단위는 마일로 환산해 읽는다', () => {
    expect(
      voiceCueText({
        elapsedMs: 35 * 60_000,
        distanceM: 5 * METERS_PER_MILE,
        unit: 'mi',
        paceSecPerUnit: 652,
        goalDeltaM: null,
      }),
    ).toBe('35분 0초 경과. 5마일. 평균 페이스 마일당 10분 52초.');
  });

  test('뒤쳐짐 문장', () => {
    expect(
      voiceCueText({
        elapsedMs: 600_000,
        distanceM: 1500,
        unit: 'km',
        paceSecPerUnit: 400,
        goalDeltaM: -80,
      }),
    ).toContain('목표보다 80미터 뒤쳐져 있습니다.');
  });
});

describe('countdownCueText', () => {
  test('3·2·1은 한글 수사로 읽는다', () => {
    expect(countdownCueText(3)).toBe('삼');
    expect(countdownCueText(2)).toBe('이');
    expect(countdownCueText(1)).toBe('일');
  });

  test('0은 시작', () => {
    expect(countdownCueText(0)).toBe('시작');
  });

  test('범위 밖 숫자는 null', () => {
    expect(countdownCueText(11)).toBeNull();
    expect(countdownCueText(-1)).toBeNull();
  });
});

describe('voiceSummaryText', () => {
  const base = {
    elapsedMs: 35 * 60_000 + 12_000,
    distanceM: 5200,
    unit: 'km' as const,
    paceSecPerUnit: 405,
  };

  test('목표 거리가 없으면 세 문장', () => {
    expect(voiceSummaryText({ ...base, goalDistanceUnits: null })).toBe(
      '수고하셨습니다. 총 35분 12초, 5.2킬로미터. 평균 페이스 킬로미터당 6분 45초.',
    );
  });

  test('목표 거리를 달성하면 달성 문장이 붙는다', () => {
    expect(voiceSummaryText({ ...base, goalDistanceUnits: 5 })).toBe(
      '수고하셨습니다. 총 35분 12초, 5.2킬로미터. 평균 페이스 킬로미터당 6분 45초. 목표 5킬로미터를 달성했습니다.',
    );
  });

  test('미달이면 남은 거리를 미터로 읽는다', () => {
    expect(
      voiceSummaryText({ ...base, distanceM: 4680, goalDistanceUnits: 5 }),
    ).toContain('목표 5킬로미터에 320미터 못 미쳤습니다.');
  });

  test('목표 거리와 정확히 같으면 달성이다', () => {
    expect(
      voiceSummaryText({ ...base, distanceM: 5000, goalDistanceUnits: 5 }),
    ).toContain('목표 5킬로미터를 달성했습니다.');
  });

  test('mi 단위는 조사가 을이다', () => {
    expect(
      voiceSummaryText({
        ...base,
        unit: 'mi',
        distanceM: 3 * METERS_PER_MILE,
        paceSecPerUnit: 652,
        goalDistanceUnits: 3,
      }),
    ).toBe(
      '수고하셨습니다. 총 35분 12초, 3마일. 평균 페이스 마일당 10분 52초. 목표 3마일을 달성했습니다.',
    );
  });
});

describe('isVoiceGuideOn', () => {
  test('둘 다 끔이면 false', () => {
    expect(isVoiceGuideOn(null, null)).toBe(false);
  });

  test('하나라도 켜져 있으면 true', () => {
    expect(isVoiceGuideOn(1, null)).toBe(true);
    expect(isVoiceGuideOn(null, 5)).toBe(true);
    expect(isVoiceGuideOn(0.5, 2)).toBe(true);
  });
});
