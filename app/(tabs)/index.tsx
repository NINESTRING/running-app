import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, View } from 'react-native';
import { LocateFixed } from 'lucide-react-native';
import { Icon } from '@/components/ui/icon';
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
import { RouteMap, type RouteMapHandle } from '@/components/RouteMap';
import { cadenceSpm, formatCadence } from '@/lib/cadence';
import { formatDistance, formatDuration, formatPace, paceSecPerKm } from '@/lib/geo';
import {
  getInitialCoords,
  getMyLocation,
  myLocationAction,
  requestPermissions,
  startTracking,
  stopTracking,
} from '@/services/location';
import {
  backfillSteps,
  requestPedometerPermissions,
  startStepCounting,
  stopStepCounting,
} from '@/services/pedometer';
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
  const stepSamples = useRunStore((s) => s.stepSamples);
  const unit = useSettingsStore((s) => s.unit);
  const [now, setNow] = useState(() => Date.now());
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  // undefined: 초기 좌표 확정 전(지도 미렌더). null: 좌표 없음 → 기본 지역
  const [initialCoords, setInitialCoords] = useState<
    { latitude: number; longitude: number } | null | undefined
  >(Platform.OS === 'web' ? null : undefined);

  const mapRef = useRef<RouteMapHandle>(null);
  const locatingRef = useRef(false);

  // fromButton: 버튼 탭이면 거부 시 설정 안내를 띄운다 (마운트 시에는 조용히 무시)
  const goToMyLocation = async (fromButton: boolean) => {
    if (locatingRef.current) return;
    locatingRef.current = true;
    try {
      const action = myLocationAction(await getMyLocation(), fromButton);
      if (action.kind === 'animate') {
        setPermissionDenied(false);
        mapRef.current?.animateTo(action.coords);
      } else if (action.kind === 'showDenied') {
        setPermissionDenied(true);
      }
    } finally {
      locatingRef.current = false;
    }
  };

  useEffect(() => {
    if (Platform.OS === 'web') return;
    void (async () => {
      setInitialCoords(await getInitialCoords());
      await goToMyLocation(false);
    })();
  }, []);

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
    // 모션 권한 거부·미지원이어도 러닝은 계속 — 케이던스만 '--'
    if (await requestPedometerPermissions()) {
      await startStepCounting();
    }
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
    stopStepCounting();
    const s = useRunStore.getState();
    const stoppedAt = Date.now();
    const durationSec = Math.round(elapsedMs(s, 0) / 1000);
    // iOS: CMPedometer 이력으로 백필 (화면 꺼짐 구간 보정). 실패·Android는 라이브 카운트.
    const steps = (await backfillSteps(s.segments)) ?? s.steps;
    const result = await saveRun({
      startedAt: s.startedAt ?? stoppedAt,
      durationSec,
      distanceM: s.distanceM,
      steps,
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
      {initialCoords !== undefined && (
        <RouteMap
          points={points}
          showsUserLocation
          follow
          ref={mapRef}
          initialCoords={initialCoords ?? undefined}
        />
      )}
      <View className="absolute inset-x-4 bottom-6 gap-3" pointerEvents="box-none">
        {Platform.OS !== 'web' && points.length === 0 && (
          <View className="items-end" pointerEvents="box-none">
            <Pressable
              accessibilityLabel="내 위치로 이동"
              accessibilityRole="button"
              onPress={() => goToMyLocation(true)}
              className="h-11 w-11 items-center justify-center rounded-full bg-card shadow-lg shadow-black/5 active:opacity-70"
            >
              <Icon as={LocateFixed} size={20} />
            </Pressable>
          </View>
        )}
        <Card>
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
              <Metric label="케이던스" value={formatCadence(cadenceSpm(stepSamples, now))} />
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
      </View>

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
