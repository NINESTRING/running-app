import '../src/global.css';
import '../src/services/location';

import { PortalHost } from '@rn-primitives/portal';
import { Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { colorScheme as nativewindColorScheme, useColorScheme } from 'nativewind';
import { useEffect, useState } from 'react';
import { NAV_THEME } from '@/lib/theme';
import { ensureSignedIn } from '@/services/auth';
import { useSettingsStore } from '@/stores/settingsStore';

export default function RootLayout() {
  const { colorScheme } = useColorScheme();
  const scheme = colorScheme ?? 'light';
  const theme = useSettingsStore((s) => s.theme);
  // 저장된 테마를 읽기 전에 렌더하면 라이트 → 다크로 깜빡이므로 하이드레이션을 기다린다
  const [hydrated, setHydrated] = useState(useSettingsStore.persist.hasHydrated());

  useEffect(() => {
    // 하이드레이션이 커밋과 이펙트 플러시 사이에 끝나면 onFinishHydration이 재발화되지
    // 않아 영원히 대기하게 되므로, 이펙트 실행 시점에 이미 끝났는지 다시 확인한다
    const applyThemeAndFinish = () => {
      nativewindColorScheme.set(useSettingsStore.getState().theme);
      setHydrated(true);
    };
    if (useSettingsStore.persist.hasHydrated()) {
      applyThemeAndFinish();
      return;
    }
    return useSettingsStore.persist.onFinishHydration(applyThemeAndFinish);
  }, []);

  useEffect(() => {
    if (hydrated) nativewindColorScheme.set(theme);
  }, [hydrated, theme]);

  useEffect(() => {
    ensureSignedIn().then((result) => {
      if (!result.ok) console.warn('익명 로그인 실패:', result.error);
    });
  }, []);

  if (!hydrated) return null;

  return (
    <ThemeProvider value={NAV_THEME[scheme]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerTitle: '', headerBackButtonDisplayMode: 'minimal' }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="run/[id]" />
        <Stack.Screen name="changelog" />
      </Stack>
      <PortalHost />
    </ThemeProvider>
  );
}
