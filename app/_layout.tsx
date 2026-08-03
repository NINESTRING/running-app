import '../src/services/location';
import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="run/[id]" options={{ title: '러닝 상세' }} />
    </Stack>
  );
}
