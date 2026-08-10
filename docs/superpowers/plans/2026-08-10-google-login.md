# 구글 로그인 (익명 계정 업그레이드) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 익명 유저가 설정 탭에서 구글 계정을 연결(linkIdentity)해 유저 ID를 유지한 채 영구 계정으로 업그레이드하고, 재설치 후에도 구글 로그인으로 기록을 되찾을 수 있게 한다.

**Architecture:** 브라우저 OAuth 방식 — `supabase.auth.linkIdentity()`로 OAuth URL을 받아 `expo-web-browser`의 `openAuthSessionAsync()`로 열고, `runningapp://google-auth` 딥링크 콜백에서 토큰을 추출해 `setSession()`한다. 세션 상태는 zustand `authStore`가 `onAuthStateChange` 구독으로 노출하고, 설정 탭의 `AccountSection` 컴포넌트가 이를 렌더링한다. DB/RLS 변경 없음.

**Tech Stack:** Expo SDK 57, expo-router, supabase-js v2, expo-web-browser(설치됨), zustand, RNR UI 컴포넌트(Card/Button/AlertDialog), jest + jest-expo

**스펙:** `docs/superpowers/specs/2026-08-10-google-login-design.md`

## Global Constraints

- Expo SDK 57 고정 — 코드 작성 전 https://docs.expo.dev/versions/v57.0.0/ 의 해당 API 문서를 확인할 것 (AGENTS.md 요구사항)
- 새 네이티브 의존성 추가 금지 (dev client 재빌드 없이 동작해야 함)
- 딥링크 리다이렉트 URL은 정확히 `runningapp://google-auth` (Supabase 대시보드 허용 목록에 이미 등록됨)
- 원격 Supabase 프로젝트: `hytckdlqvfmrqpocgzin` (Google provider, manual linking, redirect URL 설정 완료)
- UI 문구는 한국어, 기존 파일들의 한국어 주석 스타일 유지
- iOS 우선 — 웹(`Platform.OS === 'web'`)에서는 계정 섹션을 렌더링하지 않음
- 테스트 실행: `npm test` (TZ=Asia/Seoul jest)
- 커밋 메시지는 기존 컨벤션(`feat(auth): ...` 형식, 한국어 요약) + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## File Structure

| 파일 | 작업 | 책임 |
|---|---|---|
| `supabase/config.toml` | 수정 | 로컬 개발 스택 설정을 원격과 일치 (manual linking, google provider, redirect URL) |
| `src/services/auth.ts` | 수정 | 콜백 URL 파서, 브라우저 OAuth 플로우, `linkGoogleAccount` / `signInWithGoogle` / `signOut` |
| `src/services/__tests__/auth.test.ts` | 수정 | 위 함수들의 단위 테스트 (supabase·WebBrowser 모킹) |
| `src/stores/authStore.ts` | 생성 | 세션 상태 (`userId`, `isAnonymous`, `email`) — `onAuthStateChange` 구독 |
| `src/stores/__tests__/authStore.test.ts` | 생성 | 세션→상태 변환 및 구독 갱신 테스트 |
| `src/components/AccountSection.tsx` | 생성 | 설정 탭 계정 섹션 UI (연결/로그아웃/충돌 다이얼로그) |
| `app/(tabs)/settings.tsx` | 수정 | `AccountSection` 배치 |

---

### Task 1: 로컬 Supabase 설정 반영 (config.toml)

원격 대시보드에는 이미 설정이 끝났다. 로컬 개발 스택(`supabase start` 사용 시)이 원격과 동일하게 동작하도록 `config.toml`만 맞춘다. 코드가 참조하는 파일이 아니므로 테스트는 없다.

**Files:**
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: 없음
- Produces: 없음 (로컬 인프라 설정)

- [ ] **Step 1: manual linking 활성화**

`supabase/config.toml` 180행 부근:

```toml
# 변경 전
enable_manual_linking = false
# 변경 후 — 익명 계정에 identity를 연결(linkIdentity)하려면 필수
enable_manual_linking = true
```

- [ ] **Step 2: 딥링크 redirect URL 허용 목록 추가**

163행 부근:

```toml
# 변경 전
additional_redirect_urls = ["https://127.0.0.1:3000"]
# 변경 후
additional_redirect_urls = ["https://127.0.0.1:3000", "runningapp://google-auth"]
```

- [ ] **Step 3: Google provider 섹션 추가**

`[auth.external.apple]` 섹션 아래에 추가 (시크릿은 env 치환 — 커밋 금지 규칙은 파일 내 주석과 동일):

