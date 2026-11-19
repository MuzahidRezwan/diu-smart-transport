import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { ErrorNote, Loading } from '../../components/ui';
import { ssoFailureMessage } from '@diu/shared';

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
      {reason ? <ErrorNote error={new Error(ssoFailureMessage(reason))} /> : error ? <ErrorNote error={error} /> : <Loading what="Signing you in" />}
      {(reason || error) ? <Link className="btn justify-center" to="/login">Back to sign-in</Link> : null}
    </main>
  );
}
