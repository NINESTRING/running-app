# 러닝 음성 안내 설계

2026-08-18

## 목표

러닝 중 정해진 거리·시간마다 진행 상황을 음성으로 읽어준다. 화면을 보지 않고
뛰는 사람이 경과 시간·거리·평균 페이스, 그리고 목표 페이스 대비 얼마나
앞서거나 뒤쳐졌는지를 귀로만 알 수 있게 한다.

## 요구사항

- 설정 화면에서 **거리 주기**와 **시간 주기**를 각각 고른다. 두 축은 독립이며
  동시에 켤 수 있다(중복 선택).
  - 거리: `끔` / `0.5` / `1` / `2` (현재 거리 단위 기준)
  - 시간: `끔` / `1분` / `2분` / `5분`
- 둘 다 `끔`이면 음성 안내를 하지 않는다. 별도의 마스터 토글은 두지 않는다.
- 안내 문장은 트리거 종류와 무관하게 동일한 형태다:
  경과 시간 → 거리 → 평균 페이스 → 목표 대비 편차.
- 목표 페이스가 설정되어 있지 않거나 판정이 불가능하면 마지막 문장을 뺀다.
- 화면이 꺼져 있거나 앱이 백그라운드여도 안내가 나온다.
- 음악을 듣고 있으면 안내 동안만 음악 볼륨이 낮아진다(ducking).
- 일시정지·저장 중에는 안내하지 않는다.
- 러닝 시작 카운트다운을 음성으로 읽는다("삼 · 이 · 일 · 시작").
- 러닝을 저장하면 총정리를 음성으로 읽는다.
- **카운트다운과 총정리는 음성 안내가 켜져 있을 때만 나온다.** 두 축이 모두
  `끔`이면 지금처럼 무음이다.
- 설정 화면에 미리듣기 버튼을 둔다.
- 음성이 나오지 않아도(TTS 엔진 없음·음소거·권한 문제) 러닝 기록에는 아무
  영향이 없어야 한다.

## 설정

### 저장 위치

`src/stores/settingsStore.ts`에 필드 두 개를 추가한다.

```ts
voiceDistanceUnits: 0.5 | 1 | 2 | null;   // null = 끔. 현재 단위 기준 수치
voiceTimeMin: 1 | 2 | 5 | null;           // null = 끔
```

거리 값은 `goalStore`와 같은 규칙을 따른다 — **현재 단위 기준 숫자이고,
km ↔ mi를 바꿔도 숫자를 변환하지 않는다.** `1`을 골라둔 사용자가 단위를 mi로
바꾸면 1마일마다 안내가 된다. 목표 거리·목표 페이스와 동일한 동작이므로
설정 화면 안에서 규칙이 하나로 유지된다.

기존 저장본에는 이 두 키가 없지만 zustand `persist`가 초기 상태 위에 얕은
병합을 하므로 두 키 모두 `null`(끔)로 복원된다. 버전 올림·마이그레이션은
필요 없다.

### UI

`설정` 탭에 "음성 안내" 섹션을 추가한다. 기존 `거리 단위`·`화면 모드`와 같은
`ToggleGroup` 패턴을 그대로 쓴다.

```
음성 안내
  거리마다   [ 끔 ][ 0.5 ][ 1 ][ 2 ] km      ← 단위 설정이 mi면 라벨도 mi
  시간마다   [ 끔 ][ 1 ][ 2 ][ 5 ] 분
  [ 미리듣기 ]
```

`app/(tabs)/settings.tsx`가 더 길어지지 않도록
`src/components/VoiceGuideSection.tsx`로 분리한다. `AccountSection`·
`AppInfoSection`과 같은 구성이다.

미리듣기 버튼은 고정된 예시 문장 하나를 읽는다. 실제 러닝을 하지 않고도
볼륨·무음 스위치·TTS 엔진 설치 여부를 확인할 수 있어야 하기 때문이다. 문장은
실제 안내와 같은 형태여야 하므로 `voiceCueText()`에 고정 예시값을 넣어
생성한다(30분·5km·6분 페이스·120m 앞섬, 현재 단위 설정 반영).

## 안내 문장