```toml
[auth.external.google]
enabled = true
client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"
# 로컬 스택에서 구글 로그인 시 nonce 검사를 건너뛰어야 함 (config 상단 주석 참고)
skip_nonce_check = true
```

- [ ] **Step 4: 커밋**

```bash
git add supabase/config.toml
git commit -m "chore(supabase): 로컬 설정에 구글 provider 및 manual linking 반영

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 콜백 URL 파서 + `linkGoogleAccount()`

**Files:**
- Modify: `src/services/auth.ts`
- Test: `src/services/__tests__/auth.test.ts`

**Interfaces:**
- Consumes: `supabase` 클라이언트 (`./supabase`), `expo-web-browser`
- Produces (Task 3, 4, 7이 사용):
  - `export type GoogleAuthResult = { status: 'success' } | { status: 'conflict' } | { status: 'cancelled' } | { status: 'error'; error: string }`
  - `export function parseAuthCallbackParams(url: string): { accessToken: string | null; refreshToken: string | null; errorCode: string | null; errorDescription: string | null }`
  - `export async function linkGoogleAccount(): Promise<GoogleAuthResult>`
  - 내부 헬퍼 `completeOAuthInBrowser(oauthUrl: string): Promise<GoogleAuthResult>` (Task 3에서 재사용)

**배경 지식 (구현자용):**
- Supabase 암시적(implicit) 플로우는 토큰을 콜백 URL의 **프래그먼트(`#`)** 로 전달한다: `runningapp://google-auth#access_token=...&refresh_token=...`
- 계정 충돌(이미 다른 유저에 연결된 구글 계정)은 OAuth 완료 후 콜백 URL에 에러로 실려 온다: `#error=server_error&error_code=identity_already_exists&error_description=...`. `linkIdentity()` 호출 자체가 즉시 에러를 반환하는 경우(manual linking 비활성 등)도 있으므로 양쪽 모두 처리한다.
- `openAuthSessionAsync`는 유저가 시트를 닫으면 `{ type: 'cancel' }`(iOS) 또는 `{ type: 'dismiss' }`를 반환한다 — `'success'`가 아니면 전부 취소로 처리.
- URL/URLSearchParams는 Expo SDK 57 런타임에 폴리필되어 있어 그대로 사용 가능.

- [ ] **Step 1: 파서 실패 테스트 작성**

`src/services/__tests__/auth.test.ts`의 기존 `jest.mock('../supabase', ...)` 블록을 아래처럼 확장하고 (기존 테스트는 유지), 파일 상단에 expo-web-browser 모킹을 추가한 뒤 파서 테스트를 추가한다:

```ts
import { ensureSignedIn, linkGoogleAccount, parseAuthCallbackParams } from '../auth';
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
```

파서 테스트:

```ts
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- --testPathPattern auth`
Expected: FAIL — `parseAuthCallbackParams`가 export되지 않음

- [ ] **Step 3: 파서 구현**

`src/services/auth.ts`에 추가:

```ts
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
```

- [ ] **Step 4: 파서 테스트 통과 확인**

Run: `npm test -- --testPathPattern auth`
Expected: PASS (파서 테스트 3개)

- [ ] **Step 5: `linkGoogleAccount` 실패 테스트 작성**

```ts
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
```

- [ ] **Step 6: 테스트 실패 확인**

Run: `npm test -- --testPathPattern auth`
Expected: FAIL — `linkGoogleAccount`가 export되지 않음

- [ ] **Step 7: `linkGoogleAccount` 구현**

`src/services/auth.ts` 상단 import와 상수, 그리고 함수 추가:

```ts
import * as WebBrowser from 'expo-web-browser';

import { supabase } from './supabase';

const GOOGLE_AUTH_REDIRECT_URL = 'runningapp://google-auth';

export type GoogleAuthResult =
  | { status: 'success' }
  | { status: 'conflict' }
  | { status: 'cancelled' }
  | { status: 'error'; error: string };
```

```ts
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
```

- [ ] **Step 8: 테스트 통과 확인**

Run: `npm test -- --testPathPattern auth`
Expected: PASS (기존 3개 + 파서 3개 + linkGoogleAccount 4개)

- [ ] **Step 9: 커밋**

