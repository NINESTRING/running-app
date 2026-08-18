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
import { GoalDialog } from '@/components/GoalDialog';
import { CountdownOverlay } from '@/components/CountdownOverlay';
import { RouteMap, type RouteMapHandle } from '@/components/RouteMap';
import { cadenceSpm, formatCadence } from '@/lib/cadence';
import {
  COUNTDOWN_EXIT_MS,
  COUNTDOWN_START,
  COUNTDOWN_TICK_MS,
  isCancellable,
  nextCountdown,
} from '@/lib/countdown';
import { formatDistance, formatDuration, formatPace, METERS_PER_MILE, paceSecPerUnit } from '@/lib/geo';
import { goalDeltaM, goalDeltaStatus, goalSummary } from '@/lib/goal';
import { cn } from '@/lib/utils';
import {
  computeSplits,
  partitionPoints,
  splitDistanceFor,
  liveExtraSec,
  liveSplitPaceSec,
} from '@/lib/splits';
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
import { fetchCurrentWeather, resolveRunWeather } from '@/services/weather';
import { fetchLocationLabel } from '@/services/geocoding';
import { useGoalStore } from '@/stores/goalStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { elapsedMs, useRunStore } from '@/stores/runStore';

type DialogState =
  | { type: 'startError'; message: string }
  | { type: 'confirmStop' }
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
  const segments = useRunStore((s) => s.segments);
  const unit = useSettingsStore((s) => s.unit);
  const goalPaceSec = useGoalStore((s) => s.paceSecPerUnit);
  const goalDistanceUnits = useGoalStore((s) => s.distanceUnits);
  const [goalOpen, setGoalOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  // 3·2·1·0(시작!) — null이면 카운트다운 중이 아니다. runStore는 이 구간 내내 idle.
  const [countdown, setCountdown] = useState<number | null>(null);
  // undefined: 초기 좌표 확정 전(지도 미렌더). null: 좌표 없음 → 기본 지역
  const [initialCoords, setInitialCoords] = useState<
    { latitude: number; longitude: number } | null | undefined
  >(Platform.OS === 'web' ? null : undefined);

  const mapRef = useRef<RouteMapHandle>(null);
  const locatingRef = useRef(false);
  const startingRef = useRef(false);
  const countdownRef = useRef<number | null>(null);

  // 가드는 커밋 전에도 참인 ref를 읽는다 — setCountdown만으로는 같은 틱에 도착한 탭이 옛 값을 본다
  const applyCountdown = (v: number | null) => {
    countdownRef.current = v;
    setCountdown(v);
  };

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

  // 목표 페이스 대비 편차 — 30초 미만이면 null(초반 가드)
  const goalDelta =
    goalPaceSec !== null && (status === 'running' || status === 'paused')
      ? goalDeltaM({ distanceM, elapsedMs: elapsed, paceSecPerUnit: goalPaceSec, unit })
      : null;

  // 거리 목표 진행 표시 (idle에서는 요약 줄이 있으므로 숨김)
  const unitM = unit === 'mi' ? METERS_PER_MILE : 1000;
  const showDistanceGoal = goalDistanceUnits !== null && status !== 'idle';
  const distanceValue = showDistanceGoal
    ? `${formatDistance(distanceM, unit)} / ${goalDistanceUnits.toFixed(2)}`
    : formatDistance(distanceM, unit);
  const distanceReached = showDistanceGoal && distanceM >= goalDistanceUnits * unitM;

  // 러닝·일시정지 중 현재 구간 번호와 실시간 구간 페이스
  const splitDistanceM = splitDistanceFor(unit);
  const liveSplits =
    status === 'running' || status === 'paused'
      ? computeSplits(partitionPoints(points, segments), splitDistanceM)
      : null;
  // 러닝 중에는 마지막 GPS 포인트 이후 경과 시간을 가산 — 멈춰 서면 페이스가 점점 느려진다.
  // 재개 직후엔 세그먼트 시작이 앵커라 일시정지 시간은 가산되지 않는다.
  const extraSec = liveExtraSec(
    status === 'running',
    now,
    points[points.length - 1]?.timestamp,
    segmentStartedAt
  );

  // 러닝 시작 시점 날씨를 백그라운드로 조회 — 실패해도 러닝 흐름에 영향 없음
  const fetchWeatherForRun = async () => {
    const startedAt = useRunStore.getState().startedAt;
    if (startedAt === null) return;
    const loc = await getMyLocation();
    if (loc.status !== 'granted') return;
    const w = await fetchCurrentWeather(loc.coords.latitude, loc.coords.longitude);
    if (w) useRunStore.getState().setWeather(startedAt, w.weatherCode, w.temperatureC);
  };

  // 카운트다운 0초 시점 — 여기가 실제 러닝 시작이다.
  // 만보계·날씨는 반드시 start() 이후에 부른다: start()가 상태를 initial로 리셋하므로
  // 먼저 부르면 beginStepTracking()이 세운 steps:0이 null로 덮여 케이던스가 영구히 '--'가 된다.
  const beginRun = async () => {
    const startedAt = Date.now();
    useRunStore.getState().start(startedAt);
    setNow(startedAt);
    fetchWeatherForRun().catch(() => {});
    // 모션 권한 거부·미지원이어도 러닝은 계속 — 케이던스만 '--'
    if (await requestPedometerPermissions()) {
      await startStepCounting();
    }
  };

  // 시작 탭: 권한·GPS 추적까지만 확보하고 카운트다운으로 넘긴다.
  // 추적을 먼저 켜두면 3초간 GPS가 워밍업되고, 권한 팝업·실패 다이얼로그가 카운트다운을 깨지 않는다.
  // 이 구간에 도착한 좌표는 addPoint의 status 가드가 버리고, 뒤이은 start()가 points를 비운다.
  const onStart = async () => {
    if (startingRef.current || countdownRef.current !== null) return;
    startingRef.current = true;
    try {
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
      applyCountdown(COUNTDOWN_START);
    } finally {
      startingRef.current = false;
    }
  };

  // 카운트다운 취소 — start()를 아직 안 불렀으므로 켜둔 GPS만 되돌리면 된다.
  const onCancelCountdown = () => {
    if (!isCancellable(countdownRef.current)) return;
    applyCountdown(null);
    stopTracking().catch((e) => console.warn('추적 중지 실패', e));
  };

  // 카운트다운 틱. 0에 닿는 순간 러닝을 시작하고, COUNTDOWN_EXIT_MS 뒤 오버레이를 걷는다.
  // 클린업이 예약된 타이머를 지우므로 "취소했는데 1초 뒤 시작되는" 레이스가 없다.
  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      const t = setTimeout(() => applyCountdown(null), COUNTDOWN_EXIT_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      const next = nextCountdown(countdown);
      // beginRun()보다 먼저 커밋 — 늦게 도착한 취소 탭이 0을 보고 물러난다
      applyCountdown(next);
      if (next === 0) beginRun().catch(() => {});
    }, COUNTDOWN_TICK_MS);
    return () => clearTimeout(t);
  }, [countdown]);

  const onPause = () => useRunStore.getState().pause(Date.now());

  const onResume = () => {
    useRunStore.getState().resume(Date.now());
    setNow(Date.now());
  };

  // 종료 탭: 즉시 저장하지 않고 일시정지 후 확인 다이얼로그를 띄운다.
  const onStopPressed = () => {
    useRunStore.getState().pause(Date.now()); // paused면 no-op
    setDialog({ type: 'confirmStop' });
  };

  // 상태 가드 + 동기 reset: 저장·버리기 동시 탭이나 센서 중지 대기 중 재개로
  // 폐기가 진행 중인 러닝을 오염시키지 않도록 비동기 정리는 reset 이후로 미룬다.
  // (addPoint·addStepReading은 status 가드가 있어 늦게 도착한 샘플은 버려진다)
  const onDiscard = () => {
    if (useRunStore.getState().status !== 'paused') return;
    setDialog(null);
    stopStepCounting();
    useRunStore.getState().reset();
    stopTracking().catch((e) => console.warn('추적 중지 실패', e));
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
    const firstPoint = s.points[0];
    const [steps, weather, locationLabel] = await Promise.all([
      // iOS: CMPedometer 이력으로 백필 (화면 꺼짐 구간 보정). 실패·Android는 라이브 카운트.
      backfillSteps(s.segments).then((b) => b ?? s.steps),
      // 시작 시 조회 실패 시 마지막 GPS 좌표로 1회 재시도 — 백필과 병렬이라 저장을 추가 지연시키지 않음
      resolveRunWeather(
        { weatherCode: s.weatherCode, temperatureC: s.temperatureC },
        s.points[s.points.length - 1]
      ),
      // 시작 지점 행정구역 라벨 — 위치는 시간에 안 민감하므로 저장 시점에 조회
      firstPoint
        ? fetchLocationLabel(firstPoint.latitude, firstPoint.longitude)
        : Promise.resolve<string | null>(null),
    ]);
    const result = await saveRun({
      startedAt: s.startedAt ?? stoppedAt,
      durationSec,
      distanceM: s.distanceM,
      steps,
      points: s.points,
      segments: s.segments,
      weatherCode: weather.weatherCode,
      temperatureC: weather.temperatureC,
      locationLabel,
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
            {status === 'idle' && (
              <View className="flex-row items-center justify-between">
                <Text className="text-sm text-muted-foreground">
                  {goalSummary(goalPaceSec, goalDistanceUnits, unit)}
                </Text>
                <Button size="sm" variant="outline" onPress={() => setGoalOpen(true)}>
                  <Text>목표</Text>
                </Button>
              </View>
            )}
            <View className="flex-row justify-around">
              <Metric
                label={`거리(${unit})`}
                value={distanceValue}
                valueClassName={cn(
                  showDistanceGoal && 'text-lg',
                  distanceReached && 'text-green-600 dark:text-green-500',
                )}
              />
              <Metric label="시간" value={formatDuration(elapsed)} />
              <Metric label={`페이스(/${unit})`} value={formatPace(paceSecPerUnit(distanceM, elapsed, unit))} />
              <Metric label="케이던스" value={formatCadence(cadenceSpm(stepSamples, now))} />
            </View>
            {liveSplits && (
              <Text className="text-center text-sm text-muted-foreground">
                {`구간 ${liveSplits.completed.length + 1} · ${formatPace(
                  liveSplitPaceSec(liveSplits.current, splitDistanceM, extraSec)
                )}`}
              </Text>
            )}
            {goalDelta !== null && <GoalDeltaLine deltaM={goalDelta} />}
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
                  <Button size="lg" variant="destructive" onPress={onStopPressed}>
                    <Text>종료</Text>
                  </Button>
                </>
              )}
              {status === 'paused' && (
                <>
                  <Button size="lg" onPress={onResume}>
                    <Text>재개</Text>
                  </Button>
                  <Button size="lg" variant="destructive" onPress={onStopPressed}>
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

      <GoalDialog open={goalOpen} onOpenChange={setGoalOpen} />

      <AlertDialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <AlertDialogContent>
          {dialog?.type === 'confirmStop' && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>러닝을 종료할까요?</AlertDialogTitle>
                <AlertDialogDescription>
                  기록을 저장하거나 버릴 수 있습니다.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onPress={() => setDialog(null)}>
                  <Text>취소</Text>
                </AlertDialogCancel>
                <AlertDialogAction onPress={onDiscard}>
                  <Text>버리기</Text>
                </AlertDialogAction>
                <AlertDialogAction
                  onPress={() => {
                    setDialog(null);
                    void onStop();
                  }}
                >
                  <Text>저장</Text>
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
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

      <CountdownOverlay tick={countdown} onCancel={onCancelCountdown} />
    </View>
  );
}

function Metric({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <View className="items-center">
      <Text className={cn('text-2xl font-bold', valueClassName)}>{value}</Text>
      <Text className="text-xs text-muted-foreground">{label}</Text>
    </View>
  );
}

function GoalDeltaLine({ deltaM }: { deltaM: number }) {
  const status = goalDeltaStatus(deltaM);
  if (status === 'onPace') {
    return <Text className="text-center text-sm text-muted-foreground">목표 페이스 유지</Text>;
  }
  const m = Math.round(Math.abs(deltaM));
  return status === 'behind' ? (
    <Text className="text-center text-sm font-medium text-destructive">{`▼ ${m}m 뒤쳐짐`}</Text>
  ) : (
    <Text className="text-center text-sm font-medium text-green-600 dark:text-green-500">{`▲ ${m}m 앞섬`}</Text>
  );
}