| 상황 | 발화 |
|---|---|
| 목표 페이스 설정됨 · 앞섬 | "35분 12초 경과. 5.2킬로미터. 평균 페이스 킬로미터당 6분 45초. 목표보다 120미터 앞서고 있습니다." |
| 뒤쳐짐 | "…목표보다 80미터 뒤쳐져 있습니다." |
| 목표 페이스 유지(±10m) | "…목표 페이스를 유지하고 있습니다." |
| 목표 미설정 / 경과 30초 미만 | "35분 12초 경과. 5.2킬로미터. 평균 페이스 킬로미터당 6분 45초." |
| 거리 10m 미만이라 페이스 미정 | "1분 0초 경과. 0킬로미터. 평균 페이스 측정 중." |
| 단위가 mi | "…3.1마일. 평균 페이스 마일당 10분 52초." |

### 페이스는 평균 페이스다

구간 페이스가 아니라 누적 평균 페이스를 읽는다. 마지막 "몇 미터
앞섬/뒤쳐짐" 문장이 이미 *지금* 목표 대비 어떤 상태인지를 알려주므로 순간
페이스의 역할을 대신한다. 거리 트리거와 시간 트리거가 "페이스"라는 같은
단어로 서로 다른 값을 가리키면 귀로만 들을 때 혼란스럽다.

### 화면 표기를 그대로 읽히지 않는다

화면용 포매터(`formatPace` → `6'45"`, `formatDistance` → `5.20`)는 TTS에
그대로 넣을 수 없다. 음성 전용 포매터를 `src/lib/voice.ts`에 따로 둔다.

- 거리: 소수점 둘째 자리까지 반올림한 뒤 뒤따르는 0을 떨어뜨린다
  (`5.20` → `5.2`, `5.00` → `5`).
- 페이스: `킬로미터당 6분 45초` / `마일당 10분 52초`. 초가 0이면 `6분`.
- 경과 시간: `35분 12초`, 1시간을 넘으면 `1시간 5분 12초`.

### 값의 출처

- 시간·거리는 **일시정지를 제외한** 값 — 화면 지표와 같은 `elapsedMs`,
  `distanceM`.
- 페이스는 `paceSecPerUnit(distanceM, elapsedMs, unit)`.
- 앞섬/뒤쳐짐은 `src/lib/goal.ts`의 `goalDeltaM()`·`goalDeltaStatus()`를 그대로
  재사용한다. 화면의 `GoalDeltaLine`과 같은 함수를 쓰므로 눈으로 본 값과 귀로
  들은 값이 어긋날 수 없다. `goalDeltaM()`은 경과 30초 미만이면 `null`을
  반환하므로 GPS 워밍업 구간의 엉뚱한 안내도 자동으로 막힌다.

## 시작 카운트다운 음성

기존 카운트다운(`3` → `2` → `1` → `시작!`)의 각 틱에 발화를 얹는다. 화면 숫자가
바뀌는 순간과 발화 시점이 정확히 같다.

| 화면 | 발화 |
|---|---|
| `3` | "삼" |
| `2` | "이" |
| `1` | "일" |
| `시작!` | "시작" |

`speakCue()`가 발화 전에 `Speech.stop()`을 부르므로, 앞 숫자가 아직 끝나지
않았어도 다음 숫자에 잘리고 밀리지 않는다. 카운트다운은 1초 간격이고 발화는
한 음절이라 실제로 겹칠 일은 드물다.

카운트다운을 취소하면 `stopSpeaking()`으로 발화도 끊는다.

### 오디오 세션은 `onStart()`에서 잡는다

원래 `beginRun()`(카운트다운 0초)에서 부르려 했지만, 그러면 "삼"이 세션이
잡히기 전에 나가 첫 숫자가 씹힌다. **`configureVoiceAudio()`를 `onStart()`의
`startTracking()` 성공 직후, `applyCountdown(COUNTDOWN_START)` 직전으로
옮기고 `await` 한다.** `onStart()`는 이미 비동기이고 `startTracking()`을
기다리므로 한 번 더 기다려도 흐름이 달라지지 않는다.

음성 안내가 꺼져 있으면 세션을 잡지 않는다 — 뛰는 동안에도 발화할 일이 없기
때문이다.

러닝 도중에 설정에서 음성 안내를 처음 켜는 경우를 위해, `useVoiceCues`가
`status === 'running' && 음성 안내 켜짐`일 때 `configureVoiceAudio()`를 한 번 더
부른다. 이 함수는 멱등이라 중복 호출 비용이 없고, 첫 안내는 아무리 빨라도
1분 뒤라 비동기 설정이 끝날 시간이 충분하다.

## 종료 총정리 음성

**저장에 성공했을 때만** 읽는다. 버리기를 고른 기록에 "수고하셨습니다"가
나오는 것은 어색하다.

