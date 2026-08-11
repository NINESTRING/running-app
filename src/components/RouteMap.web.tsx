import type { Ref } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { RoutePoint } from '../types/run';
import type { RouteMapHandle } from './RouteMap';

interface Props {
  points: RoutePoint[];
  showsUserLocation?: boolean;
  initialCoords?: { latitude: number; longitude: number };
  ref?: Ref<RouteMapHandle>;
}

// react-native-maps는 웹을 지원하지 않으므로(codegenNativeComponent 없음)
// 웹 번들에서는 이 플레이스홀더가 대신 사용된다. ref는 연결하지 않는다.
export function RouteMap({ points }: Props) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.container]}>
      <Text style={styles.title}>지도는 모바일 앱에서 확인할 수 있어요</Text>
      {points.length >= 2 && (
        <Text style={styles.subtitle}>경로 좌표 {points.length}개 기록됨</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e5e7eb',
  },
  title: {
    color: '#374151',
    fontSize: 15,
    fontWeight: '600',
  },
  subtitle: {
    marginTop: 4,
    color: '#6b7280',
    fontSize: 13,
  },
});
