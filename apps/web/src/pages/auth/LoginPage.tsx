import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { ErrorNote } from '../../components/ui';

export function LoginPage() {
  const auth = useAuth();
  const [mode, setMode] = useState<'rider' | 'authority'>('rider');
  const [universityId, setUniversityId] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<{ challengeId: string; enrollment?: { otpauthUrl: string; secret: string } } | null>(null);
  const [code, setCode] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<{ adminId: string; adminPassword: string | null; studentId: string; facultyId: string } | null>(null);

  // Public demo servers say so at /demo; a real deployment answers 404 and nothing is shown.
  useEffect(() => { api<NonNullable<typeof demo>>('/demo').then(setDemo).catch(() => undefined); }, []);

  useEffect(() => {
    if (challenge?.enrollment) QRCode.toDataURL(challenge.enrollment.otpauthUrl, { margin: 1, width: 200 }).then(setQr).catch(() => setQr(null));
  }, [challenge]);

  if (auth.me) return <Navigate to="/" replace />;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <main className="mx-auto grid min-h-screen max-w-md content-center gap-5 p-6">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-lg font-bold" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>DIU</span>
        <div><h1 className="text-xl">DIU Smart Transport</h1><p className="muted">Daffodil International University</p></div>
      </div>
      <div className="seg w-full" role="group" aria-label="Who are you">
        <button className="flex-1" aria-pressed={mode === 'rider'} onClick={() => setMode('rider')}>Student / Faculty</button>
        <button className="flex-1" aria-pressed={mode === 'authority'} onClick={() => setMode('authority')}>Transport office</button>
      </div>

      {demo && (
        <section className="card grid gap-2" style={{ borderColor: 'var(--accent)' }}>
          <p><b>Public demo.</b> Sample data; it resets when the server restarts. Nothing here is real.</p>
          {mode === 'authority' ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="muted">Transport office: <span className="mono">{demo.adminId}</span>{demo.adminPassword && <> / <span className="mono">{demo.adminPassword}</span></>}</span>
              {demo.adminPassword && <button type="button" className="btn btn-sm" onClick={() => { setUniversityId(demo.adminId); setPassword(demo.adminPassword!); }}>Fill in</button>}
            </div>
          ) : (
            <p className="muted">On the university sign-in page, type <span className="mono">{demo.studentId}</span> (student) or <span className="mono">{demo.facultyId}</span> (faculty). For the dashboard, choose <i>Transport office</i>.</p>
          )}
        </section>
      )}

      {mode === 'rider' ? (
        <section className="card grid gap-3">
          <p>Sign in with your official DIU account. You type your password on the university's page; this app never sees it.</p>
          <button className="btn btn-primary justify-center" disabled={busy} onClick={() => run(auth.startUniversitySignIn)}>Sign in with DIU account</button>
        </section>
      ) : !challenge ? (
        <form className="card grid gap-3" onSubmit={(e) => { e.preventDefault(); run(async () => { const c = await auth.authorityPassword(universityId.trim(), password); if (c) setChallenge(c); }); }}>
          <label className="field" htmlFor="uid">University ID<input id="uid" className="input mono" autoComplete="username" value={universityId} onChange={(e) => setUniversityId(e.target.value)} required /></label>
          <label className="field" htmlFor="pw">Password<input id="pw" type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          <button className="btn btn-primary justify-center" disabled={busy}>Continue</button>
        </form>
      ) : (
        <form className="card grid gap-3" onSubmit={(e) => { e.preventDefault(); run(() => auth.authorityTotp(challenge.challengeId, code)); }}>
          {challenge.enrollment ? (
            <div className="grid gap-2">
              <p><b>Set up two-step sign-in.</b> Scan this with Google Authenticator or Microsoft Authenticator, then enter the 6-digit code.</p>
              {qr && <img src={qr} alt="Authenticator QR code" width={200} height={200} className="rounded-lg bg-white p-2" />}
              <p className="muted text-xs">Can't scan? Enter this key: <span className="mono">{challenge.enrollment.secret}</span></p>
            </div>
          ) : <p>Enter the 6-digit code from your authenticator app.</p>}
          <label className="field" htmlFor="code">Code<input id="code" className="input mono text-lg tracking-widest" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required /></label>
          <button className="btn btn-primary justify-center" disabled={busy || code.length !== 6}>Sign in</button>
        </form>
      )}
      {error ? <ErrorNote error={error} /> : null}
    </main>
  );
}