> "수고하셨습니다. 총 35분 12초, 5.2킬로미터. 평균 페이스 킬로미터당 6분 45초.
> 목표 5킬로미터를 달성했습니다."

목표 **거리**가 설정되어 있을 때만 마지막 문장이 붙는다. 러닝 중 안내가 목표
**페이스**를 다루는 것과 짝을 이룬다 — 달리는 동안에는 페이스가, 끝나고 나서는
거리가 관심사다.

| 상황 | 마지막 문장 |
|---|---|
| 목표 거리 달성 | "목표 5킬로미터를 달성했습니다." |
| 미달 | "목표 5킬로미터에 320미터 못 미쳤습니다." |
| 목표 거리 미설정 | (없음) |

조사는 단위에 따라 다르다 — `킬로미터를`, `마일을`.

값은 저장에 쓴 것과 같다(`durationSec`, `distanceM`). `runStore.reset()`이
상태를 비우기 전에 이미 지역 변수로 잡아둔 값이라 리셋 순서와 무관하다.

## 트리거 판정

### `src/lib/voice.ts` — 순수 규칙

```ts
export interface VoiceCueState {
  lastDistanceM: number;   // 마지막으로 판정한 거리
  lastElapsedMs: number;   // 마지막으로 판정한 경과 시간
}

export const INITIAL_VOICE_CUE_STATE: VoiceCueState = {
  lastDistanceM: 0,
  lastElapsedMs: 0,
};

export function nextVoiceCue(p: {
  distanceM: number;
  elapsedMs: number;
  unit: 'km' | 'mi';
  distanceUnits: number | null;   // 설정값. null = 거리 안내 끔
  timeMin: number | null;         // 설정값. null = 시간 안내 끔
  state: VoiceCueState;
}): { state: VoiceCueState; cue: 'distance' | 'time' | null };
```

판정 규칙은 "마일스톤 번호가 올라갔는가" 하나다.

```
거리 마일스톤 = floor(distanceM / (distanceUnits × 단위미터))
시간 마일스톤 = floor(elapsedMs / (timeMin × 60000))

거리 축이 켜져 있고 거리 마일스톤이 올라갔으면      → cue: 'distance'
아니고 시간 축이 켜져 있고 시간 마일스톤이 올라갔으면 → cue: 'time'
아니면                                              → cue: null
```

### 반환 state는 발화 여부와 무관하게 항상 현재 값으로 갱신한다

`nextVoiceCue`는 `cue`가 무엇이든 `state`를 `{ lastDistanceM: distanceM,
lastElapsedMs: elapsedMs }`로 스냅해서 돌려준다. 이 한 가지 규칙이 세 가지
문제를 동시에 해결한다.

- **동시 도달 중복 제거.** 1km 지점과 6분 지점이 같은 틱에 걸려도 거리 안내
  하나만 나가고, 시간 축의 기준점도 함께 밀리므로 다음 틱에 시간 안내가
  뒤따라 나오지 않는다.
- **밀린 안내 몰아 읽기 방지.** 앱이 백그라운드에서 오래 있다가 돌아와 한
  틱에 마일스톤 3개가 지나간 것이 관측돼도, 발화는 한 번이고 그 내용은 가장
  최신 상태다. 3km·4km·5km를 연달아 읽는 일이 없다.
- **러닝 중 설정 변경.** 축을 끄면 `cue`는 `null`이지만 기준점은 계속 갱신되므로,
  다시 켰을 때 그동안 지나간 마일스톤이 한꺼번에 터지지 않고 *다음* 마일스톤부터
  울린다. 간격을 `1` → `2`로 바꿔도 직전 판정 거리를 새 간격으로 재해석하므로
  경계 근처에서 즉시 재발화하지 않는다.

마일스톤 "번호"를 상태로 들고 있으면 간격이 바뀔 때 번호의 의미가 달라져
위 마지막 항목이 깨진다. 그래서 번호가 아니라 **마지막으로 판정한 원값**을
저장한다.

### `src/hooks/useVoiceCues.ts` — 배선

`app/(tabs)/index.tsx`는 러닝 중 이미 1초 간격으로 리렌더되므로 별도 타이머를
만들지 않고 그 tick에 얹는다.

- `VoiceCueState`는 `useRef`에 둔다. 이 값의 변화가 화면에 반영될 이유가 없어
  리렌더를 유발하면 안 된다.
