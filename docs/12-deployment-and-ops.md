# 12. Deployment and Operations

How to run the system for real, keep it healthy and recover it. Commands assume the repository is checked out on the server, for example in `/srv/diu-transport`.

## 12.1 Environments

| Environment | Database | University systems | Payments | Purpose |
|---|---|---|---|---|
| Development (laptop) | PGlite in `apps/api/.data` (no server needed) | Mock SSO and directory | Mock gateway | Building and demoing |
| CI | PGlite, plus PostgreSQL 16 with the production roles | Mocks | Mock | Every push and pull request |
| Staging | PostgreSQL 16 (docker compose) | DIU test SSO and directory | SSLCommerz **sandbox** | Pilot with the transport office |
| Production | PostgreSQL 16 (compose, or managed) | DIU SSO and directory | SSLCommerz live | Everyone |

The API **refuses to start in production** with a mock SSO, directory or gateway, or without `JWT_SECRET`, `DATA_ENCRYPTION_KEY`, `DATABASE_URL` and `ML_SERVICE_TOKEN`.

## 12.2 First deployment (one machine, docker compose)

Machine: 4 vCPU, 8 GB RAM, 80 GB SSD, Ubuntu 24.04 with Docker. Enough for the whole university at MVP stage (see 12.6).

1. **DNS.** Point two names at the machine, e.g. `transport.daffodilvarsity.edu.bd` (web) and `api.transport.daffodilvarsity.edu.bd` (API).
2. **Ask IT for the integrations** ([10.1](10-risks-and-assumptions.md)): OIDC client with redirect URI `https://<api domain>/auth/sso/callback`; a directory API token; an SSLCommerz store with IPN URL `https://<api domain>/payments/sslcommerz/ipn`.
3. **Settings.**
   ```bash
   cp .env.example .env            # database passwords, ML token, domains
   cp .env.api.example .env.api    # app settings and integration secrets
   chmod 600 .env .env.api
   ```
   Replace every `change-me` value. Generate each secret separately (commands are in the files). Keep a copy of `DATA_ENCRYPTION_KEY` with the database backup key: without it, 2FA seeds and QR seeds in a restored database cannot be read.
4. **Start.**
   ```bash
   docker compose --profile edge up -d --build
   docker compose ps          # all services healthy
   curl https://<api domain>/ready
   ```
   On the first start Postgres creates the least-privilege roles (`infra/postgres/10-roles.sh`), the API migrates as `diu_migrator`, applies `grants.sql`, and creates the main admin from `BOOTSTRAP_ADMIN_*`.
5. **First sign-in.** Open the web address → *Transport office*, sign in with the bootstrap ID and password, scan the 2FA QR with an authenticator app, choose a new password. Then **delete the three `BOOTSTRAP_ADMIN_*` lines** from `.env.api` and `docker compose up -d api`.
6. **Enter the transport data** in the dashboard: semester, fee rules, operators and buses (with seat counts), routes with stops and durations, time slots, calendar, routine sources. Add co-admins with only the permissions they need.
7. **Backups** (12.8) before anyone pays.
8. **Mobile app** (12.4).

Without the `edge` profile the app listens on `127.0.0.1:8080` (web) and `127.0.0.1:4000` (API) only, for when the university already has a reverse proxy. That proxy must replace `X-Forwarded-For` (the API trusts exactly one hop) and pass WebSocket upgrades for `/realtime`.

### Managed PostgreSQL instead of the compose database

1. Create database `diu_transport`. As the admin user, run `psql "<admin url>/diu_transport" -f apps/api/drizzle/roles.sql` (on RDS/Cloud SQL first `GRANT diu_migrator TO <admin user>;`, see the file).
2. Set passwords: `ALTER ROLE diu_migrator PASSWORD '…'` and the same for `diu_app`, `transport_admin`, `diu_reporting`.
3. In the API environment set `MIGRATION_DATABASE_URL` (diu_migrator), `DATABASE_URL` (diu_app) and `ADMIN_DATABASE_URL` (transport_admin), with `?sslmode=require`. Remove the `postgres` service from compose.

