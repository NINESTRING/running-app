export interface GeocodedAddressParts {
  region: string | null; // 시/도 (예: "서울특별시")
  city: string | null; // 시/구 — 플랫폼에 따라 채워지는 필드가 다름 (iOS 위주)
  subregion: string | null; // 구 — Android 폴백
  district: string | null; // 동 (예: "서초동")
}

// endsWith 매칭이므로 긴 접미사를 먼저 검사한다
const REGION_SUFFIXES = ['특별자치시', '특별자치도', '특별시', '광역시'];

function shortenRegion(name: string): string {
  for (const suffix of REGION_SUFFIXES) {
    if (name.endsWith(suffix) && name.length > suffix.length) {
      return name.slice(0, -suffix.length);
    }
  }
  return name;
}

/**
 * reverseGeocode 결과를 "서울 강남구 서초동" 형태로 조합한다.
 * iOS(Apple)·Android(Google)가 필드를 다르게 채우므로 구는 city ?? subregion 폴백.
 * 유효한 파트가 하나도 없으면 null.
 */
export function formatLocationLabel(a: GeocodedAddressParts): string | null {
  const parts = [a.region, a.city ?? a.subregion, a.district]
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .map((p) => shortenRegion(p.trim()));
  const deduped = parts.filter((p, i) => p !== parts[i - 1]);
  return deduped.length > 0 ? deduped.join(' ') : null;
}
