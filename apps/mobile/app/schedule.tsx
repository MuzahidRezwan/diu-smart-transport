import { ScrollView, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { formatClock } from '@diu/shared';
import { api } from '../src/lib/api';
import { useAuth } from '../src/lib/auth';
import { BusChip, Card, T, s, useTheme } from '../src/components/ui';

interface Slot { timeSlotId: string; routeName: string; direction: 'to_campus' | 'from_campus'; departureMinutes: number; buses: { id: string; code: string }[] }

export default function ScheduleScreen() {
  const t = useTheme();
  const { me } = useAuth();
  const q = useQuery({ queryKey: ['schedule-today'], queryFn: () => api<{ slots: Slot[]; closed: string | null; canSeeBuses: boolean }>('/me/schedule', { query: { audience: me?.role === 'student' ? 'student' : 'faculty' } }) });
  const now = Math.floor(((Date.now() / 60_000) + 6 * 60) % 1440);
  const block = (dir: 'to_campus' | 'from_campus') => (q.data?.slots ?? []).filter((x) => x.direction === dir).map((x) => (
    <Card key={x.timeSlotId} style={x.departureMinutes < now - 5 ? { opacity: 0.55 } : undefined}>
      <View style={s.row}><T bold>{formatClock(x.departureMinutes)}</T><T size={12}>{dir === 'to_campus' ? `${x.routeName} → DSC` : `DSC → ${x.routeName}`}</T></View>
      {q.data!.canSeeBuses && <View style={s.row}>{x.buses.length ? x.buses.map((b) => <BusChip key={b.id} code={b.code} />) : <T muted size={12}>Buses not published yet</T>}</View>}
    </Card>
  ));
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 14, gap: 10 }}>
      {q.data?.closed ? <Card><T bold>No service today: {q.data.closed}</T></Card> : <>
        <T muted bold size={12}>TO CAMPUS</T>{block('to_campus')}
        <T muted bold size={12}>TO HOME</T>{block('from_campus')}
      </>}
    </ScrollView>
  );
}
