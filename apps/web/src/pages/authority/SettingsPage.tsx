import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Card, ErrorNote, Loading, useToast } from '../../components/ui';

interface Settings { dayPassLimitPerSemester: number; dayPassOverLimit: 'reject' | 'manual'; allocationBufferPct: number; defaultTurnaroundMinutes: number; attendanceFactorColdStart: number }

export function SettingsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/admin/settings') });
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => { if (q.data) setS(q.data); }, [q.data]);
  const save = useMutation({ mutationFn: () => api<Settings>('/admin/settings', { method: 'PATCH', body: s }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); toast('Settings saved'); } });
  if (!s) return <Loading />;
  const ro = !can('settings.manage');
  return (
    <Card title="Settings">
      <form className="grid max-w-xl gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <label className="field" htmlFor="dp">One Day Passes per rider per semester<input id="dp" type="number" min={0} max={10} className="input" disabled={ro} value={s.dayPassLimitPerSemester} onChange={(e) => setS({ ...s, dayPassLimitPerSemester: Number(e.target.value) })} /></label>
        <label className="field" htmlFor="dpo">When a rider asks for more than that<select id="dpo" className="input" disabled={ro} value={s.dayPassOverLimit} onChange={(e) => setS({ ...s, dayPassOverLimit: e.target.value as Settings['dayPassOverLimit'] })}>
          <option value="manual">Send to the transport office for a decision</option><option value="reject">Reject automatically</option></select></label>
        <label className="field" htmlFor="buf">Extra seats on top of the P90 prediction (%)<input id="buf" type="number" min={0} max={50} className="input" disabled={ro} value={Math.round(s.allocationBufferPct * 100)} onChange={(e) => setS({ ...s, allocationBufferPct: Number(e.target.value) / 100 })} /></label>
        <label className="field" htmlFor="ta">Turnaround time at DSC (minutes)<input id="ta" type="number" min={0} max={120} className="input" disabled={ro} value={s.defaultTurnaroundMinutes} onChange={(e) => setS({ ...s, defaultTurnaroundMinutes: Number(e.target.value) })} /></label>
        <label className="field" htmlFor="cs">Attendance before there is boarding data (%)<input id="cs" type="number" min={30} max={100} className="input" disabled={ro} value={Math.round(s.attendanceFactorColdStart * 100)} onChange={(e) => setS({ ...s, attendanceFactorColdStart: Number(e.target.value) / 100 })} /></label>
        {save.error ? <ErrorNote error={save.error} /> : null}
        {!ro && <div><button className="btn btn-primary" disabled={save.isPending}>Save settings</button></div>}
      </form>
    </Card>
  );
}
