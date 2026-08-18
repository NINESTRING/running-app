# 러닝 시작 카운트다운 설계

2026-08-18

## 목표

홈에서 시작 버튼을 누르면 곧바로 러닝이 시작되는 대신, 화면 전체에 큰 숫자로
3 → 2 → 1 → "시작!"을 보여준 뒤 러닝을 시작한다. 준비할 시간을 주고,
실수로 눌렀을 때 빠져나갈 수 있게 한다.

## 요구사항

- 시작 버튼 탭 → 권한 요청·GPS 추적 시작이 성공한 경우에만 카운트다운 진입.
  권한 거부·추적 실패는 지금과 동일하게 처리하며 카운트다운을 띄우지 않는다.
- 카운트다운은 1초 간격으로 `3` → `2` → `1` → `시작!`.
- **"시작!"이 표시되는 순간이 러닝 타이머가 시작되는 순간이다.** 사용자가 보는
  시점과 기록의 시작 시각이 일치한다.
- 오버레이는 화면 전체를 반투명 검정으로 덮고 가운데에 초대형 숫자를 둔다.
  지도·지표 카드 모두 덮는다.
- 숫자가 표시되는 동안(3·2·1) 오버레이 아무 곳이나 탭하면 취소되고 idle로
  돌아간다. 이미 시작된 GPS 추적도 중지한다.
- "시작!"이 뜬 뒤(= 이미 시작됨)에는 취소할 수 없다.
- 새 네이티브 의존성을 추가하지 않는다(햅틱·사운드 없음).

## 시작 흐름

```
시작 탭
  ├ requestPermissions()      거부 → permissionDenied 안내. 카운트다운 없음
  ├ startTracking()           실패 → startError 다이얼로그. 카운트다운 없음
  └ setCountdown(3)           ← 오버레이 시작

t=0.0s   "3"
t=1.0s   "2"
t=2.0s   "1"
t=3.0s   "시작!"  +  runStore.start(now)
                     setNow(now)
                     fetchWeatherForRun()
                     requestPedometerPermissions() → startStepCounting()
t=3.5s   오버레이 제거 (3.0s부터 페이드아웃, 터치 통과)
```

### GPS 추적만 앞당기는 이유

`startTracking()`을 카운트다운 **전에** 부르면 3초 동안 GPS가 워밍업되어 첫
좌표 정확도가 오르고, OS 권한 팝업이나 실패 다이얼로그가 카운트다운을 깨지
않는다. 이 구간에 도착한 좌표는 `runStore.addPoint`의 `status !== 'running'`
가드가 버리고, 이어지는 `start()`가 `points`·`distanceM`을 다시 비우므로
거리에 섞이지 않는다.

### 만보계·날씨를 앞당기지 않는 이유

`runStore.start()`는 `set({ ...initial, ... })`로 상태 전체를 리셋한다.
`startStepCounting()`을 먼저 부르면 그 안의 `beginStepTracking()`이 세운
`steps: 0`을 `start()`가 `null`로 덮어쓴다. 구독은 살아 있으므로 이후
`addStepReading`이 `steps === null` 가드에 걸려 `lastStepReading`만 갱신하고,
케이던스가 러닝 내내 `--`로 굳는다. 날씨 조회도 `startedAt`을 읽으므로
`start()` 이후여야 한다. 두 호출은 0초 블록에 그대로 둔다.

## 상태 위치

카운트다운 값은 `HomeScreen`의 로컬 state(`countdown: number | null`)로 둔다.
`runStore`는 변경하지 않는다.

카운트다운은 러닝 상태가 아니라 시작 직전의 UI 연출이다. `runStore`에
`'countdown'` status를 추가하면 `addPoint`·`addStepReading`·`beginSave`의 모든
status 가드와 기존 스토어 테스트를 재검토해야 하지만 얻는 것이 없다. 또한
`start()`를 아직 부르지 않았으므로 취소 시 되돌릴 스토어 상태가 없다.

## 구현

### `src/components/CountdownOverlay.tsx` (신규)

프레젠테이션 전용. 타이머를 소유하지 않는다.

```tsx
type Props = { tick: number | null; onCancel: () => void };
```

- `COUNTDOWN_START = 3`, `COUNTDOWN_TICK_MS = 1000`, `COUNTDOWN_EXIT_MS = 500`을
  이 파일에서 export한다.
