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
