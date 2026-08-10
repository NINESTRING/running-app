# 홈 화면 내 위치 표시 + 복귀 버튼 설계

날짜: 2026-08-10
상태: 승인됨

## 목표

홈 화면 지도에 러닝 시작 전에도 내 위치(파란 점)가 보이고, 지도가 다른 곳으로
이동해 있어도 버튼 하나로 내 위치로 복귀할 수 있게 한다.

## 문제 원인

- `RouteMap`에 `showsUserLocation`은 켜져 있으나, 위치 권한 요청이 '시작' 버튼을
  눌러야만 실행된다. 러닝 전에는 권한이 없어 파란 점이 표시되지 않는다.
- 러닝 전에는 지도를 내 위치로 이동시키는 로직이 없어 하드코딩된 기본
  위치(서울시청)에 머문다.

## 확정된 요구사항

| 항목 | 결정 |
|---|---|
| 권한 요청 시점 | 홈 화면 진입 시 **포그라운드** 권한 요청. 백그라운드 권한은 지금처럼 '시작' 시에만 |
| 초기 카메라 | 권한 허용 시 현재 위치를 가져와 지도를 내 위치로 이동 |
| 복귀 버튼 | 지도 위 **우측 하단**(하단 카드 바로 위)에 원형 버튼. 누르면 현재 위치로 애니메이션 이동 |
| 권한 거부 시 | 기본 지역 유지. 복귀 버튼을 누르면 재요청하고, 거부 상태면 기존 "설정 열기" 안내 노출 |
| 러닝 중 동작 | 변경 없음 (기존처럼 최신 포인트 따라 이동) |
| 웹 | `RouteMap.web.tsx`는 placeholder이므로 복귀 버튼 숨김 |

## 아키텍처

### `src/components/RouteMap.tsx`

- `ref`로 `{ animateTo(coord: { latitude, longitude }) }`를 노출
  (`useImperativeHandle`, 내부에서 `MapView.animateToRegion` 호출, delta 0.01 유지).
- 기존 props·렌더링은 그대로 — `app/run/[id].tsx`의 사용처에 영향 없음.
- `RouteMap.web.tsx`에도 동일 시그니처의 no-op ref를 추가해 타입 일치.

### `app/(tabs)/index.tsx` (홈)

- 마운트 시: `Location.requestForegroundPermissionsAsync()` → 허용이면
  `Location.getCurrentPositionAsync()`로 현재 위치를 얻어 `mapRef.animateTo()`.
  파란 점은 권한이 생기는 즉시 `showsUserLocation`으로 자동 표시된다.
- 복귀 버튼: 우측 하단(카드 위)에 오버레이. 누르면 권한 확인(없으면 재요청) 후
  현재 위치로 `animateTo`. 거부 상태면 `permissionDenied`를 켜 기존 안내 재사용.
- 위치 조회 중 중복 탭은 무시(in-flight 가드).

### 에러 처리

- `getCurrentPositionAsync` 실패(위치 서비스 꺼짐 등) 시 조용히 무시하고 기본
  지역 유지 — 홈 진입을 막지 않는다. 버튼 탭 실패도 동일.

## 테스트

- `expo-location` 목을 사용해 홈 화면 로직(권한 허용/거부, animateTo 호출) 단위 테스트.
- 실기기/시뮬레이터에서 수동 확인: 첫 진입 권한 프롬프트 → 파란 점 + 카메라 이동,
  지도 이동 후 복귀 버튼 동작.

## 구현 참고

- AGENTS.md 지침에 따라 Expo v57 버전 문서(`expo-location`)를 구현 전에 확인한다.
