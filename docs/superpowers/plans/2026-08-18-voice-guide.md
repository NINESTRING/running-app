# 러닝 음성 안내 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 러닝 중 설정한 거리·시간 주기마다 경과 시간·거리·평균 페이스·목표 대비 편차를 음성으로 읽어준다.

**Architecture:** 트리거 판정과 문장 생성을 `src/lib/voice.ts`의 순수 함수로 몰아 전부 노드에서 테스트한다. 부수효과(TTS 발화, 오디오 세션)는 `src/services/speech.ts`에 격리하고 모든 실패를 삼킨다. 배선은 `src/hooks/useVoiceCues.ts` 훅 하나가 담당해 `app/(tabs)/index.tsx`에는 호출 한 줄만 늘어난다. 판정 상태는 `useRef`에 두어 리렌더를 유발하지 않는다.

**Tech Stack:** Expo SDK 57(React Native 0.86), expo-speech, expo-audio, zustand + persist, NativeWind 4, 기존 `@/components/ui/toggle-group`·`@/components/ui/button`·`@/components/ui/text`.

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-08-18-voice-guide-design.md`
- **`src/stores/runStore.ts` 수정 금지.** 음성 안내는 러닝 상태가 아니라 러닝 상태를 읽기만 하는 관찰자다.
- **신규 npm 의존성은 `expo-speech`, `expo-audio` 둘뿐이다.** 반드시 `npx expo install`로 설치해 SDK 57에 맞는 버전이 잡히게 한다(`npm install` 금지).
- 설정 값(정확히 이 값): 거리 `0.5 | 1 | 2 | null`, 시간(분) `1 | 2 | 5 | null`. `null` = 끔.
- 거리 설정값은 **현재 단위 기준 숫자이며 km ↔ mi 변경 시 변환하지 않는다.** `goalStore`와 같은 규칙이다.
- 안내 언어는 `ko-KR`. 문장 구분자는 마침표 + 공백(`. `)이고 문장 끝에도 마침표를 찍는다.
- 발화 실패·오디오 세션 실패는 **절대 throw하지 않는다.** `console.warn`만 남기고 정상 반환한다. 러닝 기록에 영향이 없어야 한다.
- `Platform.OS === 'web'`이면 `src/services/speech.ts`의 모든 함수는 no-op이다.
- 일시정지·저장 중에는 발화하지 않는다. 시간·거리는 항상 **일시정지를 제외한** 값(`elapsedMs`, `distanceM`)을 쓴다.
- 검증: `npm test`, `npx tsc --noEmit`, `npm run lint` 모두 기존 대비 회귀 없음.
- 이 저장소에는 컴포넌트/훅 테스트 인프라(`@testing-library/react-native` 등)가 없다. **테스트 라이브러리를 새로 도입하지 않는다.** 컴포넌트와 훅은 수동 확인으로 검증한다.
- 커밋 메시지는 한국어 Conventional Commits(`feat(voice): …`, `test(voice): …`). 기존 이력과 같은 형식이다.

---

### Task 1: 음성 전용 포매터와 안내 문장 생성

화면용 포매터(`formatPace` → `6'45"`, `formatDistance` → `5.20`)는 TTS에 그대로 넣을 수 없다. 음성 전용 포매터를 새로 만들고 이를 조합해 안내 문장을 만든다. 전부 순수 함수다.

**Files:**
- Create: `src/lib/voice.ts`
- Create: `src/lib/__tests__/voice.test.ts`

