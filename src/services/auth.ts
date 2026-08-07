import { supabase } from './supabase';

// 앱 시작 시 호출: 기존 세션이 없으면 익명 로그인으로 기기별 사용자를 만든다.
export async function ensureSignedIn(): Promise<{
  ok: boolean;
  error?: string;
}> {
  if (!supabase) {
    return { ok: false, error: 'Supabase가 설정되지 않았습니다 (.env 확인)' };
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) return { ok: true };

  const { error } = await supabase.auth.signInAnonymously();
  return error ? { ok: false, error: error.message } : { ok: true };
}
