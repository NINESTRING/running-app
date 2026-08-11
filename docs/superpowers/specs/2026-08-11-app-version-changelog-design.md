# 앱 버전 표시 + 버전 이력 DB 보관 설계

날짜: 2026-08-11

## 목적

- 설정 페이지에 현재 앱 버전을 표시한다.
- 버전과 변경 사항(체인지로그)을 Supabase에 보관한다.
- DB의 최신 버전이 앱 버전보다 높으면 설정 페이지에 "새 버전 있음" 배지를 조용히 표시한다.
- 버전 행을 누르면 버전별 변경 사항 목록을 볼 수 있다.

강제 업데이트, 앱 시작 시 모달 안내는 범위 밖이다.

## 데이터베이스 (Supabase)

새 마이그레이션으로 `public.app_versions` 테이블을 추가한다.

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `version` | `text primary key` | semver 문자열 (예: "1.0.0") |
| `notes` | `text not null` | 변경 사항. 줄바꿈으로 항목 구분 |
| `released_at` | `timestamptz not null default now()` | 릴리스 시각 |

- RLS 활성화. 로그인한 사용자(익명 포함) 누구나 `select` 가능한 정책만 둔다.
- `insert`/`update`/`delete` 정책은 만들지 않는다 — 버전 등록은 개발자가 마이그레이션 또는 Supabase 대시보드(service role)에서 직접 한다.
- 시드로 현재 버전 `1.0.0` 행을 마이그레이션에 포함한다.
- `src/types/database.types.ts`에 테이블 타입을 반영한다.

## 앱 구조

### 버전 읽기

- 네이티브: `expo-application`의 `nativeApplicationVersion` (실제 설치된 바이너리 버전).
- 웹 폴백: `expo-constants`의 `expoConfig.version`.

### 비교 로직 — `src/lib/version.ts`

- `compareSemver(a: string, b: string): number` 순수 함수 (-1/0/1).
- 기존 `src/lib/__tests__/` 패턴대로 단위 테스트를 작성한다.

### 서비스 — `src/services/appVersions.ts`

- `fetchLatestVersion()`: 최신 버전 한 건 조회.
- `fetchVersionHistory()`: 전체 버전 이력을 `released_at` 내림차순으로 조회.
- 기존 `runs.ts` 패턴(널 가능한 supabase 클라이언트 처리 등)을 따른다.

## UI

### 설정 페이지 (`app/(tabs)/settings.tsx`)

- "앱 정보" 섹션을 추가하고 "버전 x.y.z" 행을 표시한다.
- DB 최신 버전이 내 버전보다 높으면 행 옆에 "새 버전 있음" 배지를 표시한다.
- 행을 누르면 변경 사항 화면으로 이동한다.

### 변경 사항 화면 (`app/changelog.tsx`)

- 버전 이력을 버전·날짜·변경 사항으로 목록 표시한다.
- 로딩/빈 목록/에러 상태를 처리한다.

### 에러/오프라인 처리

- 최신 버전 조회 실패 시 배지 없이 내 버전만 표시한다 (조용한 실패).
- 변경 사항 화면은 조회 실패 시 에러 문구를 표시한다.

## 릴리스 절차 (운영 규칙)

새 버전을 낼 때마다:

1. `app.json`의 `expo.version`을 올린다.
2. `app_versions`에 새 행을 추가한다 (마이그레이션 또는 대시보드).

이 절차를 README에 한 줄 기록해 둔다.

## 테스트

- `compareSemver` 단위 테스트 (일반 비교, 자릿수 다른 버전, 동일 버전).
- 서비스/UI는 기존 프로젝트 테스트 패턴 범위 내에서 작성한다.
