import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../src/lib/auth';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } });

/** Sends signed-out people to the login screen and supervisors to the scanner. */
function Gate() {
  const { me, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    const atLogin = segments[0] === 'login';
    if (!me && !atLogin) router.replace('/login');
    else if (me?.role === 'supervisor' && segments[0] !== 'scan') router.replace('/scan');
    else if (me && atLogin) router.replace('/');
  }, [me, loading, segments, router]);
  return (
    <Stack screenOptions={{ headerShadowVisible: false }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="schedule" options={{ title: "Today's bus schedule" }} />
      <Stack.Screen name="support" options={{ title: 'Complaint, suggestion or help' }} />
      <Stack.Screen name="scan" options={{ title: 'Boarding scan' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StatusBar style="auto" />
          <Gate />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
