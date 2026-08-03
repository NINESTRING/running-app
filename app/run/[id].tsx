import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RouteMap } from '../../src/components/RouteMap';
import {
  formatDistance,
  formatDuration,
  formatPace,
  paceSecPerKm,
} from '../../src/lib/geo';
import { getRun } from '../../src/services/runs';
import { useSettingsStore } from '../../src/stores/settingsStore';
import type { RoutePoint, RunRecord } from '../../src/types/run';

export default function RunDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [run, setRun] = useState<RunRecord | null>(null);
  const unit = useSettingsStore((s) => s.unit);

  useEffect(() => {
    let cancelled = false;
    if (id) {
      getRun(id).then((r) => {
        if (!cancelled) setRun(r);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!run) {
    return (
      <View style={styles.center}>
        <Text style={styles.dim}>기록을 불러오는 중이거나 찾을 수 없습니다.</Text>
      </View>
    );
  }

  const points: RoutePoint[] =
    run.routeGeojson?.coordinates.map(([lon, lat]) => ({
      latitude: lat,
      longitude: lon,
      timestamp: 0,
    })) ?? [];

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <RouteMap points={points} />
      </View>
      <View style={styles.summary}>
        <Text style={styles.title}>
          {new Date(run.startedAt).toLocaleString('ko-KR')}
        </Text>
        <Text>
          {formatDistance(run.distanceM, unit)}{unit} ·{' '}
          {formatDuration(run.durationSec * 1000)} ·{' '}
          {formatPace(paceSecPerKm(run.distanceM, run.durationSec * 1000))}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dim: { color: '#6b7280' },
  summary: { padding: 16, gap: 8 },
  title: { fontSize: 16, fontWeight: '600' },
});