**Interfaces:**
- Consumes: `src/lib/geo.ts`의 `METERS_PER_MILE: number`, `src/lib/goal.ts`의 `goalDeltaStatus(deltaM: number): 'ahead' | 'behind' | 'onPace'`.
- Produces: 다음 심볼을 export 한다. Task 5·6이 `voiceCueText`를 import 한다.
  - `speakNumber(n: number): string`
  - `speakDuration(ms: number): string`
  - `speakPace(secPerUnit: number | null, unit: 'km' | 'mi'): string`
  - `speakGoalDelta(deltaM: number | null): string | null`
  - `voiceCueText(p: { elapsedMs: number; distanceM: number; unit: 'km' | 'mi'; paceSecPerUnit: number | null; goalDeltaM: number | null }): string`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/__tests__/voice.test.ts`를 아래 내용 그대로 만든다.

```ts
import { METERS_PER_MILE } from '../geo';
import {
  speakDuration,
  speakGoalDelta,
  speakNumber,
  speakPace,
  voiceCueText,
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx jest src/lib/__tests__/voice.test.ts`
Expected: FAIL — `Cannot find module '../voice'`

- [ ] **Step 3: 구현 작성**

`src/lib/voice.ts`를 아래 내용 그대로 만든다.

```ts
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
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `npx jest src/lib/__tests__/voice.test.ts`
Expected: PASS (전부 통과)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/voice.ts src/lib/__tests__/voice.test.ts
git commit -m "feat(voice): 음성 전용 포매터와 안내 문장 생성"
```

---

### Task 2: 안내 트리거 판정

거리·시간 마일스톤을 넘었는지 판정하는 순수 함수. Task 1과 같은 파일에 추가한다.

**Files:**
- Modify: `src/lib/voice.ts` (파일 끝에 추가)
- Modify: `src/lib/__tests__/voice.test.ts` (파일 끝에 추가)

**Interfaces:**
- Consumes: Task 1에서 만든 `src/lib/voice.ts`의 `unitMeters` 내부 헬퍼.
- Produces: 다음 심볼을 export 한다. Task 6이 전부 import 한다.
  - `interface VoiceCueState { lastDistanceM: number; lastElapsedMs: number }`
  - `const INITIAL_VOICE_CUE_STATE: VoiceCueState`
  - `type VoiceCue = 'distance' | 'time' | null`
  - `nextVoiceCue(p: { distanceM: number; elapsedMs: number; unit: 'km' | 'mi'; distanceUnits: number | null; timeMin: number | null; state: VoiceCueState }): { state: VoiceCueState; cue: VoiceCue }`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/__tests__/voice.test.ts`의 맨 위 import 문을 아래로 교체한다.

```ts
import { METERS_PER_MILE } from '../geo';
import {
  INITIAL_VOICE_CUE_STATE,
  nextVoiceCue,
  speakDuration,
  speakGoalDelta,
  speakNumber,
  speakPace,
  voiceCueText,
} from '../voice';
```

그리고 파일 끝에 아래를 추가한다.

```ts
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx jest src/lib/__tests__/voice.test.ts`
Expected: FAIL — `nextVoiceCue is not a function` (또는 export를 찾을 수 없다는 타입/런타임 오류)

- [ ] **Step 3: 구현 작성**

`src/lib/voice.ts` 파일 **끝에** 아래를 추가한다. (Task 1에서 만든 `unitMeters` 헬퍼를 그대로 쓴다.)

```ts
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
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `npx jest src/lib/__tests__/voice.test.ts`
Expected: PASS (Task 1 테스트 포함 전부 통과)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/voice.ts src/lib/__tests__/voice.test.ts
git commit -m "feat(voice): 거리·시간 안내 트리거 판정"
```

---

### Task 3: 설정 스토어에 음성 안내 주기 추가

**Files:**
- Modify: `src/stores/settingsStore.ts`
- Modify: `src/stores/__tests__/settingsStore.test.ts`

**Interfaces:**
- Produces: 다음 심볼을 export 한다. Task 5·6이 import 한다.
  - `type VoiceDistanceUnits = 0.5 | 1 | 2`
  - `type VoiceTimeMin = 1 | 2 | 5`
  - `useSettingsStore` 상태에 `voiceDistanceUnits: VoiceDistanceUnits | null`, `voiceTimeMin: VoiceTimeMin | null` 추가
  - 액션 `setVoiceDistanceUnits(v: VoiceDistanceUnits | null): void`, `setVoiceTimeMin(v: VoiceTimeMin | null): void`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/stores/__tests__/settingsStore.test.ts`의 `beforeEach`를 아래로 교체한다. (새 필드를 초기화하지 않으면 테스트 간 상태가 샌다.)

```ts
  beforeEach(async () => {
    await AsyncStorage.clear();
    useSettingsStore.setState({
      unit: 'km',
      theme: 'system',
      voiceDistanceUnits: null,
      voiceTimeMin: null,
    });
  });
```

그리고 파일 맨 끝(가장 바깥 `describe`의 닫는 괄호 **앞**)에 아래 테스트를 추가한다.

```ts
  test('음성 안내 주기의 기본값은 둘 다 null(끔)이다', () => {
    expect(useSettingsStore.getState().voiceDistanceUnits).toBeNull();
    expect(useSettingsStore.getState().voiceTimeMin).toBeNull();
  });

  test('음성 안내 주기를 변경한다', () => {
    useSettingsStore.getState().setVoiceDistanceUnits(0.5);
    useSettingsStore.getState().setVoiceTimeMin(2);
    expect(useSettingsStore.getState().voiceDistanceUnits).toBe(0.5);
    expect(useSettingsStore.getState().voiceTimeMin).toBe(2);
  });

  test('음성 안내 주기를 null로 되돌려 끌 수 있다', () => {
    useSettingsStore.getState().setVoiceTimeMin(5);
    useSettingsStore.getState().setVoiceTimeMin(null);
    expect(useSettingsStore.getState().voiceTimeMin).toBeNull();
  });

  test('음성 안내 주기가 AsyncStorage에 저장된다', async () => {
    useSettingsStore.getState().setVoiceDistanceUnits(2);
    useSettingsStore.getState().setVoiceTimeMin(1);
    await flush();

    const raw = await AsyncStorage.getItem('settings');
    const parsed = JSON.parse(raw as string);
    expect(parsed.state.voiceDistanceUnits).toBe(2);
    expect(parsed.state.voiceTimeMin).toBe(1);
  });

  // 복원은 저장소를 직접 세팅해서 확인한다. setState로 값을 되돌린 뒤 rehydrate를
  // 부르면 persist의 fire-and-forget setItem이 rehydrate의 읽기와 경쟁한다.
  test('저장된 음성 안내 주기가 rehydrate로 복원된다', async () => {
    await AsyncStorage.setItem(
      'settings',
      JSON.stringify({
        state: { unit: 'km', theme: 'system', voiceDistanceUnits: 0.5, voiceTimeMin: 5 },
        version: 0,
      }),
    );

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState().voiceDistanceUnits).toBe(0.5);
    expect(useSettingsStore.getState().voiceTimeMin).toBe(5);
  });

  // 마이그레이션 없이 필드를 추가했으므로, 기존 사용자의 저장본에 두 키가 없다.
  // persist의 얕은 병합이 초기값(null = 끔)을 남겨야 한다.
  test('두 키가 없는 기존 저장본은 병합으로 null(끔)이 된다', async () => {
    await AsyncStorage.setItem(
      'settings',
      JSON.stringify({ state: { unit: 'mi', theme: 'dark' }, version: 0 }),
    );

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState().unit).toBe('mi');
    expect(useSettingsStore.getState().voiceDistanceUnits).toBeNull();
    expect(useSettingsStore.getState().voiceTimeMin).toBeNull();
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx jest src/stores/__tests__/settingsStore.test.ts`
Expected: FAIL — `setVoiceDistanceUnits is not a function`

- [ ] **Step 3: 구현 작성**

`src/stores/settingsStore.ts`를 아래 내용 그대로 교체한다.

```ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createSafeStorage } from '../lib/persist';

