import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

import { supabase } from '../services/supabase';

export interface AuthState {
  userId: string | null;
  isAnonymous: boolean;
  email: string | null;
}

// 세션이 없으면 익명 취급 — 앱은 시작 시 항상 익명 로그인하므로 잠깐의 초기 상태일 뿐이다.
export function sessionToAuthState(session: Session | null): AuthState {
  return {
    userId: session?.user.id ?? null,
    isAnonymous: session?.user.is_anonymous ?? true,
    email: session?.user.email ?? null,
  };
}

export const useAuthStore = create<AuthState>(() => sessionToAuthState(null));

// 구독 즉시 INITIAL_SESSION 이벤트가 와서 초기 상태도 여기서 채워진다.
supabase?.auth.onAuthStateChange((_event, session) => {
  useAuthStore.setState(sessionToAuthState(session));
});
