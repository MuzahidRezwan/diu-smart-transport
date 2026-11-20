import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Link } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { formatClock } from '@diu/shared';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { BusChip, Button, Card, OP_NAMES, Segmented, T, s, useTheme } from '../../src/components/ui';

interface Slot { timeSlotId: string; routeName: string; direction: 'to_campus' | 'from_campus'; departureMinutes: number; note?: string | null }
/** "Sat 21 Nov" for a YYYY-MM-DD service date. */
const dayName = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

interface MyBus { closed: string | null; direction: 'to_campus' | 'from_campus'; next: Slot | null; serviceDate: string; isToday: boolean; minutesUntil: number | null; buses: { code: string; operatorCode: string }[]; canSeeBuses: boolean; reason?: string }
interface RouteInfo { id: string; name: string; stops: { name: string }[] }

export default function MyBusScreen() {
  const t = useTheme();
  const { me, signOut } = useAuth();
  const staff = me?.role !== 'student';
  const [dir, setDir] = useState<'to_campus' | 'from_campus' | undefined>();
  const [service, setService] = useState<'student' | 'faculty'>(staff ? 'faculty' : 'student');
  const q = useQuery({ queryKey: ['my-bus', dir, service], queryFn: () => api<MyBus>('/me/my-bus', { query: { direction: dir, audience: service } }), refetchInterval: 60_000 });
  const routes = useQuery({ queryKey: ['routes'], queryFn: () => api<RouteInfo[]>('/routes') });
  const route = routes.data?.find((r) => r.id === me?.homeRouteId);
  const d = q.data;
  const direction = d?.direction ?? dir ?? 'to_campus';
  const stops = route ? (direction === 'to_campus' ? route.stops : [...route.stops].reverse()) : [];

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 14, gap: 12 }} refreshControl={<RefreshControl refreshing={q.isFetching} onRefresh={() => q.refetch()} />}>
      <View>
        <T bold size={17}>{me?.name}</T>
        <T muted size={12}>ID {me?.universityId}{route ? ` · Route: ${route.name}` : ''}</T>
      </View>
      {staff && <Segmented value={service} onChange={setService} options={[['faculty', 'Faculty service'], ['student', 'Student service']]} />}
      <Segmented value={direction} onChange={(v) => setDir(v)} options={[['to_campus', 'To campus'], ['from_campus', 'To home']]} />

      {d && !d.canSeeBuses && (
        <Card style={{ borderColor: t.accent }}>
          <T bold>Get your transport card</T>
          <T muted size={12}>See bus numbers and live buses, and board with your QR. Approved instantly after payment.</T>
          <Link href="/card" asChild><Button primary title="Apply for transport card" onPress={() => undefined} /></Link>
        </Card>
      )}

      {!me?.homeRouteId ? <Card><T bold>Choose your route on the My Card tab to get started.</T></Card>
        : !d?.next ? <Card><T bold>{q.isLoading ? 'Loading…' : d?.closed ? `No buses today: ${d.closed}` : 'No buses in this direction in the next 7 days.'}</T></Card>
        : (
          <View style={{ backgroundColor: t.accent, borderRadius: 16, padding: 14, gap: 8 }}>
            <View style={s.row}><T bold size={12} color={t.accentInk}>{d.isToday ? 'YOUR BUS' : 'NEXT BUS'}</T><View style={{ flex: 1 }} /><T bold size={12} color={t.accentInk}>{!d.isToday ? dayName(d.serviceDate) : (d.minutesUntil ?? 0) > 0 ? `in ${d.minutesUntil} min` : 'boarding now'}</T></View>
            <T bold size={40} color={t.accentInk}>{formatClock(d.next.departureMinutes)}</T>
            <T bold color={t.accentInk}>{d.next.direction === 'to_campus' ? `${d.next.routeName} → DSC` : `DSC → ${d.next.routeName}`}</T>
            {d.next.note ? <T size={12} color={t.accentInk}>{d.next.note}</T> : null}
            {d.canSeeBuses && (d.buses.length ? ['H', 'M', 'S'].map((op) => {
              const list = d.buses.filter((b) => b.operatorCode === op);
              return list.length ? <View key={op} style={s.row}><T bold size={12} color={t.accentInk} style={{ minWidth: 76 }}>{OP_NAMES[op]}</T>{list.map((b) => <View key={b.code} style={{ backgroundColor: '#fff', borderRadius: 8 }}><BusChip code={b.code} /></View>)}</View> : null;
            }) : <T size={12} bold color={t.accentInk}>Buses not published yet · usually by 2:00 PM</T>)}
          </View>
        )}

      <Link href="/schedule" asChild><Button title="See today's bus schedule" onPress={() => undefined} /></Link>

      {stops.length > 0 && (
        <Card>
          <T bold>Route</T>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row' }}>
              {stops.map((st, i) => (
                <View key={`${st.name}-${i}`} style={{ width: 76, alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 3, borderColor: t.accent, backgroundColor: i === stops.length - 1 ? t.accent : t.surface }} />
                  <T muted bold size={11} style={{ textAlign: 'center' }}>{st.name}</T>
                </View>
              ))}
            </View>
          </ScrollView>
        </Card>
      )}

      <Card>
        <Link href="/support" asChild><Button title="Complaint, suggestion or help" onPress={() => undefined} /></Link>
        <T muted size={12}>Transport office: see the contact on the notice board.</T>
        <Button title="Sign out" onPress={() => signOut()} />
      </Card>
    </ScrollView>
  );
}
