/**
 * University sign-in (SSO) and the university directory (profile data).
 *
 * The API never sees a university password: users type it only on the
 * university's own login page (OIDC Authorization Code + PKCE).
 * Mock providers exist for development and tests and are refused in production.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { UserCategory } from '@diu/shared';
import { badRequest, unauthorized, upstreamUnavailable } from '../lib/errors.js';

export interface SsoIdentity {
  universityId: string;
  name?: string;
  email?: string;
}

export interface SsoProvider {
  readonly mode: 'mock' | 'oidc';
  authorizationUrl(p: { state: string; codeChallenge: string; redirectUri: string }): Promise<string>;
  exchange(p: { code: string; codeVerifier: string; redirectUri: string }): Promise<SsoIdentity>;
}

export interface DirectoryPerson {
  universityId: string;
  name: string;
  role: 'student' | 'faculty' | 'staff';
  category: UserCategory;
  department?: string;
  program?: string;
  batch?: string;
  section?: string;
  teacherInitial?: string;
  designation?: string;
  phone?: string;
  email?: string;
  photoUrl?: string;
}

export interface UniversityDirectory {
  lookup(universityId: string): Promise<DirectoryPerson | null>;
}

/* ---------------- OIDC ---------------- */

interface Discovery { authorization_endpoint: string; token_endpoint: string; jwks_uri: string; issuer: string }

