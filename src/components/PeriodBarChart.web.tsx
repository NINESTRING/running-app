import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { METERS_PER_MILE } from '@/lib/geo';
import { niceMax, type Bucket } from '@/lib/stats';

interface Props {
  buckets: Bucket[];
  averageM: number | null;
  unit: 'km' | 'mi';
}

// victory-native는 Skia(CanvasKit WASM) 기반이라 웹에서는 WASM을 따로 로드하지 않으면
// 동작하지 않는다. 웹 번들에서는 View 기반 막대 그래프로 대체한다.
export function PeriodBarChart({ buckets, averageM, unit }: Props) {
  const unitM = unit === 'mi' ? METERS_PER_MILE : 1000;
  const yMax = niceMax(Math.max(...buckets.map((b) => b.distanceM / unitM), 0));
  const avg = averageM === null ? null : averageM / unitM;
  const sparse = buckets.length > 8;

  return (
    <View className="gap-1">
      <View className="flex-row">
        <View className="h-52 flex-1">
          <View style={styles.row}>
            {buckets.map((b) => (
              <View key={b.start.toISOString()} style={styles.slot}>
                <View
                  style={[
                    styles.bar,
                    { height: `${(b.distanceM / unitM / yMax) * 100}%` },
                  ]}
                />
              </View>
            ))}
          </View>
          {avg !== null && (
            <>
              <View style={[styles.avgLine, { top: `${(1 - avg / yMax) * 100}%` }]} />
              <Text
                className="absolute right-1 text-xs text-muted-foreground"
                style={{ top: `${(1 - avg / yMax) * 100}%`, marginTop: -18 }}
              >
                {avg.toFixed(1)}
              </Text>
            </>
          )}
        </View>
        <View className="h-52 w-12 justify-between pl-1">
          <Text className="text-xs text-muted-foreground">{yMax}</Text>
          <Text className="text-xs text-muted-foreground">0{unit}</Text>
        </View>
      </View>
      <View className="flex-row pr-12">
        {buckets.map((b, i) => (
          <View key={b.start.toISOString()} className="flex-1 items-center">
            <Text className="text-xs text-muted-foreground">
              {sparse && i % 2 === 1 ? '' : b.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
  },
  slot: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  bar: {
    width: '55%',
    backgroundColor: '#3b82f6',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  avgLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#9ca3af',
  },
});
