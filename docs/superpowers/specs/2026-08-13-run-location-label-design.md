# 러닝 기록 위치 라벨 설계

2026-08-13

## 목표

러닝 기록에 시작 지점의 행정구역 라벨(예: "서울 강남구 서초동")을 자동으로 기록하고, 기록 탭 목록과 러닝 상세 화면에 표시한다.

## 요구사항

- 지오코딩은 `expo-location` 내장 `reverseGeocodeAsync`만 사용한다. 외부 API·키 없음.
- 라벨 수준은 시·구·동("서울 강남구 서초동"). "서울특별시" 같은 접미사는 "서울"로 축약한다.
- 표시는 기록 탭 목록 행과 러닝 상세 화면 두 곳.
- 새 기록은 저장 시점에 지오코딩한다. 과거 기록은 기록 탭에서 lazy 백필한다(날씨 기능과 다른 점).
- 지오코딩 실패가 러닝 저장을 막거나 지연시키지 않는다. 실패 시 `null` 저장.
- 사용자 입력·수정 기능은 없다.

## 데이터 모델

### 마이그레이션 (`supabase/migrations/`)

`weather` 추가(`20260813000000_runs_weather.sql`)와 동일한 패턴:

```sql
-- 러닝 시작 지점 행정구역 라벨. null = 미조회·조회 실패·구버전 기록.
alter table public.runs add column location_label text;
```

이후 `runs_with_geojson` 뷰를 drop 후 재생성하며 컬럼을 추가한다
(기존 패턴대로 `create or replace` 대신 drop 사용, `security_invoker = on` 유지).

백필은 기존 update RLS 정책(본인 행만 update 가능)으로 충분하다. 새 정책 불필요.

### 타입

- `src/types/run.ts` — `RunRecord`에 `locationLabel: string | null` 추가.
- `src/services/runs.ts` — `FinishedRun`에 동일 필드 추가, `saveRun()` insert와 `rowToRunRecord()` 매핑에 반영. 백필용 `updateRunLocationLabel(id: string, label: string): Promise<boolean>` 추가(runs 테이블 update, 실패 시 false).
- `src/types/database.types.ts` — `npm run gen:types`로 재생성.

## 라벨 조합 (신규 `src/lib/location.ts`, 순수 함수)

```ts
formatLocationLabel(address: {
  region: string | null;      // 시/도 (예: "서울특별시")
  city: string | null;        // 시/구 (플랫폼별 상이)
  subregion: string | null;   // 구 (Android 폴백)
  district: string | null;    // 동 (예: "서초동")
}): string | null
```

- iOS(Apple)와 Android(Google)가 같은 좌표에서 필드를 다르게 채우므로 폴백 체인으로 조합한다:
  시/도 = `region`, 구 = `city ?? subregion`, 동 = `district`.
- 축약: "서울특별시"→"서울", "부산광역시"→"부산" 등 "특별시·광역시·특별자치시·특별자치도" 접미사 제거. "경기도" 등 도(道)는 그대로 둔다.
- null인 파트는 생략하고 남은 파트를 공백으로 연결한다. 인접 파트가 중복 문자열이면 하나만 남긴다.
- 모든 파트가 null이면 null 반환.
- 유닛 테스트 대상 (`src/lib/__tests__/location.test.ts`): iOS식 입력, Android식 입력, 부분 null, 전체 null, 축약, 중복 제거.

## 지오코딩 서비스 (신규 `src/services/geocoding.ts`)

```ts
fetchLocationLabel(latitude: number, longitude: number): Promise<string | null>
```

- `Location.reverseGeocodeAsync({ latitude, longitude })` 호출, 첫 결과를 `formatLocationLabel`로 조합.
- `reverseGeocodeAsync`는 abort를 지원하지 않으므로 `Promise.race`로 5초 타임아웃.
- 타임아웃·에러·빈 결과·조합 결과 null 등 모든 실패는 `null` 반환. throw하지 않는다.
- 위치 권한은 러닝 기능에서 이미 확보된 상태를 전제한다(권한 요청을 새로 하지 않는다).

## 저장 흐름 (새 기록)

날씨와 달리 시작 시점 선조회가 불필요하다(위치는 시간에 민감하지 않다).
`app/(tabs)/index.tsx`의 `onStop`에서 저장 직전에:

1. 경로 첫 좌표(첫 세그먼트의 첫 포인트)를 가져온다. 포인트가 없으면 라벨은 `null`.
2. `fetchLocationLabel()` 호출 결과를 `FinishedRun.locationLabel`에 담아 `saveRun()`에 전달한다.

실패해도 `null`로 저장하고 러닝 저장은 그대로 진행한다.

## 과거 기록 백필 (기록 탭)

`app/(tabs)/history.tsx`에서 `listRuns()` 완료 후 fire-and-forget으로:

1. `locationLabel === null`이고 시작 좌표가 있는(`routePoints` 또는 `routeGeojson` 존재) 기록을 최신순으로 골라 **최대 5건**만 처리한다(기기 지오코더 부하·OS rate limit 배려).
2. 건별로 순차 실행: `fetchLocationLabel()` → 성공 시 `updateRunLocationLabel()` → 성공 시 화면 상태의 해당 기록만 갱신.
3. 지오코딩이 `null`이면 그 건은 건너뛴다(DB는 그대로 null, 다음 포커스에서 재시도 후보).
4. 화면 이탈(`useFocusEffect` cleanup) 시 이후 건 처리를 중단한다. 좌표가 없는 기록은 영구 생략.

## 표시

- **기록 목록** (`app/(tabs)/history.tsx` 행): 기존 둘째 줄("5.2km · 32:10 · ☀️ 27°") 아래 셋째 줄에 muted 스타일 소형 텍스트로 라벨 표시. `null`이면 줄 자체를 생략.
- **러닝 상세** (`app/run/[id].tsx`): 날짜 표시 근처에 동일 라벨 표시. `null`이면 생략.

## 에러 처리

- 지오코딩 실패는 어디서든 `null`로 수렴하며 사용자에게 에러를 노출하지 않는다.
- 백필 update 실패는 무시한다(다음 포커스에서 재시도).

## 테스트

- `formatLocationLabel` 유닛 테스트(위 케이스 목록).
- 서비스·백필 흐름은 기존 날씨 기능과 동일하게 수동 확인(실기기).
