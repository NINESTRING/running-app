import { useEffect } from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  ZoomIn,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Portal } from '@rn-primitives/portal';
import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view';
import { Text } from '@/components/ui/text';
import { COUNTDOWN_EXIT_MS } from '@/lib/countdown';

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

  // 숫자 변화 안내. Android·web은 accessibilityLiveRegion이 처리하지만 iOS는 지원하지
  // 않으므로 명시적으로 알린다. VoiceOver가 꺼져 있으면 no-op이고 포커스는 옮기지 않는다.
  useEffect(() => {
    if (tick === null || Platform.OS !== 'ios') return;
    AccessibilityInfo.announceForAccessibility(tick === 0 ? '시작' : String(tick));
  }, [tick]);

  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (tick === null) return null;

  const started = tick === 0;

  return (
    // 루트 PortalHost에 그린다 — 탭 scene 안에 두면 노치 영역과 탭바가 덮이지 않는다
    <Portal name="countdown-overlay">
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
    </Portal>
  );
}
