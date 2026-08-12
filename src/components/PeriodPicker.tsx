import { FlatList, Modal, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { PeriodOption } from '@/lib/stats';
import { cn } from '@/lib/utils';

interface Props {
  visible: boolean;
  options: PeriodOption[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onClose: () => void;
}

export function PeriodPicker({ visible, options, selectedKey, onSelect, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/40" onPress={onClose}>
        {/* 내부 시트 탭이 배경 onPress로 전파되지 않도록 빈 핸들러 */}
        <Pressable className="max-h-[60%] rounded-t-2xl bg-background pb-8 pt-2" onPress={() => {}}>
          <View className="items-center py-2">
            <View className="h-1 w-10 rounded-full bg-muted" />
          </View>
          <FlatList
            data={options}
            keyExtractor={(o) => o.key}
            renderItem={({ item }) => (
              <Pressable
                className="px-6 py-3 active:bg-accent"
                onPress={() => {
                  onSelect(item.key);
                  onClose();
                }}
              >
                <Text
                  className={cn(
                    'text-base',
                    item.key === selectedKey && 'font-bold'
                  )}
                >
                  {item.label}
                </Text>
              </Pressable>
            )}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
