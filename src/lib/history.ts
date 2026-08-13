import type { RunRecord } from '../types/run';

export type TimeOfDay = '새벽' | '오전' | '오후' | '밤';

/** 로컬 시각 기준 시간대. 새벽 0~5시, 오전 6~11시, 오후 12~17시, 밤 18~23시. */
export function timeOfDay(startedAt: string): TimeOfDay {
  const h = new Date(startedAt).getHours();
  if (h < 6) return '새벽';
  if (h < 12) return '오전';
  if (h < 18) return '오후';
  return '밤';
}

/** "8. 13. (목)" 형태의 목록 행 날짜. */
export function formatRunDay(startedAt: string): string {
  return new Date(startedAt).toLocaleDateString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  });
}

export interface RunSection {
  title: string; // "2026년 8월"
  data: RunRecord[];
}

/** 입력 순서(최신순)를 보존하며 로컬 연·월이 같은 연속 구간을 섹션으로 묶는다. */
export function groupRunsByMonth(runs: RunRecord[]): RunSection[] {
  const sections: RunSection[] = [];
  let prevKey: string | null = null;
  for (const r of runs) {
    const d = new Date(r.startedAt);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (key === prevKey) {
      sections[sections.length - 1].data.push(r);
    } else {
      sections.push({
        title: d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' }),
        data: [r],
      });
      prevKey = key;
    }
  }
  return sections;
}

/** 위치 라벨 백필용 시작 좌표. 원본 시계열 우선, 구버전 기록은 GeoJSON 폴백. 경로 없으면 null. */
export function startCoords(
  run: RunRecord
): { latitude: number; longitude: number } | null {
  const p = run.routePoints?.[0]?.[0];
  if (p) return { latitude: p.latitude, longitude: p.longitude };
  const c = run.routeGeojson?.coordinates[0];
  return c ? { latitude: c[1], longitude: c[0] } : null;
}
