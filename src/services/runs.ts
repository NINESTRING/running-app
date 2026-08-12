import type { Tables } from '../types/database.types';
import type { RoutePoint, RunRecord } from '../types/run';
import { partitionPoints, type TimeRange } from '../lib/splits';
import { supabase } from './supabase';

export interface FinishedRun {
  startedAt: number; // epoch ms
  durationSec: number;
  distanceM: number;
  steps: number | null; // null = 측정 안 됨
  points: RoutePoint[];
  segments: TimeRange[]; // 완료된 러닝 세그먼트 — 일시정지 제외 구간 계산용
}

// [t, lat, lng, alt] 튜플의 세그먼트별 배열 (route_points JSONB 포맷)
export type RoutePointsJson = [number, number, number, number | null][][];

export function segmentsToJson(
  points: RoutePoint[],
  segments: TimeRange[]
): RoutePointsJson | null {
  if (points.length < 2) return null;
  return partitionPoints(points, segments).map((g) =>
    g.map((p): [number, number, number, number | null] => [
      p.timestamp,
      p.latitude,
      p.longitude,
      p.altitude,
    ])
  );
}

export function parseRoutePoints(json: unknown): RoutePoint[][] | null {
  if (!Array.isArray(json) || json.length === 0) return null;
  const groups: RoutePoint[][] = [];
  for (const g of json) {
    if (!Array.isArray(g)) return null;
    const pts: RoutePoint[] = [];
    for (const t of g) {
      if (!Array.isArray(t) || t.length !== 4) return null;
      const [ts, lat, lng, alt] = t;
      if (
        typeof ts !== 'number' ||
        typeof lat !== 'number' ||
        typeof lng !== 'number' ||
        (typeof alt !== 'number' && alt !== null)
      ) {
        return null;
      }
      pts.push({ timestamp: ts, latitude: lat, longitude: lng, altitude: alt });
    }
    groups.push(pts);
  }
  return groups;
}

export function pointsToEwkt(points: RoutePoint[]): string | null {
  if (points.length < 2) return null;
  const coords = points.map((p) => `${p.longitude} ${p.latitude}`).join(',');
  return `SRID=4326;LINESTRING(${coords})`;
}

export type RunRow = Tables<'runs_with_geojson'>;

// 뷰 컬럼은 원본 테이블이 NOT NULL이어도 타입상 전부 nullable로 생성됨 →
// 필수 값이 빠진 행은 null로 걸러낸다.
export function rowToRunRecord(row: RunRow): RunRecord | null {
  if (
    row.id === null ||
    row.started_at === null ||
    row.duration_sec === null ||
    row.distance_m === null
  ) {
    return null;
  }
  return {
    id: row.id,
    startedAt: row.started_at,
    durationSec: row.duration_sec,
    distanceM: row.distance_m,
    steps: row.steps ?? null,
    routeGeojson: row.route_geojson ? JSON.parse(row.route_geojson) : null,
    routePoints: parseRoutePoints(row.route_points),
  };
}

export async function saveRun(
  run: FinishedRun
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) {
    return { ok: false, error: 'Supabase가 설정되지 않았습니다 (.env 확인)' };
  }
  try {
    const { error } = await supabase.from('runs').insert({
      started_at: new Date(run.startedAt).toISOString(),
      duration_sec: run.durationSec,
      distance_m: run.distanceM,
      steps: run.steps,
      route: pointsToEwkt(run.points),
      route_points: segmentsToJson(run.points, run.segments),
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function listRuns(): Promise<RunRecord[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('runs_with_geojson')
      .select('*')
      .order('started_at', { ascending: false });
    if (error || !data) return [];
    return data
      .map(rowToRunRecord)
      .filter((r): r is RunRecord => r !== null);
  } catch {
    return [];
  }
}

export async function getRun(id: string): Promise<RunRecord | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('runs_with_geojson')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) return null;
    return rowToRunRecord(data);
  } catch {
    return null;
  }
}
