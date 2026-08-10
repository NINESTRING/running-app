import { ensureSignedIn, linkGoogleAccount, parseAuthCallbackParams, signInWithGoogle } from '../auth';
import { supabase } from '../supabase';
import * as WebBrowser from 'expo-web-browser';

jest.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      signInAnonymously: jest.fn(),
      linkIdentity: jest.fn(),
      signInWithOAuth: jest.fn(),
      setSession: jest.fn(),
      signOut: jest.fn(),
    },
  },
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
}));

const auth = (supabase as NonNullable<typeof supabase>).auth as unknown as {
  getSession: jest.Mock;
  signInAnonymously: jest.Mock;
  linkIdentity: jest.Mock;
  signInWithOAuth: jest.Mock;
  setSession: jest.Mock;
  signOut: jest.Mock;
};
const openAuthSessionAsync = WebBrowser.openAuthSessionAsync as jest.Mock;

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

describe('parseAuthCallbackParams', () => {
  it('프래그먼트에서 토큰을 추출한다', () => {
    const result = parseAuthCallbackParams(
      'runningapp://google-auth#access_token=at-1&refresh_token=rt-1&token_type=bearer'
    );
    expect(result.accessToken).toBe('at-1');
    expect(result.refreshToken).toBe('rt-1');
    expect(result.errorCode).toBeNull();
  });

  it('에러 파라미터를 추출한다', () => {
    const result = parseAuthCallbackParams(
      'runningapp://google-auth#error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked'
    );
    expect(result.errorCode).toBe('identity_already_exists');
    expect(result.errorDescription).toBe('Identity is already linked');
    expect(result.accessToken).toBeNull();
  });

  it('파라미터가 없으면 전부 null을 반환한다', () => {
    const result = parseAuthCallbackParams('runningapp://google-auth');
    expect(result).toEqual({
      accessToken: null,
      refreshToken: null,
      errorCode: null,
      errorDescription: null,
    });
  });
});

describe('linkGoogleAccount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('브라우저 인증 성공 시 세션을 설정하고 success를 반환한다', async () => {
    auth.linkIdentity.mockResolvedValue({
      data: { url: 'https://accounts.google.com/oauth' },
      error: null,
    });
    openAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: 'runningapp://google-auth#access_token=at-1&refresh_token=rt-1',
    });
    auth.setSession.mockResolvedValue({ data: {}, error: null });

    const result = await linkGoogleAccount();

    expect(result).toEqual({ status: 'success' });
    expect(auth.linkIdentity).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: 'runningapp://google-auth',
        skipBrowserRedirect: true,
      },
    });
    expect(auth.setSession).toHaveBeenCalledWith({
      access_token: 'at-1',
      refresh_token: 'rt-1',
    });
  });

  it('콜백 URL에 identity_already_exists 에러가 있으면 conflict를 반환한다', async () => {
    auth.linkIdentity.mockResolvedValue({
      data: { url: 'https://accounts.google.com/oauth' },
      error: null,
    });
    openAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: 'runningapp://google-auth#error=server_error&error_code=identity_already_exists',
    });

    const result = await linkGoogleAccount();

    expect(result).toEqual({ status: 'conflict' });
    expect(auth.setSession).not.toHaveBeenCalled();
  });

  it('유저가 브라우저 시트를 닫으면 cancelled를 반환한다', async () => {
    auth.linkIdentity.mockResolvedValue({
      data: { url: 'https://accounts.google.com/oauth' },
      error: null,
    });
    openAuthSessionAsync.mockResolvedValue({ type: 'cancel' });

    const result = await linkGoogleAccount();

    expect(result).toEqual({ status: 'cancelled' });
    expect(auth.setSession).not.toHaveBeenCalled();
  });

  it('linkIdentity가 에러를 반환하면 error를 반환한다', async () => {
    auth.linkIdentity.mockResolvedValue({
      data: { url: null },
      error: { code: 'manual_linking_disabled', message: 'Manual linking is disabled' },
    });

    const result = await linkGoogleAccount();

    expect(result).toEqual({
      status: 'error',
      error: 'Manual linking is disabled',
    });
  });
});

describe('signInWithGoogle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('브라우저 인증 성공 시 세션을 설정하고 success를 반환한다', async () => {
    auth.signInWithOAuth.mockResolvedValue({
      data: { url: 'https://accounts.google.com/oauth' },
      error: null,
    });
    openAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: 'runningapp://google-auth#access_token=at-2&refresh_token=rt-2',
    });
    auth.setSession.mockResolvedValue({ data: {}, error: null });

    const result = await signInWithGoogle();

    expect(result).toEqual({ status: 'success' });
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: 'runningapp://google-auth',
        skipBrowserRedirect: true,
      },
    });
  });

  it('유저가 브라우저 시트를 닫으면 cancelled를 반환한다', async () => {
    auth.signInWithOAuth.mockResolvedValue({
      data: { url: 'https://accounts.google.com/oauth' },
      error: null,
    });
    openAuthSessionAsync.mockResolvedValue({ type: 'dismiss' });

    const result = await signInWithGoogle();

    expect(result).toEqual({ status: 'cancelled' });
  });
});
