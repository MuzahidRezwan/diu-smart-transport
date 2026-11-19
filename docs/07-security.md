# 7. Security Plan

## 7.1 Authentication

| Who | How | Details |
|---|---|---|
| Students, faculty, staff | **DIU SSO via OIDC Authorization Code + PKCE** | The user types their password only on the university's page. We receive an authorization code, exchange it server-side and read the verified university ID from the ID token. **We never receive or store university passwords.** |
| Fallback if DIU has no OIDC | Server-side call to a DIU "verify credentials" API over mTLS/VPN | Password is passed through in memory once, never logged or stored; request bodies on `/auth/*` are excluded from logs. Push DIU to provide OIDC. |
| Authority | University ID + own password (bcrypt, cost 12) + **mandatory TOTP** | Lockout after 5 failed attempts for 15 min; password policy ≥ 12 chars. Lost authenticator: another admin with `admins.manage` deactivates and recreates the account, or IT runs the audited break-glass reset (`reset-admin`, [12.10](12-deployment-and-ops.md#1210-runbooks)), which forces a new password and a new 2FA enrolment. |
| GPS trackers | Per-device API key (HMAC-SHA256 of body + timestamp) | Keys rotate; requests older than 60 s are rejected (replay protection). |
| ML service | Internal network only + shared service token | Never exposed to the internet. |

### Tokens
- **Access token**: JWT, 15 min, HS256 with `JWT_SECRET`, containing `sub`, `role` and the university ID. Permissions and the active flag are read from the database on every request, so a revoked permission or a deactivated account takes effect at once. Sent as `Authorization: Bearer`.
- **Refresh token**: 256-bit random opaque value, stored **hashed** (SHA-256) in `refresh_tokens`, 30 days, **rotated on every use**. If a used token is presented again, the whole token family is revoked (theft detection).
- Web stores the refresh token in an `HttpOnly; Secure; SameSite=Strict` cookie; the mobile app stores it in the OS keystore (`expo-secure-store`).
- Logout revokes the current family; "log out of all devices" revokes all families.

## 7.2 Authorization (RBAC)

- Roles: `student`, `faculty`, `staff`, `authority`.
- Authority accounts carry **fine-grained permissions** (see `packages/shared/src/permissions.ts`), e.g. `allocation.publish`, `cards.approve`, `cards.grant_free`, `access.lookup`, `access.grant_revoke`, `notices.publish`, `admins.manage`, `fees.manage`, `fleet.manage`, `reports.view`.
- The Main Admin implicitly has all permissions and is the only one with `admins.manage` by default. Presets: *Allocation officer*, *Card desk*, *Support desk*, *Viewer*.
- Every route declares its permission with `requirePermission(...)`; deny by default.
- Object-level checks: a user can only read their own card, passes, payments and complaints (`WHERE user_id = :me`), never by passing another ID.

### Authority data boundary (no profile access, no impersonation)

The transport office manages transport, not people's university records. This is enforced in four layers, so one bug cannot break it:

1. **No permission exists for it.** The permission catalogue has no `users.read_profile`, `users.edit` or `users.impersonate`. Because the main admin can only hand out permissions that exist, nobody can be given profile or impersonation access from the dashboard.
2. **Separate data.** Profile fields that the app needs for the rider themself (phone, department, batch, section, teacher initial, photo URL) live in `user_profiles`, which only the rider's own `/me` endpoints read. Authority endpoints read the `transport_riders` view: university ID, name, rider type, home route, card/pass status. The view has no other columns.
3. **Narrow lookup.** `GET /admin/access/:universityId` needs the exact ID and `access.lookup`; there is no list or search-by-name endpoint for riders. It returns the `transport_riders` row plus that rider's transport history (cards, payments, day passes, access-change audit rows), all of which are transport-owned tables. Every lookup is audit-logged and rate-limited (30/hour per admin) to stop scraping.
4. **Database grants.** The API's authority code path connects as `transport_admin`, which can read `transport_riders` and the identity columns of `users` and has **no** privilege on `user_profiles` or `device_tokens`. Even an injected query from that path cannot read profiles. Roles come from [`roles.sql`](../apps/api/drizzle/roles.sql) (docker compose creates them on first start), grants from [`grants.sql`](../apps/api/drizzle/grants.sql) (re-applied after every migration), and CI runs the whole API test suite on PostgreSQL with these roles, so a change that needs profile access from the dashboard fails the build.

Other rules:
- **No "log in as user".** Tokens are issued only by the rider's own SSO sign-in; there is no endpoint that mints a token for someone else. "Preview the app" in the dashboard renders the app with a fixed sample account and blocks every write.
- Authority actions can change only transport-owned rows (allocations, slots, fleet, fees, notices, `transport_cards.status`, `day_passes.status`, ticket replies). Granting, revoking and approving without payment require a reason, stored in the audit log.
- Complaints/help tickets are shown to the authority by ticket number and route. The rider's identity is attached to the ticket only in the rider's own view; replies are delivered inside the ticket.
- Reports and the ML pipeline use aggregated or pseudonymous data (hashed IDs), never profile fields.

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
- **Payment report exports** (`GET /admin/payments/export?from=&to=&status=&method=&format=xlsx|csv`) need `payments.export`, are limited to 93 days per file, contain only the columns listed in FR-5.9, and write an audit row (who, period, filters, row count). CSV cells are quoted and any cell starting with `=`, `+`, `-` or `@` is prefixed with `'` so a name can never run as a spreadsheet formula (CSV injection). The Excel file carries a Summary sheet with the exporter's name and the period.

## 7.5 Data protection & privacy

- TLS 1.2+ everywhere (Caddy/LB), HSTS.
- PostgreSQL encrypted at rest (managed disk encryption); TOTP secrets additionally encrypted with an application key (AES-256-GCM).
- **Data minimization**: we store only what transport needs (no CGPA, no guardian info).
- **Live location** is collected for **buses only**, shown only during active trips, kept 90 days raw then aggregated. Users' phone location is used on-device to show "you are here" and is never uploaded.
- QR codes on cards are **signed short-lived tokens**: the app derives a new code every 30 s from a per-card secret, and the scanner accepts a code for about a minute, so a screenshot stops working almost at once. Codes are made on the phone, so they work offline.
- Personal data export/delete requests are handled by IT (database access), not through the dashboard, following university policy. The transport office cannot see the data to export it.

## 7.6 Audit & monitoring

- `audit_logs` row for every authority write and every rider lookup: actor, action, entity, entity ID, affected rider, before/after JSON, reason, IP, user agent, timestamp. Append-only twice over: no `UPDATE`/`DELETE` grant for the app roles, and a trigger that refuses changes even from the owner.
- Alerts on: repeated failed authority logins, IPN validation failures, spikes in 4xx/5xx, GPS devices silent during a trip.

## 7.7 Backups & recovery

- **Docker compose (launch):** nightly `pg_dump` piped straight into GPG with a public key ([`scripts/backup-db.sh`](../scripts/backup-db.sh)); 14 days on the server, copied off-site; the private key is kept offline by IT. RPO 24 h.
- **Managed PostgreSQL (later):** point-in-time recovery (WAL archiving), 30 days, another region. RPO ≤ 15 min.
- Restore drill **monthly** with [`scripts/restore-db.sh`](../scripts/restore-db.sh) into a scratch database. The restore re-applies roles and grants, so privacy rules survive a recovery. RTO ≤ 4 h.
- Backup files, dumps and ML training exports are blocked from git by the secret guard. Steps: [12.8](12-deployment-and-ops.md#128-backups-and-restore).

## 7.8 Secure development

- Secrets only via environment/secret store; `.env` and `.env.api` are git-ignored, and the pre-commit/pre-push guard plus gitleaks in CI refuse keys, env files and dumps. `npm audit` (production dependencies) and `pip-audit` run in CI; Dependabot proposes updates weekly.
- In docker compose the superuser password reaches only the database container; the app containers get their own role passwords.
- Branch protection, PR review, CI must pass.
- Least-privilege DB roles: `diu_app` (rider API, no DDL), `transport_admin` (dashboard, no profiles), `diu_migrator` (DDL, migrations only), `diu_reporting` (read-only).