- `tick === null`이면 `null`을 반환한다.
- 컨테이너: `absolute inset-0 items-center justify-center bg-black/70`.
  `HomeScreen` 루트 `View`의 마지막 자식으로 렌더해 지도·카드 위에 온다.
- 숫자: Reanimated `Animated.Text`에 `key={tick}` + `entering={ZoomIn.duration(200)}`.
  틱마다 새 노드가 마운트되어 전환이 생긴다. `text-white font-bold`, `fontSize: 140`.
- `tick === 0`: 텍스트를 `시작!`(`fontSize: 72`)로 바꾸고 컨테이너에
  `exiting={FadeOut}`, `pointerEvents="none"`을 준다.
- 취소: `tick > 0`일 때만 화면을 덮는 `Pressable`이 `onCancel`을 호출한다.
- 접근성: 컨테이너에 `accessibilityLiveRegion="assertive"`, 취소 `Pressable`에
  `accessibilityRole="button"`과 `accessibilityLabel="카운트다운 취소"`.

### `app/(tabs)/index.tsx` (수정)

- `const [countdown, setCountdown] = useState<number | null>(null)` 추가.
- 기존 `onStart`를 둘로 나눈다.
  - `onStart`: 재진입 가드 → `requestPermissions()` → `startTracking()` →
    `setCountdown(COUNTDOWN_START)`.
  - `beginRun()`: `runStore.start(now)` · `setNow(now)` · `fetchWeatherForRun()` ·
    `requestPedometerPermissions()` → `startStepCounting()`.
- 틱 `useEffect`:
  - `countdown === null` → 아무것도 하지 않는다.
  - `countdown === 0` → `COUNTDOWN_EXIT_MS` 후 `setCountdown(null)`.
  - 그 외 → `COUNTDOWN_TICK_MS` 후 `setCountdown(countdown - 1)`, 다음 값이 0이면
    같은 콜백에서 `beginRun()`을 호출한다.
  - 클린업에서 항상 `clearTimeout`.
- 재진입 가드: `startingRef`(권한·추적 await 구간)와 `countdown !== null` 조건으로
  시작 버튼 더블탭을 막는다. 현재 코드에는 없는 보호다.
- 취소 핸들러: `countdown`이 `null`이나 `0`이면 무시, 아니면 `setCountdown(null)`
  후 `stopTracking().catch(() => {})`.
- 루트 `View` 마지막에 `<CountdownOverlay tick={countdown} onCancel={...} />`.

## 엣지 케이스

- **취소 레이스**: `setCountdown(null)`이 틱 `useEffect`의 클린업을 돌려
  예약된 `setTimeout`을 지운다. "취소했는데 1초 뒤 시작"이 일어날 수 없다.
- **카운트다운 중 탭 전환**: 타이머는 계속 돌아 러닝이 시작된다. 시작을 눌렀다는
  의도대로이므로 별도 처리하지 않는다.
- **시작 버튼 더블탭**: `startingRef` + `countdown !== null` 가드.
- **추적 시작 실패**: 기존 `startError` 다이얼로그. `countdown`은 `null`로 유지.
- **카운트다운 중 도착한 GPS 좌표**: `addPoint`의 status 가드가 버리고,
  `start()`가 `points`를 비운다.
- **web**: 플랫폼 분기 없이 동일하게 동작한다. Reanimated의 `ZoomIn`/`FadeOut`은
  웹에서도 지원되며, 실패해도 숫자 자체는 표시된다.

## 테스트

새 순수 로직이 없다(라벨 매핑 한 줄이 전부). 단위 테스트 대상이 없으므로 검증은
회귀 + 수동 확인으로 한다.

- `npm test` — 기존 스토어·서비스 회귀, 특히 `src/stores/__tests__/runStore.test.ts`.
- `npx tsc --noEmit`, `npm run lint`.
- 실기기 확인:
  - 3 → 2 → 1 → 시작! 이후 시간 지표가 00:00부터 오른다.
  - 카운트다운 중 화면을 탭하면 idle로 돌아가고, 다시 시작하면 정상 동작한다.
  - 취소 후 상태표시줄의 위치 추적 표시가 사라진다.
  - 러닝 시작 후 케이던스가 `--`로 굳지 않고 숫자가 뜬다.
  - 거리·시간이 카운트다운 구간을 포함하지 않는다.
