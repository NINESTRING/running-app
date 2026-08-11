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
    const unsubscribe = useSettingsStore.persist.onFinishHydration(() => setHydrated(true));
    return unsubscribe;
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
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="run/[id]" options={{ title: '러닝 상세' }} />
        <Stack.Screen name="changelog" options={{ title: '변경 사항' }} />
      </Stack>
      <PortalHost />
    </ThemeProvider>
  );
}
