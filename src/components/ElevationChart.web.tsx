import { View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { elevationYDomain, type ProfilePoint } from '@/lib/elevation';

interface Props {
  profile: ProfilePoint[];
}

// victory-native는 Skia(CanvasKit WASM) 기반이라 웹에서 동작하지 않는다.
// 웹 번들에서는 SVG 폴리라인으로 대체한다.
export function ElevationChart({ profile }: Props) {
  if (profile.length < 2) return null;
  const maxD = profile[profile.length - 1].distanceM || 1;
  // native 차트와 같은 y 도메인 규칙 — 최소 표시범위를 보장한다
  const [minA, maxA] = elevationYDomain(profile);
  const range = maxA - minA || 1;
  const points = profile
    .map(
      (p) =>
        `${(p.distanceM / maxD) * 100},${40 - ((p.altitudeM - minA) / range) * 36 - 2}`
    )
    .join(' ');
  return (
    <View style={{ flex: 1 }}>
      <Svg width="100%" height="100%" viewBox="0 0 100 40" preserveAspectRatio="none">
        <Polyline
          points={points}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={0.8}
        />
      </Svg>
    </View>
  );
}
