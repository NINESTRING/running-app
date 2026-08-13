# 기록 리스트 스와이프 삭제 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기록 탭 리스트에서 행을 왼쪽으로 스와이프해 삭제 버튼을 노출하고, 확인 다이얼로그를 거쳐 Supabase에서 해당 러닝 기록을 삭제한다.

**Architecture:** 데이터 계층은 `src/services/runs.ts`에 `deleteRun` 함수 하나 추가(기존 RLS 삭제 정책 사용, 마이그레이션 불필요). UI는 `react-native-gesture-handler/ReanimatedSwipeable`(이미 설치된 2.32 내장 컴포넌트)로 기존 `history.tsx`의 행을 감싸고, 기존 `ui/alert-dialog`로 확인 다이얼로그를 띄운다. 전제 조건으로 `GestureHandlerRootView`를 루트 레이아웃에 추가한다.

**Tech Stack:** Expo 57, react-native-gesture-handler 2.32 (ReanimatedSwipeable), react-native-reanimated 4.5, Supabase, jest-expo, NativeWind.

## Global Constraints

- 신규 npm 의존성 금지 — 설치된 패키지만 사용.
- 복구 불가 데이터: 확인 다이얼로그 없이 삭제되는 경로가 있으면 안 됨. 낙관적 제거 금지 — 서버 성공 후에만 목록에서 제거.
- 테스트 실행: `npm test` (TZ=Asia/Seoul jest). 타입 체크: `npx tsc --noEmit`. 린트: `npm run lint`.
- 커밋 메시지는 기존 컨벤션(한국어, `feat(history): …` / `test(runs): …` 형식) 유지.

---

### Task 1: `deleteRun` 서비스 함수 (TDD)

**Files:**
- Modify: `src/services/runs.ts` (파일 끝에 함수 추가)
- Test: `src/services/__tests__/runs.delete.test.ts` (신규)

**Interfaces:**
- Consumes: `supabase` (from `src/services/supabase.ts`, `SupabaseClient | null`)
- Produces: `deleteRun(id: string): Promise<boolean>` — Task 3의 history 화면이 import.

주의: 기존 `src/services/__tests__/runs.test.ts`는 순수 함수만 테스트하며 supabase를 mock하지 않는다. supabase mock이 필요한 `deleteRun`은 **별도 파일**로 만들어 기존 테스트에 영향을 주지 않는다. mock은 getter를 사용해 케이스별로 client를 교체한다 (jest mock factory는 `mock` 접두사 변수만 참조 가능).

- [ ] **Step 1: 실패하는 테스트 작성**

`src/services/__tests__/runs.delete.test.ts` 생성:

```ts
import { deleteRun } from '../runs';

// 케이스별로 supabase client를 교체하기 위한 가변 홀더 (getter로 매 접근마다 재평가)
const mockHolder: { client: unknown } = { client: null };

jest.mock('../supabase', () => ({
  get supabase() {
    return mockHolder.client;
  },
}));

function clientWithDeleteResult(result: { error: { message: string } | null }) {
  const eq = jest.fn().mockResolvedValue(result);
  const del = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue({ delete: del });
  return { client: { from }, from, del, eq };
}

describe('deleteRun', () => {
  afterEach(() => {
    mockHolder.client = null;
  });

  it('runs 테이블에서 id로 삭제하고 true를 반환한다', async () => {
    const { client, from, del, eq } = clientWithDeleteResult({ error: null });
    mockHolder.client = client;

    await expect(deleteRun('run-1')).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith('runs');
    expect(del).toHaveBeenCalledTimes(1);
    expect(eq).toHaveBeenCalledWith('id', 'run-1');
  });

  it('에러 응답이면 false', async () => {
    const { client } = clientWithDeleteResult({ error: { message: 'boom' } });
    mockHolder.client = client;

    await expect(deleteRun('run-1')).resolves.toBe(false);
  });

  it('예외가 던져지면 false', async () => {
    mockHolder.client = {
      from: () => ({
        delete: () => ({ eq: () => Promise.reject(new Error('network')) }),
      }),
    };

    await expect(deleteRun('run-1')).resolves.toBe(false);
  });

  it('supabase 미설정이면 false', async () => {
    mockHolder.client = null;

    await expect(deleteRun('run-1')).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test -- src/services/__tests__/runs.delete.test.ts`