## 12.3 Configuration reference (API)

| Variable | Required in production | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | yes (`production`) | development | |
| `PORT` | | 4000 | |
| `TRUST_PROXY` | behind a proxy | false | Trusts one hop of `X-Forwarded-For` |
| `PUBLIC_API_URL` | yes | http://localhost:4000 | Used for SSO and gateway callbacks |
| `WEB_APP_URL` | yes | http://localhost:5173 | Redirect target after sign-in and payment |
| `CORS_ORIGINS` | yes | http://localhost:5173 | Comma-separated |
| `MOBILE_REDIRECT_URI` | | diutransport://auth | Must match the app scheme |
| `DATABASE_URL` | yes | (PGlite) | Rider-facing role `diu_app` |
| `ADMIN_DATABASE_URL` | recommended | = DATABASE_URL | Authority role `transport_admin` |
| `MIGRATION_DATABASE_URL` | with restricted roles | = DATABASE_URL | Owner role `diu_migrator`, migrations only |
| `JWT_SECRET` | yes | random per run | ≥ 32 characters |
| `DATA_ENCRYPTION_KEY` | yes | random per run | base64 of exactly 32 bytes |
| `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_DAYS` | | 900, 30 | |
| `SSO_MODE` | yes (`oidc`) | mock | |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | yes | | From IT |
| `OIDC_SCOPES`, `OIDC_UNIVERSITY_ID_CLAIM` | | `openid profile email`, `university_id` | |
| `DIRECTORY_MODE` | yes (`http`) | mock | |
| `DIRECTORY_BASE_URL`, `DIRECTORY_TOKEN` | yes | | From IT |
| `PAYMENT_GATEWAY` | yes (`sslcommerz`) | mock | |
| `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD` | yes | | From Accounts |
| `SSLCOMMERZ_SANDBOX` | | true | Set `false` only for live money |
| `ML_SERVICE_URL`, `ML_SERVICE_TOKEN` | yes | http://localhost:8000 | Same token in the ML service |
| `PUSH_PROVIDER`, `EXPO_ACCESS_TOKEN` | for push | console | `expo` in production |
| `BOOTSTRAP_ADMIN_ID`, `_NAME`, `_PASSWORD` | first start only | | Remove after first sign-in |

ML service: `ML_SERVICE_TOKEN`, `ENV=production` (hides `/docs`), `MODEL_DIR`, `ALLOWED_FETCH_HOSTS` (routine download allow-list). Web build: `VITE_API_URL`. Mobile build: `EXPO_PUBLIC_API_URL`.

## 12.4 Mobile app releases

The app is built with Expo Application Services (EAS); the profiles are in [`apps/mobile/eas.json`](../apps/mobile/eas.json).

```bash
cd apps/mobile
npx eas login                     # the university's Expo account
npx eas init                      # once: links the project
npx eas build -p android --profile preview      # installable APK for the pilot
npx eas build -p android --profile production   # Play Store bundle
```

Set `EXPO_PUBLIC_API_URL` in `eas.json` (or EAS environment variables) to the HTTPS API address. A release build that points anywhere else shows an error screen instead of half-working. To build a bundle locally, use `npm run bundle:android`: it clears Metro's cache, because a stale cache once produced an app pointing at `localhost`. Upgrade Expo SDKs with `npx expo install --fix`, never by bumping single native packages.

## 12.5 Scheduled jobs

The `jobs` container runs these (Asia/Dhaka time):

| Time | Job | Does |
|---|---|---|
| 00:10 | `expiry` | Expires cards after their semester and day passes after their date; deletes used one-time codes and refresh tokens a week after expiry |
| 03:00 | `gps-retention` | Deletes raw GPS pings older than 90 days |
| 05:00 | `routine-sync` | Checks department routine URLs; changed files wait for review |
| 05:30 | `forecast` | Today + 7 days |
| 10:00 | `renewal-reminders` | Push 14, 7 and 1 days before the semester ends |
| 13:00 | `forecast-midday` | Refreshes the afternoon and evening trips |

