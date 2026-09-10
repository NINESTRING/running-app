import { CartesianChart, Line } from 'victory-native';
import { heartRateYDomain } from '@/lib/heartRate';
import type { HeartRateSample } from '@/types/run';

interface Props {
  samples: HeartRateSample[];
}

/** 경과 분 × bpm 라인 차트. 샘플이 2개 미만이면 렌더하지 않는다. */
export function HeartRateChart({ samples }: Props) {
  if (samples.length < 2) return null;
  const data = samples.map(([sec, bpm]) => ({ minute: sec / 60, bpm }));
  // 평탄한 심박이 차트를 가득 채워 요동치듯 보이지 않도록 최소 표시 폭을 준다
  const [yMin, yMax] = heartRateYDomain(samples);
  return (
    <CartesianChart data={data} xKey="minute" yKeys={['bpm']} domain={{ y: [yMin, yMax] }}>
      {({ points }) => <Line points={points.bpm} color="#ef4444" strokeWidth={2} />}
    </CartesianChart>
  );
}
