import { Bar, CartesianChart } from 'victory-native';

interface Props {
  data: { day: string; km: number }[];
}

export function WeeklyBarChart({ data }: Props) {
  return (
    <CartesianChart data={data} xKey="day" yKeys={['km']}>
      {({ points, chartBounds }) => (
        <Bar
          points={points.km}
          chartBounds={chartBounds}
          color="#3b82f6"
          roundedCorners={{ topLeft: 4, topRight: 4 }}
        />
      )}
    </CartesianChart>
  );
}
