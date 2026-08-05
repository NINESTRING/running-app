import '../src/global.css';
import '../src/services/location';

import { ThemeProvider } from '@react-navigation/native';
import { PortalHost } from '@rn-primitives/portal';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import { NAV_THEME } from '@/lib/theme';

export default function RootLayout() {
  const { colorScheme } = useColorScheme();
  const scheme = colorScheme ?? 'light';

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
