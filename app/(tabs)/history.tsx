import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDistance, formatDuration } from '../../src/lib/geo';
import { listRuns } from '../../src/services/runs';
import { supabase } from '../../src/services/supabase';
import { useSettingsStore } from '../../src/stores/settingsStore';
import type { RunRecord } from '../../src/types/run';

export default function HistoryScreen() {
  const router = useRouter();
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const unit = useSettingsStore((s) => s.unit);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      listRuns().then((r) => {
        if (!cancelled) setRuns(r);
      });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  if (!supabase) {
    return (
      <View style={styles.center}>
        <Text style={styles.dim}>
          Supabase가 설정되지 않았습니다.{'\n'}.env에 URL과 키를 넣어주세요.
        </Text>
      </View>
    );
  }

  if (runs.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.dim}>아직 러닝 기록이 없습니다.</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={runs}
      keyExtractor={(r) => r.id}
      renderItem={({ item }) => (
        <Pressable
          style={styles.row}
          onPress={() => router.push(`/run/${item.id}`)}
        >
          <Text style={styles.rowTitle}>
            {new Date(item.startedAt).toLocaleDateString('ko-KR')}
          </Text>
          <Text style={styles.dim}>
            {formatDistance(item.distanceM, unit)}{unit} ·{' '}
            {formatDuration(item.durationSec * 1000)}
          </Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  dim: { color: '#6b7280', textAlign: 'center' },
  row: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
    gap: 4,
  },
  rowTitle: { fontSize: 16, fontWeight: '600' },
});
