import { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { RouteMap } from '../../src/components/RouteMap';
import {
  formatDistanceKm,
  formatDuration,
  formatPace,
  paceSecPerKm,
} from '../../src/lib/geo';
import {
  requestPermissions,
  startTracking,
  stopTracking,
} from '../../src/services/location';
import { saveRun } from '../../src/services/runs';
import { elapsedMs, useRunStore } from '../../src/stores/runStore';

export default function HomeScreen() {
  const status = useRunStore((s) => s.status);
  const points = useRunStore((s) => s.points);
  const distanceM = useRunStore((s) => s.distanceM);
  const accumulatedMs = useRunStore((s) => s.accumulatedMs);
  const segmentStartedAt = useRunStore((s) => s.segmentStartedAt);
  const [now, setNow] = useState(() => Date.now());
  const [permissionDenied, setPermissionDenied] = useState(false);

  useEffect(() => {
    if (status !== 'running') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status]);

  const elapsed = elapsedMs({ accumulatedMs, segmentStartedAt }, now);

  const onStart = async () => {
    const granted = await requestPermissions();
    if (!granted) {
      setPermissionDenied(true);
      return;
    }
    setPermissionDenied(false);
    useRunStore.getState().start(Date.now());
    setNow(Date.now());
    await startTracking();
  };

  const onPause = () => useRunStore.getState().pause(Date.now());

  const onResume = () => {
    useRunStore.getState().resume(Date.now());
    setNow(Date.now());
  };

  const onStop = async () => {
    await stopTracking();
    const s = useRunStore.getState();
    const stoppedAt = Date.now();
    const durationSec = Math.round(elapsedMs(s, s.status === 'running' ? stoppedAt : 0) / 1000);
    const result = await saveRun({
      startedAt: s.startedAt ?? stoppedAt,
      durationSec,
      distanceM: s.distanceM,
      points: s.points,
    });
    Alert.alert(
      result.ok ? '저장 완료' : '저장하지 못했습니다',
      result.ok ? '기록 탭에서 확인하세요.' : result.error
    );
    useRunStore.getState().reset();
  };

  return (
    <View style={styles.container}>
      <RouteMap points={points} showsUserLocation />
      <View style={styles.panel}>
        {permissionDenied && (
          <Pressable onPress={() => Linking.openSettings()}>
            <Text style={styles.warn}>
              위치 권한이 필요합니다. 눌러서 설정 열기
            </Text>
          </Pressable>
        )}
        <View style={styles.metrics}>
          <Metric label="거리(km)" value={formatDistanceKm(distanceM)} />
          <Metric label="시간" value={formatDuration(elapsed)} />
          <Metric label="페이스" value={formatPace(paceSecPerKm(distanceM, elapsed))} />
        </View>
        <View style={styles.buttons}>
          {status === 'idle' && (
            <Button label="시작" onPress={onStart} color="#3b82f6" />
          )}
          {status === 'running' && (
            <>
              <Button label="일시정지" onPress={onPause} color="#f59e0b" />
              <Button label="종료" onPress={onStop} color="#ef4444" />
            </>
          )}
          {status === 'paused' && (
            <>
              <Button label="재개" onPress={onResume} color="#3b82f6" />
              <Button label="종료" onPress={onStop} color="#ef4444" />
            </>
          )}
        </View>
      </View>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function Button({
  label,
  onPress,
  color,
}: {
  label: string;
  onPress: () => void;
  color: string;
}) {
  return (
    <Pressable style={[styles.button, { backgroundColor: color }]} onPress={onPress}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  panel: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  warn: { color: '#ef4444', textAlign: 'center' },
  metrics: { flexDirection: 'row', justifyContent: 'space-around' },
  metric: { alignItems: 'center' },
  metricValue: { fontSize: 24, fontWeight: '700' },
  metricLabel: { fontSize: 12, color: '#6b7280' },
  buttons: { flexDirection: 'row', gap: 12, justifyContent: 'center' },
  button: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 24,
  },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600' },
});
