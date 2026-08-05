import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WeeklyBarChart } from '../../src/components/WeeklyBarChart';
import { weeklyDistances } from '../../src/lib/stats';
import { listRuns } from '../../src/services/runs';

export default function StatsScreen() {
  const [data, setData] = useState(() => weeklyDistances([], new Date()));

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      listRuns().then((runs) => {
        if (!cancelled) setData(weeklyDistances(runs, new Date()));
      });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>이번 주 거리 (km)</Text>
      <View style={styles.chart}>
        <WeeklyBarChart data={data} />
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
