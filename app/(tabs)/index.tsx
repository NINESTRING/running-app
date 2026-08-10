import { useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { RouteMap } from '@/components/RouteMap';
import { formatDistance, formatDuration, formatPace, paceSecPerKm } from '@/lib/geo';
import { requestPermissions, startTracking, stopTracking } from '@/services/location';
import { saveRun } from '@/services/runs';
import { useSettingsStore } from '@/stores/settingsStore';
import { elapsedMs, useRunStore } from '@/stores/runStore';

type DialogState =
  | { type: 'startError'; message: string }
  | { type: 'saved' }
  | { type: 'saveError'; message: string }
  | null;

export default function HomeScreen() {
  const status = useRunStore((s) => s.status);
  const points = useRunStore((s) => s.points);
  const distanceM = useRunStore((s) => s.distanceM);
  const accumulatedMs = useRunStore((s) => s.accumulatedMs);
  const segmentStartedAt = useRunStore((s) => s.segmentStartedAt);
  const unit = useSettingsStore((s) => s.unit);
  const [now, setNow] = useState(() => Date.now());
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);

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
    try {
      await startTracking();
    } catch (e) {
      setDialog({
        type: 'startError',
        message: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    useRunStore.getState().start(Date.now());
    setNow(Date.now());
  };

  const onPause = () => useRunStore.getState().pause(Date.now());

  const onResume = () => {
    useRunStore.getState().resume(Date.now());
    setNow(Date.now());
  };

  const onStop = async () => {
    // saving 전환에 실패하면 이미 저장이 진행 중 → 중복 저장 방지
    if (!useRunStore.getState().beginSave(Date.now())) return;
    try {
      await stopTracking();
    } catch {
      // 추적 중지 실패해도 이후 기록 저장 로직은 계속 진행
    }
    const s = useRunStore.getState();
    const stoppedAt = Date.now();
    const durationSec = Math.round(elapsedMs(s, 0) / 1000);
    const result = await saveRun({
      startedAt: s.startedAt ?? stoppedAt,
      durationSec,
      distanceM: s.distanceM,
      points: s.points,
    });
    if (result.ok) {
      useRunStore.getState().reset();
      setDialog({ type: 'saved' });
    } else {
      useRunStore.getState().failSave();
      setDialog({ type: 'saveError', message: result.error ?? '알 수 없는 오류' });
    }
  };

  return (
    <View className="flex-1">
      <RouteMap points={points} showsUserLocation />
      <Card className="absolute inset-x-4 bottom-6">
        <CardContent className="gap-3 p-4">
          {permissionDenied && (
            <Pressable onPress={() => Linking.openSettings()}>
              <Text className="text-center text-destructive">
                위치 권한이 필요합니다. 눌러서 설정 열기
              </Text>
            </Pressable>
          )}
          <View className="flex-row justify-around">
            <Metric label={`거리(${unit})`} value={formatDistance(distanceM, unit)} />
            <Metric label="시간" value={formatDuration(elapsed)} />
            <Metric label="페이스" value={formatPace(paceSecPerKm(distanceM, elapsed))} />
          </View>
          <View className="flex-row justify-center gap-3">
            {status === 'idle' && (
              <Button size="lg" onPress={onStart}>
                <Text>시작</Text>
              </Button>
            )}
            {status === 'running' && (
              <>
                <Button size="lg" variant="secondary" onPress={onPause}>
                  <Text>일시정지</Text>
                </Button>
                <Button size="lg" variant="destructive" onPress={onStop}>
                  <Text>종료</Text>
                </Button>
              </>
            )}
            {status === 'paused' && (
              <>
                <Button size="lg" onPress={onResume}>
                  <Text>재개</Text>
                </Button>
                <Button size="lg" variant="destructive" onPress={onStop}>
                  <Text>종료</Text>
                </Button>
              </>
            )}
            {status === 'saving' && (
              <Button size="lg" variant="destructive" disabled>
                <Text>저장 중…</Text>
              </Button>
            )}
          </View>
        </CardContent>
      </Card>

      <AlertDialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <AlertDialogContent>
          {dialog?.type === 'saved' && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>저장 완료</AlertDialogTitle>
                <AlertDialogDescription>기록 탭에서 확인하세요.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogAction onPress={() => setDialog(null)}>
                  <Text>확인</Text>
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
          {dialog?.type === 'startError' && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>추적을 시작하지 못했습니다</AlertDialogTitle>
                <AlertDialogDescription>{dialog.message}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogAction onPress={() => setDialog(null)}>
                  <Text>확인</Text>
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
          {dialog?.type === 'saveError' && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>저장하지 못했습니다</AlertDialogTitle>
                <AlertDialogDescription>
                  {dialog.message}
                  {'\n'}기록을 버릴까요?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onPress={() => setDialog(null)}>
                  <Text>유지</Text>
                </AlertDialogCancel>
                <AlertDialogAction
                  onPress={() => {
                    useRunStore.getState().reset();
                    setDialog(null);
                  }}
                >
                  <Text>버리기</Text>
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View className="items-center">
      <Text className="text-2xl font-bold">{value}</Text>
      <Text className="text-xs text-muted-foreground">{label}</Text>
    </View>
  );
}