- `status !== 'running'`이면 판정 자체를 건너뛴다. 일시정지 중에는 `elapsedMs`·
  `distanceM`이 모두 얼어 있어 어차피 마일스톤이 올라가지 않지만, 명시적으로
  막아 `saving` 구간까지 함께 조용해진다.
- `startedAt`이 바뀌면 새 러닝이므로 ref를 `INITIAL_VOICE_CUE_STATE`로 리셋한다.
  `runStore.start()`가 `startedAt`을 새로 세우는 것이 유일한 신호다.
- `cue`가 `null`이 아니면 `voiceCueText(...)`로 문장을 만들어 `speakCue()`에
  넘긴다.

`index.tsx`에 추가되는 코드는 훅 호출 한 줄이다. 종료·버리기 경로에서
`stopSpeaking()`을 부른다.

## 오디오와 TTS

### 의존성

- `expo-speech` — TTS 발화.
- `expo-audio` — 오디오 세션 설정. 백그라운드 재생과 음악 ducking을 위해
  필요하다.

`app.json`에 플러그인을 추가한다.

```json
["expo-audio", { "enableBackgroundPlayback": true }]
```

iOS `UIBackgroundModes`에 `"audio"`가 붙는다(기존 `"location"`은 유지).
**네이티브 리빌드가 필요하다** — 기존 dev build로는 확인되지 않으므로
`npx expo run:ios`를 다시 돌려야 한다.

### `src/services/speech.ts`

```ts
export async function configureVoiceAudio(): Promise<void>;   // setAudioModeAsync, 1회만
export function speakCue(text: string): void;                 // Speech.stop() 후 speak
export function speakIfVoiceGuideOn(text: string | null): void; // 음성 안내 켜짐일 때만
export function stopSpeaking(): void;
```

오디오 모드는 다음과 같이 잡는다.

```ts
setAudioModeAsync({
  shouldPlayInBackground: true,   // 화면이 꺼져 있어도 안내가 나온다
  interruptionMode: 'duckOthers', // 안내 동안만 음악 볼륨이 낮아진다
  playsInSilentMode: true,        // iOS 무음 스위치와 무관하게 들린다
});
```

**`configureVoiceAudio()`는 앱 부팅이 아니라 `onStart()`(카운트다운 직전)에서
부른다.** 뛰지도 않는 동안 오디오 세션을 잡아두면 다른 앱의 음악 재생에
간섭하게 된다. 미리듣기 버튼도 발화 직전에 이 함수를 먼저 부른다 — 미리듣기는
음성 안내가 아직 꺼져 있어도 들려야 하므로, 켜짐 여부 확인은 이 함수 안이
아니라 호출부에서 한다. 내부 플래그로 중복 호출을 막는다.

`speakIfVoiceGuideOn(text)`는 음성 안내가 켜져 있을 때만 발화하는 얇은 래퍼다.
카운트다운과 총정리가 이것을 쓴다. 주기 안내는 애초에 축이 켜져 있어야
트리거되므로 `speakCue()`를 직접 쓴다.

`speakCue()`는 발화 전에 `Speech.stop()`을 부른다. `Speech.speak()`는 발화
중에 호출하면 큐에 쌓이는데, 안내가 밀리면 3분 전 거리를 읽는 사태가 난다.
**오래된 안내는 버리고 최신 것만 말한다.**

iOS에서는 `Speech.speak(text, { useApplicationAudioSession: true })`로
`expo-audio`가 설정한 세션을 쓰게 한다. 그러지 않으면 위의 ducking·백그라운드
설정이 발화에 적용되지 않는다.

언어는 `ko-KR`, 속도·음높이는 기본값을 쓴다.

### 실패는 전부 삼킨다

TTS 엔진 미설치, 음소거, 오디오 세션 획득 실패 — 어느 것도 러닝 기록에
영향을 주면 안 된다. `services/speech.ts`의 모든 함수는 예외를 잡아
`console.warn`만 남기고 정상 반환한다. `Platform.OS === 'web'`이면 전부
no-op이다.

## 테스트

판정과 문장 생성이 모두 순수 함수라 대부분 노드에서 검증된다.

`src/lib/__tests__/voice.test.ts`

- `nextVoiceCue`
  - 거리 마일스톤 도달 시 `'distance'`
  - 시간 마일스톤 도달 시 `'time'`
  - 같은 틱에 둘 다 도달하면 `'distance'` 한 번, 다음 틱에는 `null`
  - 마일스톤 3개를 한 번에 건너뛰어도 발화는 1회
  - 축이 `null`이면 그 축은 절대 발화하지 않는다
  - 축을 껐다 켜면 그동안 지나간 마일스톤이 터지지 않는다
  - 간격을 `1` → `2`로 바꿔도 경계 근처에서 즉시 재발화하지 않는다
  - `unit: 'mi'`면 마일 기준으로 판정한다
