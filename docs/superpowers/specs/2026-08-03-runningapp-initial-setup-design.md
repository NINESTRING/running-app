# 런닝앱 초기 세팅 설계

날짜: 2026-08-03
상태: 승인됨

## 목표

React Native + Expo 기반 런닝앱의 초기 스캐폴드 + 핵심 화면 뼈대를 만든다.
뼈대 수준에서 GPS 추적 시작·정지가 실제로 동작해야 한다.

## 확정된 스택

| 층 | 선택 |
|---|---|
| 앱 프레임워크 | React Native + Expo (TypeScript) |
| 라우팅 | Expo Router (파일 기반, 탭 4개) |
| GPS 추적 | expo-location + expo-task-manager (백그라운드) |
| 빌드/배포 | EAS Build (development / preview / production 프로필) |
| 백엔드 + DB | Supabase (PostgreSQL + PostGIS, 인증) — 프로젝트 미생성, 마이그레이션 SQL만 준비 |
| 지도 | react-native-maps |
| 상태 관리 | Zustand |
| 차트 | victory-native (Skia 기반) |

## 프로젝트 구조

```
runningapp.v1/
├── app/
│   ├── _layout.tsx              # 루트 레이아웃 (백그라운드 태스크 등록 import)
│   ├── (tabs)/
│   │   ├── _layout.tsx          # 탭 네비게이터
│   │   ├── index.tsx            # 홈: 지도 + 추적 시작/일시정지/정지
│   │   ├── history.tsx          # 기록 목록
│   │   ├── stats.tsx            # 통계 (주간 거리 차트)
│   │   └── settings.tsx         # 설정 (단위 등 최소 항목)
│   └── run/[id].tsx             # 러닝 상세 (경로 지도 + 요약)
├── src/
│   ├── components/RouteMap.tsx  # react-native-maps 래퍼 (경로 폴리라인)
│   ├── stores/runStore.ts       # Zustand: 세션 상태/좌표/거리/시간
│   ├── services/
│   │   ├── location.ts          # 위치 권한, 백그라운드 추적 태스크
│   │   └── supabase.ts          # Supabase 클라이언트 (.env 기반)
│   ├── lib/geo.ts               # haversine 거리, 페이스 계산/포맷
│   └── types/run.ts
├── supabase/migrations/0001_init.sql
├── eas.json
├── .env.example                 # EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY
└── app.json                     # 위치 권한 plugin 설정
```

## 데이터 흐름

1. 홈 화면에서 시작 → 위치 권한 요청 → `Location.startLocationUpdatesAsync`로 백그라운드 태스크 시작.
2. TaskManager 콜백이 좌표를 `runStore`에 추가하고 haversine으로 거리 누적.
3. 홈 화면이 `runStore`를 구독해 실시간 거리/경과 시간/페이스 표시, 지도에 폴리라인 갱신.
4. 정지 시 좌표 배열을 GeoJSON LineString으로 변환해 Supabase `runs` 테이블에 저장.

## DB 스키마 (supabase/migrations/0001_init.sql)

```sql
runs (
  id uuid primary key,
  user_id uuid references auth.users,
  started_at timestamptz,
  duration_sec integer,
  distance_m double precision,
  route geography(LineString, 4326)
)
```

- PostGIS 확장 활성화 포함.
- RLS: 본인 행만 select/insert/update/delete 가능.
- Supabase 프로젝트는 아직 없으므로 SQL 파일로만 준비. 추후 프로젝트 생성 후 적용.

## 에러 처리

- **위치 권한 거부**: 홈 화면에 안내 메시지 + 시스템 설정 열기 버튼. 크래시 없음.
- **Supabase 미설정**: `.env`가 없으면 클라이언트는 null. 저장 시도 시 사용자에게 경고만 표시하고 앱은 계속 동작.
- **백그라운드 권한**: iOS `NSLocationAlwaysAndWhenInUseUsageDescription` 문구, Android foreground service를 `app.json`의 expo-location plugin 옵션으로 선언.

## 테스트

- `jest-expo` 프리셋.
- 유닛 테스트 대상: `lib/geo.ts`(거리·페이스 계산), `stores/runStore.ts`(상태 전이: idle → running → paused → finished).
- 지도·GPS는 네이티브 의존이므로 EAS dev build에서 수동 확인 (시뮬레이터 GPX 재생 활용).

## 범위 제외 (YAGNI)

- 인증 화면(로그인/회원가입) — Supabase 프로젝트 생성 후 별도 작업.
- Kakao Maps 전환 — 필요 시 `RouteMap` 컴포넌트만 교체.
- 소셜/공유/목표 설정 등 부가 기능.
