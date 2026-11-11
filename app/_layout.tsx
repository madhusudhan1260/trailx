import '@/services/tracking'; // registers the background location task at module scope
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { boot } from '@/services/boot';
import { useApp } from '@/store';
import { Button, T } from '@/ui/primitives';
import { C } from '@/ui/theme';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [fonts] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, SpaceGrotesk_500Medium, SpaceGrotesk_700Bold });
  const ready = useApp((s) => s.ready);
  const [error, setError] = useState<string | null>(null);
  const start = () => {
    setError(null);
    boot().catch((e: Error) => setError(e.message));
  };
  useEffect(start, []);
  useEffect(() => {
    if ((fonts && ready) || error) void SplashScreen.hideAsync().catch(() => undefined);
  }, [fonts, ready, error]);

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
        <T v="h2" center>TRAILX could not open its local storage</T>
        <T center>{error}</T>
        <Button title="Try again" onPress={start} />
      </View>
    );
  }
  if (!fonts || !ready) return <View style={{ flex: 1, backgroundColor: C.bg }} />;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'fade_from_bottom', animationDuration: 260 }}>
          <Stack.Screen name="index" options={{ animation: 'none' }} />
          <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
          <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
          <Stack.Screen name="sos" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
          <Stack.Screen name="plan" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="emergency/[id]" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="history/index" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="history/[id]" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="profile" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="beacon" options={{ animation: 'slide_from_right' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
