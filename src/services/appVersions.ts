import type { Tables } from '../types/database.types';
import { supabase } from './supabase';

export type AppVersionRow = Tables<'app_versions'>;

// 최신 버전 1건 — 실패하면 null (배지를 안 띄우는 조용한 실패)
export async function fetchLatestVersion(): Promise<AppVersionRow | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('app_versions')
      .select('*')
      .order('released_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

// 전체 버전 이력 — released_at 내림차순, 실패하면 빈 배열
export async function fetchVersionHistory(): Promise<AppVersionRow[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('app_versions')
      .select('*')
      .order('released_at', { ascending: false });
    if (error || !data) return [];
    return data;
  } catch {
    return [];
  }
}
