import { View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { Card, OP_COLORS, T, useTheme } from '../../src/components/ui';

interface Live { allowed: boolean; positions: { busId: string; code: string; operatorCode: string; lat: number; lng: number; trip: { direction: string } | null }[] }
interface RouteInfo { id: string; name: string; stops: { name: string; lat: number; lng: number }[] }

/** Buses on the rider's route while they are on a trip. Riders' own location never leaves the phone. */
export default function LiveScreen() {
  const t = useTheme();
  const { me } = useAuth();
  const live = useQuery({ queryKey: ['live'], queryFn: () => api<Live>('/me/live'), refetchInterval: 10_000 });
  const routes = useQuery({ queryKey: ['routes'], queryFn: () => api<RouteInfo[]>('/routes') });
  const route = routes.data?.find((r) => r.id === me?.homeRouteId);
  if (live.data && !live.data.allowed) {
    return <View style={{ flex: 1, backgroundColor: t.bg, padding: 14 }}><Card><T bold>Live route is for transport card holders.</T><T muted>Get your card on the My Card tab.</T></Card></View>;
  }
  return (
    <View style={{ flex: 1 }}>
      <MapView style={{ flex: 1 }} initialRegion={{ latitude: 23.85, longitude: 90.34, latitudeDelta: 0.18, longitudeDelta: 0.18 }} showsUserLocation>
        {route && <Polyline coordinates={route.stops.map((s) => ({ latitude: s.lat, longitude: s.lng }))} strokeColor="#1446a0" strokeWidth={4} />}
        {route?.stops.map((s) => <Marker key={s.name} coordinate={{ latitude: s.lat, longitude: s.lng }} title={s.name} pinColor="#8a96b0" />)}
        {(live.data?.positions ?? []).map((p) => <Marker key={p.busId} coordinate={{ latitude: p.lat, longitude: p.lng }} title={p.code} pinColor={OP_COLORS[p.operatorCode] ?? '#333'} />)}
      </MapView>
      <View style={{ position: 'absolute', left: 12, right: 12, bottom: 12 }}>
        <Card><T bold>{live.data?.positions.length ?? 0} bus(es) on the road</T><T muted size={12}>Updates every 10 seconds.</T></Card>
      </View>
    </View>
  );
}
