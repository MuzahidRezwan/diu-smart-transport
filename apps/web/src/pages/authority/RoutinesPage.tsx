import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { dateTime } from '../../lib/format';
import type { RoutineVersion } from '../../lib/types';
import { Card, ErrorNote, Loading, Pill, useToast, type Tone } from '../../components/ui';

const TONE: Record<string, Tone> = { pending_review: 'warn', active: 'ok', rejected: 'crit', superseded: 'none' };

export function RoutinesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['routines'], queryFn: () => api<RoutineVersion[]>('/admin/routines') });
  const [department, setDepartment] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const upload = useMutation({
    mutationFn: () => { const f = new FormData(); f.set('department', department); f.set('file', file!); return api<{ sessions: number; warnings: string[]; duplicate: boolean }>('/admin/routines/upload', { form: f }); },
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['routines'] }); toast(r.duplicate ? 'This routine is already uploaded' : `${r.sessions} classes read · waiting for review`); setFile(null); },
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'activate' | 'reject' }) => api(`/admin/routines/${id}/${action}`, { body: {} }),
    onSuccess: (_r, v) => { qc.invalidateQueries({ queryKey: ['routines'] }); toast(v.action === 'activate' ? 'Routine activated. Re-run the forecast to use it.' : 'Routine rejected'); },
  });
  return (
    <>
      <Card title="Upload a class routine">
        <form className="grid max-w-2xl gap-3" onSubmit={(e) => { e.preventDefault(); upload.mutate(); }}>
          <p className="muted m-0">Best: the standard CSV template (<span className="mono">department, batch, section, teacher_initial, day, start_time, end_time, course_code, room</span>). Department grid files (XLSX, PDF, HTML) with cells like <span className="mono">SE331 (41_G) MRH</span> also work. New routines wait for review before they affect predictions.</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="field" htmlFor="dept">Department<input id="dept" className="input" required minLength={2} value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. SWE" /></label>
            <label className="field" htmlFor="file">File (CSV, XLSX, PDF, HTML · up to 5 MB)<input id="file" type="file" className="input" accept=".csv,.xlsx,.pdf,.html,.htm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
            <button className="btn btn-primary" disabled={!file || !department || upload.isPending}>{upload.isPending ? 'Reading…' : 'Upload'}</button>
          </div>
          {upload.error ? <ErrorNote error={upload.error} /> : null}
        </form>
      </Card>
      <Card title="Routine versions">
        {list.isLoading ? <Loading /> : !list.data?.length ? <p className="muted">No routines yet.</p> : (
          <div className="overflow-x-auto"><table className="data">
            <thead><tr><th>Department</th><th>File</th><th>Classes</th><th>Warnings</th><th>Status</th><th>Uploaded</th><th /></tr></thead>
            <tbody>{list.data.map((v) => (
              <tr key={v.id}>
                <td><b>{v.department}</b></td><td className="text-xs">{v.fileName}</td><td className="num">{v.sessionCount}</td>
                <td className="text-xs">{v.warnings.length ? <details><summary>{v.warnings.length} warning(s)</summary><ul className="pl-4">{v.warnings.slice(0, 10).map((w, i) => <li key={i}>{w}</li>)}</ul></details> : 'None'}</td>
                <td><Pill tone={TONE[v.status] ?? 'none'}>{v.status.replace('_', ' ')}</Pill></td><td className="text-xs">{dateTime(v.createdAt)}</td>
                <td>{v.status === 'pending_review' && <div className="flex gap-1.5"><button className="btn btn-sm btn-primary" onClick={() => act.mutate({ id: v.id, action: 'activate' })}>Activate</button><button className="btn btn-sm btn-danger" onClick={() => act.mutate({ id: v.id, action: 'reject' })}>Reject</button></div>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