export type ThemePreference = 'system' | 'light' | 'dark';

// 음성 안내 주기. 거리 값은 goalStore와 같은 규칙 —
// 현재 단위(km/mi) 기준 수치이며, 단위를 바꿔도 숫자는 변환하지 않는다.
export type VoiceDistanceUnits = 0.5 | 1 | 2;
export type VoiceTimeMin = 1 | 2 | 5;

interface SettingsState {
  unit: 'km' | 'mi';
  theme: ThemePreference;
  voiceDistanceUnits: VoiceDistanceUnits | null; // null = 끔
  voiceTimeMin: VoiceTimeMin | null; // null = 끔
  setUnit: (unit: 'km' | 'mi') => void;
  setTheme: (theme: ThemePreference) => void;
  setVoiceDistanceUnits: (v: VoiceDistanceUnits | null) => void;
  setVoiceTimeMin: (v: VoiceTimeMin | null) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      unit: 'km',
      theme: 'system',
      voiceDistanceUnits: null,
      voiceTimeMin: null,
      setUnit: (unit) => set({ unit }),
      setTheme: (theme) => set({ theme }),
      setVoiceDistanceUnits: (voiceDistanceUnits) => set({ voiceDistanceUnits }),
      setVoiceTimeMin: (voiceTimeMin) => set({ voiceTimeMin }),
    }),
    {
      // 기존 저장본에는 voice* 키가 없다. persist가 초기 상태 위에 얕은 병합을 하므로
      // 두 필드는 null(끔)로 복원된다 — 버전 올림·마이그레이션 불필요.
      name: 'settings',
      version: 0,
      storage: createSafeStorage<SettingsState>(),
    },
  ),
);
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `npx jest src/stores/__tests__/settingsStore.test.ts`
Expected: PASS (기존 테스트 포함 전부 통과)

