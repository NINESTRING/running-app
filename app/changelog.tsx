import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';

import { Text } from '@/components/ui/text';
import {
  fetchVersionHistory,
  type AppVersionRow,
} from '@/services/appVersions';

export default function ChangelogScreen() {
  const [versions, setVersions] = useState<AppVersionRow[] | null>(null);

  useEffect(() => {
    fetchVersionHistory().then(setVersions);
  }, []);

  if (versions === null) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  // 시드로 항상 1건 이상 있으므로, 빈 배열은 사실상 조회 실패(오프라인 등)를 의미
  if (versions.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-4">
        <Text className="text-muted-foreground">
          변경 사항을 불러오지 못했어요. 네트워크를 확인해 주세요.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      className="flex-1 bg-background"
      contentContainerClassName="gap-6 p-4"
      data={versions}
      keyExtractor={(v) => v.version}
      renderItem={({ item }) => (
        <View className="gap-1">
          <View className="flex-row items-baseline gap-2">
            <Text className="text-base font-semibold">{item.version}</Text>
            <Text className="text-sm text-muted-foreground">
              {new Date(item.released_at).toLocaleDateString('ko-KR')}
            </Text>
          </View>
          <Text className="text-sm">{item.notes}</Text>
        </View>
      )}
    />
  );
}
