# 다크모드 설정 (로컬 저장) 설계

날짜: 2026-08-11

## 목적

- 설정 화면에서 화면 모드를 시스템/라이트/다크 3단으로 선택할 수 있게 한다. 기본값은 시스템(OS 설정 따라감).
- 선택은 기기 로컬(AsyncStorage)에 저장한다. DB 동기화는 하지 않는다 — 표시 설정은 기기별 특성이고, 로그인 전에도 동작해야 하며, 서버 왕복 없이 즉시 적용돼야 한다.
- 기존 거리 단위(km/mi) 설정도 함께 영구 저장한다 (현재는 인메모리라 앱 재시작 시 초기화됨).

화면별 테마 오버라이드, 커스텀 색상 팔레트, 여러 기기 간 설정 동기화는 범위 밖이다.

## 상태·저장 — `src/stores/settingsStore.ts`

- `theme: 'system' | 'light' | 'dark'` 필드와 `setTheme` 액션을 추가한다. 기본값 `'system'`.
- 스토어 전체에 zustand `persist` 미들웨어를 적용한다:
  - `name: 'settings'`, `storage: createJSONStorage(() => AsyncStorage)`.
  - 기존 `unit` 필드도 함께 저장된다.
- 새 의존성 없음 — `@react-native-async-storage/async-storage`와 `zustand`는 이미 설치되어 있다.

## 테마 적용 배선

- `tailwind.config.js`: `darkMode: 'media'` → `'class'` (사용자 수동 선택을 위해 필요).
- `src/global.css`: 다크 변수 블록을 `@media (prefers-color-scheme: dark)`에서 NativeWind class 모드 규칙에 맞는 다크 셀렉터 블록으로 옮긴다. 라이트 변수는 `:root` 그대로 둔다.
- `app/_layout.tsx`:
  - 스토어의 `theme`를 구독해 NativeWind의 `colorScheme.set(theme)`을 호출하는 effect를 추가한다. `'system'`이면 NativeWind가 OS 설정을 따라간다.
  - 기존 `useColorScheme()` → `NAV_THEME` 선택과 `StatusBar` 스타일 로직은 변경 없이 자동 연동된다.
- 시작 시 깜빡임(flash) 방지: persist 하이드레이션이 끝날 때까지 렌더를 잠깐 보류한다 (`useSettingsStore.persist`의 하이드레이션 상태 확인). 하이드레이션은 수 ms 수준이라 체감 지연은 없다.

## UI — `app/(tabs)/settings.tsx`

- "화면 모드" 섹션을 거리 단위 섹션 바로 아래에 추가한다.
- 거리 단위와 동일한 `ToggleGroup`(single) 패턴으로 시스템/라이트/다크 3개 버튼을 배치한다.
- UI 문구는 기존 관례대로 한국어.

## 테스트 — `src/stores/__tests__/settingsStore.test.ts`

- `setTheme`/`setUnit` 상태 변경 동작.
- AsyncStorage에 저장되고 재하이드레이션 시 복원되는지 (기존 `__mocks__/@react-native-async-storage/async-storage.js` jest mock 활용).
- 테스트명은 기존 관례대로 한국어.

## 구현 시 참고

- 코드를 쓰기 전에 NativeWind v4의 `colorScheme` API와 class 다크모드 문서, Expo v57 문서를 확인한다 (AGENTS.md 규칙).
