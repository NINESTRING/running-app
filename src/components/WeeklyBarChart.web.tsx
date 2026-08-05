import { StyleSheet, View } from 'react-native';

interface Props {
  data: { day: string; km: number }[];
}

// victory-native는 Skia(CanvasKit WASM) 기반이라 웹에서는 WASM을 따로 로드하지 않으면
// 동작하지 않는다. 웹 번들에서는 View 기반 막대 그래프로 대체한다.
export function WeeklyBarChart({ data }: Props) {
  const maxKm = Math.max(...data.map((d) => d.km), 1);
  return (
    <View style={styles.row}>
      {data.map((d) => (
        <View key={d.day} style={styles.slot}>
          <View
            style={[styles.bar, { height: `${(d.km / maxKm) * 100}%` }]}
          />
        </View>
      ))}
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
});
