import { View } from 'react-native';

import { RecordBadge } from '@/components/RecordBadge';
import { Card, CardTitle } from '@/components/ui/card';
import { formatDistance, formatDuration } from '@/lib/geo';
import type { PersonalRecords, RecordEntry } from '@/lib/records';

interface Props {
  records: PersonalRecords;
  unit: 'km' | 'mi';
  onPressRun: (runId: string) => void;
}

const dateStr = (e: RecordEntry) => new Date(e.startedAt).toLocaleDateString('ko-KR');
const timeStr = (e: RecordEntry) => formatDuration(e.value * 1000);

export function PersonalRecordsSection({ records, unit, onPressRun }: Props) {
  const badges: {
    key: string;
    name: string;
    entry: RecordEntry | null;
    format: (e: RecordEntry) => string;
    label?: string;
    icon?: 'distance' | 'duration';
  }[] = [
    {
      key: 'longestDistance',
      name: '최장 거리 러닝',
      icon: 'distance',
      entry: records.longestDistance,
      format: (e) => `${formatDistance(e.value, unit)}${unit}`,
    },
    {
      key: 'longestDuration',
      name: '최장 시간 러닝',
      icon: 'duration',
      entry: records.longestDuration,
      format: timeStr,
    },
    { key: 'best1k', name: '1K 최고 기록', label: '1K', entry: records.best1k, format: timeStr },
    { key: 'best1mi', name: '마일 최고 기록', label: '1MI', entry: records.best1mi, format: timeStr },
    { key: 'best5k', name: '5K 최고 기록', label: '5K', entry: records.best5k, format: timeStr },
    { key: 'best10k', name: '10K 최고 기록', label: '10K', entry: records.best10k, format: timeStr },
    { key: 'bestHalf', name: '하프마라톤 최고 기록', label: '21.1K', entry: records.bestHalf, format: timeStr },
    { key: 'bestFull', name: '마라톤 최고 기록', label: '42.2K', entry: records.bestFull, format: timeStr },
  ];

  return (
    <Card className="mx-4 mt-4 gap-4 py-4">
      <CardTitle className="px-4 text-xl font-bold">개인 기록</CardTitle>
      <View className="flex-row flex-wrap px-1">
        {badges.map((b) => {
          const entry = b.entry;
          return (
            <View key={b.key} className="w-1/3 items-center px-1 pb-5">
              <RecordBadge
                label={b.label}
                icon={b.icon}
                achieved={entry !== null}
                date={entry ? dateStr(entry) : undefined}
                name={b.name}
                value={entry ? b.format(entry) : undefined}
                onPress={entry ? () => onPressRun(entry.runId) : undefined}
              />
            </View>
          );
        })}
      </View>
    </Card>
  );
}