Expected: FAIL — `deleteRun` is not exported (TS/undefined 에러).

- [ ] **Step 3: 최소 구현**

`src/services/runs.ts` 파일 끝(`updateRunLocationLabel` 뒤)에 추가:

```ts
/** 기록 삭제. 실패(에러·예외·supabase 미설정) 시 false. RLS로 본인 기록만 삭제됨. */
export async function deleteRun(id: string): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase.from('runs').delete().eq('id', id);
    return !error;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- src/services/__tests__/runs.delete.test.ts`
Expected: PASS (4 tests).

기존 테스트 회귀 확인: `npm test`
Expected: 전체 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/services/runs.ts src/services/__tests__/runs.delete.test.ts
git commit -m "feat(runs): deleteRun 서비스 함수"
```

---

### Task 2: 루트 레이아웃에 GestureHandlerRootView 추가

**Files:**
- Modify: `app/_layout.tsx`

**Interfaces:**
- Consumes: 없음
- Produces: 앱 전체가 `GestureHandlerRootView`로 감싸짐 — Task 3의 스와이프 제스처 전제 조건.

- [ ] **Step 1: import 추가 및 트리 감싸기**

`app/_layout.tsx` import에 추가:

```ts
import { GestureHandlerRootView } from 'react-native-gesture-handler';
```

return 문의 최상단 `<ThemeProvider …>`를 감싼다 (`flex: 1` 필수 — 없으면 화면이 0 높이로 렌더됨):

```tsx
return (
  <GestureHandlerRootView style={{ flex: 1 }}>
    <ThemeProvider value={NAV_THEME[scheme]}>
      {/* 기존 내용 그대로 */}
    </ThemeProvider>
  </GestureHandlerRootView>
);
```

기존 자식(StatusBar, Stack, PortalHost 등)은 변경하지 않는다.

- [ ] **Step 2: 타입·린트 확인**

Run: `npx tsc --noEmit && npm run lint`
Expected: 에러 없음 (기존 경고 제외).

- [ ] **Step 3: 커밋**

```bash
git add app/_layout.tsx
git commit -m "feat(app): GestureHandlerRootView 루트 래핑 — 스와이프 제스처 전제"
```

---

### Task 3: history 행 스와이프 삭제 UI + 확인 다이얼로그

**Files:**
- Modify: `app/(tabs)/history.tsx`

**Interfaces:**
- Consumes: `deleteRun(id: string): Promise<boolean>` (Task 1), `GestureHandlerRootView` 래핑 (Task 2), `ui/alert-dialog` 컴포넌트들, `SwipeableMethods` 타입 (`react-native-gesture-handler/ReanimatedSwipeable`).
- Produces: 없음 (말단 UI).

- [ ] **Step 1: import·상태 추가**

`app/(tabs)/history.tsx` import에 추가:

```ts
import { useRef } from 'react'; // 기존 useCallback 줄에 합침
import Swipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { deleteRun, listRuns, updateRunLocationLabel } from '@/services/runs';
```

`HistoryScreen` 컴포넌트 안에 상태 추가 (`unit` 선언 아래):

```ts
type DeleteDialog = { type: 'confirm'; run: RunRecord } | { type: 'error' } | null;