export class OidcProvider implements SsoProvider {
  readonly mode = 'oidc' as const;
  private discovery?: Promise<Discovery>;
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly opts: { issuer: string; clientId: string; clientSecret: string; scopes: string; idClaim: string }) {}

  private meta(): Promise<Discovery> {
    this.discovery ??= fetch(`${this.opts.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(8000) })
      .then(async (r) => {
        if (!r.ok) throw new Error(`OIDC discovery failed: ${r.status}`);
        return (await r.json()) as Discovery;
      })
      .catch((err) => {
        this.discovery = undefined;
        throw upstreamUnavailable('University sign-in', err);
      });
    return this.discovery;
  }

  async authorizationUrl(p: { state: string; codeChallenge: string; redirectUri: string }): Promise<string> {
    const m = await this.meta();
    const url = new URL(m.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.opts.clientId,
      redirect_uri: p.redirectUri,
      scope: this.opts.scopes,
      state: p.state,
      code_challenge: p.codeChallenge,
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  async exchange(p: { code: string; codeVerifier: string; redirectUri: string }): Promise<SsoIdentity> {
    const m = await this.meta();
    const res = await fetch(m.token_endpoint, {
      signal: AbortSignal.timeout(8000),
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: p.code,
        redirect_uri: p.redirectUri,
        code_verifier: p.codeVerifier,
        client_id: this.opts.clientId,
        client_secret: this.opts.clientSecret,
      }),
    }).catch((err) => { throw upstreamUnavailable('University sign-in', err); });
    if (res.status >= 500) throw upstreamUnavailable('University sign-in');
    if (!res.ok) throw unauthorized('The university sign-in did not complete. Try again.');
    const body = (await res.json()) as { id_token?: string };
    if (!body.id_token) throw unauthorized('The university sign-in returned no identity.');
    this.jwks ??= createRemoteJWKSet(new URL(m.jwks_uri));
    const { payload } = await jwtVerify(body.id_token, this.jwks, { issuer: m.issuer, audience: this.opts.clientId });
    const universityId = payload[this.opts.idClaim];
    if (typeof universityId !== 'string' || !universityId) throw unauthorized('Your university account has no ID.');
    return {
      universityId,
      name: typeof payload.name === 'string' ? payload.name : undefined,
      email: typeof payload.email === 'string' ? payload.email : undefined,
    };
  }
}

/* ---------------- Mock (development only) ---------------- */

export class MockSsoProvider implements SsoProvider {
  readonly mode = 'mock' as const;
  constructor(private readonly publicApiUrl: string) {}

  async authorizationUrl(p: { state: string; redirectUri: string }): Promise<string> {
    const url = new URL('/auth/sso/mock-authorize', this.publicApiUrl);
    url.searchParams.set('state', p.state);
    return url.toString();
  }

  async exchange(p: { code: string }): Promise<SsoIdentity> {
    const m = /^mock\.(.+)$/.exec(p.code);
    if (!m) throw badRequest('Invalid mock code');
    return { universityId: m[1]! };
  }
}

/* ---------------- Directory ---------------- */

export class HttpDirectory implements UniversityDirectory {
  constructor(private readonly baseUrl: string, private readonly token: string) {}

  async lookup(universityId: string): Promise<DirectoryPerson | null> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/people/${encodeURIComponent(universityId)}`, {
      headers: { authorization: `Bearer ${this.token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    }).catch((err) => { throw upstreamUnavailable('University directory', err); });
    if (res.status === 404) return null;
    if (!res.ok) throw upstreamUnavailable('University directory', new Error(`HTTP ${res.status}`));
    return (await res.json()) as DirectoryPerson;
  }
}

const FIRST = ['Khalilur', 'Nusrat', 'Tanvir', 'Sadia', 'Mehedi', 'Farzana', 'Rakib', 'Jannatul', 'Imran', 'Moumita', 'Sabbir', 'Lamia', 'Rafsan', 'Tasnim', 'Nayeem', 'Priya', 'Ashik', 'Mahmuda'];
const LAST = ['Rahman', 'Jahan', 'Ahmed', 'Afrin', 'Hasan', 'Yeasmin', 'Islam', 'Ferdous', 'Kabir', 'Das', 'Akter', 'Hossain', 'Chowdhury', 'Saha'];
const DEPTS: Record<string, string> = { '35': 'Software Engineering', '15': 'Computer Science and Engineering', '11': 'Electrical and Electronic Engineering', '33': 'Multimedia and Creative Technology', '10': 'Business Administration' };

function h(s: string): number { let x = 2166136261; for (const c of s) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; }

/** Deterministic fake people so the whole system runs without university access. */
export class MockDirectory implements UniversityDirectory {
  async lookup(universityId: string): Promise<DirectoryPerson | null> {
    const k = h(universityId);
    const name = `${FIRST[k % FIRST.length]} ${LAST[(k >>> 8) % LAST.length]}`;
    const phone = `017${String(10000000 + (k % 89999999)).slice(0, 8)}`;
    const student = /^(\d{2})(\d)-(\d{2})-(\d{3,5})$/.exec(universityId);
    if (student) {
      const [, yy, term, dept] = student;
      if (universityId === '232-35-797') {
        return { universityId, name: 'Khalilur Rahman', role: 'student', category: 'student_tri_semester', department: 'Software Engineering', program: 'BSc in SWE', batch: '41', section: 'G', phone, email: 'khalilur35-797@diu.edu.bd' };
      }
      const categories: UserCategory[] = ['student_tri_semester', 'student_tri_semester', 'student_tri_semester', 'student_bi_semester', 'student_thesis_only', 'hall_resident'];
      return {
        universityId, name, role: 'student', category: categories[k % categories.length]!,
        department: DEPTS[dept!] ?? 'Software Engineering',
        batch: String((Number(yy) - 10) * 3 + Number(term)),
        section: 'ABCDEFGH'[(k >>> 4) % 8],
        phone, email: `${universityId.replace(/-/g, '')}@diu.edu.bd`,
      };
    }
    if (/^\d{5,8}$/.test(universityId)) {
      const faculty = (k % 10) < 6;
      return {
        universityId, name: faculty ? `Dr. ${name}` : name, role: faculty ? 'faculty' : 'staff', category: faculty ? 'faculty' : 'admin_staff',
        department: faculty ? 'Software Engineering' : 'Registrar Office', designation: faculty ? 'Assistant Professor' : 'Officer',
        teacherInitial: faculty ? name.split(' ').map((p) => p[0]).join('') : undefined, phone,
      };
    }
    return null;
  }
}
