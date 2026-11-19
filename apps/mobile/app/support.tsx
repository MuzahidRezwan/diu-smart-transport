import { useState } from 'react';
import { Alert, ScrollView, Switch, TextInput, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { COMPLAINT_CATEGORIES } from '@diu/shared';
import { api } from '../src/lib/api';
import { Button, Card, Segmented, T, s, useTheme } from '../src/components/ui';

interface Ticket { id: string; number: string; status: string; body: string }

export default function SupportScreen() {
  const t = useTheme();
  const qc = useQueryClient();
  const [kind, setKind] = useState<'complaint' | 'suggestion' | 'help'>('complaint');
  const [category, setCategory] = useState<string>('late_bus');
  const [body, setBody] = useState('');
  const [hide, setHide] = useState(true);
  const mine = useQuery({ queryKey: ['my-tickets'], queryFn: () => api<Ticket[]>('/me/tickets') });
  const send = useMutation({
    mutationFn: () => api<{ number: string }>('/me/tickets', { body: kind === 'help' ? { kind, subject: 'Help request', body } : { kind, category, body, hideIdentityFromDriver: hide } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['my-tickets'] }); setBody(''); Alert.alert('Sent', `Ticket ${r.number}. You will get the reply here.`); },
    onError: (e: Error) => Alert.alert('Not sent', e.message),
  });
  const input = { borderWidth: 1, borderColor: t.line, borderRadius: 10, padding: 10, color: t.ink, minHeight: 100, textAlignVertical: 'top' as const };
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 14, gap: 12 }}>
      <Card>
        <Segmented value={kind} onChange={setKind} options={[['complaint', 'Complaint'], ['suggestion', 'Suggestion'], ['help', 'Help']]} />
        {kind !== 'help' && (
          <View style={s.row}>
            {COMPLAINT_CATEGORIES.map((c) => <Button key={c} title={c.replaceAll('_', ' ')} primary={c === category} onPress={() => setCategory(c)} />)}
          </View>
        )}
        <TextInput multiline placeholder="Bus number, time and what happened" placeholderTextColor={t.muted} value={body} onChangeText={setBody} style={input} />
        {kind !== 'help' && <View style={s.row}><Switch value={hide} onValueChange={setHide} /><T>Hide my name from the driver</T></View>}
        <Button primary title="Send" disabled={body.trim().length < 10 || send.isPending} onPress={() => send.mutate()} />
      </Card>
      <T bold>My tickets</T>
      {(mine.data ?? []).map((x) => <Card key={x.id}><View style={s.row}><T bold>{x.number}</T><T muted size={12}>{x.status.replace('_', ' ')}</T></View><T muted numberOfLines={2}>{x.body}</T></Card>)}
    </ScrollView>
  );
}