const [dialog, setDialog] = useState<DeleteDialog>(null);
// 열린 스와이프 행 1개만 유지 — 새 행이 열리면 이전 행을 닫는다 (iOS 기본 UX)
const openRowRef = useRef<SwipeableMethods | null>(null);
```

(`DeleteDialog` 타입은 컴포넌트 밖 파일 하단에 선언해도 된다.)

- [ ] **Step 2: 삭제 핸들러 추가**

컴포넌트 안, `sections` useMemo 아래에:

```ts
const onConfirmDelete = useCallback(async (run: RunRecord) => {
  setDialog(null); // 즉시 닫아 중복 확정 방지
  const ok = await deleteRun(run.id);
  if (ok) {
    openRowRef.current = null;
    setRuns((prev) => (prev ? prev.filter((r) => r.id !== run.id) : prev));
  } else {
    setDialog({ type: 'error' });
  }
}, []);
```

- [ ] **Step 3: renderItem을 Swipeable로 감싸기**

기존 `renderItem`을 다음으로 교체 (Pressable 내부 내용은 기존 그대로 유지, `bg-background`만 추가 — 스와이프 시 뒤의 빨간 액션이 비치지 않도록):

```tsx
renderItem={({ item }) => (
  <Swipeable
    ref={(ref) => {
      rowRefs.current.set(item.id, ref);
    }}
    friction={2}
    rightThreshold={40}
    overshootRight={false}
    onSwipeableWillOpen={() => {
      const ref = rowRefs.current.get(item.id) ?? null;
      if (openRowRef.current && openRowRef.current !== ref) {
        openRowRef.current.close();
      }
      openRowRef.current = ref;
    }}
    renderRightActions={() => (
      <Pressable
        className="w-20 items-center justify-center bg-destructive active:opacity-80"
        onPress={() => setDialog({ type: 'confirm', run: item })}
      >
        <Text className="font-semibold text-white">삭제</Text>
      </Pressable>
    )}
  >
    <Pressable
      className="gap-1 bg-background p-4 active:bg-accent"
      onPress={() => router.push(`/run/${item.id}`)}
    >
      {/* 기존 Text 3개 그대로 */}
    </Pressable>
  </Swipeable>
)}
```

행별 ref 보관용 map을 상태 선언부에 추가:

```ts
const rowRefs = useRef(new Map<string, SwipeableMethods | null>());
```

- [ ] **Step 4: 확인·실패 다이얼로그 추가**

`SectionList`를 fragment로 감싸고 다이얼로그를 뒤에 추가:

```tsx
return (
  <>
    <SectionList … />
    <AlertDialog
      open={dialog !== null}
      onOpenChange={(open) => {
        if (!open) {
          setDialog(null);
          openRowRef.current?.close(); // 취소·dismiss 시 열린 행 닫기
        }
      }}
    >
      <AlertDialogContent>
        {dialog?.type === 'confirm' && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>이 기록을 삭제할까요?</AlertDialogTitle>
              <AlertDialogDescription>
                {formatRunDay(dialog.run.startedAt)} ·{' '}
                {formatDistance(dialog.run.distanceM, unit)}
                {unit} 러닝 기록이 삭제되며 복구할 수 없습니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                onPress={() => {
                  setDialog(null);
                  openRowRef.current?.close();
                }}
              >
                <Text>취소</Text>
              </AlertDialogCancel>
              <AlertDialogAction onPress={() => void onConfirmDelete(dialog.run)}>
                <Text>삭제</Text>
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
        {dialog?.type === 'error' && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>삭제하지 못했습니다</AlertDialogTitle>
              <AlertDialogDescription>
                네트워크 상태를 확인하고 다시 시도해주세요.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction onPress={() => setDialog(null)}>
                <Text>확인</Text>
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  </>
);
```

주의: `AlertDialogAction`의 기본 스타일이 primary 버튼이므로 삭제 버튼을 destructive로 강조하고 싶으면 기존 `index.tsx`의 저장 실패 다이얼로그 패턴을 확인해 동일하게 맞춘다 — 다르게 만들지 말 것.

- [ ] **Step 5: 타입·린트·전체 테스트 확인**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: 전부 통과.

- [ ] **Step 6: 커밋**

```bash
git add "app/(tabs)/history.tsx"
git commit -m "feat(history): 기록 스와이프 삭제 — 확인 다이얼로그 후 서버 삭제"
```

---

### Task 4: 실기기 수동 확인 (사용자와 함께)

**Files:** 없음 (검증만)

- [ ] **Step 1: 시뮬레이터/실기기에서 확인**

`npm run ios` 후 기록 탭에서:

1. 행 왼쪽 스와이프 → 빨간 "삭제" 버튼 노출
2. 다른 행 스와이프 → 이전 행 자동 닫힘
3. 삭제 탭 → 확인 다이얼로그 → 취소 시 아무 변화 없음(행 닫힘)
4. 삭제 확정 → 행 제거, 개인 기록·월 섹션 재계산
5. 행 일반 탭 → 상세 화면 이동이 여전히 동작
6. 비행기 모드에서 삭제 확정 → "삭제하지 못했습니다" 다이얼로그, 목록 유지

Expected: 전부 정상. 실패 시 해당 Task로 돌아가 수정.
