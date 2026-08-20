import { CartesianChart, Line } from 'victory-native';
import { elevationYDomain, type ProfilePoint } from '@/lib/elevation';

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
  // y축에 최소 표시범위를 주지 않으면 평지의 잔여 노이즈가 차트를 가득 채운다
  const [yMin, yMax] = elevationYDomain(profile);
  return (
    <CartesianChart
      data={data}
      xKey="distance"
      yKeys={['altitude']}
      domain={{ y: [yMin, yMax] }}
    >
      {({ points }) => (
        <Line points={points.altitude} color="#3b82f6" strokeWidth={2} />
      )}
    </CartesianChart>
  );
}
