/**
 * API client. The access token lives in memory only; the refresh token is an
 * HttpOnly cookie the browser sends to /auth/refresh. A 401 triggers one refresh.
 */
export const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000').replace(/\/+$/, '');

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
const listeners = new Set<(signedIn: boolean) => void>();

export const getAccessToken = () => accessToken;
export function setAccessToken(token: string | null) {
  accessToken = token;
  listeners.forEach((l) => l(Boolean(token)));
}
export const onAuthChange = (fn: (signedIn: boolean) => void) => { listeners.add(fn); return () => listeners.delete(fn); };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

export async function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (!res.ok) { setAccessToken(null); return false; }
      setAccessToken(((await res.json()) as { accessToken: string }).accessToken);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => { refreshing = null; }, 0);
    }
  })();
  return refreshing;
}

type Query = Record<string, string | number | boolean | undefined | null>;

function url(path: string, query?: Query) {
  // API_URL may be absolute (https://api.example) or a path on this origin (/api).
  const u = new URL(`${API_URL.replace(/\/+$/, '')}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  return u.toString();
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; query?: Query; form?: FormData } = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(url(path, opts.query), {
    method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
    headers,
    credentials: 'include',
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  if (res.status === 401 && !retried && !path.startsWith('/auth/')) {
    if (await refreshSession()) return api<T>(path, opts, true);
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (body as { error?: { code: string; message: string; details?: unknown } }).error;
    throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? `Request failed (${res.status})`, e?.details);
  }
  return body as T;
}

/** Downloads a file from the API with the current token and saves it with the server's file name. */
export async function download(path: string, query?: Query): Promise<string> {
  const go = () => fetch(url(path, query), { headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {}, credentials: 'include' });
  let res = await go();
  if (res.status === 401 && (await refreshSession())) res = await go();
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, 'download_failed', (body as { error?: { message: string } }).error?.message ?? 'Download failed');
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'download';
  const href = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 5000);
  return name;
}
