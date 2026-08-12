import { DashPathEffect, Line as SkiaLine, vec } from '@shopify/react-native-skia';
import { useState } from 'react';
import { View } from 'react-native';
import { Bar, CartesianChart } from 'victory-native';

import { Text } from '@/components/ui/text';
import { METERS_PER_MILE } from '@/lib/geo';
import { niceMax, type Bucket } from '@/lib/stats';

interface Props {
  buckets: Bucket[];
  averageM: number | null;
  unit: 'km' | 'mi';
}

export function PeriodBarChart({ buckets, averageM, unit }: Props) {
  const [chartHeight, setChartHeight] = useState(0);
  const unitM = unit === 'mi' ? METERS_PER_MILE : 1000;
  const data = buckets.map((b, i) => ({ x: i, value: b.distanceM / unitM }));
  const yMax = niceMax(Math.max(...data.map((d) => d.value), 0));
  const avg = averageM === null ? null : averageM / unitM;
  const sparse = buckets.length > 8; // 12개월 등은 라벨 격버킷 표시

  return (
    <View className="gap-1">
      <View className="flex-row">
        <View
          className="h-52 flex-1"
          onLayout={(e) => setChartHeight(e.nativeEvent.layout.height)}
        >
          <CartesianChart
            data={data}
            xKey="x"
            yKeys={['value']}
            domain={{ y: [0, yMax] }}
            domainPadding={{ left: 16, right: 16 }}
          >
            {({ points, chartBounds }) => {
              const avgY =
                avg === null
                  ? null
                  : chartBounds.bottom -
                    (avg / yMax) * (chartBounds.bottom - chartBounds.top);
              return (
                <>
                  <Bar
                    points={points.value}
                    chartBounds={chartBounds}
                    color="#3b82f6"
                    roundedCorners={{ topLeft: 4, topRight: 4 }}
                  />
                  {avgY !== null && (
                    <SkiaLine
                      p1={vec(chartBounds.left, avgY)}
                      p2={vec(chartBounds.right, avgY)}
                      color="#9ca3af"
                      strokeWidth={1}
                    >
                      <DashPathEffect intervals={[4, 4]} />
                    </SkiaLine>
                  )}
                </>
              );
            }}
          </CartesianChart>
          {avg !== null && chartHeight > 0 && (
            <Text
              className="absolute right-1 text-xs text-muted-foreground"
              style={{ top: Math.max((1 - avg / yMax) * chartHeight - 16, 0) }}
            >
              {avg.toFixed(1)}
            </Text>
          )}
        </View>
        <View className="h-52 w-12 justify-between pl-1">
          <Text className="text-xs text-muted-foreground">{yMax}</Text>
          <Text className="text-xs text-muted-foreground">0{unit}</Text>
        </View>
      </View>
      <View className="flex-row pr-12">
        {buckets.map((b, i) => (
          <View key={b.start.toISOString()} className="flex-1 items-center">
            <Text className="text-xs text-muted-foreground">
              {sparse && i % 2 === 1 ? '' : b.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
