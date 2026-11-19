/**
 * API client for the app. The refresh token lives in the OS keystore
 * (expo-secure-store); the access token only in memory.
 */
import * as SecureStore from 'expo-secure-store';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';
const REFRESH_KEY = 'diu.refresh';

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function saveSession(t: { accessToken: string; refreshToken?: string }) {
  accessToken = t.accessToken;
  if (t.refreshToken) await SecureStore.setItemAsync(REFRESH_KEY, t.refreshToken);
}

export async function clearSession() {
  const rt = await SecureStore.getItemAsync(REFRESH_KEY);
  accessToken = null;
  await SecureStore.deleteItemAsync(REFRESH_KEY);
  if (rt) await fetch(`${API_URL}/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) }).catch(() => undefined);
}

export async function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const rt = await SecureStore.getItemAsync(REFRESH_KEY);
      if (!rt) return false;
      const res = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) });
      if (!res.ok) { if (res.status === 401) await SecureStore.deleteItemAsync(REFRESH_KEY); return false; }
      await saveSession(await res.json());
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => { refreshing = null; }, 0);
    }
  })();
  return refreshing;
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; query?: Record<string, string | undefined> } = {}, retried = false): Promise<T> {
  const q = Object.entries(opts.query ?? {}).filter(([, v]) => v !== undefined) as [string, string][];
  const url = `${API_URL}${path}${q.length ? `?${new URLSearchParams(q).toString()}` : ''}`;
  const res = await fetch(url, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: { ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}), ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && !retried && (await refresh())) return api<T>(path, opts, true);
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (body as { error?: { code: string; message: string } }).error;
    throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}
