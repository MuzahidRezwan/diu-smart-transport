import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { ErrorNote, Loading } from '../../components/ui';

const REASONS: Record<string, string> = {
  sign_in_cancelled: 'Sign-in was cancelled.',
  not_in_directory: 'Your ID was not found in the university directory. Contact the IT office.',
  use_authority_login: 'This is a transport office account. Use the "Transport office" sign-in.',
};

export function SsoCallbackPage() {
  const [params] = useSearchParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const code = params.get('code');
    if (!code) return;
    auth.completeUniversitySignIn(code).then(() => navigate('/', { replace: true })).catch(setError);
  }, [params, auth, navigate]);

  const reason = params.get('error');
  return (
    <main className="mx-auto grid min-h-screen max-w-md content-center gap-3 p-6">
      {reason ? <ErrorNote error={new Error(REASONS[reason] ?? 'Sign-in did not complete.')} /> : error ? <ErrorNote error={error} /> : <Loading what="Signing you in" />}
      {(reason || error) ? <Link className="btn justify-center" to="/login">Back to sign-in</Link> : null}
    </main>
  );
}
