# 앱 시작 시 첫 지도 화면을 내 위치로 설계

날짜: 2026-08-11
상태: 승인됨

## 목표

홈 화면의 지도가 처음부터 내 위치로 그려지게 한다. 현재는 기본 지역(서울시청)으로
먼저 렌더된 뒤 `getCurrentPositionAsync` 완료 후에야 내 위치로 날아간다.

## 확정된 요구사항

| 항목 | 결정 |
|---|---|
| 방식 | 지도 렌더 전 위치 확정 — 권한이 이미 있으면 캐시 위치(`getLastKnownPositionAsync`, 즉시 반환)를 읽어 `initialRegion`으로 사용 |
| 권한 프롬프트 | `getInitialCoords`는 `getForegroundPermissionsAsync`(상태 확인만)를 사용 — 프롬프트를 띄우지 않는다. 권한 요청은 기존 마운트 로직(`getMyLocation`)이 담당 |
| 폴백 | 권한 없음·캐시 없음·조회 실패 → `null` 반환 → 기본 지역(시청)으로 지금처럼 렌더 |
| 미세 보정 | 기존 마운트 로직(`getCurrentPositionAsync` → `animateTo`) 유지 — 캐시가 오래된 경우 현재 위치로 보정, 최초 설치 시 권한 허용 직후 이동도 담당 |
| 대기 화면 | 좌표 확정 전에는 지도 미렌더(빈 배경). 캐시 조회라 일반적으로 0.1초 미만 |
| 웹 | placeholder이므로 좌표 확정 없이 즉시 렌더 (기존 마운트 조회 생략 유지) |

## 아키텍처

### `src/services/location.ts`

```ts
export async function getInitialCoords(): Promise<{ latitude: number; longitude: number } | null>;
```

- `getForegroundPermissionsAsync()` → granted가 아니면 `null`
- `getLastKnownPositionAsync()` → 결과가 null이면 `null`, 있으면 좌표 반환
- 전체를 try/catch로 감싸 어떤 실패도 `null` (절대 throw하지 않음)
- 단위 테스트 4개: 권한+캐시 있음 → 좌표 / 권한 없음 → null / 캐시 null → null / 예외 → null

### `src/components/RouteMap.tsx`

- 옵셔널 prop `initialCoords?: { latitude: number; longitude: number }` 추가.
  있으면 `initialRegion`을 `{ ...initialCoords, delta 0.01 }`로, 없으면 기존 `DEFAULT_REGION`.
- 기존 `region`/`Polyline`/`ref` 로직 변경 없음. `app/run/[id].tsx` 사용처 영향 없음.
- `RouteMap.web.tsx`는 Props 시그니처만 일치(무시).

### `app/(tabs)/index.tsx`

- 상태 `initialCoords: { latitude, longitude } | null | undefined` (undefined = 확정 전).
- 마운트 효과(네이티브만): `setInitialCoords(await getInitialCoords())` 후 기존
  `goToMyLocation(false)` 호출 (순서 보장 — 확정 전 animateTo가 낭비되지 않도록).
- 렌더: 웹이거나 `initialCoords !== undefined`일 때만 `RouteMap` 렌더,
  `initialCoords={initialCoords ?? undefined}` 전달.

## 테스트

- `getInitialCoords` 단위 테스트(위 4개) — 기존 `location.test.ts`에 추가.
- 수동 확인: 권한 허용 상태에서 앱 재시작 → 시청 화면 없이 바로 내 위치.

## 구현 참고

- Expo v57 `getLastKnownPositionAsync(options?): Promise<LocationObject | null>` —
  캐시된 마지막 위치를 즉시 반환, 없으면 null. AGENTS.md 지침에 따라 v57 문서 확인 완료.
