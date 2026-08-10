import type { Session } from '@supabase/supabase-js';

import { supabase } from '../../services/supabase';

jest.mock('../../services/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: jest.fn().mockReturnValue({
        data: { subscription: { unsubscribe: jest.fn() } },
      }),
    },
  },
}));

// 모킹 후 import해야 모듈 로드 시 구독이 모의 객체에 걸린다
import { sessionToAuthState, useAuthStore } from '../authStore';

const onAuthStateChange = (supabase as NonNullable<typeof supabase>).auth
  .onAuthStateChange as jest.Mock;

function fakeSession(user: Partial<Session['user']>): Session {
  return { user } as Session;
}

describe('sessionToAuthState', () => {
  it('익명 세션을 변환한다', () => {
    const session = fakeSession({ id: 'anon-1', is_anonymous: true });
    expect(sessionToAuthState(session)).toEqual({
      userId: 'anon-1',
      isAnonymous: true,
      email: null,
    });
  });

  it('구글 연결된 세션을 변환한다', () => {
    const session = fakeSession({
      id: 'user-1',
      is_anonymous: false,
      email: 'runner@gmail.com',
    });
    expect(sessionToAuthState(session)).toEqual({
      userId: 'user-1',
      isAnonymous: false,
      email: 'runner@gmail.com',
    });
  });

  it('세션이 없으면 익명 취급 초기값을 반환한다', () => {
    expect(sessionToAuthState(null)).toEqual({
      userId: null,
      isAnonymous: true,
      email: null,
    });
  });
});

describe('useAuthStore', () => {
  it('auth 상태 변경 이벤트로 스토어가 갱신된다', () => {
    // 모듈 로드 시 등록된 구독 콜백을 꺼내서 직접 호출
    const handler = onAuthStateChange.mock.calls[0][0] as (
      event: string,
      session: Session | null
    ) => void;

    handler(
      'USER_UPDATED',
      fakeSession({ id: 'user-1', is_anonymous: false, email: 'runner@gmail.com' })
    );

    expect(useAuthStore.getState()).toEqual({
      userId: 'user-1',
      isAnonymous: false,
      email: 'runner@gmail.com',
    });
  });
});