Run one by hand: `docker compose exec jobs node dist/jobs/worker.js --run=forecast`. Each run logs `job done` with a result, or `job failed`.

## 12.6 Capacity and scaling

Peak load is the morning: most riders open the app between 6:30 and 8:30 AM to see their bus. Schedules and allocations change rarely, so the public schedule is cached for 60 s and routes for 5 minutes; card QR codes are generated on the phone and work offline.

- **One machine** (above) is the plan for launch. Load-test it before the pilot with the expected peak (for example 5,000 riders opening the app within 15 minutes) and watch API latency and database CPU.
- **Scale up first**: more CPU/RAM for the API and database.
- **Scale out later**: several API containers behind the proxy need the Socket.IO Redis adapter so live events reach every container. That adapter is **not wired yet**; until it is, run one API container.
- The ML service is CPU-only and runs a few times a day; it does not need scaling.

## 12.7 Monitoring

| Check | How | Alert when |
|---|---|---|
| API up | `GET /health` (container healthcheck) | Down for 2 minutes |
| Database reachable | `GET /ready` | Fails |
| Errors | JSON logs (`docker compose logs api`); every error response has a `requestId` that is in the log line | 5xx more than 1% of requests for 5 minutes |
| University systems | Log lines with `upstream_unavailable` | Repeated for 10 minutes: tell IT |
| Payments | `ipn` log lines; dashboard Payments page | An IPN outcome other than success/failed, or paid money with an inactive card |
| Jobs | `job failed` log lines | Any |
| Backups | The backup log | No `backup ok` line in the last 26 hours |
| Disk | Host monitoring | > 80% |

Logs never contain request bodies, cookies or authorization headers.

## 12.8 Backups and restore

```bash
# Nightly, from host cron (encrypts to the backup public key; keeps 14 days)
30 2 * * * cd /srv/diu-transport && BACKUP_GPG_RECIPIENT=transport-backup scripts/backup-db.sh >> /var/log/diu-backup.log 2>&1

# Monthly drill: restore the latest backup into a scratch database and check counts
scripts/restore-db.sh backups/diu_transport_<date>.dump.gpg

# Disaster: stop api and jobs, restore over the live database, start again
docker compose stop api jobs
scripts/restore-db.sh backups/diu_transport_<date>.dump.gpg --live
docker compose start api jobs
```

- Copy `backups/` off the machine every night (another server or object storage).
- The private backup key and a copy of `DATA_ENCRYPTION_KEY` are kept offline by IT, not on this machine.
- The restore re-applies the database roles and grants, so the authority role still cannot read rider profiles afterwards (tested).
- ML models are files in the `models` volume; a lost model is rebuilt by retraining (12.9) and the service falls back to the routine count meanwhile.

## 12.9 ML retraining

Weekly, after enough boarding scans exist (at least 44 days):

```bash
docker compose exec api node dist/db/export-training.js /tmp/training-export.json
docker compose cp api:/tmp/training-export.json ./training-export.json
docker compose cp ./training-export.json ml:/tmp/training-export.json
docker compose exec ml python -m app.train --input /tmp/training-export.json
rm training-export.json
```

The export is pseudonymised but still personal data (file mode 600, ignored and blocked by git). The new model is served only if it beats the baseline and keeps P90 coverage ≥ 85%; otherwise the old one stays. Rollback: point `artifacts/latest.json` at the previous version.

## 12.10 Runbooks

**Riders cannot sign in ("University sign-in is not reachable").** DIU SSO or the directory is down (503 `upstream_unavailable`). Cards keep working: QR codes are generated offline and already signed-in riders stay signed in for 30 days. Tell IT; post a notice if it lasts.

