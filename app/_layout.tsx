import '../src/global.css';
import '../src/services/location';

import { PortalHost } from '@rn-primitives/portal';
import { Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import { useEffect } from 'react';
import { NAV_THEME } from '@/lib/theme';
import { ensureSignedIn } from '@/services/auth';

export default function RootLayout() {
  const { colorScheme } = useColorScheme();
  const scheme = colorScheme ?? 'light';

  useEffect(() => {
    ensureSignedIn().then((result) => {
      if (!result.ok) console.warn('익명 로그인 실패:', result.error);
    });
  }, []);

  return (
    <ThemeProvider value={NAV_THEME[scheme]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="run/[id]" options={{ title: '러닝 상세' }} />
      </Stack>
      <PortalHost />
    </ThemeProvider>
  );
}
