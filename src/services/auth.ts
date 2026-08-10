import * as WebBrowser from 'expo-web-browser';

import { supabase } from './supabase';

const GOOGLE_AUTH_REDIRECT_URL = 'runningapp://google-auth';

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

export type GoogleAuthResult =
  | { status: 'success' }
  | { status: 'conflict' }
  | { status: 'cancelled' }
  | { status: 'error'; error: string };

// 콜백 딥링크에서 인증 파라미터를 추출한다.
// 암시적 플로우는 토큰·에러 모두 URL 프래그먼트(#)로 전달한다.
export function parseAuthCallbackParams(url: string): {
  accessToken: string | null;
  refreshToken: string | null;
  errorCode: string | null;
  errorDescription: string | null;
} {
  const fragment = url.split('#')[1] ?? url.split('?')[1] ?? '';
  const params = new URLSearchParams(fragment);
  return {
    accessToken: params.get('access_token'),
    refreshToken: params.get('refresh_token'),
    errorCode: params.get('error_code'),
    errorDescription: params.get('error_description'),
  };
}

// OAuth URL을 브라우저 인증 시트로 열고, 콜백 토큰으로 세션을 만든다.
async function completeOAuthInBrowser(oauthUrl: string): Promise<GoogleAuthResult> {
  const result = await WebBrowser.openAuthSessionAsync(oauthUrl, GOOGLE_AUTH_REDIRECT_URL);
  if (result.type !== 'success') return { status: 'cancelled' };

  const { accessToken, refreshToken, errorCode, errorDescription } =
    parseAuthCallbackParams(result.url);
  if (errorCode === 'identity_already_exists') return { status: 'conflict' };
  if (errorCode) return { status: 'error', error: errorDescription ?? errorCode };
  if (!accessToken || !refreshToken) {
    return { status: 'error', error: '인증 토큰을 받지 못했습니다' };
  }

  const { error } = await supabase!.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  return error ? { status: 'error', error: error.message } : { status: 'success' };
}

// 익명 계정에 구글 identity를 연결한다. 유저 ID가 유지되어 기존 기록이 승계된다.
export async function linkGoogleAccount(): Promise<GoogleAuthResult> {
  if (!supabase) {
    return { status: 'error', error: 'Supabase가 설정되지 않았습니다 (.env 확인)' };
  }
  const { data, error } = await supabase.auth.linkIdentity({
    provider: 'google',
    options: { redirectTo: GOOGLE_AUTH_REDIRECT_URL, skipBrowserRedirect: true },
  });
  if (error) {
    return error.code === 'identity_already_exists'
      ? { status: 'conflict' }
      : { status: 'error', error: error.message };
  }
  if (!data.url) return { status: 'error', error: 'OAuth URL을 받지 못했습니다' };
  return completeOAuthInBrowser(data.url);
}

// 구글 계정으로 로그인한다 (기존 계정 전환·재로그인용). 현재 세션은 새 세션으로 대체된다.
export async function signInWithGoogle(): Promise<GoogleAuthResult> {
  if (!supabase) {
    return { status: 'error', error: 'Supabase가 설정되지 않았습니다 (.env 확인)' };
  }
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: GOOGLE_AUTH_REDIRECT_URL, skipBrowserRedirect: true },
  });
  if (error) return { status: 'error', error: error.message };
  if (!data.url) return { status: 'error', error: 'OAuth URL을 받지 못했습니다' };
  return completeOAuthInBrowser(data.url);
}
