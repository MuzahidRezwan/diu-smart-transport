import { Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './lib/auth';
import { Loading } from './components/ui';
import { LoginPage } from './pages/auth/LoginPage';
import { SsoCallbackPage } from './pages/auth/SsoCallbackPage';
import { PaymentResultPage } from './pages/rider/PaymentResultPage';
import { AuthorityLayout } from './pages/authority/AuthorityLayout';
import { DashboardPage } from './pages/authority/DashboardPage';
import { FleetPage } from './pages/authority/FleetPage';
import { AvailabilityPage } from './pages/authority/AvailabilityPage';
import { AccessLookupPage } from './pages/authority/AccessLookupPage';
import { TicketsPage } from './pages/authority/TicketsPage';
import { PaymentsPage } from './pages/authority/PaymentsPage';
import { AdminsPage } from './pages/authority/AdminsPage';
import { RoutinesPage } from './pages/authority/RoutinesPage';
import { SettingsPage } from './pages/authority/SettingsPage';
import { ProfilePage } from './pages/authority/ProfilePage';
import { PreviewPage } from './pages/authority/PreviewPage';
import { RiderLayout } from './pages/rider/RiderLayout';
import { MyBusPage } from './pages/rider/MyBusPage';
import { SchedulePage } from './pages/rider/SchedulePage';
import { CardPage } from './pages/rider/CardPage';
import { NoticesPage } from './pages/rider/NoticesPage';
import { SupportPage } from './pages/rider/SupportPage';

function RequireRole({ roles, children }: { roles: string[]; children: ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <div className="p-8"><Loading what="Checking your session" /></div>;
  if (!me) return <Navigate to="/login" replace />;
  if (!roles.includes(me.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Home() {
  const { me, loading } = useAuth();
  if (loading) return <div className="p-8"><Loading /></div>;
  if (!me) return <Navigate to="/login" replace />;
  return <Navigate to={me.role === 'authority' ? '/admin' : '/app'} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<SsoCallbackPage />} />
      <Route path="/payment/result" element={<PaymentResultPage />} />
      <Route path="/admin" element={<RequireRole roles={['authority']}><AuthorityLayout /></RequireRole>}>
        <Route index element={<DashboardPage />} />
        <Route path="fleet" element={<FleetPage />} />
        <Route path="availability" element={<AvailabilityPage />} />
        <Route path="access" element={<AccessLookupPage />} />
        <Route path="tickets/:kind" element={<TicketsPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="admins" element={<AdminsPage />} />
        <Route path="routines" element={<RoutinesPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="preview" element={<PreviewPage />} />
      </Route>
      <Route path="/app" element={<RequireRole roles={['student', 'faculty', 'staff']}><RiderLayout /></RequireRole>}>
        <Route index element={<MyBusPage />} />
        <Route path="schedule" element={<SchedulePage />} />
        <Route path="card" element={<CardPage />} />
        <Route path="notices" element={<NoticesPage />} />
        <Route path="support" element={<SupportPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
