/**
 * Supervisor mode: scan riders' QR codes at the bus door. Every scan is
 * recorded as ridership (ground truth for the prediction model).
 */
import { useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useQuery } from '@tanstack/react-query';
import { api } from '../src/lib/api';
import { useAuth } from '../src/lib/auth';
import { Button, Card, Segmented, T, useTheme } from '../src/components/ui';

interface Bus { id: string; code: string }
interface ScanResult { valid: boolean; reason: string | null; name: string | null }

export default function ScanScreen() {
  const t = useTheme();
  const { signOut } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [busId, setBusId] = useState<string | null>(null);
  const [last, setLast] = useState<ScanResult | null>(null);
  const [count, setCount] = useState(0);
  const busy = useRef(false);
  const lastToken = useRef('');
  const buses = useQuery({ queryKey: ['supervisor-buses'], queryFn: () => api<Bus[]>('/boarding/buses') });
  const [filter, setFilter] = useState('');
  const shown = (buses.data ?? []).filter((b) => !filter || b.code.startsWith(filter));

  if (!permission) return <View style={{ flex: 1, backgroundColor: t.bg }} />;
  if (!permission.granted) {
    return <View style={{ flex: 1, backgroundColor: t.bg, padding: 14, gap: 12 }}><Card><T bold>Camera access is needed to scan boarding QR codes.</T><Button primary title="Allow camera" onPress={requestPermission} /></Card></View>;
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, padding: 14, gap: 12 }}>
      <Segmented value={filter} onChange={setFilter} options={[['', 'All'], ['H', 'Hanif'], ['M', 'Monir'], ['S', 'Surjomukhi']]} />
      <ScrollView horizontal style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 6 }}>
        {shown.map((b) => <Button key={b.id} title={b.code} primary={b.id === busId} onPress={() => setBusId(b.id)} />)}
      </ScrollView>
      <View style={{ flex: 1, borderRadius: 16, overflow: 'hidden' }}>
        <CameraView style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={async ({ data }) => {
          if (busy.current || data === lastToken.current || !busId) return;
          busy.current = true;
          lastToken.current = data;
          try {
            const r = await api<ScanResult>('/boarding/scan', { body: { qrToken: data, busId, method: 'qr', scannedAt: new Date().toISOString() } });
            setLast(r);
            if (r.valid) setCount((c) => c + 1);
          } catch (e) {
            setLast({ valid: false, reason: e instanceof Error ? e.message : 'Scan failed', name: null });
          } finally {
            setTimeout(() => { busy.current = false; }, 1200);
          }
        }} />
      </View>
      <Card style={{ backgroundColor: last ? (last.valid ? t.okSoft : t.critSoft) : t.surface }}>
        <T bold size={18} color={last ? (last.valid ? t.ok : t.crit) : undefined}>{!busId ? 'Choose your bus first' : last ? (last.valid ? `OK · ${last.name ?? ''}` : 'Not valid') : 'Point at the rider\'s QR'}</T>
        {last?.reason && <T>{last.reason}</T>}
        <T muted>{count} rider(s) boarded on this trip</T>
      </Card>
      <Button title="Sign out" onPress={() => signOut()} />
    </View>
  );
}