- `voiceCueText`
  - 목표 편차 `null`이면 마지막 문장이 없다
  - 앞섬 / 뒤쳐짐 / 유지 세 가지 문구
  - 페이스 `null`이면 "측정 중"
  - 경과 1시간 초과 시 "시간"이 붙는다
  - `mi` 단위에서 "마일" · "마일당"
  - 거리 소수점 끝 0 제거 (`5.20` → `5.2`, `5.00` → `5`)
- `countdownCueText`
  - `3`·`2`·`1` → "삼"·"이"·"일", `0` → "시작"
  - 범위 밖 숫자는 `null`
- `voiceSummaryText`
  - 목표 거리 미설정이면 세 문장
  - 목표 달성 / 미달 두 문구, 미달은 남은 거리를 미터로 읽는다
  - 단위별 조사 (`킬로미터를` / `마일을`)
- `isVoiceGuideOn`
  - 둘 다 `null`이면 `false`, 하나라도 켜져 있으면 `true`

`src/stores/__tests__/settingsStore.test.ts`

- 새 필드 기본값이 `null`이다
- 변경이 AsyncStorage에 저장되고 rehydrate로 복원된다
- **두 키가 없는 기존 저장본이 병합으로 복원되며 두 필드가 `null`이 된다**

`src/services/__tests__/speech.test.ts` — `expo-speech`·`expo-audio` 목으로 얇게

- `speakCue()`가 넘긴 문장이 `Speech.speak`에 전달된다
- `speakCue()`가 발화 전에 `Speech.stop()`을 부른다
- `Speech.speak`가 throw해도 `speakCue()`가 throw하지 않는다
- `configureVoiceAudio()`를 두 번 불러도 `setAudioModeAsync`는 1회만 불린다
- `speakIfVoiceGuideOn()`이 두 축 모두 `끔`이면 발화하지 않는다
- `speakIfVoiceGuideOn()`이 한 축이라도 켜져 있으면 발화한다
- `speakIfVoiceGuideOn(null)`은 아무것도 하지 않는다

## 실기기 확인 (자동화 불가)

- 화면을 끈 채 주머니에 넣고 뛰었을 때 안내가 나오는지
- 음악 재생 중 안내 동안만 볼륨이 낮아지고 안내 후 복귀하는지
- iOS 무음 스위치가 켜져 있어도 안내가 들리는지
- 거리·시간을 둘 다 켜고 뛰었을 때 중복 발화가 없는지
- 카운트다운 "삼·이·일·시작"이 화면 숫자와 같은 박자로 나오는지 (첫 숫자가
  씹히지 않는지)
- 카운트다운 취소 시 발화가 즉시 끊기는지
- 저장 직후 총정리가 나오고, 버리기에서는 나오지 않는지
- 음성 안내를 둘 다 `끔`으로 두면 카운트다운·총정리도 무음인지

## 변경 파일

**신규**

- `src/lib/voice.ts`
- `src/hooks/useVoiceCues.ts`
- `src/services/speech.ts`
- `src/components/VoiceGuideSection.tsx`
- `src/lib/__tests__/voice.test.ts`
- `src/services/__tests__/speech.test.ts`

**수정**

- `src/stores/settingsStore.ts` — 필드 2개 추가
- `src/stores/__tests__/settingsStore.test.ts` — 케이스 추가
- `app/(tabs)/settings.tsx` — `VoiceGuideSection` 배치
- `app/(tabs)/index.tsx` — `useVoiceCues()` 호출, `onStart()`에서 오디오 세션
  설정, 카운트다운 틱 발화, 저장 성공 시 총정리, 종료·버리기·취소 시
  `stopSpeaking()`
- `app.json` — `expo-audio` 플러그인
- `package.json` — `expo-speech`, `expo-audio`

## 범위 밖

- 음성 속도·음높이·목소리 선택
- 케이던스·고도 등 다른 지표의 음성 안내
- 러닝 중 목표 거리 달성 시점의 즉시 안내 (총정리에서만 다룬다)
- 카운트다운 숫자·간격 변경 (기존 `COUNTDOWN_START = 3`, 1초 간격 그대로)
