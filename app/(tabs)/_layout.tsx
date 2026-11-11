import { Tabs } from 'expo-router';
import React from 'react';
import { TabBar } from '@/ui/TabBar';
import { C } from '@/ui/theme';

export default function TabsLayout() {
  return (
    <Tabs tabBar={(p) => <TabBar {...p} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: C.bg }, animation: 'fade' }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="explore" />
      <Tabs.Screen name="trek" />
      <Tabs.Screen name="return" />
      <Tabs.Screen name="safety" />
    </Tabs>
  );
}
