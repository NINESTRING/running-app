import { useFocusEffect } from 'expo-router';
import { ChevronDown } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { PeriodBarChart } from '@/components/PeriodBarChart';
import { PeriodPicker } from '@/components/PeriodPicker';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { formatDuration, formatPace, METERS_PER_MILE } from '@/lib/geo';
import {
  availablePeriods,
  averageDistanceM,
  periodBuckets,
  periodSummary,
  type PeriodType,
} from '@/lib/stats';
import { listRuns } from '@/services/runs';
import { useSettingsStore } from '@/stores/settingsStore';
import type { RunRecord } from '@/types/run';

const PERIOD_TABS: { value: PeriodType; label: string }[] = [
  { value: 'week', label: '주' },
  { value: 'month', label: '월' },
  { value: 'year', label: '년' },
  { value: 'all', label: '전체' },
];

export default function StatsScreen() {
  const unit = useSettingsStore((s) => s.unit);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [periodType, setPeriodType] = useState<PeriodType>('week');
  // null = 현재 기간. 세그먼트 전환 시 리셋
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      listRuns().then((loaded) => {
        if (!cancelled) setRuns(loaded);
      });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  // 개인 기록 수백 건 수준이라 렌더마다 집계해도 충분히 가볍다
  const now = new Date();
  const options = availablePeriods(runs, periodType, now);
  const selected = options.find((o) => o.key === selectedKey) ?? options[0] ?? null;
  const anchor = selected?.anchor ?? now;
  const summary = periodSummary(runs, periodType, anchor, unit);
  const buckets = periodBuckets(runs, periodType, anchor);
  const averageM = averageDistanceM(buckets, now);
  const unitM = unit === 'mi' ? METERS_PER_MILE : 1000;
  const bigDistance = (summary.distanceM / unitM).toFixed(1);

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-5 p-4">
      <Text className="text-3xl font-bold">활동</Text>

      <ToggleGroup
        type="single"
        value={periodType}
        onValueChange={(v) => {
          if (v === 'week' || v === 'month' || v === 'year' || v === 'all') {
            setPeriodType(v);
            setSelectedKey(null);
          }
        }}
        variant="outline"
      >
        {PERIOD_TABS.map((tab, i) => (
          <ToggleGroupItem
            key={tab.value}
            value={tab.value}
            isFirst={i === 0}
            isLast={i === PERIOD_TABS.length - 1}
            className="flex-1"
          >
            <Text>{tab.label}</Text>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {periodType !== 'all' && selected && (
        <Pressable
          className="flex-row items-center gap-1 self-start"
          onPress={() => setPickerVisible(true)}
        >
          <Text className="text-xl font-semibold">{selected.label}</Text>
          <Icon as={ChevronDown} size={18} />
        </Pressable>
      )}

      <View>
        <Text className="text-6xl font-extrabold italic">{bigDistance}</Text>
        <Text className="text-sm text-muted-foreground">
          {unit === 'km' ? '킬로미터' : '마일'}
        </Text>
      </View>

      <View className="flex-row">
        <View className="flex-1 gap-0.5">
          <Text className="text-2xl font-semibold">{summary.runCount}</Text>
          <Text className="text-xs text-muted-foreground">러닝</Text>
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="text-2xl font-semibold">
            {formatPace(summary.avgPaceSecPerUnit)}
          </Text>
          <Text className="text-xs text-muted-foreground">평균 페이스</Text>
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="text-2xl font-semibold">
            {formatDuration(summary.durationSec * 1000)}
          </Text>
          <Text className="text-xs text-muted-foreground">시간</Text>
        </View>
      </View>

      <PeriodBarChart buckets={buckets} averageM={averageM} unit={unit} />

      <PeriodPicker
        visible={pickerVisible}
        options={options}
        selectedKey={selected?.key ?? null}
        onSelect={setSelectedKey}
        onClose={() => setPickerVisible(false)}
      />
    </ScrollView>
  );
}
