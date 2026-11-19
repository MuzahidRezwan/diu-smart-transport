import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../lib/auth';

const NAV = [['/app', 'My Bus'], ['/app/schedule', 'Schedule'], ['/app/card', 'My Card'], ['/app/notices', 'Notification'], ['/app/support', 'Help']] as const;

export function RiderLayout() {
  const { me, logout } = useAuth();
  return (
    <div className="mx-auto grid min-h-screen max-w-xl grid-rows-[auto_1fr_auto]">
      <header className="flex items-center gap-3 p-4">
        <div className="grid h-10 w-10 place-items-center rounded-xl font-bold" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>{me?.name.split(' ').map((p) => p[0]).join('').slice(0, 2)}</div>
        <div className="min-w-0 flex-1"><b>{me?.name}</b><div className="muted truncate text-xs">ID {me?.universityId}{me?.profile.department ? ` · ${me.profile.department}` : ''}{me?.profile.batch ? ` · ${me.profile.batch}-${me.profile.section ?? ''}` : ''}</div></div>
        <button className="btn btn-sm" onClick={() => logout()}>Logout</button>
      </header>
      <main className="grid content-start gap-3 px-4 pb-6"><Outlet /></main>
      <nav className="sticky bottom-0 grid grid-cols-5 border-t border-line bg-surface px-1 pb-3 pt-1.5" aria-label="App">
        {NAV.map(([to, label]) => (
          <NavLink key={to} to={to} end={to === '/app'} className={({ isActive }) => `grid justify-items-center py-1.5 text-[11px] font-bold ${isActive ? 'text-accent' : 'text-muted'}`}>{label}</NavLink>
        ))}
      </nav>
    </div>
  );
}
