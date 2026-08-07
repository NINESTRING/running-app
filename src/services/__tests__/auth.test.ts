import { ensureSignedIn } from '../auth';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      signInAnonymously: jest.fn(),
    },
  },
}));

const auth = (supabase as NonNullable<typeof supabase>)
  .auth as unknown as {
  getSession: jest.Mock;
  signInAnonymously: jest.Mock;
};

describe('ensureSignedIn', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('세션이 이미 있으면 익명 로그인을 호출하지 않는다', async () => {
    auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
      error: null,
    });

    const result = await ensureSignedIn();

    expect(result).toEqual({ ok: true });
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it('세션이 없으면 익명 로그인을 호출한다', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    auth.signInAnonymously.mockResolvedValue({
      data: { session: { user: { id: 'anon-1' } } },
      error: null,
    });

    const result = await ensureSignedIn();

    expect(result).toEqual({ ok: true });
    expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('익명 로그인이 실패하면 에러 메시지를 반환한다', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    auth.signInAnonymously.mockResolvedValue({
      data: { session: null },
      error: { message: 'Anonymous sign-ins are disabled' },
    });

    const result = await ensureSignedIn();

    expect(result).toEqual({
      ok: false,
      error: 'Anonymous sign-ins are disabled',
    });
  });
});