- [ ] **Step 5: 커밋**

```bash
git add src/stores/settingsStore.ts src/stores/__tests__/settingsStore.test.ts
git commit -m "feat(voice): 설정 스토어에 음성 안내 주기 추가"
```

---

### Task 4: TTS·오디오 세션 서비스

부수효과를 전부 이 파일에 격리한다. 의존성 설치와 `app.json` 플러그인 설정도 이 태스크에 포함된다 — 셋이 함께 있어야 동작하기 때문이다.

**Files:**
- Create: `src/services/speech.ts`
- Create: `src/services/__tests__/speech.test.ts`
- Modify: `app.json`
- Modify: `package.json`, `package-lock.json` (설치 결과)

**Interfaces:**
- Consumes: `expo-speech`의 `speak`·`stop`, `expo-audio`의 `setAudioModeAsync`.
- Produces: 다음 심볼을 export 한다. Task 5가 `configureVoiceAudio`·`speakCue`를, Task 6이 셋 다 import 한다.
  - `configureVoiceAudio(): Promise<void>`
  - `speakCue(text: string): void`
  - `stopSpeaking(): void`

- [ ] **Step 1: 의존성 설치**

```bash
npx expo install expo-speech expo-audio
```

`package.json`의 `dependencies`에 `expo-speech`와 `expo-audio`가 `~57.x` 버전으로 추가되었는지 확인한다. `npm install`을 쓰면 SDK 57과 맞지 않는 버전이 잡히므로 반드시 `npx expo install`을 쓴다.

- [ ] **Step 2: app.json에 expo-audio 플러그인 추가**

`app.json`의 `expo.plugins` 배열 맨 끝(`expo-sensors` 항목 뒤)에 아래 항목을 추가한다.

```json
      [
        "expo-audio",
        {
          "enableBackgroundPlayback": true
        }
      ]
```

이 플러그인이 iOS `UIBackgroundModes`에 `"audio"`를 추가한다. `expo.ios.infoPlist.UIBackgroundModes`의 기존 `"location"`은 **그대로 둔다** — 손으로 지우거나 바꾸지 않는다.

- [ ] **Step 3: 실패하는 테스트 작성**

`src/services/__tests__/speech.test.ts`를 아래 내용 그대로 만든다.

```ts
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

beforeEach(() => {
  jest.resetModules();
  // clearAllMocks가 아니라 resetAllMocks — 앞선 테스트가 심어둔 throw 구현이
  // 다음 테스트로 새지 않아야 한다(clearAllMocks는 호출 기록만 지운다).
  jest.resetAllMocks();
  mockSetAudioMode.mockResolvedValue(undefined);
  Platform.OS = 'ios';
  speech = require('../speech');
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
```

- [ ] **Step 4: 테스트가 실패하는지 확인**

Run: `npx jest src/services/__tests__/speech.test.ts`
Expected: FAIL — `Cannot find module '../speech'`

- [ ] **Step 5: 구현 작성**

`src/services/speech.ts`를 아래 내용 그대로 만든다.

```ts
import { Platform } from 'react-native';
import { setAudioModeAsync } from 'expo-audio';
import * as Speech from 'expo-speech';

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

/** 진행 중인 발화를 중단한다. 러닝 종료·버리기 시 부른다. */
export function stopSpeaking(): void {
  if (Platform.OS === 'web') return;
  try {
    Speech.stop();
  } catch (e) {
    console.warn('[speech] 발화 중지 실패', e);
  }
}
```

- [ ] **Step 6: 테스트가 통과하는지 확인**

Run: `npx jest src/services/__tests__/speech.test.ts`
Expected: PASS (전부 통과)

- [ ] **Step 7: 타입 검사**

Run: `npx tsc --noEmit`
Expected: 오류 없음. `useApplicationAudioSession`이 `SpeechOptions`에 없다는 오류가 나면 설치된 `expo-speech` 버전의 타입 정의를 열어 확인하고, 정말 없으면 그 옵션만 빼고 나머지는 그대로 둔다(그 경우 `src/services/speech.ts` 주석도 함께 지운다).