```bash
git add src/services/auth.ts src/services/__tests__/auth.test.ts
git commit -m "feat(auth): 구글 계정 연결(linkGoogleAccount) 및 콜백 파서 추가

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `signInWithGoogle()`

충돌 시 기존 계정으로 전환하거나 로그아웃 후 재로그인할 때 쓰는 함수. Task 2의 `completeOAuthInBrowser`를 재사용하므로 차이는 `signInWithOAuth` 호출뿐이다.

**Files:**
- Modify: `src/services/auth.ts`
- Test: `src/services/__tests__/auth.test.ts`

**Interfaces:**
- Consumes: Task 2의 `completeOAuthInBrowser`, `GoogleAuthResult`, `GOOGLE_AUTH_REDIRECT_URL`
- Produces (Task 6이 사용): `export async function signInWithGoogle(): Promise<GoogleAuthResult>` — `'conflict'`는 반환하지 않음

- [ ] **Step 1: 실패 테스트 작성**

```ts
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
```

import 문에 `signInWithGoogle` 추가.

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- --testPathPattern auth`
Expected: FAIL — `signInWithGoogle`가 export되지 않음

- [ ] **Step 3: 구현**

```ts
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- --testPathPattern auth`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/services/auth.ts src/services/__tests__/auth.test.ts
git commit -m "feat(auth): 구글 로그인(signInWithGoogle) 추가

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `signOut()`

**Files:**
- Modify: `src/services/auth.ts`
- Test: `src/services/__tests__/auth.test.ts`

**Interfaces:**
- Consumes: `supabase` 클라이언트
- Produces (Task 6이 사용): `export async function signOut(): Promise<{ ok: boolean; error?: string }>`

- [ ] **Step 1: 실패 테스트 작성**

```ts
describe('signOut', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('로그아웃 후 즉시 새 익명 세션을 만든다', async () => {
    auth.signOut.mockResolvedValue({ error: null });
    auth.signInAnonymously.mockResolvedValue({
      data: { session: { user: { id: 'anon-2' } } },
      error: null,
    });

    const result = await signOut();

    expect(result).toEqual({ ok: true });
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('로그아웃이 실패하면 익명 로그인을 시도하지 않는다', async () => {
    auth.signOut.mockResolvedValue({ error: { message: 'network error' } });

    const result = await signOut();

    expect(result).toEqual({ ok: false, error: 'network error' });
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });
});
```

import 문에 `signOut` 추가.

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- --testPathPattern auth`
Expected: FAIL — `signOut`이 export되지 않음

- [ ] **Step 3: 구현**

```ts
// 로그아웃 후 즉시 새 익명 세션을 만든다.
// 앱 전체가 "항상 로그인돼 있음"을 전제하므로 로그아웃 상태를 따로 두지 않는다.
export async function signOut(): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) {
    return { ok: false, error: 'Supabase가 설정되지 않았습니다 (.env 확인)' };
  }
  const { error: signOutError } = await supabase.auth.signOut();
  if (signOutError) return { ok: false, error: signOutError.message };

  const { error } = await supabase.auth.signInAnonymously();
  return error ? { ok: false, error: error.message } : { ok: true };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- --testPathPattern auth`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/services/auth.ts src/services/__tests__/auth.test.ts
git commit -m "feat(auth): 로그아웃 후 익명 세션 재생성(signOut) 추가

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `authStore` — 세션 상태 스토어

**Files:**
- Create: `src/stores/authStore.ts`
- Test: `src/stores/__tests__/authStore.test.ts`

**Interfaces:**
- Consumes: `supabase` 클라이언트 (`../services/supabase`), `Session` 타입 (`@supabase/supabase-js`)
- Produces (Task 6이 사용):
  - `export interface AuthState { userId: string | null; isAnonymous: boolean; email: string | null }`
  - `export function sessionToAuthState(session: Session | null): AuthState`
  - `export const useAuthStore: UseBoundStore<StoreApi<AuthState>>` — zustand 스토어

**배경 지식:** `onAuthStateChange`는 구독 즉시 `INITIAL_SESSION` 이벤트로 현재 세션을 전달하므로 초기 상태 동기화가 자동으로 된다. 구글 연결 후에는 `USER_UPDATED`/`TOKEN_REFRESHED` 이벤트로 `is_anonymous`와 `email`이 갱신된 세션이 온다.

- [ ] **Step 1: 실패 테스트 작성**

`src/stores/__tests__/authStore.test.ts`:

```ts
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- --testPathPattern authStore`
Expected: FAIL — `../authStore` 모듈 없음

- [ ] **Step 3: 구현**

`src/stores/authStore.ts`:

```ts
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- --testPathPattern authStore`
Expected: PASS

- [ ] **Step 5: 전체 테스트 확인**

Run: `npm test`
Expected: 전체 PASS (기존 runStore/geo/stats/runs 테스트 포함)

- [ ] **Step 6: 커밋**

```bash
git add src/stores/authStore.ts src/stores/__tests__/authStore.test.ts
git commit -m "feat(auth): 세션 상태 zustand 스토어(authStore) 추가

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 설정 탭 계정 섹션 UI

