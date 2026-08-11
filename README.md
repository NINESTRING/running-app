# 런닝앱

React Native + Expo 기반 GPS 러닝 트래커.

## 스택

Expo (TypeScript) · Expo Router · expo-location + expo-task-manager ·
react-native-maps · Zustand · victory-native · Supabase (PostGIS) · EAS Build

## 시작하기

```bash
npm install
npx expo start
npx expo run:ios
```

- 기본 UI 확인은 Expo Go로 가능.
- **백그라운드 위치 추적은 dev build 필요**: `eas build --profile development --platform ios` (또는 android) 후 설치.
- Android에서 지도를 보려면 Google Maps API 키가 필요 (`app.json` → `android.config.googleMaps.apiKey`).

## Supabase 연결

1. [supabase.com](https://supabase.com)에서 프로젝트 생성
2. SQL Editor에서 `supabase/migrations/0001_init.sql` 실행
3. `.env.example`을 `.env`로 복사하고 URL/anon key 입력
4. 재시작: `npx expo start --clear`

주의: `runs` 테이블은 RLS로 보호되므로 실제 저장은 로그인(추후 구현) 후 가능.

## 테스트

```bash
npm test           # jest 유닛 테스트
npx tsc --noEmit   # 타입 체크
```

## 구조

- `app/` — Expo Router 화면 (탭: 홈/기록/통계/설정, `run/[id]` 상세)
- `src/lib/` — 순수 로직 (거리·페이스·주간 통계)
- `src/stores/` — Zustand 스토어
- `src/services/` — 위치 추적, Supabase
- `supabase/migrations/` — DB 스키마

## 릴리스 절차

새 버전을 낼 때마다:

1. `app.json`의 `expo.version`을 올린다.
2. `app_versions` 테이블에 새 행을 추가한다 (마이그레이션 파일 또는 Supabase 대시보드).
   - `version`: app.json과 동일한 semver 문자열
   - `notes`: 변경 사항 (줄바꿈으로 항목 구분)
