import { View } from 'react-native';
import { Text } from '@/components/ui/text';
import { formatPace } from '@/lib/geo';
import { splitPaceSec, type Split } from '@/lib/splits';

interface Props {
  completed: Split[];
  current: Split | null;
  splitDistanceM: number;
  unit: 'km' | 'mi';
}

const MIN_BAR_PCT = 30; // 가장 느린 구간도 페이스 텍스트가 들어갈 최소 폭

/** 나이키 스타일 구간 리스트: 구간 번호 | 페이스(상대 막대) | 고도 변화 */
export function SplitsList({ completed, current, splitDistanceM, unit }: Props) {
  const rows = [
    ...completed.map((s) => ({ split: s, label: String(s.index) })),
    // 진행 중(잔여) 구간은 부분 거리로 표기 (예: 0.4)
    ...(current
      ? [{ split: current, label: (current.distanceM / splitDistanceM).toFixed(1) }]
      : []),
  ];
  if (rows.length === 0) return null;

  const paces = rows.map(({ split }) => splitPaceSec(split, splitDistanceM));
  const valid = paces.filter((p): p is number => p !== null);
  const fastest = valid.length > 0 ? Math.min(...valid) : null;
  const showElevation = rows.some(({ split }) => split.elevationDeltaM !== null);

  return (
    <View className="gap-2 px-4 pt-2">
      <Text className="text-lg font-semibold">구간</Text>
      <View className="flex-row">
        <Text className="w-12 text-xs text-muted-foreground">
          {unit === 'mi' ? 'Mi' : 'Km'}
        </Text>
        <Text className="flex-1 text-xs text-muted-foreground">평균 페이스</Text>
        {showElevation && (
          <Text className="w-16 text-right text-xs text-muted-foreground">고도</Text>
        )}
      </View>
      {rows.map(({ split, label }, i) => {
        const pace = paces[i];
        // 빠를수록 긴 막대 (가장 빠른 구간 = 100%)
        const widthPct =
          pace !== null && fastest !== null
            ? Math.max((fastest / pace) * 100, MIN_BAR_PCT)
            : MIN_BAR_PCT;
        return (
          <View key={split.index} className="flex-row items-center">
            <Text className="w-12 font-semibold">{label}</Text>
            <View className="flex-1">
              <View
                className="rounded-md bg-muted px-3 py-2"
                style={{ width: `${widthPct}%` }}
              >
                <Text className="text-sm">{formatPace(pace)}</Text>
              </View>
            </View>
            {showElevation && (
              <Text className="w-16 text-right text-sm text-muted-foreground">
                {split.elevationDeltaM === null
                  ? '—'
                  : `${Math.round(split.elevationDeltaM)} m`}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}