기존 테스트 스위트에 UI 컴포넌트 테스트 패턴이 없으므로(로직 테스트만 존재) 이 태스크는 타입체크·린트·수동 확인으로 검증한다. 분기 로직은 전부 Task 2~5에서 테스트된 서비스/스토어에 있다.

**Files:**
- Create: `src/components/AccountSection.tsx`
- Modify: `app/(tabs)/settings.tsx`

**Interfaces:**
- Consumes:
  - `linkGoogleAccount`, `signInWithGoogle`, `signOut`, `GoogleAuthResult` (`@/services/auth`)
  - `useAuthStore` (`@/stores/authStore`)
  - RNR: `Card, CardContent, CardDescription, CardHeader, CardTitle` / `Button` / `AlertDialog*` / `Text`
- Produces: `export function AccountSection(): ReactNode`

- [ ] **Step 1: `AccountSection` 컴포넌트 작성**

`src/components/AccountSection.tsx`:

```tsx
import { useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { linkGoogleAccount, signInWithGoogle, signOut } from '@/services/auth';
import { useAuthStore } from '@/stores/authStore';

export function AccountSection() {
  const isAnonymous = useAuthStore((s) => s.isAnonymous);
  const email = useAuthStore((s) => s.email);
  const [busy, setBusy] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  // iOS 우선 — 웹은 OAuth 리다이렉트 처리가 달라 이번 범위에서 제외
  if (Platform.OS === 'web') return null;

  const handleLink = async () => {
    setBusy(true);
    setErrorText(null);
    const result = await linkGoogleAccount();
    setBusy(false);
    if (result.status === 'conflict') setConflictOpen(true);
    else if (result.status === 'error') setErrorText(result.error);
    // 'cancelled'는 아무 것도 표시하지 않음
  };

  const handleConflictSignIn = async () => {
    setConflictOpen(false);
    setBusy(true);
    setErrorText(null);
    const result = await signInWithGoogle();
    setBusy(false);
    if (result.status === 'error') setErrorText(result.error);
  };

  const handleSignOut = async () => {
    setBusy(true);
    setErrorText(null);
    const result = await signOut();
    setBusy(false);
    if (!result.ok && result.error) setErrorText(result.error);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>계정</CardTitle>
        <CardDescription>
          {isAnonymous
            ? '게스트로 사용 중 — 구글 계정을 연결하면 기기를 바꾸거나 앱을 다시 설치해도 기록이 유지돼요.'
            : `${email ?? '구글 계정'}으로 연결됨`}
        </CardDescription>
      </CardHeader>
      <CardContent className="gap-3">
        {isAnonymous ? (
          <Button onPress={handleLink} disabled={busy}>
            {busy ? <ActivityIndicator size="small" /> : <Text>구글로 계정 연결</Text>}
          </Button>
        ) : (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={busy}>
                {busy ? <ActivityIndicator size="small" /> : <Text>로그아웃</Text>}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>로그아웃할까요?</AlertDialogTitle>
                <AlertDialogDescription>
                  로그아웃하면 이 기기는 새 게스트 계정으로 시작해요. 구글로 다시
                  로그인하면 기록을 되찾을 수 있어요.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>
                  <Text>취소</Text>
                </AlertDialogCancel>
                <AlertDialogAction onPress={handleSignOut}>
                  <Text>로그아웃</Text>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {errorText ? (
          <Text className="text-sm text-destructive">{errorText}</Text>
        ) : null}

        <AlertDialog open={conflictOpen} onOpenChange={setConflictOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>이미 사용 중인 구글 계정이에요</AlertDialogTitle>
              <AlertDialogDescription>
                이 구글 계정은 다른 계정에 이미 연결되어 있어요. 기존 계정으로
                로그인할까요? 이 기기의 게스트 기록은 옮겨지지 않아요.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                <Text>취소</Text>
              </AlertDialogCancel>
              <AlertDialogAction onPress={handleConflictSignIn}>
                <Text>기존 계정으로 로그인</Text>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
```

