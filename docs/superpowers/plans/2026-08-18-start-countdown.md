# 러닝 시작 카운트다운 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈에서 시작 버튼을 누르면 전체 화면에 3 → 2 → 1 → "시작!"을 보여준 뒤 러닝을 시작한다.

**Architecture:** 프레젠테이션 전용 `CountdownOverlay` 컴포넌트를 새로 만들고, 타이머와 시작 시퀀스는 `app/(tabs)/index.tsx`의 로컬 state가 소유한다. `runStore`는 변경하지 않는다 — 카운트다운은 러닝 상태가 아니라 시작 직전의 UI 연출이므로 `start()`를 부르기 전이고, 취소 시 되돌릴 스토어 상태가 없다.

**Tech Stack:** Expo(React Native 0.86), expo-router, zustand, react-native-reanimated 4, NativeWind 4, 기존 `@/components/ui/text`·`@/components/ui/native-only-animated-view`.

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-08-18-start-countdown-design.md`
- **새 npm 의존성 추가 금지.** 햅틱·사운드 없음(expo-haptics 설치 금지).
- **`src/stores/runStore.ts` 수정 금지.** 서비스 레이어(`src/services/*`)도 수정하지 않는다.
- 타이밍 상수(정확히 이 값): `COUNTDOWN_START = 3`, `COUNTDOWN_TICK_MS = 1000`, `COUNTDOWN_EXIT_MS = 500`.
- 화면 문구는 한국어: 숫자 `3` / `2` / `1`, 마지막 `시작!`. 접근성 라벨 `카운트다운 취소`.
- **순서 규칙(어기면 케이던스가 죽는다):** `runStore.start()`는 `set({ ...initial, ... })`로 상태를 전부 리셋한다. 따라서 `startStepCounting()`과 `fetchWeatherForRun()`은 **반드시 `start()` 이후**에 호출한다. 반대로 `startTracking()`(GPS)은 **카운트다운 전**에 호출한다.
- 검증: `npm test`, `npx tsc --noEmit`, `npm run lint` 모두 기존 대비 회귀 없음.
- 이 저장소에는 컴포넌트/훅 테스트 인프라(`@testing-library/react-native` 등)가 없다. 테스트 라이브러리를 새로 도입하지 않으며, UI는 수동 확인으로 검증한다.

---

### Task 1: CountdownOverlay 컴포넌트

전체 화면 딤 + 초대형 숫자를 그리는 프레젠테이션 전용 컴포넌트. 타이머를 소유하지 않고, 받은 `tick`만 그린다.

**Files:**
- Create: `src/components/CountdownOverlay.tsx`

**Interfaces:**
- Consumes: `@/components/ui/text`의 `Text`, `@/components/ui/native-only-animated-view`의 `NativeOnlyAnimatedView`, `react-native-reanimated`.
- Produces: 다음 심볼을 export 한다. Task 2가 그대로 import 한다.
  - `CountdownOverlay(props: { tick: number | null; onCancel: () => void }): React.ReactElement | null`
  - `COUNTDOWN_START: number` (= 3)
  - `COUNTDOWN_TICK_MS: number` (= 1000)
  - `COUNTDOWN_EXIT_MS: number` (= 500)
  - `tick` 의미: `3`·`2`·`1`은 숫자 표시, `0`은 "시작!"(러닝은 이미 시작됨, 취소 불가), `null`은 렌더 안 함.

- [ ] **Step 1: 컴포넌트 파일 생성**

`src/components/CountdownOverlay.tsx`를 아래 내용 그대로 만든다.

```tsx
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  ZoomIn,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view';
import { Text } from '@/components/ui/text';

/** 카운트다운 시작 숫자 */
export const COUNTDOWN_START = 3;
/** 숫자 하나가 머무는 시간 */
export const COUNTDOWN_TICK_MS = 1000;
/** tick 0("시작!")부터 오버레이가 사라지기까지 — 이 구간에서 러닝은 이미 진행 중이다 */
export const COUNTDOWN_EXIT_MS = 500;

type Props = {
  /** 3·2·1 = 숫자, 0 = "시작!"(취소 불가), null = 렌더 안 함 */
  tick: number | null;
  onCancel: () => void;
};

/**
 * 러닝 시작 전 3·2·1 카운트다운 오버레이.
 * 타이머는 호출부가 소유한다 — 이 컴포넌트는 받은 tick을 그리기만 한다.
 */
