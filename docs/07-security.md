# 7. Security Plan

## 7.1 Authentication

| Who | How | Details |
|---|---|---|
| Students, faculty, staff | **DIU SSO via OIDC Authorization Code + PKCE** | The user types their password only on the university's page. We receive an authorization code, exchange it server-side and read the verified university ID from the ID token. **We never receive or store university passwords.** |
| Fallback if DIU has no OIDC | Server-side call to a DIU "verify credentials" API over mTLS/VPN | Password is passed through in memory once, never logged or stored; request bodies on `/auth/*` are excluded from logs. Push DIU to provide OIDC. |
| Authority | University ID + own password (bcrypt, cost 12) + **mandatory TOTP** | Lockout after 5 failed attempts for 15 min; password policy ≥ 12 chars; recovery codes generated at TOTP enrolment and stored hashed. |
| GPS trackers | Per-device API key (HMAC-SHA256 of body + timestamp) | Keys rotate; requests older than 60 s are rejected (replay protection). |
| ML service | Internal network only + shared service token | Never exposed to the internet. |

### Tokens
- **Access token**: JWT, 15 min, signed with EdDSA/HS256 key from the secret store, contains `sub`, `role`, `perms` version. Sent as `Authorization: Bearer`.
- **Refresh token**: 256-bit random opaque value, stored **hashed** (SHA-256) in `refresh_tokens`, 30 days, **rotated on every use**. If a used token is presented again, the whole token family is revoked (theft detection).
- Web stores the refresh token in an `HttpOnly; Secure; SameSite=Strict` cookie; the mobile app stores it in the OS keystore (`expo-secure-store`).
- Logout revokes the current family; "log out of all devices" revokes all families.

## 7.2 Authorization (RBAC)

- Roles: `student`, `faculty`, `staff`, `authority`.
- Authority accounts carry **fine-grained permissions** (see `packages/shared/src/permissions.ts`), e.g. `allocation.publish`, `cards.approve`, `cards.grant_free`, `users.manage_access`, `notices.publish`, `admins.manage`, `fees.manage`, `fleet.manage`, `reports.view`.
- The Main Admin implicitly has all permissions and is the only one with `admins.manage` by default. Presets: *Allocation officer*, *Card desk*, *Support desk*, *Viewer*.
- Every route declares its permission with `requirePermission(...)`; deny by default.
- Object-level checks: a user can only read their own card, passes, payments and complaints (`WHERE user_id = :me`), never by passing another ID.

## 7.3 Input & API hardening

- zod validation on every body, query and param; unknown fields stripped.
- Parameterized SQL only (Drizzle); no string-built SQL.
- `helmet` security headers, strict CORS allow-list, request body limit (100 kB, 5 MB for routine uploads).
- **Rate limiting**: global per IP, stricter on `/auth/*` (10/min), `/day-passes` and `/payments/*`.
- File uploads (routines, photos): type sniffing, size limits, stored in object storage with random names, never executed; PDFs parsed in the ML container, which has no DB credentials.
- Errors return a generic message plus a request ID; stack traces only in logs.

## 7.4 Payment security

- Amount is computed **server-side** from fee rules; the client never sends an amount.
- Each payment has a unique `tran_id`; the IPN handler is **idempotent** (a second IPN for a successful payment is a no-op).
- IPN is trusted only after calling the gateway **validation API** with `val_id` and checking `status`, `tran_id`, `amount`, `currency` and `store_id` match our record. SSLCommerz `verify_sign`/`verify_key` hash is also checked.
- Success/fail redirect pages never change state; only the verified IPN does.
- Store credentials live in the secret store; sandbox and live credentials are separate environments.
- Refunds require `payments.refund` permission and are audit-logged.

## 7.5 Data protection & privacy

- TLS 1.2+ everywhere (Caddy/LB), HSTS.
- PostgreSQL encrypted at rest (managed disk encryption); TOTP secrets additionally encrypted with an application key (AES-256-GCM).
- **Data minimization**: we store only what transport needs (no CGPA, no guardian info).
- **Live location** is collected for **buses only**, shown only during active trips, kept 90 days raw then aggregated. Users' phone location is used on-device to show "you are here" and is never uploaded.
- QR codes on cards are **signed short-lived tokens** (rotate every 60 s in the app) so a screenshot cannot be shared for long.
- Personal data export/delete requests handled by the Main Admin following university policy.

## 7.6 Audit & monitoring

- `audit_logs` row for every authority write: actor, permission used, entity, entity ID, before/after JSON, IP, user agent, timestamp. Append-only (no update/delete grants for the app DB user).
- Alerts on: repeated failed authority logins, IPN validation failures, spikes in 4xx/5xx, GPS devices silent during a trip.

## 7.7 Backups & recovery

- Daily full + continuous WAL archiving (point-in-time recovery), 30-day retention, copy in a different region/provider.
- Restore drill once per semester. RPO ≤ 15 min, RTO ≤ 4 h.

## 7.8 Secure development

- Secrets only via environment/secret store; `.env` is git-ignored; `npm audit`/`pip-audit` and Dependabot in CI.
- Branch protection, PR review, CI must pass.
- Least-privilege DB users: `app` (CRUD, no DDL), `migrator` (DDL), `reporting` (read-only replica).
