import { useEffect, useState } from 'react';
import { View } from 'react-native';
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
import { Text } from '@/components/ui/text';
import { formatPace } from '@/lib/geo';
import {
  clampDistanceUnits,
  clampPaceSec,
  DEFAULT_DISTANCE_UNITS,
  DEFAULT_PACE_SEC,
  DISTANCE_STEP_UNITS,
  PACE_STEP_SEC,
} from '@/lib/goal';
import { useGoalStore } from '@/stores/goalStore';
import { useSettingsStore } from '@/stores/settingsStore';

export function GoalDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const unit = useSettingsStore((s) => s.unit);
  // 드래프트 — 확인을 눌러야 스토어에 반영된다
  const [pace, setPace] = useState<number | null>(null);
  const [distance, setDistance] = useState<number | null>(null);

  // 열 때마다 저장된 목표로 드래프트 초기화
  useEffect(() => {
    if (!open) return;
    const g = useGoalStore.getState();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPace(g.paceSecPerUnit);
    setDistance(g.distanceUnits);
  }, [open]);

  const onConfirm = () => {
    const g = useGoalStore.getState();
    g.setPace(pace);
    g.setDistance(distance);
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>목표 설정</AlertDialogTitle>
          <AlertDialogDescription>목표는 이 기기에만 저장됩니다.</AlertDialogDescription>
        </AlertDialogHeader>
        <View className="gap-4 py-2">
          <GoalRow
            label={`페이스(/${unit})`}
            valueText={pace !== null ? formatPace(pace) : null}
            onToggle={() => setPace(pace !== null ? null : DEFAULT_PACE_SEC)}
            onStep={(dir) =>
              setPace((v) => clampPaceSec((v ?? DEFAULT_PACE_SEC) + dir * PACE_STEP_SEC))
            }
          />
          <GoalRow
            label={`거리(${unit})`}
            valueText={distance !== null ? distance.toFixed(2) : null}
            onToggle={() => setDistance(distance !== null ? null : DEFAULT_DISTANCE_UNITS)}
            onStep={(dir) =>
              setDistance((v) =>
                clampDistanceUnits((v ?? DEFAULT_DISTANCE_UNITS) + dir * DISTANCE_STEP_UNITS),
              )
            }
          />
        </View>
        <AlertDialogFooter>
          <AlertDialogCancel onPress={() => onOpenChange(false)}>
            <Text>취소</Text>
          </AlertDialogCancel>
          <AlertDialogAction onPress={onConfirm}>
            <Text>확인</Text>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function GoalRow({
  label,
  valueText,
  onToggle,
  onStep,
}: {
  label: string;
  valueText: string | null; // null = 사용 안 함
  onToggle: () => void;
  onStep: (dir: 1 | -1) => void;
}) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="flex-1 text-sm text-muted-foreground" numberOfLines={1}>
        {label}
      </Text>
      {valueText === null ? (
        <Button size="sm" variant="outline" onPress={onToggle}>
          <Text>설정</Text>
        </Button>
      ) : (
        <View className="flex-row items-center gap-2">
          <Button
            size="icon"
            variant="outline"
            onPress={() => onStep(-1)}
            accessibilityLabel={`${label} 감소`}
          >
            <Text>−</Text>
          </Button>
          <Text className="w-14 text-center text-base font-semibold">{valueText}</Text>
          <Button
            size="icon"
            variant="outline"
            onPress={() => onStep(1)}
            accessibilityLabel={`${label} 증가`}
          >
            <Text>+</Text>
          </Button>
          <Button size="sm" variant="ghost" onPress={onToggle}>
            <Text className="text-muted-foreground">해제</Text>
          </Button>
        </View>
      )}
    </View>
  );
}
