import { useFocusEffect, useRouter } from 'expo-router';
import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, SectionList, View } from 'react-native';
import Swipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { PersonalRecordsSection } from '@/components/PersonalRecordsSection';
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
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { formatDistance, formatDuration } from '@/lib/geo';
import { formatRunDay, groupRunsByMonth, startCoords, timeOfDay } from '@/lib/history';
import { personalRecords } from '@/lib/records';
import { weatherLabel } from '@/lib/weather';
import { fetchLocationLabel } from '@/services/geocoding';
import { deleteRun, listRuns, updateRunLocationLabel } from '@/services/runs';
import { supabase } from '@/services/supabase';
import { useSettingsStore } from '@/stores/settingsStore';
import type { RunRecord } from '@/types/run';

// 삭제 확인·실패 다이얼로그 상태
type DeleteDialog =
  | { type: 'confirm'; run: RunRecord }
  | { type: 'error'; message: string }
  | null;

export default function HistoryScreen() {
  const router = useRouter();
  const [runs, setRuns] = useState<RunRecord[] | null>(null);
  const unit = useSettingsStore((s) => s.unit);
  const [dialog, setDialog] = useState<DeleteDialog>(null);
  // 열린 스와이프 행 1개만 유지 — 새 행이 열리면 이전 행을 닫는다 (iOS 기본 UX).
  // 메서드 핸들 대신 id로 추적해 언마운트된 행의 핸들을 붙잡지 않는다.
  const openRowIdRef = useRef<string | null>(null);
  const rowRefs = useRef(new Map<string, SwipeableMethods>());
  // 삭제 확정된 id — 삭제 커밋 전에 읽힌 포커스 refetch가 행을 부활시키지 않도록 거른다
  const deletedIdsRef = useRef(new Set<string>());

  const closeOpenRow = useCallback(() => {
    const id = openRowIdRef.current;
    if (id) rowRefs.current.get(id)?.close();
    openRowIdRef.current = null;
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      listRuns().then((r) => {
        if (cancelled) return;
        const visible = r.filter((x) => !deletedIdsRef.current.has(x.id));
        setRuns(visible);
        void backfillLocationLabels(visible, () => cancelled, setRuns);
      });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  // 롤링 윈도우 계산이 목록 렌더보다 무거우므로 runs 변경 시에만 재계산
  const records = useMemo(() => (runs && runs.length > 0 ? personalRecords(runs) : null), [runs]);
  const sections = useMemo(() => (runs ? groupRunsByMonth(runs) : []), [runs]);

  // 복구 불가 데이터 — 낙관적 제거 없이 서버 삭제 성공 후에만 목록에서 뺀다.
  // AlertDialogAction이 onPress 전에 다이얼로그를 이미 닫으므로(중복 확정 방지 포함)
  // 여기서 setDialog(null)을 부를 필요가 없다.
  const onConfirmDelete = useCallback(async (run: RunRecord) => {
    const result = await deleteRun(run.id);
    if (result.ok) {
      deletedIdsRef.current.add(run.id);
      setRuns((prev) => (prev ? prev.filter((r) => r.id !== run.id) : prev));
    } else {
      // 삭제 진행 중 사용자가 다른 행의 확인 다이얼로그를 열었다면 덮어쓰지 않는다
      setDialog((prev) =>
        prev === null
          ? { type: 'error', message: result.error ?? '알 수 없는 오류' }
          : prev
      );
    }
  }, []);

  if (!supabase) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <Text className="text-center text-muted-foreground">
          Supabase가 설정되지 않았습니다.{'\n'}.env에 URL과 키를 넣어주세요.
        </Text>
      </View>
    );
  }

  if (runs === null) {
    return (
      <View className="flex-1 gap-3 bg-background p-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </View>
    );
  }

  if (runs.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <Text className="text-center text-muted-foreground">아직 러닝 기록이 없습니다.</Text>
      </View>
    );
  }

  return (
    <>
    <SectionList
      className="bg-background"
      sections={sections}
      keyExtractor={(r) => r.id}
      ItemSeparatorComponent={() => <Separator />}
      ListHeaderComponent={
        <View className="pb-2">
          {records ? (
            <PersonalRecordsSection
              records={records}
              unit={unit}
              onPressRun={(runId) => router.push(`/run/${runId}`)}
            />
          ) : null}
          <Text className="px-4 pt-6 text-xl font-bold">러닝 기록</Text>
        </View>
      }
      renderSectionHeader={({ section }) => (
        <Text className="bg-background px-4 pb-1 pt-3 text-sm font-semibold text-muted-foreground">
          {section.title}
        </Text>
      )}
      renderItem={({ item }) => (
        <Swipeable
          ref={(ref) => {
            if (ref) rowRefs.current.set(item.id, ref);
            else rowRefs.current.delete(item.id);
          }}
          friction={2}
          rightThreshold={40}
          overshootRight={false}
          onSwipeableWillOpen={() => {
            if (openRowIdRef.current !== item.id) closeOpenRow();
            openRowIdRef.current = item.id;
          }}
          onSwipeableClose={() => {
            // 사용자가 손으로 닫은 경우에도 추적을 정리한다
            if (openRowIdRef.current === item.id) openRowIdRef.current = null;
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
            // 스와이프 제스처는 스크린리더로 수행할 수 없으므로 접근성 액션으로 삭제 제공
            accessibilityActions={[{ name: 'delete', label: '삭제' }]}
            onAccessibilityAction={(e) => {
              if (e.nativeEvent.actionName === 'delete') {
                setDialog({ type: 'confirm', run: item });
              }
            }}
          >
            <Text className="text-base font-semibold">
              {formatRunDay(item.startedAt)} · {timeOfDay(item.startedAt)} 러닝
            </Text>
            <Text className="text-muted-foreground">
              {formatDistance(item.distanceM, unit)}{unit} ·{' '}
              {formatDuration(item.durationSec * 1000)}
              {item.weatherCode !== null &&
                item.temperatureC !== null &&
                ` · ${weatherLabel(item.weatherCode).emoji} ${Math.round(item.temperatureC)}°`}
            </Text>
            {item.locationLabel !== null && (
              <Text className="text-sm text-muted-foreground">{item.locationLabel}</Text>
            )}
          </Pressable>
        </Swipeable>
      )}
    />

    <AlertDialog
      open={dialog !== null}
      onOpenChange={(open) => {
        // Cancel·Action 버튼 모두 onPress 전에 onOpenChange(false)를 먼저 호출하므로
        // 여기가 유일한 닫힘 경로다 — 취소·확정·바깥 탭 전부 열린 행을 닫는다
        if (!open) {
          setDialog(null);
          closeOpenRow();
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
              {/* Cancel은 자체적으로 onOpenChange(false)를 호출 — 위 핸들러가 닫힘 처리 */}
              <AlertDialogCancel>
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
              <AlertDialogDescription>{dialog.message}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction>
                <Text>확인</Text>
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

// 기기 지오코더 부하를 고려한 포커스당 백필 상한
const BACKFILL_LIMIT_PER_FOCUS = 5;

// 라벨 없는 과거 기록을 화면이 떠 있는 동안 조용히 채운다 — 실패는 무시(다음 포커스에서 재시도)
async function backfillLocationLabels(
  runs: RunRecord[],
  isCancelled: () => boolean,
  setRuns: Dispatch<SetStateAction<RunRecord[] | null>>
) {
  const targets = runs
    .filter((r) => r.locationLabel === null && startCoords(r) !== null)
    .slice(0, BACKFILL_LIMIT_PER_FOCUS); // listRuns가 최신순이므로 최근 기록부터
  for (const run of targets) {
    if (isCancelled()) return;
    const coords = startCoords(run);
    if (!coords) continue;
    const label = await fetchLocationLabel(coords.latitude, coords.longitude);
    if (label === null) continue;
    if (!(await updateRunLocationLabel(run.id, label))) continue;
    if (isCancelled()) return;
    setRuns((prev) =>
      prev ? prev.map((x) => (x.id === run.id ? { ...x, locationLabel: label } : x)) : prev
    );
  }
}
