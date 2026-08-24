import { View } from 'react-native';
import { Text } from '@/components/ui/text';
import { formatDuration } from '@/lib/geo';
import type { Lap } from '@/lib/laps';

const MIN_BAR_PCT = 30; // 가장 느린 바퀴도 랩타임 텍스트가 들어갈 최소 폭

/** 나이키 스타일 바퀴 리스트: 바퀴 번호 | 랩타임(상대 막대) | 거리 */
export function LapsList({ laps }: { laps: Lap[] }) {
  if (laps.length === 0) return null;
  // 막대 길이는 페이스(초/m) 기준 — 바퀴마다 측정 거리가 조금씩 달라도 공정하게 비교된다
  const paces = laps.map((l) => (l.distanceM > 0 ? l.durationSec / l.distanceM : null));
  const valid = paces.filter((p): p is number => p !== null);
  const fastest = valid.length > 0 ? Math.min(...valid) : null;

  return (
    <View className="gap-2 px-4 pt-6">
      <Text className="text-lg font-semibold">바퀴</Text>
      <View className="flex-row">
        <Text className="w-12 text-xs text-muted-foreground">바퀴</Text>
        <Text className="flex-1 text-xs text-muted-foreground">랩타임</Text>
        <Text className="w-16 text-right text-xs text-muted-foreground">거리</Text>
      </View>
      {laps.map((lap, i) => {
        const pace = paces[i];
        // 빠를수록 긴 막대 (가장 빠른 바퀴 = 100%)
        const widthPct =
          pace !== null && fastest !== null
            ? Math.max((fastest / pace) * 100, MIN_BAR_PCT)
            : MIN_BAR_PCT;
        return (
          <View key={lap.index} className="flex-row items-center">
            <Text className="w-12 font-semibold">{lap.index}</Text>
            <View className="flex-1">
              <View
                className="rounded-md bg-muted px-3 py-2"
                style={{ width: `${widthPct}%` }}
              >
                <Text className="text-sm">{formatDuration(lap.durationSec * 1000)}</Text>
              </View>
            </View>
            <Text className="w-16 text-right text-sm text-muted-foreground">
              {`${Math.round(lap.distanceM)} m`}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
