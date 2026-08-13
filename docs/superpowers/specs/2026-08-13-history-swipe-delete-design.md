# 기록 리스트 스와이프 삭제 설계

2026-08-13

## 목표

기록 탭의 러닝 기록 리스트에서 행을 왼쪽으로 스와이프하면 삭제 버튼이 나타나고,
확인 다이얼로그를 거쳐 해당 기록을 서버에서 삭제한다. 복구 불가능한 데이터이므로
확인 없이 지워지는 경로는 없어야 한다.

## 요구사항

- 기록 행을 왼쪽으로 스와이프 → 오른쪽에 빨간 배경 "삭제" 버튼 노출.
- 다른 행을 스와이프하면 이전에 열린 행은 자동으로 닫힌다 (iOS 기본 UX).
- 삭제 버튼 탭 → "이 기록을 삭제할까요? 복구할 수 없습니다" 확인 다이얼로그.
- 다이얼로그 **삭제** 확정 시에만 서버 삭제 실행. **취소**/dismiss는 아무 것도
  하지 않음 (열린 행은 닫는다).
- 삭제 성공: 목록에서 즉시 제거. 개인 기록·월 섹션은 기존 `useMemo`가 자동
  재계산.
- 삭제 실패: 목록 유지 + 실패 알림. 낙관적 제거는 하지 않는다 — 서버 성공 확인
  후에만 목록에 반영.

## 구현

### 데이터 계층 — `src/services/runs.ts`

- `deleteRun(id: string): Promise<boolean>` 추가.
  `supabase.from('runs').delete().eq('id', id)` — 실패(에러·예외·supabase 미설정)
  시 `false`. RLS 삭제 정책("본인 기록 삭제")이 이미 있어 마이그레이션 불필요.

### 루트 설정 — `app/_layout.tsx`

- `GestureHandlerRootView`(flex: 1)로 트리 최상단을 감싼다. 현재 앱 어디에도
  없으며, 스와이프 제스처 동작의 전제 조건.

### 스와이프 UI — `app/(tabs)/history.tsx`

- `renderItem`의 Pressable을 `react-native-gesture-handler/ReanimatedSwipeable`로
  감싸고 `renderRightActions`로 삭제 버튼을 렌더링. 기존 설치본
  (gesture-handler 2.32 + reanimated 4.5)만 사용, 신규 의존성 없음.
- 열린 행 ref 1개를 추적해 새 행이 열릴 때(`onSwipeableWillOpen`) 이전 행을
  닫는다.
- 삭제 버튼 탭 → 대상 run을 state에 담아 확인 다이얼로그 표시(기존
  `ui/alert-dialog` 재사용, 종료 확인 다이얼로그와 같은 패턴).
- 다이얼로그 삭제 확정: `deleteRun(id)` 완료 대기 → 성공 시
  `setRuns(prev => prev.filter(...))`, 실패 시 실패 다이얼로그(또는 Alert) 표시.

## 엣지 케이스

- 삭제 진행 중 중복 확정 탭: 확정 즉시 다이얼로그를 닫고 진행 중 상태를 유지해
  재진입을 막는다.
- 백필(`backfillLocationLabels`)이 삭제된 행을 갱신하려는 경우:
  `setRuns`의 `map`은 id 불일치 시 no-op이므로 삭제된 행이 부활하지 않는다.
- 스와이프와 행 탭(상세 이동) 충돌: ReanimatedSwipeable이 제스처를 구분하므로
  가로 스와이프 중에는 onPress가 발화하지 않는다.

## 테스트

- `deleteRun` 서비스 테스트: 성공 / 에러 응답 / 예외 / supabase 미설정 → false.
- 스와이프 제스처·다이얼로그 흐름은 실기기에서 수동 확인 (기존 UI 핸들러 계층과
  동일하게 자동 테스트 없음).
