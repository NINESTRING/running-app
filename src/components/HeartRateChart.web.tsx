import { View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { heartRateYDomain } from '@/lib/heartRate';
import type { HeartRateSample } from '@/types/run';

interface Props {
  samples: HeartRateSample[];
}

// victory-native는 Skia(CanvasKit WASM) 기반이라 웹에서 동작하지 않는다.
// 웹 번들에서는 SVG 폴리라인으로 대체한다 (ElevationChart.web.tsx와 같은 구조).
export function HeartRateChart({ samples }: Props) {
  if (samples.length < 2) return null;
  const maxSec = samples[samples.length - 1][0] || 1;
  const [yMin, yMax] = heartRateYDomain(samples);
  const range = yMax - yMin || 1;
  const points = samples
    .map(([sec, bpm]) => `${(sec / maxSec) * 100},${40 - ((bpm - yMin) / range) * 36 - 2}`)
    .join(' ');
  return (
    <View style={{ flex: 1 }}>
      <Svg width="100%" height="100%" viewBox="0 0 100 40" preserveAspectRatio="none">
        <Polyline points={points} fill="none" stroke="#ef4444" strokeWidth={0.8} />
      </Svg>
    </View>
  );
}
