# 구글 로그인 (익명 계정 업그레이드) 설계

날짜: 2026-08-10
상태: 승인됨

## 목표

현재 앱은 시작 시 자동 익명 로그인만 지원한다. 익명 유저가 구글 계정을 연결해
기기 변경·재설치 후에도 러닝 기록을 되찾을 수 있게 한다.

## 확정된 요구사항

| 항목 | 결정 |
|---|---|
| 데이터 승계 | 익명 계정 업그레이드 — `linkIdentity`로 구글 identity를 연결해 유저 ID 유지. 기존 runs 자동 승계, 마이그레이션 불필요 |
| 플랫폼 | iOS 우선. 웹에서는 계정 섹션 숨김 |
| UI 진입점 | 설정 탭에 계정 섹션. 온보딩 로그인 화면 없음 |
| 계정 충돌 | 구글 계정이 이미 다른 유저에 연결된 경우, 안내 후 기존 계정으로 로그인 전환 (현재 기기의 익명 기록은 승계되지 않음) |
| 로그아웃 | 포함. 로그아웃 즉시 새 익명 세션 생성 |
| 구현 방식 | 브라우저 OAuth (`linkIdentity` + `expo-web-browser`). 네이티브 구글 SDK는 익명 계정 연결(`linkIdentity`)을 지원하지 않아 제외 |

## Supabase 프로젝트 설정 (코드 외 사전 작업)

원격 프로젝트 `hytckdlqvfmrqpocgzin` 대상:

1. Google Cloud Console에서 OAuth 클라이언트(웹 애플리케이션 타입) 생성.
   Authorized redirect URI: `https://hytckdlqvfmrqpocgzin.supabase.co/auth/v1/callback`
2. Supabase 대시보드에서 Google provider 활성화 (client ID + secret 입력)
3. **Manual linking 활성화** — 익명 계정에 identity를 연결하는 데 필수
4. Redirect URLs 허용 목록에 `runningapp://google-auth` 추가
5. `supabase/config.toml`에도 동일 설정을 반영해 로컬 개발 환경과 일치시킴

## 아키텍처

### 인증 서비스 확장 — `src/services/auth.ts`

기존 `ensureSignedIn()`은 그대로 두고 3개 함수를 추가한다.

- **`linkGoogleAccount()`** — 익명 계정 업그레이드.
  1. `supabase.auth.linkIdentity({ provider: 'google', options: { redirectTo: 'runningapp://google-auth', skipBrowserRedirect: true } })`로 OAuth URL 획득
  2. `WebBrowser.openAuthSessionAsync(url, 'runningapp://google-auth')`로 인증 시트 오픈
  3. 콜백 URL에서 토큰 추출 후 `supabase.auth.setSession()`
  4. 유저 ID가 유지되므로 기존 runs가 자동 승계됨
  - 반환: `'linked' | 'conflict' | 'cancelled' | 'error'` 판별 유니언 (에러 메시지 포함)
  - `conflict`는 `identity_already_exists` (HTTP 422) 응답으로 판별
- **`signInWithGoogle()`** — 같은 브라우저 플로우지만 `signInWithOAuth` 사용.
  충돌 시 기존 계정 전환, 로그아웃 후 재로그인에 사용.
- **`signOut()`** — `supabase.auth.signOut()` 후 즉시 `signInAnonymously()` 재호출.
  앱 전체가 "항상 로그인돼 있음"을 전제하므로 로그아웃 상태를 별도로 만들지 않는다.

### 세션 상태 — `src/stores/authStore.ts` (신규)

기존 zustand 스토어 패턴을 따른다. `supabase.auth.onAuthStateChange` 구독으로
`{ user, isAnonymous, email }`을 노출하고, 설정 화면이 이를 구독해
익명/연결됨 상태를 렌더링한다.

### RLS / DB

변경 없음. 기존 정책이 `auth.uid()` 기반이고 유저 ID가 유지되므로
마이그레이션이 필요 없다.

## UI — 설정 탭 계정 섹션

`app/(tabs)/settings.tsx`에 "계정" 섹션 추가. 기존 RNR 컴포넌트
(Card, Button, AlertDialog) 재사용.

- **익명 상태**: "게스트로 사용 중" 안내 + [구글로 계정 연결] 버튼.
  연결하면 기기 변경·재설치에도 기록이 유지된다는 한 줄 설명.
- **연결됨 상태**: 구글 이메일 표시 + [로그아웃] 버튼.
- 진행 중에는 버튼 비활성화. 웹(`Platform.OS === 'web'`)에서는 섹션 숨김.

## 엣지 케이스 처리

| 상황 | 처리 |
|---|---|
| 구글 계정이 이미 다른 유저에 연결됨 (`identity_already_exists`) | AlertDialog: "이미 사용 중인 구글 계정입니다. 기존 계정으로 로그인할까요? 이 기기의 게스트 기록은 옮겨지지 않아요." → 확인 시 `signInWithGoogle()`로 전환 |
| 유저가 인증 시트에서 취소 | 아무 것도 하지 않음 (에러 표시 없음) |
| 네트워크/기타 오류 | 인라인 에러 텍스트 표시, 재시도 가능 |
| 로그아웃 | AlertDialog: "로그아웃하면 이 기기는 새 게스트 계정으로 시작해요. 구글로 다시 로그인하면 기록을 되찾을 수 있어요." → 확인 시 `signOut()` |

## 테스트

- `src/services/__tests__/auth.test.ts` 확장:
  - `linkGoogleAccount()`의 4가지 반환 분기 (linked / conflict / cancelled / error)
  - `signOut()`이 세션 종료 후 익명 재로그인을 호출하는지
  - supabase 클라이언트와 `expo-web-browser` 모킹 (기존 `__mocks__` 패턴)
- 수동 테스트 체크리스트:
  1. 실기기(또는 시뮬레이터)에서 구글 연결 → 설정에 이메일 표시 확인
  2. 연결 전후 러닝 기록이 동일하게 보이는지 확인 (유저 ID 승계)
  3. 앱 삭제 → 재설치 → 구글 재로그인 → 기록 복구 확인
  4. 이미 연결된 구글 계정으로 새 익명 상태에서 연결 시도 → 충돌 다이얼로그 → 전환 확인
  5. 로그아웃 → 새 게스트 세션 → 구글 재로그인 → 기록 복구 확인

## 스코프 외 (향후 고려)

- **App Store 심사 지침 4.8**: 제3자 로그인을 제공하는 앱은 Sign in with Apple도
  요구된다. 개발 단계라 미포함하지만 스토어 출시 전 애플 로그인 추가 필요.
- Android / 웹 지원 (웹은 OAuth 리다이렉트 방식 별도 처리 필요)
- 계정 삭제 기능
- 익명 유저 자동 정리 (Supabase는 30일 지난 익명 유저 삭제 SQL 예시 제공)
