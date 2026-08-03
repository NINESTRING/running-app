import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Bar, CartesianChart } from 'victory-native';
import { weeklyDistances } from '../../src/lib/stats';
import { listRuns } from '../../src/services/runs';

export default function StatsScreen() {
  const [data, setData] = useState(() => weeklyDistances([], new Date()));

  useFocusEffect(
    useCallback(() => {
      listRuns().then((runs) => setData(weeklyDistances(runs, new Date())));
    }, [])
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>이번 주 거리 (km)</Text>
      <View style={styles.chart}>
        <CartesianChart data={data} xKey="day" yKeys={['km']}>
          {({ points, chartBounds }) => (
            <Bar
              points={points.km}
              chartBounds={chartBounds}
              color="#3b82f6"
              roundedCorners={{ topLeft: 4, topRight: 4 }}
            />
          )}
        </CartesianChart>
      </View>
      <View style={styles.labels}>
        {data.map((d) => (
          <Text key={d.day} style={styles.dayLabel}>
            {d.day}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 8 },
  title: { fontSize: 16, fontWeight: '600' },
  chart: { height: 240 },
  labels: { flexDirection: 'row', justifyContent: 'space-around' },
  dayLabel: { fontSize: 12, color: '#6b7280' },
});
