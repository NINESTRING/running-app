import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { WeeklyBarChart } from '@/components/WeeklyBarChart';
import { weeklyDistances } from '@/lib/stats';
import { listRuns } from '@/services/runs';

export default function StatsScreen() {
  const [data, setData] = useState(() => weeklyDistances([], new Date()));

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      listRuns().then((runs) => {
        if (!cancelled) setData(weeklyDistances(runs, new Date()));
      });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  return (
    <View className="flex-1 bg-background p-4">
      <Card>
        <CardHeader>
          <CardTitle>이번 주 거리 (km)</CardTitle>
        </CardHeader>
        <CardContent className="gap-2">
          <View className="h-60">
            <WeeklyBarChart data={data} />
          </View>
          <View className="flex-row justify-around">
            {data.map((d) => (
              <Text key={d.day} className="text-xs text-muted-foreground">
                {d.day}
              </Text>
            ))}
          </View>
        </CardContent>
      </Card>
    </View>
  );
}
