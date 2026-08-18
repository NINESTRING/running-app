import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { METERS_PER_MILE } from '@/lib/geo';
import { voiceCueText } from '@/lib/voice';
import { configureVoiceAudio, speakCue } from '@/services/speech';
import {
  useSettingsStore,
  type VoiceDistanceUnits,
  type VoiceTimeMin,
} from '@/stores/settingsStore';

// ToggleGroup은 string 값만 다루므로 '끔'을 나타내는 센티넬이 필요하다.
const OFF = 'off';

const DISTANCE_OPTIONS: VoiceDistanceUnits[] = [0.5, 1, 2];
const TIME_OPTIONS: VoiceTimeMin[] = [1, 2, 5];

// 미리듣기 예시값 — 30분·5단위거리·6'00" 페이스·120m 앞섬
const PREVIEW_ELAPSED_MS = 30 * 60_000;
const PREVIEW_DISTANCE_UNITS = 5;
const PREVIEW_PACE_SEC = 360;
const PREVIEW_GOAL_DELTA_M = 120;

export function VoiceGuideSection() {
  const unit = useSettingsStore((s) => s.unit);
  const distanceUnits = useSettingsStore((s) => s.voiceDistanceUnits);
  const timeMin = useSettingsStore((s) => s.voiceTimeMin);
  const setDistanceUnits = useSettingsStore((s) => s.setVoiceDistanceUnits);
  const setTimeMin = useSettingsStore((s) => s.setVoiceTimeMin);

  // 실제 안내와 같은 함수로 문장을 만든다 — 미리듣기가 실제와 어긋날 수 없고,
  // 단위 설정도 자동으로 반영된다.
  const onPreview = async () => {
    await configureVoiceAudio();
    speakCue(
      voiceCueText({
        elapsedMs: PREVIEW_ELAPSED_MS,
        distanceM: PREVIEW_DISTANCE_UNITS * (unit === 'mi' ? METERS_PER_MILE : 1000),
        unit,
        paceSecPerUnit: PREVIEW_PACE_SEC,
        goalDeltaM: PREVIEW_GOAL_DELTA_M,
      }),
    );
  };

  return (
    <View className="gap-3">
      <Text className="text-base font-semibold">음성 안내</Text>

      <View className="gap-2">
        <Text className="text-sm text-muted-foreground">{`거리마다 (${unit})`}</Text>
        <ToggleGroup
          type="single"
          value={distanceUnits === null ? OFF : String(distanceUnits)}
          onValueChange={(v) => {
            if (!v) return; // 이미 선택된 항목을 다시 누른 경우 — 해제하지 않는다
            setDistanceUnits(v === OFF ? null : (Number(v) as VoiceDistanceUnits));
          }}
          className="justify-start"
        >
          <ToggleGroupItem value={OFF} isFirst>
            <Text>끔</Text>
          </ToggleGroupItem>
          {DISTANCE_OPTIONS.map((v, i) => (
            <ToggleGroupItem
              key={v}
              value={String(v)}
              isLast={i === DISTANCE_OPTIONS.length - 1}
            >
              <Text>{String(v)}</Text>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </View>

      <View className="gap-2">
        <Text className="text-sm text-muted-foreground">시간마다 (분)</Text>
        <ToggleGroup
          type="single"
          value={timeMin === null ? OFF : String(timeMin)}
          onValueChange={(v) => {
            if (!v) return;
            setTimeMin(v === OFF ? null : (Number(v) as VoiceTimeMin));
          }}
          className="justify-start"
        >
          <ToggleGroupItem value={OFF} isFirst>
            <Text>끔</Text>
          </ToggleGroupItem>
          {TIME_OPTIONS.map((v, i) => (
            <ToggleGroupItem
              key={v}
              value={String(v)}
              isLast={i === TIME_OPTIONS.length - 1}
            >
              <Text>{String(v)}</Text>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </View>

      <View className="items-start">
        <Button
          size="sm"
          variant="outline"
          accessibilityLabel="음성 안내 미리듣기"
          onPress={() => {
            void onPreview();
          }}
        >
          <Text>미리듣기</Text>
        </Button>
      </View>
    </View>
  );
}
