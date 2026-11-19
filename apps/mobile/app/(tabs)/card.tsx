import { useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, TextInput, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { USER_CATEGORY_LABELS, type UserCategory } from '@diu/shared';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { loadCard, qrToken, saveCard, secondsLeft, type StoredCard } from '../../src/lib/qr';
import { Button, Card, Segmented, T, useTheme } from '../../src/components/ui';

interface MyCard {
  card: { id: string; status: string; semester: string; route: { id: string; name: string }; expiresOn: string | null; qrSecret: string | null } | null;
  dayPasses: { id: string; travelDate: string; route: string; status: string; qrSecret: string | null }[];
  dayPassesLeft: number;
}
interface RouteInfo { id: string; name: string }

function RotatingQr({ card }: { card: StoredCard }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  return (
    <View style={{ alignItems: 'center', gap: 6, paddingVertical: 8 }}>
      <View style={{ backgroundColor: '#fff', padding: 10, borderRadius: 10 }}><QRCode value={qrToken(card.secret, card.kind, card.id, now)} size={200} /></View>
      <T muted size={12}>Show this when boarding · refreshes in {secondsLeft(now)}s · works offline</T>
    </View>
  );
}

export default function CardScreen() {
  const t = useTheme();
  const { me, reload } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['my-card'], queryFn: () => api<MyCard>('/me/card') });
  const routes = useQuery({ queryKey: ['routes'], queryFn: () => api<RouteInfo[]>('/routes') });
  const [offline, setOffline] = useState<StoredCard | null>(null);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const chosen = routeId ?? me?.homeRouteId ?? routes.data?.[0]?.id ?? '';

  // Keep the newest usable QR secret on the device for offline boarding.
  useEffect(() => {
    const d = q.data;
    const today = new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10);
    const pass = d?.dayPasses.find((p) => p.qrSecret && p.travelDate === today);
    if (d?.card?.status === 'active' && d.card.qrSecret) saveCard({ id: d.card.id, secret: d.card.qrSecret, kind: 'c', label: `${d.card.semester} · ${d.card.route.name}`, expiresOn: d.card.expiresOn });
    else if (pass?.qrSecret) saveCard({ id: pass.id, secret: pass.qrSecret, kind: 'p', label: `Day pass · ${pass.travelDate} · ${pass.route}`, expiresOn: pass.travelDate });
    loadCard().then(setOffline);
  }, [q.data]);

  const pay = useMutation({
    mutationFn: () => api<{ redirectUrl: string }>('/me/card', { body: { routeId: chosen, gateway: 'sslcommerz' } }),
    onSuccess: (r) => Linking.openURL(r.redirectUrl),
    onError: (e: Error) => Alert.alert('Payment', e.message),
  });
  const free = useMutation({
    mutationFn: () => api('/me/card/free-request', { body: { routeId: chosen, note } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-card'] }); Alert.alert('Sent', 'The transport office will review your request.'); },
    onError: (e: Error) => Alert.alert('Request', e.message),
  });
  const pass = useMutation({
    mutationFn: () => {
      let d = new Date(Date.now() + 6 * 3600_000);
      if (d.getUTCDay() === 5) d = new Date(d.getTime() + 86_400_000);
      return api<{ status: string }>('/me/day-passes', { body: { travelDate: d.toISOString().slice(0, 10), routeId: chosen } });
    },
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['my-card'] }); reload(); Alert.alert('One Day Pass', r.status === 'approved' ? 'Approved. Your QR is ready.' : 'Sent for approval.'); },
    onError: (e: Error) => Alert.alert('One Day Pass', e.message),
  });

  const active = q.data?.card?.status === 'active';
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 14, gap: 12 }}>
      {offline && (active || offline.kind === 'p' || !q.data) ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <View style={{ backgroundColor: t.accent, padding: 14, gap: 2 }}>
            <T bold size={12} color="#fff">DAFFODIL INTERNATIONAL UNIVERSITY</T>
            <T bold size={18} color="#fff">{me?.name}</T>
            <T size={12} color="#fff">{me?.profile.department}</T>
          </View>
          <View style={{ padding: 14, gap: 4 }}>
            <T>ID <T bold>{me?.universityId}</T></T>
            <T>{offline.label}</T>
            {offline.expiresOn && <T muted size={12}>Valid until {offline.expiresOn}</T>}
          </View>
          <RotatingQr card={offline} />
        </Card>
      ) : (
        <Card>
          <T bold>Transport card{q.data?.card ? ` · ${q.data.card.status.replace('_', ' ')}` : ''}</T>
          <T muted size={12}>Fee for {USER_CATEGORY_LABELS[me?.category as UserCategory] ?? 'your category'} is set by the transport office. Pay with bKash, Nagad, Rocket or card.</T>
          <Segmented value={chosen} onChange={setRouteId} options={(routes.data ?? []).slice(0, 3).map((r) => [r.id, r.name] as [string, string])} />
          {(routes.data?.length ?? 0) > 3 && <Segmented value={chosen} onChange={setRouteId} options={(routes.data ?? []).slice(3).map((r) => [r.id, r.name] as [string, string])} />}
          <Button primary title="Pay and get card" disabled={!chosen || pay.isPending} onPress={() => pay.mutate()} />
          <TextInput placeholder="Ask for free access: why? (scholarship, quota…)" value={note} onChangeText={setNote} style={{ borderWidth: 1, borderColor: t.line, borderRadius: 10, padding: 10, color: t.ink }} placeholderTextColor={t.muted} />
          <Button title="Send free access request" disabled={note.trim().length < 10 || free.isPending} onPress={() => free.mutate()} />
        </Card>
      )}
      {!active && q.data && (
        <Card>
          <T bold>One Day Pass · {q.data.dayPassesLeft} left this semester</T>
          <T muted size={12}>For one date on your route, both directions.</T>
          <Button title="Request a pass for today" disabled={!chosen || pass.isPending} onPress={() => pass.mutate()} />
        </Card>
      )}
    </ScrollView>
  );
}