- [ ] **Step 8: 커밋**

```bash
git add src/services/speech.ts src/services/__tests__/speech.test.ts app.json package.json package-lock.json
git commit -m "feat(voice): TTS·오디오 세션 서비스와 백그라운드 재생 설정"
```

---

### Task 5: 설정 화면 음성 안내 섹션

**Files:**
- Create: `src/components/VoiceGuideSection.tsx`
- Modify: `app/(tabs)/settings.tsx`

**Interfaces:**
- Consumes: Task 1의 `voiceCueText`, Task 3의 `useSettingsStore`·`VoiceDistanceUnits`·`VoiceTimeMin`, Task 4의 `configureVoiceAudio`·`speakCue`, 기존 `src/lib/geo.ts`의 `METERS_PER_MILE`.
- Produces: `VoiceGuideSection(): React.ReactElement` — props 없음.

- [ ] **Step 1: 컴포넌트 생성**

`src/components/VoiceGuideSection.tsx`를 아래 내용 그대로 만든다.

```tsx
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { METERS_PER_MILE } from '@/lib/geo';
import { voiceCueText } from '@/lib/voice';
import { configureVoiceAudio, speakCue } from '@/services/speech';
import {
  useSettingsStore,
  type VoiceDistanceUnits,
  type VoiceTimeMin,
} from '@/stores/settingsStore';

// ToggleGroup은 string 값만 다루므로 '끔'을 나타내는 센티넬이 필요하다.
const OFF = 'off';

const DISTANCE_OPTIONS: VoiceDistanceUnits[] = [0.5, 1, 2];
const TIME_OPTIONS: VoiceTimeMin[] = [1, 2, 5];

// 미리듣기 예시값 — 30분·5단위거리·6'00" 페이스·120m 앞섬
const PREVIEW_ELAPSED_MS = 30 * 60_000;
const PREVIEW_DISTANCE_UNITS = 5;
const PREVIEW_PACE_SEC = 360;
const PREVIEW_GOAL_DELTA_M = 120;

export function VoiceGuideSection() {
  const unit = useSettingsStore((s) => s.unit);
  const distanceUnits = useSettingsStore((s) => s.voiceDistanceUnits);
  const timeMin = useSettingsStore((s) => s.voiceTimeMin);
  const setDistanceUnits = useSettingsStore((s) => s.setVoiceDistanceUnits);
  const setTimeMin = useSettingsStore((s) => s.setVoiceTimeMin);

  // 실제 안내와 같은 함수로 문장을 만든다 — 미리듣기가 실제와 어긋날 수 없고,
  // 단위 설정도 자동으로 반영된다.
  const onPreview = async () => {
    await configureVoiceAudio();
    speakCue(
      voiceCueText({
        elapsedMs: PREVIEW_ELAPSED_MS,
        distanceM: PREVIEW_DISTANCE_UNITS * (unit === 'mi' ? METERS_PER_MILE : 1000),
        unit,
        paceSecPerUnit: PREVIEW_PACE_SEC,
        goalDeltaM: PREVIEW_GOAL_DELTA_M,
      }),
    );
  };

  return (
    <View className="gap-3">
      <Text className="text-base font-semibold">음성 안내</Text>

      <View className="gap-2">
        <Text className="text-sm text-muted-foreground">{`거리마다 (${unit})`}</Text>
        <ToggleGroup
          type="single"
          value={distanceUnits === null ? OFF : String(distanceUnits)}
          onValueChange={(v) => {
            if (!v) return; // 이미 선택된 항목을 다시 누른 경우 — 해제하지 않는다
            setDistanceUnits(v === OFF ? null : (Number(v) as VoiceDistanceUnits));
          }}
          className="justify-start"
        >
          <ToggleGroupItem value={OFF} isFirst>
            <Text>끔</Text>
          </ToggleGroupItem>
          {DISTANCE_OPTIONS.map((v, i) => (
            <ToggleGroupItem
              key={v}
              value={String(v)}
              isLast={i === DISTANCE_OPTIONS.length - 1}
            >
              <Text>{String(v)}</Text>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </View>

      <View className="gap-2">
        <Text className="text-sm text-muted-foreground">시간마다 (분)</Text>
        <ToggleGroup
          type="single"
          value={timeMin === null ? OFF : String(timeMin)}
          onValueChange={(v) => {
            if (!v) return;
            setTimeMin(v === OFF ? null : (Number(v) as VoiceTimeMin));
          }}
          className="justify-start"
        >
          <ToggleGroupItem value={OFF} isFirst>
            <Text>끔</Text>
          </ToggleGroupItem>
          {TIME_OPTIONS.map((v, i) => (
            <ToggleGroupItem
              key={v}
              value={String(v)}
              isLast={i === TIME_OPTIONS.length - 1}
            >
              <Text>{String(v)}</Text>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </View>

      <View className="items-start">
        <Button
          size="sm"
          variant="outline"
          accessibilityLabel="음성 안내 미리듣기"
          onPress={() => {
            void onPreview();
          }}
        >
          <Text>미리듣기</Text>
        </Button>
      </View>
    </View>
  );
}
```

