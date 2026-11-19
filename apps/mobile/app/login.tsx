import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../src/lib/auth';
import { Button, Card, T, useTheme } from '../src/components/ui';

export default function Login() {
  const { signIn } = useAuth();
  const t = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg, justifyContent: 'center', padding: 20, gap: 16 }}>
      <View style={{ gap: 4 }}>
        <T bold size={26}>DIU Smart Transport</T>
        <T muted>Daffodil International University</T>
      </View>
      <Card>
        <T>Sign in with your official DIU account. You type your password on the university's page; this app never sees it.</T>
        <Button primary title={busy ? 'Opening…' : 'Sign in with DIU account'} disabled={busy} onPress={async () => {
          setBusy(true); setError(null);
          try { await signIn(); } catch (e) { setError(e instanceof Error ? e.message : 'Sign-in failed'); } finally { setBusy(false); }
        }} />
        {error && <T color={t.crit} bold>{error}</T>}
      </Card>
      <T muted size={12}>Transport office staff use the web dashboard.</T>
    </SafeAreaView>
  );
}