export function CountdownOverlay({ tick, onCancel }: Props) {
  const opacity = useSharedValue(1);

  // tick 0(= 러닝 시작 시점)부터 페이드아웃. 호출부가 COUNTDOWN_EXIT_MS 뒤 tick을 null로 만든다.
  useEffect(() => {
    opacity.value = tick === 0 ? withTiming(0, { duration: COUNTDOWN_EXIT_MS }) : 1;
  }, [tick, opacity]);

  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (tick === null) return null;

  const started = tick === 0;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, fadeStyle]}
      pointerEvents={started ? 'none' : 'auto'}
    >
      <View
        className="flex-1 items-center justify-center bg-black/70"
        accessibilityLiveRegion="assertive"
      >
        {/* key로 매 틱 새 노드를 마운트해 전환 애니메이션을 만든다 */}
        <NativeOnlyAnimatedView key={tick} entering={ZoomIn.duration(200)}>
          <Text
            className="font-bold text-white"
            style={
              started
                ? { fontSize: 72, lineHeight: 88 }
                : { fontSize: 140, lineHeight: 160 }
            }
          >
            {started ? '시작!' : String(tick)}
          </Text>
        </NativeOnlyAnimatedView>
        {/* 숫자 구간에서만 취소 가능 — "시작!" 이후엔 이미 러닝이 시작됐다 */}
        {!started && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="카운트다운 취소"
            onPress={onCancel}
            style={StyleSheet.absoluteFill}
          />
        )}
      </View>
    </Animated.View>
  );
}
```

구현 주의:
- 딤·정렬 스타일은 안쪽 `View`의 `className`에 둔다. NativeWind의 `className`을 Reanimated의 `Animated.View`에 직접 거는 것은 피하고, 애니메이션 값은 `style`로만 전달한다.
- `NativeOnlyAnimatedView`에는 `className`을 주지 않는다. 이 컴포넌트는 web에서 자식만 반환하므로 스타일이 사라진다.
- 훅(`useSharedValue`·`useEffect`·`useAnimatedStyle`)은 `if (tick === null) return null;`보다 **위**에 있어야 한다.

- [ ] **Step 2: 타입 검사**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: 린트**

Run: `npm run lint`
Expected: `src/components/CountdownOverlay.tsx`에 대한 새 error 없음.

- [ ] **Step 4: 기존 테스트 회귀 확인**

Run: `npm test`
Expected: 기존과 동일하게 전부 통과.

- [ ] **Step 5: 커밋**

```bash
git add src/components/CountdownOverlay.tsx
git commit -m "feat(run): 시작 카운트다운 오버레이 컴포넌트"
```

---

### Task 2: 홈 화면 배선 — 시작 시퀀스 분리·타이머·취소

시작 버튼을 "권한·GPS까지만" 담당하게 바꾸고, 실제 러닝 시작은 카운트다운 0초 시점으로 옮긴다.

**Files:**
- Modify: `app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: Task 1의 `CountdownOverlay`, `COUNTDOWN_START`, `COUNTDOWN_TICK_MS`, `COUNTDOWN_EXIT_MS`. 기존 함수 `requestPermissions(): Promise<boolean>`, `startTracking(): Promise<void>`(throw 가능), `stopTracking(): Promise<void>`(throw 가능), `requestPedometerPermissions(): Promise<boolean>`, `startStepCounting(): Promise<void>`, `useRunStore.getState().start(now: number)`.
- Produces: 없음 (말단 화면).

- [ ] **Step 1: import 추가**

`app/(tabs)/index.tsx` 상단 import 블록의 `import { GoalDialog } from '@/components/GoalDialog';` 바로 아래에 추가:

```tsx
import {
  CountdownOverlay,
  COUNTDOWN_EXIT_MS,
  COUNTDOWN_START,
  COUNTDOWN_TICK_MS,
} from '@/components/CountdownOverlay';
```

- [ ] **Step 2: state와 재진입 가드 추가**

`const [dialog, setDialog] = useState<DialogState>(null);` (약 74행) 바로 아래에 추가:

```tsx
  // 3·2·1·0(시작!) — null이면 카운트다운 중이 아니다. runStore는 이 구간 내내 idle.
  const [countdown, setCountdown] = useState<number | null>(null);
```

그리고 `const locatingRef = useRef(false);` (약 80행) 바로 아래에 추가:

```tsx
  const startingRef = useRef(false);
```

- [ ] **Step 3: onStart를 beginRun / onStart / onCancelCountdown으로 분리**

기존 `onStart`(약 154–177행) 전체를 아래 세 함수로 교체한다.

