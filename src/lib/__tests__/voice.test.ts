import { METERS_PER_MILE } from '../geo';
import {
  countdownCueText,
  INITIAL_VOICE_CUE_STATE,
  isVoiceGuideOn,
  nextVoiceCue,
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
    // 1.005처럼 정확히 반올림 경계에 놓인 값은 부동소수점 표현 때문에
    // toFixed 결과가 직관과 어긋난다((1.005).toFixed(2) === '1.00'). 경계를 피한 값으로 검증한다.
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

  test('페이스가 null이면 측정 중으로 읽는다', () => {
    expect(
      voiceSummaryText({ ...base, paceSecPerUnit: null, goalDistanceUnits: null }),
    ).toBe('수고하셨습니다. 총 35분 12초, 5.2킬로미터. 평균 페이스 측정 중.');
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

describe('nextVoiceCue', () => {
  const base = {
    unit: 'km' as const,
    distanceUnits: 1 as number | null,
    timeMin: 1 as number | null,
    state: INITIAL_VOICE_CUE_STATE,
  };

  test('거리 마일스톤에 닿으면 distance', () => {
    const r = nextVoiceCue({ ...base, timeMin: null, distanceM: 1000, elapsedMs: 0 });
    expect(r.cue).toBe('distance');
  });

  test('거리 마일스톤 직전이면 발화하지 않는다', () => {
    const r = nextVoiceCue({ ...base, timeMin: null, distanceM: 999, elapsedMs: 0 });
    expect(r.cue).toBeNull();
  });

  test('시간 마일스톤에 닿으면 time', () => {
    const r = nextVoiceCue({ ...base, distanceUnits: null, distanceM: 0, elapsedMs: 60_000 });
    expect(r.cue).toBe('time');
  });

  test('두 축이 모두 켜져 있어도 거리만 못 미쳤으면 시간 분기로 흘러가 time을 낸다', () => {
    // distance 분기가 조건 불충족 시 그냥 null을 반환해버리면(시간 분기로 흘러가지 않으면)
    // 두 축을 모두 켠 가장 흔한 설정에서 시간 안내가 통째로 죽는다 — 이 회귀를 지킨다.
    const r = nextVoiceCue({ ...base, distanceM: 500, elapsedMs: 60_000 });
    expect(r.cue).toBe('time');
  });

  test('같은 틱에 둘 다 닿으면 distance 하나만 나가고 다음 틱은 조용하다', () => {
    const first = nextVoiceCue({ ...base, distanceM: 1000, elapsedMs: 60_000 });
    expect(first.cue).toBe('distance');

    // 1초 뒤: 거리·시간 모두 같은 마일스톤 구간 안이므로 시간 안내가 뒤따르지 않는다
    const second = nextVoiceCue({
      ...base,
      distanceM: 1003,
      elapsedMs: 61_000,
      state: first.state,
    });
    expect(second.cue).toBeNull();
  });

  test('마일스톤 여러 개를 한 번에 건너뛰어도 발화는 1회', () => {
    const first = nextVoiceCue({
      ...base,
      timeMin: null,
      distanceM: 3200,
      elapsedMs: 0,
      state: { lastDistanceM: 900, lastElapsedMs: 0 },
    });
    expect(first.cue).toBe('distance');
    expect(first.state.lastDistanceM).toBe(3200);

    const second = nextVoiceCue({
      ...base,
      timeMin: null,
      distanceM: 3300,
      elapsedMs: 0,
      state: first.state,
    });
    expect(second.cue).toBeNull();
  });

  test('축이 null이면 그 축은 절대 발화하지 않는다', () => {
    const r = nextVoiceCue({
      ...base,
      distanceUnits: null,
      timeMin: null,
      distanceM: 5000,
      elapsedMs: 600_000,
    });
    expect(r.cue).toBeNull();
  });

  test('발화하지 않아도 기준점은 항상 현재 값으로 갱신된다', () => {
    const r = nextVoiceCue({
      ...base,
      distanceUnits: null,
      timeMin: null,
      distanceM: 3200,
      elapsedMs: 600_000,
    });
    expect(r.state).toEqual({ lastDistanceM: 3200, lastElapsedMs: 600_000 });
  });

  test('러닝 중 축을 껐다 켜도 그동안 지나간 마일스톤이 터지지 않는다', () => {
    // 꺼진 동안에도 기준점이 따라 올라간다
    const off = nextVoiceCue({
      ...base,
      distanceUnits: null,
      timeMin: null,
      distanceM: 3200,
      elapsedMs: 600_000,
    });
    // 다시 켠 직후
    const on = nextVoiceCue({
      ...base,
      timeMin: null,
      distanceM: 3250,
      elapsedMs: 600_000,
      state: off.state,
    });
    expect(on.cue).toBeNull();

    // 다음 마일스톤부터 정상 발화
    const next = nextVoiceCue({
      ...base,
      timeMin: null,
      distanceM: 4000,
      elapsedMs: 600_000,
      state: on.state,
    });
    expect(next.cue).toBe('distance');
  });

  test('간격을 1에서 2로 바꿔도 경계 근처에서 즉시 재발화하지 않는다', () => {
    const r = nextVoiceCue({
      ...base,
      distanceUnits: 2,
      timeMin: null,
      distanceM: 2050,
      elapsedMs: 0,
      state: { lastDistanceM: 2010, lastElapsedMs: 0 },
    });
    expect(r.cue).toBeNull();

    const next = nextVoiceCue({
      ...base,
      distanceUnits: 2,
      timeMin: null,
      distanceM: 4000,
      elapsedMs: 0,
      state: r.state,
    });
    expect(next.cue).toBe('distance');
  });

  test('0.5 간격도 동작한다', () => {
    const r = nextVoiceCue({
      ...base,
      distanceUnits: 0.5,
      timeMin: null,
      distanceM: 500,
      elapsedMs: 0,
    });
    expect(r.cue).toBe('distance');
  });

  test('mi 단위는 마일 기준으로 판정한다', () => {
    const notYet = nextVoiceCue({
      ...base,
      unit: 'mi',
      timeMin: null,
      distanceM: 1000,
      elapsedMs: 0,
    });
    expect(notYet.cue).toBeNull();

    const reached = nextVoiceCue({
      ...base,
      unit: 'mi',
      timeMin: null,
      distanceM: METERS_PER_MILE,
      elapsedMs: 0,
    });
    expect(reached.cue).toBe('distance');
  });

  test('시간 간격 2분·5분', () => {
    expect(
      nextVoiceCue({ ...base, distanceUnits: null, timeMin: 2, distanceM: 0, elapsedMs: 120_000 })
        .cue,
    ).toBe('time');
    expect(
      nextVoiceCue({ ...base, distanceUnits: null, timeMin: 5, distanceM: 0, elapsedMs: 240_000 })
        .cue,
    ).toBeNull();
  });

  test('거리가 뒤로 가도(GPS 보정) 발화하지 않는다', () => {
    const r = nextVoiceCue({
      ...base,
      timeMin: null,
      distanceM: 1900,
      elapsedMs: 0,
      state: { lastDistanceM: 2010, lastElapsedMs: 0 },
    });
    expect(r.cue).toBeNull();
  });
});
