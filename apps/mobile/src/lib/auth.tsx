import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { ssoFailureMessage, type MeResponse } from '@diu/shared';
import { api, clearSession, refresh, saveSession } from './api';
import { registerForPush } from './push';

interface Auth {
  me: MeResponse | null;
  loading: boolean;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  reload(): Promise<void>;
}
const Ctx = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => { try { setMe(await api<MeResponse>('/me')); } catch { setMe(null); } }, []);

  useEffect(() => { (async () => { if (await refresh()) await reload(); setLoading(false); })(); }, [reload]);
  useEffect(() => { if (me && me.role !== 'authority') registerForPush().catch(() => undefined); }, [me]);

  const value: Auth = {
    me, loading, reload,
    /** University SSO in the system browser; the API redirects back to diutransport://auth?code=... */
    async signIn() {
      const { authorizationUrl } = await api<{ authorizationUrl: string }>('/auth/sso/start', { query: { client: 'mobile' } });
      const result = await WebBrowser.openAuthSessionAsync(authorizationUrl, Linking.createURL('auth'));
      if (result.type !== 'success') return;
      const { queryParams } = Linking.parse(result.url);
      if (queryParams?.error) throw new Error(ssoFailureMessage(String(queryParams.error)));
      const code = String(queryParams?.code ?? '');
      if (!code) throw new Error('Sign-in did not complete');
      await saveSession(await api<{ accessToken: string; refreshToken: string }>('/auth/sso/complete', { body: { code } }));
      await reload();
    },
    async signOut() { await clearSession(); setMe(null); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
