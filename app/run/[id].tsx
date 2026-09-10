import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { ElevationChart } from '@/components/ElevationChart';
import { HeartRateChart } from '@/components/HeartRateChart';
import { LapsList } from '@/components/LapsList';
import { RouteMap } from '@/components/RouteMap';
import { SplitsList } from '@/components/SplitsList';
import { avgCadenceSpm, formatCadence } from '@/lib/cadence';
import { elevationGainM, elevationProfile } from '@/lib/elevation';
import { formatDistance, formatDuration, formatPace, paceSecPerUnit } from '@/lib/geo';
import { formatHeartRate } from '@/lib/heartRate';
import { computeLaps } from '@/lib/laps';
import { computeSplits, splitDistanceFor } from '@/lib/splits';
import { weatherLabel } from '@/lib/weather';
import { backfillHeartRate } from '@/services/heartRateBackfill';
import { getRun } from '@/services/runs';
import { useSettingsStore } from '@/stores/settingsStore';
import type { RoutePoint, RunRecord } from '@/types/run';

export default function RunDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // undefined = 로딩 중, null = 조회했지만 없음
  const [run, setRun] = useState<RunRecord | null | undefined>(id ? undefined : null);
  const unit = useSettingsStore((s) => s.unit);

  useEffect(() => {
    let cancelled = false;
    if (id) {
      getRun(id).then((r) => {
        if (cancelled) return;
        setRun(r);
        // 러닝 직후 상세로 들어온 사용자가 새로고침 없이 심박을 보도록 이 기록 1건만 백필한다
        if (r) {
          void backfillHeartRate([r], {
            limit: 1,
            isCancelled: () => cancelled,
            onFilled: (_id, heartRate) =>
              setRun((prev) => (prev ? { ...prev, heartRate } : prev)),
          });
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [id]);

  // 랩 재계산은 O(포인트×후보점)라 렌더마다 다시 돌리기엔 무겁다 — 기록이 바뀔 때만 계산
  const lapResult = useMemo(
    () => (run && run.routePoints ? computeLaps(run.routePoints) : null),
    [run],
  );

  if (run === undefined) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (run === null) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-muted-foreground">기록을 찾을 수 없습니다.</Text>
      </View>
    );
  }

  // 지도는 원본 시계열 우선, 구버전 기록은 GeoJSON 폴백
  const points: RoutePoint[] =
    run.routePoints?.flat() ??
    run.routeGeojson?.coordinates.map(([lon, lat]) => ({
      latitude: lat,
      longitude: lon,
      altitude: null,
      timestamp: 0,
    })) ??
    [];

  const avgCadence = avgCadenceSpm(run.steps, run.durationSec);
  const splitDistanceM = splitDistanceFor(unit);
  const splits = run.routePoints
    ? computeSplits(run.routePoints, splitDistanceM)
    : null;
  const gain = run.routePoints ? elevationGainM(run.routePoints) : null;
  const profile = run.routePoints ? elevationProfile(run.routePoints) : [];
  const laps = lapResult !== null && lapResult.laps.length >= 1 ? lapResult.laps : null;

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingBottom: 32 }}
    >
      <View className="h-72">
        <RouteMap points={points} gate={lapResult?.gate ?? null} />
      </View>
      <View className="gap-2 p-4">
        <Text className="text-base font-semibold">
          {new Date(run.startedAt).toLocaleString('ko-KR')}
        </Text>
        {run.locationLabel !== null && (
          <Text className="text-sm text-muted-foreground">{run.locationLabel}</Text>
        )}
        <Text className="text-muted-foreground">
          {formatDistance(run.distanceM, unit)}{unit} ·{' '}
          {formatDuration(run.durationSec * 1000)} ·{' '}
          {formatPace(paceSecPerUnit(run.distanceM, run.durationSec * 1000, unit))}
          {avgCadence !== null && ` · ${formatCadence(avgCadence)} spm`}
          {gain !== null && ` · ↑ ${Math.round(gain)} m`}
          {laps !== null && ` · ${laps.length}바퀴`}
          {run.heartRate !== null &&
            ` · ${formatHeartRate(run.heartRate.avgHr, run.heartRate.maxHr)}`}
          {run.weatherCode !== null &&
            run.temperatureC !== null &&
            ` · ${weatherLabel(run.weatherCode).emoji} ${Math.round(run.temperatureC)}°C`}
        </Text>
      </View>
      {profile.length >= 2 && (
        <View className="h-40 px-4 pb-2">
          <ElevationChart profile={profile} />
        </View>
      )}
      {run.heartRate !== null && run.heartRate.samples.length >= 2 && (
        <View className="h-40 px-4 pb-2">
          <HeartRateChart samples={run.heartRate.samples} />
        </View>
      )}
      {splits && (
        <SplitsList
          completed={splits.completed}
          current={splits.current}
          splitDistanceM={splitDistanceM}
          unit={unit}
        />
      )}
      {laps !== null && <LapsList laps={laps} />}
    </ScrollView>
  );
}