- [ ] **Step 2: 설정 화면에 배치**

`app/(tabs)/settings.tsx`를 수정한다. import 블록에 아래 한 줄을 추가한다.

```tsx
import { VoiceGuideSection } from '@/components/VoiceGuideSection';
```

그리고 `화면 모드` 토글 그룹을 감싼 `<View className="gap-3">…</View>` 블록과 `<AppInfoSection />` **사이에** 아래를 넣는다.

```tsx
      <VoiceGuideSection />
```

- [ ] **Step 3: 타입 검사와 린트**

Run: `npx tsc --noEmit && npm run lint`
Expected: 오류 없음

- [ ] **Step 4: 기존 테스트 회귀 확인**

Run: `npm test`
Expected: PASS (전부 통과)

- [ ] **Step 5: 커밋**

```bash
git add src/components/VoiceGuideSection.tsx "app/(tabs)/settings.tsx"
git commit -m "feat(voice): 설정 화면에 음성 안내 주기와 미리듣기 추가"
```

---

### Task 6: 러닝 화면 배선

훅 하나가 판정·발화를 담당하고, `index.tsx`에는 호출 한 줄과 정리 코드만 늘어난다.

**Files:**
- Create: `src/hooks/useVoiceCues.ts`
- Modify: `app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: Task 1·2의 `voiceCueText`·`nextVoiceCue`·`INITIAL_VOICE_CUE_STATE`·`VoiceCueState`, Task 3의 `useSettingsStore`, Task 4의 `speakCue`, 기존 `src/lib/geo.ts`의 `paceSecPerUnit`, `src/lib/goal.ts`의 `goalDeltaM`, `src/stores/goalStore.ts`의 `useGoalStore`, `src/stores/runStore.ts`의 `RunStatus`.
- Produces: `useVoiceCues(p: { status: RunStatus; startedAt: number | null; distanceM: number; elapsedMs: number }): void`

- [ ] **Step 1: 훅 생성**

`src/hooks/useVoiceCues.ts`를 아래 내용 그대로 만든다. (`src/hooks/` 디렉터리가 없으면 새로 만든다.)

```ts
import { useEffect, useRef } from 'react';

import { paceSecPerUnit } from '@/lib/geo';
import { goalDeltaM } from '@/lib/goal';
import {
  INITIAL_VOICE_CUE_STATE,
  nextVoiceCue,
  voiceCueText,
  type VoiceCueState,
} from '@/lib/voice';
import { speakCue } from '@/services/speech';
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
```

- [ ] **Step 2: index.tsx에 import 추가**

`app/(tabs)/index.tsx`의 import 블록에 아래 두 줄을 추가한다.

```tsx
import { useVoiceCues } from '@/hooks/useVoiceCues';
import { configureVoiceAudio, stopSpeaking } from '@/services/speech';
```

- [ ] **Step 3: startedAt 구독 추가**

`app/(tabs)/index.tsx`의 `HomeScreen` 안, `const segmentStartedAt = useRunStore((s) => s.segmentStartedAt);` 바로 아래에 추가한다.

```tsx
  const startedAt = useRunStore((s) => s.startedAt);
```

- [ ] **Step 4: 훅 호출**

`const elapsed = elapsedMs({ accumulatedMs, segmentStartedAt }, now);` 바로 **아래**에 추가한다. (`elapsed`가 정의된 뒤여야 한다.)

```tsx
  useVoiceCues({ status, startedAt, distanceM, elapsedMs: elapsed });