```tsx
  // 카운트다운 0초 시점 — 여기가 실제 러닝 시작이다.
  // 만보계·날씨는 반드시 start() 이후에 부른다: start()가 상태를 initial로 리셋하므로
  // 먼저 부르면 beginStepTracking()이 세운 steps:0이 null로 덮여 케이던스가 영구히 '--'가 된다.
  const beginRun = async () => {
    const startedAt = Date.now();
    useRunStore.getState().start(startedAt);
    setNow(startedAt);
    fetchWeatherForRun().catch(() => {});
    // 모션 권한 거부·미지원이어도 러닝은 계속 — 케이던스만 '--'
    if (await requestPedometerPermissions()) {
      await startStepCounting();
    }
  };

  // 시작 탭: 권한·GPS 추적까지만 확보하고 카운트다운으로 넘긴다.
  // 추적을 먼저 켜두면 3초간 GPS가 워밍업되고, 권한 팝업·실패 다이얼로그가 카운트다운을 깨지 않는다.
  // 이 구간에 도착한 좌표는 addPoint의 status 가드가 버리고, 뒤이은 start()가 points를 비운다.
  const onStart = async () => {
    if (startingRef.current || countdown !== null) return;
    startingRef.current = true;
    try {
      const granted = await requestPermissions();
      if (!granted) {
        setPermissionDenied(true);
        return;
      }
      setPermissionDenied(false);
      try {
        await startTracking();
      } catch (e) {
        setDialog({
          type: 'startError',
          message: e instanceof Error ? e.message : String(e),
        });
        return;
      }
      setCountdown(COUNTDOWN_START);
    } finally {
      startingRef.current = false;
    }
  };

  // 카운트다운 취소 — start()를 아직 안 불렀으므로 켜둔 GPS만 되돌리면 된다.
  const onCancelCountdown = () => {
    if (countdown === null || countdown === 0) return;
    setCountdown(null);
    stopTracking().catch(() => {});
  };

  // 카운트다운 틱. 0에 닿는 순간 러닝을 시작하고, COUNTDOWN_EXIT_MS 뒤 오버레이를 걷는다.
  // 클린업이 예약된 타이머를 지우므로 "취소했는데 1초 뒤 시작되는" 레이스가 없다.
  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      const t = setTimeout(() => setCountdown(null), COUNTDOWN_EXIT_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      const next = countdown - 1;
      setCountdown(next);
      if (next === 0) void beginRun();
    }, COUNTDOWN_TICK_MS);
    return () => clearTimeout(t);
  }, [countdown]);
```

주의:
- `beginRun`은 `fetchWeatherForRun` 정의(약 145행) **뒤**에 와야 한다. 위 블록을 기존 `onStart` 자리에 그대로 넣으면 조건이 충족된다.
- 기존 `onPause`·`onResume`·`onStopPressed`·`onDiscard`·`onStop`은 손대지 않는다.
- 시작 버튼의 `onPress={onStart}`도 그대로 둔다.
- 이 `useEffect`의 의존성 배열에 `beginRun`을 넣지 않는다. 매 렌더 새로 만들어지는 함수라 넣으면 타이머가 계속 재설정된다. `react-hooks/exhaustive-deps` 경고는 이 파일의 기존 마운트 effect(약 98행)와 동일하게 그대로 둔다.

- [ ] **Step 4: 오버레이 렌더**

`app/(tabs)/index.tsx`의 루트 `<View className="flex-1">` 안, 닫는 `</View>` 직전(= `</AlertDialog>` 다음)에 추가:

```tsx
      <CountdownOverlay tick={countdown} onCancel={onCancelCountdown} />
```

- [ ] **Step 5: 타입 검사**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 6: 린트**

Run: `npm run lint`
Expected: 새 error 없음. `react-hooks/exhaustive-deps` warning은 허용.

- [ ] **Step 7: 기존 테스트 회귀 확인**

Run: `npm test`
Expected: 전부 통과. 특히 `src/stores/__tests__/runStore.test.ts` — `runStore`를 건드리지 않았으므로 변화가 없어야 한다.

- [ ] **Step 8: 커밋**

```bash
git add "app/(tabs)/index.tsx"
git commit -m "feat(run): 시작 시 3·2·1 카운트다운 후 러닝 시작"
```

- [ ] **Step 9: 실기기 수동 확인**

`npm run ios`로 dev build를 띄우고 아래를 순서대로 확인한다. 실패 항목은 고치고 Step 5–8을 다시 돈다.

1. 시작 탭 → 화면이 어두워지며 큰 `3` → `2` → `1` → `시작!`이 1초 간격으로 뜬다.
2. `시작!`이 뜨는 순간부터 시간 지표가 `00:00`에서 오르기 시작한다. 카운트다운 3초는 기록에 포함되지 않는다.
3. `시작!` 이후 약 0.5초에 걸쳐 오버레이가 사라지고 러닝 화면(일시정지·종료 버튼)이 보인다.
4. 다시 처음부터: 시작 탭 → `2`가 보일 때 화면을 탭 → 오버레이가 사라지고 시작 버튼이 있는 idle 화면으로 돌아온다. 거리·시간은 `0.00`·`00:00`.
5. 위 취소 직후 상태표시줄의 위치 추적 표시가 사라진다(`stopTracking` 확인).
6. 취소 후 다시 시작 → 정상적으로 카운트다운과 러닝이 동작한다.
7. 러닝을 30초 이상 진행 → 케이던스가 `--`로 굳지 않고 숫자가 뜬다.
8. 시작 버튼을 빠르게 두 번 탭 → 카운트다운이 한 번만 시작되고 숫자가 겹치지 않는다.
9. `1`이 `시작!`로 바뀌는 바로 그 순간에 화면을 탭 → 러닝이 정상 시작되고 거리가 실제로 증가한다 (취소되지 않는다).
