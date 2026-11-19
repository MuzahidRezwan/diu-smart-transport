import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ALL_PERMISSIONS, PERMISSION_LABELS, PERMISSION_PRESETS, type Permission } from '@diu/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTime } from '../../lib/format';
import type { AdminRow } from '../../lib/types';
import { Card, ErrorNote, Loading, Modal, Pill, useToast } from '../../components/ui';

export function AdminsPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['admins'], queryFn: () => api<AdminRow[]>('/admin/admins') });
  const [form, setForm] = useState({ universityId: '', name: '', designation: '' });
  const [perms, setPerms] = useState<Set<Permission>>(new Set(['dashboard.view']));
  const [temp, setTemp] = useState<{ name: string; password: string } | null>(null);

  const create = useMutation({
    mutationFn: () => api<{ temporaryPassword: string }>('/admin/admins', { body: { ...form, permissions: [...perms] } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['admins'] }); setTemp({ name: form.name, password: r.temporaryPassword }); setForm({ universityId: '', name: '', designation: '' }); },
  });
  const toggleActive = useMutation({
    mutationFn: (a: AdminRow) => api(`/admin/admins/${a.userId}`, { method: 'PATCH', body: { isActive: !a.isActive } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admins'] }); toast('Saved'); },
  });

  return (
    <>
      <Card title="Admins & co-admins">
        {list.isLoading ? <Loading /> : (
          <div className="overflow-x-auto"><table className="data">
            <thead><tr><th>Name</th><th>Role</th><th>Permissions</th><th>2FA</th><th>Last sign-in</th><th /></tr></thead>
            <tbody>{(list.data ?? []).map((a) => (
              <tr key={a.userId}>
                <td><b>{a.name}</b><div className="muted mono text-xs">{a.universityId}</div></td><td>{a.isMainAdmin ? 'Main admin' : a.designation}</td>
                <td><div className="flex flex-wrap gap-1">{a.isMainAdmin ? <Pill tone="info">All transport permissions</Pill> : a.permissions.map((p) => <Pill key={p} tone="info">{p}</Pill>)}</div></td>
                <td>{a.totpEnabled ? <Pill tone="ok">On</Pill> : <Pill tone="warn">Not set up</Pill>}</td><td className="text-xs">{dateTime(a.lastLoginAt)}</td>
                <td>{!a.isMainAdmin && a.userId !== me?.id && <button className="btn btn-sm" onClick={() => toggleActive.mutate(a)}>{a.isActive ? 'Suspend' : 'Re-activate'}</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      <Card title="Add co-admin">
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="flex flex-wrap gap-2">
            <label className="field min-w-[200px] flex-1" htmlFor="a-name">Name<input id="a-name" className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="field" htmlFor="a-id">Staff ID<input id="a-id" className="input mono" required value={form.universityId} onChange={(e) => setForm({ ...form, universityId: e.target.value })} /></label>
            <label className="field" htmlFor="a-des">Designation<input id="a-des" className="input" required value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} /></label>
            <label className="field" htmlFor="a-preset">Start from<select id="a-preset" className="input" defaultValue="" onChange={(e) => e.target.value && setPerms(new Set(PERMISSION_PRESETS[e.target.value]))}>
              <option value="">Custom</option>{Object.keys(PERMISSION_PRESETS).map((k) => <option key={k}>{k}</option>)}</select></label>
          </div>
          <fieldset className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
            <legend className="field mb-1">Permissions</legend>
            {ALL_PERMISSIONS.filter((p) => p !== 'admins.manage' || me?.admin?.isMainAdmin).map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={perms.has(p)} onChange={() => setPerms((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; })} />{PERMISSION_LABELS[p]}</label>
            ))}
          </fieldset>
          <p className="muted m-0 text-xs">There is no permission for reading rider profiles or acting as a rider, so even the main admin cannot give one.</p>
          {create.error ? <ErrorNote error={create.error} /> : null}
          <div><button className="btn btn-primary" disabled={create.isPending}>Add co-admin</button></div>
        </form>
      </Card>
      {temp && <Modal title="Co-admin added" onClose={() => setTemp(null)} width={520}>
        <p>Give this temporary password to <b>{temp.name}</b> in person. It is shown only once. They must change it and set up 2FA at first sign-in.</p>
        <p className="mono rounded-lg p-3 text-lg" style={{ background: 'var(--surface-2)' }}>{temp.password}</p>
        <button className="btn" onClick={() => navigator.clipboard?.writeText(temp.password).then(() => toast('Copied'), () => toast('Copy blocked'))}>Copy</button>
      </Modal>}
    </>
  );
}
