import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Permission } from '@diu/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dayLabel, greeting, todayDhaka } from '../../lib/format';

interface NavItem { to: string; label: string; perm?: Permission; badge?: number }

export function AuthorityLayout() {
  const { me, can, logout } = useAuth();
  const complaints = useQuery({ queryKey: ['tickets', 'complaint'], queryFn: () => api<{ unread: number }>('/admin/tickets', { query: { kind: 'complaint' } }), enabled: can('support.manage') });
  const help = useQuery({ queryKey: ['tickets', 'help'], queryFn: () => api<{ unread: number }>('/admin/tickets', { query: { kind: 'help' } }), enabled: can('support.manage') });
  const semesters = useQuery({ queryKey: ['semesters'], queryFn: () => api<{ name: string; isCurrent: boolean }[]>('/admin/semesters') });
  const current = semesters.data?.find((s) => s.isCurrent);

  const groups: [string, NavItem[]][] = [
    ['Today', [{ to: '/admin', label: 'Dashboard' }, { to: '/admin/profile', label: 'Profile' }]],
    ['Fleet', [{ to: '/admin/fleet', label: 'Total bus list', perm: 'fleet.view' }, { to: '/admin/availability', label: 'Next 7 days', perm: 'fleet.view' }]],
    ['People', [
      { to: '/admin/access', label: 'Transport access lookup', perm: 'access.lookup' },
      { to: '/admin/tickets/complaint', label: 'Complaints & suggestions', perm: 'support.manage', badge: complaints.data?.unread },
      { to: '/admin/tickets/help', label: 'Help requests', perm: 'support.manage', badge: help.data?.unread },
    ]],
    ['Finance', [{ to: '/admin/payments', label: 'Payments & collection', perm: 'payments.view' }]],
    ['Admin', [
      { to: '/admin/routines', label: 'Class routines', perm: 'routines.manage' },
      { to: '/admin/admins', label: 'Admins & co-admins', perm: 'admins.manage' },
      { to: '/admin/settings', label: 'Settings', perm: 'dashboard.view' },
    ]],
  ];

  return (
    <div className="grid min-h-screen md:grid-cols-[250px_minmax(0,1fr)]">
      <nav aria-label="Authority menu" className="flex gap-3 overflow-x-auto border-b border-line bg-surface p-2.5 md:sticky md:top-0 md:h-screen md:flex-col md:overflow-y-auto md:border-b-0 md:border-r">
        <div className="hidden items-center gap-2 px-2 py-1 font-bold md:flex">
          <span className="grid h-8 w-8 place-items-center rounded-lg text-xs" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>DIU</span>Smart Transport
        </div>
        {groups.map(([label, items]) => {
          const visible = items.filter((i) => !i.perm || can(i.perm));
          if (!visible.length) return null;
          return (
            <div key={label} className="flex gap-0.5 md:grid">
              <div className="hidden px-2.5 pb-1 text-[11px] font-extrabold uppercase tracking-widest text-muted md:block">{label}</div>
              {visible.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.to === '/admin'} className={({ isActive }) => `nav-link whitespace-nowrap ${isActive ? 'active' : ''}`}>
                  <span className="flex-1">{i.label}</span>{i.badge ? <span className="badge">{i.badge}</span> : null}
                </NavLink>
              ))}
            </div>
          );
        })}
        <button className="nav-link whitespace-nowrap text-left" onClick={() => logout()}>Logout</button>
      </nav>
      <main className="grid min-w-0 content-start gap-4 p-4 md:p-6">
        <header className="flex flex-wrap items-center gap-4">
          <div className="grid h-12 w-12 place-items-center rounded-xl font-bold" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>
            {me?.name.split(' ').filter((p) => !/^(mr|mrs|ms|dr)\.?$/i.test(p)).map((p) => p[0]).join('').slice(0, 2)}
          </div>
          <div>
            <h1 className="text-xl">{greeting()}, {me?.name}</h1>
            <p className="muted">{me?.admin?.designation ?? 'Transport office'} · ID {me?.universityId} · {dayLabel(todayDhaka(), true)}</p>
          </div>
          <span className="flex-1" />
          {current && <span className="pill pill-info">Semester: {current.name}</span>}
        </header>
        <Outlet />
      </main>
    </div>
  );
}
