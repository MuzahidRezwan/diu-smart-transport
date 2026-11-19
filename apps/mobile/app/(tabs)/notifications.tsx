import { FlatList, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../src/lib/api';
import { Card, T, useTheme } from '../../src/components/ui';

interface Notice { id: string; title: string; body: string; publishedAt: string }

export default function NotificationsScreen() {
  const t = useTheme();
  const q = useQuery({ queryKey: ['notices'], queryFn: () => api<Notice[]>('/me/notices'), refetchInterval: 60_000 });
  return (
    <FlatList style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 14, gap: 10 }} data={q.data ?? []} keyExtractor={(n) => n.id}
      refreshing={q.isFetching} onRefresh={() => q.refetch()}
      ListEmptyComponent={<T muted>{q.isLoading ? 'Loading…' : 'No notices yet.'}</T>}
      renderItem={({ item }) => (
        <Card>
          <View style={{ flexDirection: 'row', gap: 8 }}><T bold style={{ flex: 1 }}>{item.title}</T><T muted size={12}>{new Date(item.publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</T></View>
          <T muted>{item.body}</T>
        </Card>
      )} />
  );
}
