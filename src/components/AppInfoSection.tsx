import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { compareSemver, getInstalledVersion } from '@/lib/version';
import { fetchLatestVersion } from '@/services/appVersions';

export function AppInfoSection() {
  const router = useRouter();
  const installed = getInstalledVersion();
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (!installed) return;
    let cancelled = false;
    fetchLatestVersion().then((latest) => {
      if (cancelled || !latest) return;
      setUpdateAvailable(compareSemver(installed, latest.version) < 0);
    });
    return () => {
      cancelled = true;
    };
  }, [installed]);

  return (
    <View className="gap-3">
      <Text className="text-base font-semibold">앱 정보</Text>
      <Pressable
        className="flex-row items-center justify-between active:opacity-70"
        onPress={() => router.push('/changelog')}
        accessibilityRole="button"
        accessibilityLabel="버전 정보와 변경 사항 보기"
      >
        <Text className="text-muted-foreground">
          버전 {installed ?? '알 수 없음'}
        </Text>
        {updateAvailable ? (
          <Text className="text-sm font-medium text-primary">새 버전 있음</Text>
        ) : null}
      </Pressable>
    </View>
  );
}
