import { CartesianChart, Line } from 'victory-native';
import type { ProfilePoint } from '@/lib/elevation';

interface Props {
  profile: ProfilePoint[];
}

/** 거리 × 고도 라인 차트. 유효 포인트가 2개 미만이면 렌더하지 않는다. */
export function ElevationChart({ profile }: Props) {
  if (profile.length < 2) return null;
  const data = profile.map((p) => ({
    distance: p.distanceM,
    altitude: p.altitudeM,
  }));
  return (
    <CartesianChart data={data} xKey="distance" yKeys={['altitude']}>
      {({ points }) => (
        <Line points={points.altitude} color="#3b82f6" strokeWidth={2} />
      )}
    </CartesianChart>
  );
}
