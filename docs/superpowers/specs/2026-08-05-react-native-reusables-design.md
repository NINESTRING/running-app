# React Native Reusables 도입 설계

날짜: 2026-08-05
상태: 승인됨

## 목표

앱 전체 UI를 React Native Reusables(RNR) + NativeWind 기반으로 전환한다. 화면 레이아웃 구조는 유지하되, 색·타이포그래피·컴포넌트 외형은 RNR 기본 테마(shadcn/ui 스타일)로 통일하고 시스템 설정을 따르는 라이트/다크 모드를 지원한다.

## 배경

- Expo SDK 57, React Native 0.86, expo-router 기반. 화면 5개(홈, 기록, 통계, 설정, 러닝 상세) 총 632줄로 규모가 작다.
- 현재 스타일링은 전부 `StyleSheet` + react-native 프리미티브. NativeWind/Tailwind는 미설치.
- `src/global.css`가 존재하나 폰트 CSS 변수만 담고 있다 (병합 대상).
- 지도(react-native-maps / .web 대체)와 차트(Skia, victory-native)는 RNR 범위 밖이므로 그대로 유지한다.

## 결정 사항

| 항목 | 결정 |
| --- | --- |
| 적용 범위 | 셋업 + 전체 5개 화면 마이그레이션 |
| 디자인 | RNR 기본 테마로 리디자인 (기존 디자인 재현 아님) |
| 다크 모드 | 시스템 설정 따라가기 |
| 도입 방식 | RNR 공식 CLI (컴포넌트 소스를 `src/components/ui/`에 복사, 프로젝트가 소유) |

수동 셋업 대안은 CLI가 해주는 테마 변수·`cn` 유틸 배선을 전부 수작업해야 해서 기각했다.

## 설계

### 1. 기반 셋업

- `nativewind`, `tailwindcss` 및 RNR CLI가 요구하는 peer 의존성 설치. 버전은 구현 시점에 Expo SDK 57 문서(AGENTS.md 지침)와 RNR 최신 문서를 확인해 결정한다.
- `tailwind.config.js`, `babel.config.js`, `metro.config.js` 생성.
- 기존 `src/global.css`에 Tailwind 지시문 + RNR 테마 CSS 변수를 병합한다 (기존 폰트 변수 유지).
- 루트 `app/_layout.tsx`에 테마 프로바이더를 연결하고 `useColorScheme`으로 시스템 라이트/다크를 따른다. 웹(react-native-web)에서도 동일 동작.

### 2. 도입 컴포넌트

CLI로 `src/components/ui/`에 추가:

- `text` — 모든 텍스트의 기본
- `button` — 시작/일시정지/저장 등 액션
- `card` — 기록 리스트 항목, 통계/상세 요약 블록
- `separator` — 목록·섹션 구분
- `toggle-group` — 설정 화면 km/mi 전환
- `skeleton` — 목록/통계 로딩 상태
- `alert-dialog` — 저장 실패 시 선택지 (`Alert.alert` 대체)

지도·차트 컴포넌트는 내부 구현을 유지하고, 이를 감싸는 레이아웃만 Tailwind 클래스로 전환한다.

### 3. 화면 마이그레이션

5개 화면의 `StyleSheet`를 제거하고 RNR 컴포넌트 + Tailwind 클래스로 교체한다.

- 레이아웃 구조(배치, 정보 위계)는 유지
- 색·간격·버튼/카드 외형은 RNR 기본 테마 토큰 사용
- 탭 바 등 내비게이션 색상도 테마 변수와 일치시킴
- 다크 모드에서 모든 화면이 테마 토큰으로 자연스럽게 전환되어야 함

### 4. 오류 처리

- 위치 권한 거부, 저장 실패 등 기존 오류 플로우는 동작을 그대로 유지하되 표현만 RNR 컴포넌트(`alert-dialog` 등)로 교체한다.

### 5. 검증

- 기존 Jest 테스트 전부 통과 (필요시 `transformIgnorePatterns`에 nativewind 추가)
- iOS와 웹에서 5개 화면 렌더 확인
- 시스템 다크 모드 전환 시 화면 확인

## 범위 밖

- 지도/차트 내부 구현 변경
- 새 기능 추가, 화면 구조 개편
- 기존 디자인의 픽셀 단위 재현
