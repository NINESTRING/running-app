const EARTH_RADIUS_M = 6371000;

type LatLng = { latitude: number; longitude: number };

export function haversineM(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(s));
}

export function paceSecPerKm(distanceM: number, elapsedMs: number): number | null {
  if (distanceM < 10) return null;
  return elapsedMs / 1000 / (distanceM / 1000);
}

export function formatPace(secPerKm: number | null): string {
  if (secPerKm === null || !Number.isFinite(secPerKm)) return `--'--"`;
  let min = Math.floor(secPerKm / 60);
  let sec = Math.round(secPerKm % 60);
  if (sec === 60) {
    min += 1;
    sec = 0;
  }
  return `${min}'${String(sec).padStart(2, '0')}"`;
}

export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDistanceKm(m: number): string {
  return (m / 1000).toFixed(2);
}

const MILES_PER_KM = 0.621371;

export function formatDistance(m: number, unit: 'km' | 'mi'): string {
  const km = m / 1000;
  return unit === 'mi' ? (km * MILES_PER_KM).toFixed(2) : km.toFixed(2);
}