```

- [ ] **Step 5: 러닝 시작 시 오디오 세션 설정**

`beginRun` 안, `fetchWeatherForRun().catch(() => {});` 바로 **아래** 줄에 추가한다.

```tsx
    // 오디오 세션은 뛰는 동안에만 잡는다 — 대기 중에 잡으면 다른 앱 음악에 간섭한다.
    // 실패해도 함수 안에서 삼키므로 러닝 흐름에 영향이 없다.
    void configureVoiceAudio();
```

- [ ] **Step 6: 종료·버리기 시 발화 중단**

`onDiscard` 안, `stopStepCounting();` 바로 **위**에 추가한다.

```tsx
    stopSpeaking();
```

그리고 `onStop` 안, `if (!useRunStore.getState().beginSave(Date.now())) return;` 바로 **아래**에 추가한다.

```tsx
    stopSpeaking();
```

- [ ] **Step 7: 타입 검사와 린트**

Run: `npx tsc --noEmit && npm run lint`
Expected: 오류 없음

- [ ] **Step 8: 전체 테스트 회귀 확인**

Run: `npm test`
Expected: PASS (전부 통과)

- [ ] **Step 9: 커밋**

```bash
git add src/hooks/useVoiceCues.ts "app/(tabs)/index.tsx"
git commit -m "feat(voice): 러닝 화면에 음성 안내 배선"
```

---

### Task 7: 네이티브 리빌드와 실기기 확인

`expo-audio` 플러그인이 iOS `UIBackgroundModes`를 바꾸므로 기존 dev build로는 백그라운드 발화가 확인되지 않는다.

**Files:** 없음 (검증 전용)

- [ ] **Step 1: 네이티브 리빌드**

```bash
npx expo run:ios
```

빌드가 끝난 뒤 `ios/runningapp/Info.plist`에서 `UIBackgroundModes`에 `location`과 `audio`가 **둘 다** 들어 있는지 확인한다.

- [ ] **Step 2: 설정 화면 확인**

- 설정 탭에 "음성 안내" 섹션이 보이고, 거리 `끔/0.5/1/2`, 시간 `끔/1/2/5`가 표시된다.
- 거리 라벨이 단위 설정에 따라 `(km)` ↔ `(mi)`로 바뀐다.
- 미리듣기를 누르면 "30분 0초 경과. 5킬로미터. 평균 페이스 킬로미터당 6분. 목표보다 120미터 앞서고 있습니다."가 들린다.
- 앱을 껐다 켜도 고른 값이 유지된다.

- [ ] **Step 3: 러닝 중 확인**

시간 `1분`, 거리 `0.5`를 켜고 목표 페이스를 설정한 뒤 뛰면서 확인한다.

- 1분 시점에 안내가 나온다.
- 0.5km 지점에 안내가 나오고, 그 직후 시간 안내가 뒤따라 나오지 않는다.
- 일시정지 중에는 안내가 나오지 않고, 재개 직후 밀린 안내가 몰려 나오지 않는다.
- 화면을 끄고 주머니에 넣은 상태에서도 안내가 나온다.
- 음악 재생 중 안내 동안만 볼륨이 낮아지고, 안내가 끝나면 원래 볼륨으로 돌아온다.
- iOS 무음 스위치를 켜도 안내가 들린다.
- 종료(저장·버리기) 직후 발화가 남아 이어지지 않는다.

- [ ] **Step 4: 확인 결과 기록**

실기기에서 어긋난 항목이 있으면 그대로 두지 말고 목록으로 정리해 보고한다. 통과했으면 이 태스크는 커밋 없이 종료한다.

---

## 검증 요약

전체 완료 후 아래가 모두 통과해야 한다.

```bash
npm test
npx tsc --noEmit
npm run lint
```

새로 추가되는 자동 테스트: `src/lib/__tests__/voice.test.ts`(포매터·문장·트리거), `src/services/__tests__/speech.test.ts`(발화·오디오 세션), `src/stores/__tests__/settingsStore.test.ts`에 추가된 5개 케이스.

컴포넌트(`VoiceGuideSection`)와 훅(`useVoiceCues`)은 이 저장소에 테스트 인프라가 없어 Task 7의 수동 확인으로 검증한다.
