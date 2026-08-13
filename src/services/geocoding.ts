import * as Location from 'expo-location';
import { formatLocationLabel } from '../lib/location';

const TIMEOUT_MS = 5000;

/**
 * 좌표를 "서울 강남구 서초동" 형태의 행정구역 라벨로 변환한다.
 * OS 지오코더 사용(API 키 불필요). 타임아웃·오류·빈 결과 등 모든 실패는 null — throw하지 않는다.
 * 위치 권한은 러닝 기능에서 이미 확보된 상태를 전제한다 (새로 요청하지 않음).
 */
export async function fetchLocationLabel(
  latitude: number,
  longitude: number
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // reverseGeocodeAsync는 abort를 지원하지 않아 race로 타임아웃만 건다
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), TIMEOUT_MS);
    });
    const results = await Promise.race([
      Location.reverseGeocodeAsync({ latitude, longitude }),
      timeout,
    ]);
    const first = results?.[0];
    if (!first) return null;
    return formatLocationLabel({
      region: first.region,
      city: first.city,
      subregion: first.subregion,
      district: first.district,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