**A rider paid but the card is not active.** Find the payment in *Payments* (or the rider in *Access lookup*). If the status is `initiated`, the IPN has not arrived: check the IPN URL in the SSLCommerz panel and the `ipn` log lines. If SSLCommerz shows the payment as valid, the IPN can be re-sent from the merchant panel; the API validates it again and activates the card once. Never activate by hand without the gateway record.

**The ML service is down.** The dashboard keeps showing the last forecast; *Suggest allocation* falls back to the simple greedy plan; publishing still works. `docker compose logs ml`, then `docker compose restart ml`.

**A bus breaks down.** *Fleet → mark unavailable* for the dates. The API answers with the dates on which that bus is already allocated; replace it in those allocations (it no longer appears as available) and publish; riders on those routes get a push. Add a route notice if the trip will be late.

**Strike, flood or sudden closure.** Add a calendar event with *cancels service* for the day and publish a notice to everyone. The forecast and allocations for that day stop.

**An admin's phone or laptop is lost.** The Main Admin deactivates that account in *Admins* (all its sessions end at once), then creates a new one with a new 2FA enrolment. If the **Main Admin** loses theirs, or no admin with `admins.manage` is left, IT runs the break-glass reset on the server:
```bash
docker compose exec api node dist/db/reset-admin.js 710215 "Lost phone, IT ticket 1234"
```
It prints a temporary password once, forces a new password and a new 2FA enrolment at the next sign-in, signs out every session, and writes the reason to the audit log.

**A secret may have leaked.** Rotate it where it was issued, update `.env`/`.env.api`, `docker compose up -d`. Effects: new `JWT_SECRET` signs everyone out; new `ML_SERVICE_TOKEN` must go to `api`, `jobs` and `ml` together; new database role passwords need `ALTER ROLE` first. `DATA_ENCRYPTION_KEY` cannot be rotated yet (no re-encryption tool): if it leaks, admins re-enrol 2FA and riders' QR seeds are reissued — plan this before go-live.

**A commit is blocked by the secret guard.** It found a key, an `.env` file, a dump or a training export. Remove it from the commit; if it was a real secret that was ever pushed anywhere, rotate it.

## 12.11 Releases

1. Changes go to `main` through pull requests; CI must pass (secret scan + gitleaks, unit and API tests on PGlite **and** on PostgreSQL with production roles, web build, ML tests, mobile typecheck and Android bundle, dependency audit).
2. Take a backup (`scripts/backup-db.sh`), then on the server: `git pull && docker compose up -d --build`. The API applies new migrations and grants at start; the worker never migrates.
3. Check `/ready`, sign in, open today's allocation.
4. Rollback: `git checkout <previous tag> && docker compose up -d --build`. If a migration was destructive, restore the backup taken in step 2.

Dependabot proposes weekly updates for the API/web workspace, the ML service and GitHub Actions; the mobile app gets security updates only (Expo SDK upgrades are done by hand), and PuLP stays below 4 until the image installs the CBC solver itself.

## 12.12 Go-live checklist

- [ ] `.env` / `.env.api` complete, mode 600, no `change-me` left; `BOOTSTRAP_ADMIN_*` removed after first sign-in
- [ ] `SSLCOMMERZ_SANDBOX=false` only after a full sandbox test (pay, IPN, card active, refund path agreed)
- [ ] OIDC redirect URI and SSLCommerz IPN URL registered with the right domain
- [ ] HTTPS works on both domains; HTTP redirects to HTTPS
- [ ] Every co-admin has 2FA and only the permissions they need
- [ ] Nightly backup running, copied off-site, and one restore drill done
- [ ] `DATA_ENCRYPTION_KEY` and the backup private key stored offline by IT
- [ ] Load test at the expected morning peak passed
- [ ] Privacy notice in the app approved by the Registrar ([10.1](10-risks-and-assumptions.md) item 4)
- [ ] Transport office trained on allocation, publishing and the runbooks above
