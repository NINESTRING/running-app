# 러닝 종료 확인 다이얼로그 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 종료 버튼 탭 시 즉시 저장 대신 저장/버리기/취소 확인 다이얼로그를 띄운다.

**Architecture:** `app/(tabs)/index.tsx` 한 파일만 수정. 종료 버튼은 자동 일시정지 + 다이얼로그 오픈으로 바꾸고, 기존 저장 로직은 다이얼로그의 저장 버튼으로 옮긴다. 스토어(`runStore`)는 기존 액션(`pause`/`beginSave`/`reset`)을 그대로 재사용하며 변경 없음.

**Tech Stack:** Expo(React Native), zustand, 기존 `@/components/ui/alert-dialog` 컴포넌트.

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-08-13-stop-confirm-dialog-design.md`
- UI 문구는 한국어: 다이얼로그 제목 "러닝을 종료할까요?", 설명 "기록을 저장하거나 버릴 수 있습니다.", 버튼 "취소" / "버리기" / "저장".
- 스토어·서비스 레이어 변경 금지. 새 파일 생성 없음.
- 검증: `npm test`(기존 테스트 회귀 없음), `npx tsc --noEmit`.

---

### Task 1: 종료 확인 다이얼로그 추가

**Files:**
- Modify: `app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: `useRunStore` 기존 액션 — `pause(now: number)`, `beginSave(now: number): boolean`, `reset()`; `stopTracking(): Promise<void>`(throw 가능), `stopStepCounting(): void`.
- Produces: 없음 (말단 UI 변경).

- [ ] **Step 1: DialogState에 confirmStop 추가**

`app/(tabs)/index.tsx:52-56`의 유니언에 한 줄 추가:

```tsx
type DialogState =
  | { type: 'startError'; message: string }
  | { type: 'confirmStop' }
  | { type: 'saved' }
  | { type: 'saveError'; message: string }
  | null;
```

- [ ] **Step 2: 종료 버튼 핸들러 교체 + 버리기 핸들러 추가**

기존 `onStop`(줄 185)은 이름과 본문을 그대로 두고, 그 앞에 두 핸들러를 추가한다:

```tsx
// 종료 탭: 즉시 저장하지 않고 일시정지 후 확인 다이얼로그를 띄운다.
const onStopPressed = () => {
  useRunStore.getState().pause(Date.now()); // paused면 no-op
  setDialog({ type: 'confirmStop' });
};

const onDiscard = async () => {
  setDialog(null);
  try {
    await stopTracking();
  } catch {
    // 추적 중지 실패해도 기록 폐기는 계속 진행
  }
  stopStepCounting();
  useRunStore.getState().reset();
};
```

`status === 'running'`(줄 306)과 `status === 'paused'`(줄 316)의 두 종료 버튼 모두 `onPress={onStop}` → `onPress={onStopPressed}`로 변경. `onStop` 자체는 수정하지 않는다(다이얼로그 저장 버튼에서 호출).

- [ ] **Step 3: 다이얼로그 UI 렌더링 추가**

기존 `AlertDialogContent` 내부(줄 340 `dialog?.type === 'saved'` 블록 앞)에 추가:

```tsx
{dialog?.type === 'confirmStop' && (
  <>
    <AlertDialogHeader>
      <AlertDialogTitle>러닝을 종료할까요?</AlertDialogTitle>
      <AlertDialogDescription>기록을 저장하거나 버릴 수 있습니다.</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel onPress={() => setDialog(null)}>
        <Text>취소</Text>
      </AlertDialogCancel>
      <AlertDialogAction onPress={onDiscard}>
        <Text>버리기</Text>
      </AlertDialogAction>
      <AlertDialogAction
        onPress={() => {
          setDialog(null);
          void onStop();
        }}
      >
        <Text>저장</Text>
      </AlertDialogAction>
    </AlertDialogFooter>
  </>
)}
```

`AlertDialogAction`은 `variant` prop이 없다(ui/alert-dialog.tsx가 기본 buttonVariants 고정) — 기존 saveError 다이얼로그의 버리기 버튼과 동일하게 기본 스타일을 쓴다. 바깥 탭 dismiss는 기존 `onOpenChange`가 `setDialog(null)`을 호출하므로 취소와 동일하게 동작한다 — 별도 처리 불필요.

- [ ] **Step 4: 타입·테스트 검증**

Run: `npx tsc --noEmit && npm test`
Expected: 타입 에러 0, 기존 테스트 전체 PASS (이 변경은 UI 전용이라 새 테스트 없음 — 스펙 '테스트' 절 참조)

- [ ] **Step 5: Commit**

```bash
git add "app/(tabs)/index.tsx"
git commit -m "feat(run): 종료 시 저장/버리기/취소 확인 다이얼로그"
```
