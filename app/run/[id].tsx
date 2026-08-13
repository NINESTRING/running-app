import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { ElevationChart } from '@/components/ElevationChart';
import { RouteMap } from '@/components/RouteMap';
import { SplitsList } from '@/components/SplitsList';
import { avgCadenceSpm, formatCadence } from '@/lib/cadence';
import { formatDistance, formatDuration, formatPace, paceSecPerUnit } from '@/lib/geo';
import { computeSplits, elevationGainM, elevationProfile, splitDistanceFor } from '@/lib/splits';
import { weatherLabel } from '@/lib/weather';
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
        if (!cancelled) setRun(r);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [id]);

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

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingBottom: 32 }}
    >
      <View className="h-72">
        <RouteMap points={points} />
      </View>
      <View className="gap-2 p-4">
        <Text className="text-base font-semibold">
          {new Date(run.startedAt).toLocaleString('ko-KR')}
        </Text>
        <Text className="text-muted-foreground">
          {formatDistance(run.distanceM, unit)}{unit} ·{' '}
          {formatDuration(run.durationSec * 1000)} ·{' '}
          {formatPace(paceSecPerUnit(run.distanceM, run.durationSec * 1000, unit))}
          {avgCadence !== null && ` · ${formatCadence(avgCadence)} spm`}
          {gain !== null && ` · ↑ ${Math.round(gain)} m`}
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
      {splits && (
        <SplitsList
          completed={splits.completed}
          current={splits.current}
          splitDistanceM={splitDistanceM}
          unit={unit}
        />
      )}
    </ScrollView>
  );
}
