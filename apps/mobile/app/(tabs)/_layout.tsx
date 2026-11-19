import { Tabs } from 'expo-router';
import { useTheme } from '../../src/components/ui';

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: t.accent, tabBarInactiveTintColor: t.muted, headerShadowVisible: false, tabBarLabelStyle: { fontWeight: '700' } }}>
      <Tabs.Screen name="index" options={{ title: 'My Bus' }} />
      <Tabs.Screen name="live" options={{ title: 'Live Route' }} />
      <Tabs.Screen name="card" options={{ title: 'My Card' }} />
      <Tabs.Screen name="notifications" options={{ title: 'Notification' }} />
    </Tabs>
  );
}
