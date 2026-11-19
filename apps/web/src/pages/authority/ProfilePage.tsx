import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Card, ErrorNote, Pill, useToast } from '../../components/ui';

export function ProfilePage() {
  const { me, logout } = useAuth();
  const toast = useToast();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const change = useMutation({
    mutationFn: () => api('/auth/authority/change-password', { body: pw }),
    onSuccess: async () => { toast('Password changed. Sign in again.'); await logout(); },
  });
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Profile">
        <dl className="grid grid-cols-[130px_1fr] gap-2">
          <dt className="muted font-bold">Name</dt><dd>{me?.name}</dd>
          <dt className="muted font-bold">Designation</dt><dd>{me?.admin?.designation}</dd>
          <dt className="muted font-bold">ID</dt><dd className="mono">{me?.universityId}</dd>
          <dt className="muted font-bold">Role</dt><dd>{me?.admin?.isMainAdmin ? 'Main admin' : 'Co-admin'}</dd>
          <dt className="muted font-bold">2FA</dt><dd><Pill tone="ok">Authenticator app on</Pill></dd>
        </dl>
        <div className="mt-4 flex gap-2"><button className="btn" onClick={() => logout(true)}>Sign out of all devices</button></div>
      </Card>
      <Card title="Change password">
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); change.mutate(); }}>
          <label className="field" htmlFor="cur">Current password<input id="cur" type="password" className="input" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required /></label>
          <label className="field" htmlFor="new">New password (12+ characters)<input id="new" type="password" className="input" autoComplete="new-password" minLength={12} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required /></label>
          {change.error ? <ErrorNote error={change.error} /> : null}
          <div><button className="btn btn-primary" disabled={change.isPending}>Change password</button></div>
        </form>
      </Card>
    </div>
  );
}
