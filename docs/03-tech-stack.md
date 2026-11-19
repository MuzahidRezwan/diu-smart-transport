# 3. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Language (apps) | **TypeScript** everywhere except ML | One language for API, web and mobile; types are shared in `packages/shared`, so a changed field breaks the build instead of production. Easy to hire/teach at DIU. |
| API framework | **Express 5** | Small, well known, async error handling built in (v5). Modules are plain folders (`routes.ts`, `service.ts`, `schemas.ts`), easy for a student team to follow. NestJS is a fine alternative if the team already knows it. |
| Validation | **zod** | Same schemas validate requests in the API and forms in web/mobile. |
| Database | **PostgreSQL 16** | Relational data with strong constraints (unique allocations, foreign keys), JSONB for gateway payloads, time ranges for overlap checks, mature backups and managed hosting everywhere. |
| ORM / migrations | **Drizzle ORM + drizzle-kit** | SQL-like, fully typed, no binary engine to download, generates plain SQL migrations you can review. Tests run on **PGlite** (Postgres compiled to WASM) so no DB server is needed in CI. |
| Auth | **OIDC (openid-client)** for DIU SSO, **JWT** (jose) access tokens, opaque rotating **refresh tokens**, **bcrypt** for authority passwords, **TOTP** (otplib) for 2FA | Standard, audited building blocks; no university password ever touches our DB. |
| Real-time | **Socket.IO** | Rooms per route for live bus positions; falls back to polling on bad networks; Redis adapter when scaling to many API instances. |
| Jobs | **node-cron** in a dedicated worker process | Enough for daily/nightly tasks; move to BullMQ + Redis when retries/queues are needed. |
| Web | **React 18 + Vite + Tailwind CSS + TanStack Query + React Router** | Fast dev server, small bundles, cache-aware data fetching. Dashboard is behind login, so SSR (Next.js) brings little benefit. |
| Maps | **Leaflet + OpenStreetMap** tiles (react-leaflet / react-native-maps) | Free, no API key for MVP. Switch to Google Maps or a paid OSM tile provider when traffic grows (OSM's public tiles have a fair-use policy). |
| Mobile | **Expo (React Native) + Expo Router** | One codebase for Android and iOS, OTA updates for quick fixes, expo-notifications for FCM, expo-camera for QR scanning, shares types and the API client with web. |
| ML | **Python 3.11+, FastAPI, pandas, scikit-learn (HistGradientBoosting), PuLP (CBC solver)** | Mature ecosystem; HistGradientBoosting handles tabular data, categorical features and quantile loss with no extra native libs; PuLP ships the CBC MILP solver for allocation. |
| Routine parsing | **pdfplumber, openpyxl, pandas.read_html, BeautifulSoup** | Covers the formats departments actually publish (PDF, Excel, HTML tables). |
| Payments | **SSLCommerz** first (covers bKash, Nagad, Rocket, cards in one integration), **bKash Tokenized Checkout** direct as phase 2 | SSLCommerz is the most common aggregator in Bangladesh; direct bKash lowers fees later. |
| Push | **Firebase Cloud Messaging** (via Expo push for the app) | Free, reliable on Android, topic per route. |
| SMS / email | Any BD SMS gateway (e.g. SSL Wireless, BulkSMSBD) behind an interface; SMTP or a transactional email provider | OTPs, renewal reminders, payment receipts. |
| Testing | **Vitest + Supertest** (API, shared), **pytest** (ML) | Fast, TypeScript-native. |
| Infra | **Docker, Docker Compose**, Caddy (automatic HTTPS), GitHub Actions CI | Reproducible, cheap to run on one VM, easy upgrade path to Kubernetes/managed services. |
| Observability | pino structured logs, request IDs, `/health` + `/ready`, Prometheus metrics (phase 2), Sentry for app crashes | Find problems before students complain. |
