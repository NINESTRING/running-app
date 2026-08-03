import type { RoutePoint, RunRecord } from '../types/run';
import { supabase } from './supabase';

export interface FinishedRun {
  startedAt: number; // epoch ms
  durationSec: number;
  distanceM: number;
  points: RoutePoint[];
}

export function pointsToEwkt(points: RoutePoint[]): string | null {
  if (points.length < 2) return null;
  const coords = points.map((p) => `${p.longitude} ${p.latitude}`).join(',');
  return `SRID=4326;LINESTRING(${coords})`;
}

interface RunRow {
  id: string;
  started_at: string;
  duration_sec: number;
  distance_m: number;
  route_geojson: string | null;
}

export function rowToRunRecord(row: RunRow): RunRecord {
  return {
    id: row.id,
    startedAt: row.started_at,
    durationSec: row.duration_sec,
    distanceM: row.distance_m,
    routeGeojson: row.route_geojson ? JSON.parse(row.route_geojson) : null,
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
      route: pointsToEwkt(run.points),
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
    return (data as RunRow[]).map(rowToRunRecord);
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
    return rowToRunRecord(data as RunRow);
  } catch {
    return null;
  }
}
