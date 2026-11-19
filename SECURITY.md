# Security Policy

## Secrets never go into git

This repository is **public**. Passwords, API keys, payment-gateway credentials, JWT secrets, database URLs with real passwords, Firebase service accounts and private keys must never be committed.

| Where real values live | How |
|---|---|
| Your machine | `.env` files (git-ignored). Copy the matching `.env.example` and fill it in. |
| Servers | Environment variables from the host's secret store (e.g. Docker secrets, GitHub Actions secrets, cloud secret manager). |
| CI | GitHub → Settings → Secrets and variables → Actions. |

### Four layers stop a leak

1. **`.gitignore`** ignores `.env*` (except `.env.example`), keys (`*.pem`, `*.key`, `*.p12`, `*.jks`…), service-account JSON, Firebase config, database dumps and registry credentials.
2. **pre-commit hook** (`.githooks/pre-commit`) runs `scripts/check-secrets.mjs --staged` and blocks a commit that adds a forbidden file or a value that looks like a real secret (private keys, GitHub/AWS/Google tokens, JWTs, `*_SECRET=...` / `*_PASSWORD=...` with a real-looking value, database URLs with a password for a non-local host).
3. **pre-push hook** (`.githooks/pre-push`) scans **every line in the whole history** before anything is pushed.
4. **CI** runs the same scanner plus [gitleaks](https://github.com/gitleaks/gitleaks) on every push and pull request. GitHub **secret scanning + push protection** should be on in the repository settings.

The hooks are installed automatically by `npm install` (the `prepare` script sets `core.hooksPath`). Run a full scan any time with:

```bash
npm run secrets:check
```

### If a secret was committed

1. **Rotate it first** (change the password / revoke the key). Removing it from git is not enough: assume it is already copied.
2. Remove it from history (`git filter-repo`), force-push, and tell the maintainers.
3. Add a rule to `scripts/check-secrets.mjs` if the scanner missed it.

## Personal data

- Never commit real student/faculty data, payment exports, database dumps or screenshots that show real IDs. Use the synthetic data generator in `services/ml` and the seed script in `apps/api`.
- Payment exports (Excel/CSV) downloaded from the dashboard stay on the finance office's machines.

## Reporting a vulnerability

Please do **not** open a public issue. Email the maintainer (see the GitHub profile) with steps to reproduce. We aim to respond within 72 hours.