주의: `@rn-primitives/alert-dialog`의 Root가 controlled `open`/`onOpenChange` prop을 지원하는지 `src/components/ui/alert-dialog.tsx`와 홈 화면(`app/(tabs)/index.tsx`)의 기존 사용례에서 확인할 것. 만약 controlled 모드가 없으면 충돌 다이얼로그는 조건부 렌더링(`{conflictOpen && <AlertDialog defaultOpen ...>}`) 대신 primitive의 실제 API에 맞춰 조정한다.

- [ ] **Step 2: 설정 화면에 배치**

`app/(tabs)/settings.tsx` — `AccountSection`을 거리 단위 위에 추가:

```tsx
import { View } from 'react-native';

import { AccountSection } from '@/components/AccountSection';
import { Text } from '@/components/ui/text';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useSettingsStore } from '@/stores/settingsStore';

export default function SettingsScreen() {
  const unit = useSettingsStore((s) => s.unit);
  const setUnit = useSettingsStore((s) => s.setUnit);

  return (
    <View className="flex-1 gap-6 bg-background p-4">
      <AccountSection />
      <View className="gap-3">
        <Text className="text-base font-semibold">거리 단위</Text>
        <ToggleGroup
          type="single"
          value={unit}
          onValueChange={(v) => {
            if (v === 'km' || v === 'mi') setUnit(v);
          }}
          className="justify-start"
        >
          <ToggleGroupItem value="km" isFirst>
            <Text>km</Text>
          </ToggleGroupItem>
          <ToggleGroupItem value="mi" isLast>
            <Text>mi</Text>
          </ToggleGroupItem>
        </ToggleGroup>
      </View>
    </View>
  );
}
```

- [ ] **Step 3: 타입체크·린트·전체 테스트**

Run: `npx tsc --noEmit && npx eslint src/components/AccountSection.tsx "app/(tabs)/settings.tsx" && npm test`
Expected: 에러 없음, 전체 테스트 PASS

- [ ] **Step 4: 커밋**

```bash
git add src/components/AccountSection.tsx "app/(tabs)/settings.tsx"
git commit -m "feat(settings): 계정 섹션 UI 추가 (구글 연결·로그아웃·충돌 처리)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 수동 통합 검증 (실기기/시뮬레이터)

브라우저 OAuth와 딥링크 복귀는 단위 테스트로 검증할 수 없다. iOS 시뮬레이터(또는 실기기)에서 dev client로 확인한다.

**Files:** 없음 (검증만)

**Interfaces:**
- Consumes: Task 1~6의 전체 결과물
- Produces: 없음

- [ ] **Step 1: 앱 실행**

Run: `npx expo start` 후 iOS dev client로 열기 (시뮬레이터: 터미널에서 `i`)

- [ ] **Step 2: 연결 플로우 확인**

1. 설정 탭 → "게스트로 사용 중" 카드 확인
2. [구글로 계정 연결] → 사파리 인증 시트에서 구글 로그인 (구글 앱 Testing 상태이므로 테스트 사용자로 등록한 계정 사용)
3. 앱 복귀 후 카드가 이메일 표시로 바뀌는지 확인

- [ ] **Step 3: 기록 승계 확인**

연결 전에 기록해 둔 러닝이 히스토리 탭에 그대로 보이는지 확인 (유저 ID 유지 검증)

- [ ] **Step 4: 취소 플로우 확인**

로그아웃 → 새 게스트 상태에서 [구글로 계정 연결] → 인증 시트를 그냥 닫기 → 에러 표시 없이 게스트 상태 유지 확인

- [ ] **Step 5: 충돌 플로우 확인**

새 게스트 상태(Step 4 이후)에서 [구글로 계정 연결] → Step 2에서 쓴 구글 계정으로 진행 → "이미 사용 중인 구글 계정이에요" 다이얼로그 → [기존 계정으로 로그인] → 이메일 표시 + Step 3의 기록이 다시 보이는지 확인

- [ ] **Step 6: 로그아웃 확인**

로그아웃 → 확인 다이얼로그 → 게스트 카드로 전환 확인. 히스토리가 비어 있는지(새 익명 계정) 확인

- [ ] **Step 7: 문제 발견 시**

superpowers:systematic-debugging 스킬로 원인 규명 후 수정. 흔한 원인:
- 시트에서 인증은 되는데 앱으로 안 돌아옴 → Supabase 대시보드 Redirect URLs에 `runningapp://google-auth` 누락
- `linkIdentity`가 즉시 에러 → 대시보드 "Allow manual linking" 꺼져 있음
- 연결 후에도 게스트로 표시 → authStore가 `USER_UPDATED` 이벤트를 못 받음: `setSession` 성공 여부와 onAuthStateChange 구독 시점 확인
