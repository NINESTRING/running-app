import { View } from 'react-native';
import { Text } from '@/components/ui/text';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useSettingsStore } from '@/stores/settingsStore';

export default function SettingsScreen() {
  const unit = useSettingsStore((s) => s.unit);
  const setUnit = useSettingsStore((s) => s.setUnit);

  return (
    <View className="flex-1 gap-3 bg-background p-4">
      <Text className="text-base font-semibold">거리 단위</Text>
      <ToggleGroup
        type="single"
        value={unit}
        onValueChange={(v) => {
          if (v === 'km' || v === 'mi') setUnit(v);
        }}
        className="justify-start"
      >
        <ToggleGroupItem value="km">
          <Text>km</Text>
        </ToggleGroupItem>
        <ToggleGroupItem value="mi">
          <Text>mi</Text>
        </ToggleGroupItem>
      </ToggleGroup>
    </View>
  );
}
