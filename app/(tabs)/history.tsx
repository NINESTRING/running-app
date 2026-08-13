import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { PersonalRecordsSection } from '@/components/PersonalRecordsSection';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { formatDistance, formatDuration } from '@/lib/geo';
import { personalRecords } from '@/lib/records';
import { listRuns } from '@/services/runs';
import { supabase } from '@/services/supabase';
import { useSettingsStore } from '@/stores/settingsStore';
import type { RunRecord } from '@/types/run';

export default function HistoryScreen() {
  const router = useRouter();
  const [runs, setRuns] = useState<RunRecord[] | null>(null);
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

  // 롤링 윈도우 계산이 목록 렌더보다 무거우므로 runs 변경 시에만 재계산
  const records = useMemo(() => (runs && runs.length > 0 ? personalRecords(runs) : null), [runs]);

  if (!supabase) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <Text className="text-center text-muted-foreground">
          Supabase가 설정되지 않았습니다.{'\n'}.env에 URL과 키를 넣어주세요.
        </Text>
      </View>
    );
  }

  if (runs === null) {
    return (
      <View className="flex-1 gap-3 bg-background p-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </View>
    );
  }

  if (runs.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <Text className="text-center text-muted-foreground">아직 러닝 기록이 없습니다.</Text>
      </View>
    );
  }

  return (
    <FlatList
      className="bg-background"
      data={runs}
      keyExtractor={(r) => r.id}
      ItemSeparatorComponent={() => <Separator />}
      ListHeaderComponent={
        records ? (
          <PersonalRecordsSection
            records={records}
            unit={unit}
            onPressRun={(runId) => router.push(`/run/${runId}`)}
          />
        ) : null
      }
      renderItem={({ item }) => (
        <Pressable
          className="gap-1 p-4 active:bg-accent"
          onPress={() => router.push(`/run/${item.id}`)}
        >
          <Text className="text-base font-semibold">
            {new Date(item.startedAt).toLocaleDateString('ko-KR')}
          </Text>
          <Text className="text-muted-foreground">
            {formatDistance(item.distanceM, unit)}{unit} ·{' '}
            {formatDuration(item.durationSec * 1000)}
          </Text>
        </Pressable>
      )}
    />
  );
}
