import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { MeResponse, Permission } from '@diu/shared';
import { api, refreshSession, setAccessToken } from './api';

export interface AuthorityChallenge { challengeId: string; mustEnrollTotp: boolean; enrollment?: { otpauthUrl: string; secret: string }; mustChangePassword: boolean }

interface AuthState {
  me: MeResponse | null;
  loading: boolean;
  reload(): Promise<void>;
  startUniversitySignIn(): Promise<void>;
  completeUniversitySignIn(code: string): Promise<void>;
  /** Returns the 2FA challenge, or null when the server signed in straight away (public demo). */
  authorityPassword(universityId: string, password: string): Promise<AuthorityChallenge | null>;
  authorityTotp(challengeId: string, code: string): Promise<void>;
  logout(all?: boolean): Promise<void>;
  can(p: Permission): boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try { setMe(await api<MeResponse>('/me')); } catch { setMe(null); }
  }, []);

  useEffect(() => {
    (async () => {
      if (await refreshSession()) await reload();
      setLoading(false);
    })();
  }, [reload]);

  const value: AuthState = {
    me,
    loading,
    reload,
    async startUniversitySignIn() {
      const { authorizationUrl } = await api<{ authorizationUrl: string }>('/auth/sso/start', { query: { client: 'web' } });
      window.location.assign(authorizationUrl);
    },
    async completeUniversitySignIn(code) {
      const t = await api<{ accessToken: string }>('/auth/sso/complete', { body: { code } });
      setAccessToken(t.accessToken);
      await reload();
    },
    async authorityPassword(universityId, password) {
      const r = await api<AuthorityChallenge | { accessToken: string }>('/auth/authority/login', { body: { universityId, password } });
      if ('accessToken' in r) { setAccessToken(r.accessToken); await reload(); return null; }
      return r;
    },
    async authorityTotp(challengeId, code) {
      const t = await api<{ accessToken: string }>('/auth/authority/totp', { body: { challengeId, code } });
      setAccessToken(t.accessToken);
      await reload();
    },
    async logout(all = false) {
      await api(all ? '/auth/logout-all' : '/auth/logout', { body: {} }).catch(() => undefined);
      setAccessToken(null);
      setMe(null);
    },
    can(p) {
      return Boolean(me?.admin && (me.admin.isMainAdmin || me.admin.permissions.includes(p)));
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
