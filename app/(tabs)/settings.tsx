import { View } from 'react-native';

import { AccountSection } from '@/components/AccountSection';
import { AppInfoSection } from '@/components/AppInfoSection';
import { Text } from '@/components/ui/text';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useSettingsStore } from '@/stores/settingsStore';

export default function SettingsScreen() {
  const unit = useSettingsStore((s) => s.unit);
  const setUnit = useSettingsStore((s) => s.setUnit);

  return (
    <View className="flex-1 gap-6 bg-background p-4">
      <AccountSection />
      <View className="gap-3">
        <Text className="text-base font-semibold">거리 단위</Text>
        <ToggleGroup
          type="single"
          value={unit}
          onValueChange={(v) => {
            if (v === 'km' || v === 'mi') setUnit(v);
          }}
          className="justify-start"
        >
          <ToggleGroupItem value="km" isFirst>
            <Text>km</Text>
          </ToggleGroupItem>
          <ToggleGroupItem value="mi" isLast>
            <Text>mi</Text>
          </ToggleGroupItem>
        </ToggleGroup>
      </View>
      <AppInfoSection />
    </View>
  );
}
