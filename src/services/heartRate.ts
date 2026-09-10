import {
  isHealthDataAvailable,
  queryQuantitySamples,
  requestAuthorization,
} from '@kingstinct/react-native-healthkit';
import { Platform } from 'react-native';
import { summarizeRunHeartRate, type RawHeartRateSample } from '../lib/heartRate';
import type { TimeRange } from '../lib/splits';
import type { HeartRateSummary } from '../types/run';

const HEART_RATE_TYPE = 'HKQuantityTypeIdentifierHeartRate' as const;
export const HR_FETCH_TIMEOUT_MS = 5000;

/**
 * HealthKit 사용 가능 여부. iOS 실기기·시뮬레이터만 true — iPad 일부·Android·웹은 false.
 * 라이브러리가 비iOS에서는 스텁(false)을 주지만, 네이티브 로드 실패까지 방어하기 위해 try로 감싼다.
 */
export function isHeartRateSourceAvailable(): boolean {
  if (Platform.OS !== 'ios') return false;
  try {
    return isHealthDataAvailable();
  } catch {
    return false;
  }
}

/**
 * 심박 읽기 권한 요청. 사용자가 시트를 닫으면 resolve된다.
 * 주의: HealthKit은 읽기 권한 거부 여부를 앱에 알려주지 않는다 — true는 "시트를 띄웠고 오류 없이
 * 닫혔다"만 보장한다. 거부 시 이후 조회가 빈 결과로 돌아온다.
 */
export async function requestHeartRateAccess(): Promise<boolean> {
  if (!isHeartRateSourceAvailable()) return false;
  try {
    await requestAuthorization({ toRead: [HEART_RATE_TYPE] });
    return true;
  } catch {
    return false;
  }
}

// nitro는 Date를 돌려주지만 직렬화 경로에 따라 숫자가 올 수 있어 둘 다 받는다
function toEpochMs(d: unknown): number | null {
  if (d instanceof Date) return d.getTime();
  if (typeof d === 'number' && Number.isFinite(d)) return d;
  if (typeof d === 'string') {
    const t = Date.parse(d);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/**
 * [startedAt, endedAt] 구간 심박을 읽어 활동 구간 필터 → 소스 선택 → 10초 버킷 요약.
 * 데이터 없음·권한 없음·타임아웃·오류 모두 null. throw하지 않는다.
 */
export async function fetchRunHeartRate(params: {
  startedAt: number;
  endedAt: number;
  active: TimeRange[];
}): Promise<HeartRateSummary | null> {
  if (params.active.length === 0) return null;
  if (!isHeartRateSourceAvailable()) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // 라이브러리 쿼리는 abort를 지원하지 않아 race로 타임아웃만 건다 (geocoding.ts와 같은 방식)
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), HR_FETCH_TIMEOUT_MS);
    });
    const result = await Promise.race([
      queryQuantitySamples(HEART_RATE_TYPE, {
        filter: {
          date: { startDate: new Date(params.startedAt), endDate: new Date(params.endedAt) },
        },
        unit: 'count/min',
        limit: 0, // 0 = 전부
        ascending: true,
      }),
      timeout,
    ]);
    if (result === null) return null;
    const raw: RawHeartRateSample[] = [];
    for (const s of result) {
      const ts = toEpochMs(s.startDate);
      if (ts === null || typeof s.quantity !== 'number') continue;
      raw.push({
        timestamp: ts,
        bpm: s.quantity,
        sourceId: s.sourceRevision?.source?.bundleIdentifier ?? 'unknown',
      });
    }
    return summarizeRunHeartRate(raw, params.startedAt, params.active);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
