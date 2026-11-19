# 2. System Architecture

## 2.1 Overview

```mermaid
flowchart LR
  subgraph Clients
    WEB[Web dashboard<br/>React + Vite<br/>authority + user portal]
    APP[Mobile app<br/>Expo / React Native<br/>student + faculty]
    DRV[Driver / supervisor<br/>QR scanner screen]
    GPS[GPS trackers<br/>on buses]
  end

  subgraph Edge
    CDN[CDN + static hosting]
    LB[HTTPS load balancer<br/>TLS, WAF, rate limit]
  end

  subgraph Core
    API[API service<br/>Node.js + Express<br/>REST + Socket.IO]
    JOBS[Scheduler / jobs<br/>routine sync, nightly forecast,<br/>reminders, expiry]
    ML[ML service<br/>Python + FastAPI<br/>parse, forecast, optimize]
  end

  subgraph Data
    PG[(PostgreSQL 16)]
    OBJ[(Object storage<br/>photos, routine files,<br/>model artifacts)]
  end

  subgraph External
    SSO[DIU SSO / OIDC]
    INFO[DIU student &<br/>faculty info API]
    PAY[SSLCommerz / bKash / Nagad]
    FCM[Firebase Cloud Messaging]
    SMS[SMS + email gateway]
    MAP[OpenStreetMap tiles<br/>or Google Maps]
    DEPT[Department routine<br/>web pages]
  end

  WEB --> CDN
  WEB --> LB
  APP --> LB
  DRV --> LB
  GPS -->|HTTPS pings, device key| LB
  LB --> API
  API --> PG
  API --> OBJ
  API <-->|internal HTTP, service token| ML
  JOBS --> API
  JOBS --> ML
  ML --> OBJ
  ML -->|fetch| DEPT
  API --> SSO
  API --> INFO
  API --> PAY
  PAY -->|IPN webhook| LB
  API --> FCM
  API --> SMS
  WEB --> MAP
  APP --> MAP
```

## 2.2 Components

| Component | Responsibility | Owns data? |
|---|---|---|
| **API** (`apps/api`) | Auth, RBAC, every business rule (cards, passes, fees, payments, allocation conflicts), REST endpoints, Socket.IO for live bus positions, push notifications, audit log. | Yes, the whole `public` schema. |
| **Jobs** (inside `apps/api`, `src/jobs`) | Cron-style tasks: daily routine sync, nightly 7-day forecast refresh, card expiry, renewal reminders, GPS ping retention. Runs in a separate process (`node dist/jobs/worker.js`) so it can be scaled to exactly 1 replica. | No (uses API services). |
| **ML service** (`services/ml`) | Stateless compute: parse routines (CSV/XLSX/PDF/HTML), compute rule-based expected demand, forecast real ridership with a gradient-boosting model, solve the bus allocation optimization. Stores only model artifacts. | Model artifacts only. |
| **Web** (`apps/web`) | Authority dashboard (prediction panel, allocation, approvals, live map, notices, admin management) and a browser version of the user portal. | No. |
| **Mobile** (`apps/mobile`) | Student/faculty app: My Bus, Live Route, My Card (QR), Notifications, side menu. Driver mode for boarding scans. | Offline cache only. |
| **Shared** (`packages/shared`) | TypeScript types, enums, permission catalogue, zod request schemas and the bus-requirement calculator, used by API, web and mobile. | No. |

**Why the ML service is stateless:** the API is the single owner of data. It gathers what the ML service needs (transport users, routine sessions, slots, history, calendar), sends it, and stores the result. This keeps one migration history, one backup and one place for access control, and lets the ML service be redeployed or retrained without touching the database.

## 2.3 Key flows

### Sign-in (student/faculty)
```mermaid
sequenceDiagram
  participant U as App/Web
  participant A as API
  participant S as DIU SSO (OIDC)
  participant I as DIU info API
  U->>A: GET /auth/sso/start
  A-->>U: redirect URL (state + PKCE)
  U->>S: user signs in on the university page
  S-->>U: redirect with ?code
  U->>A: POST /auth/sso/callback {code, state}
  A->>S: exchange code (server side)
  A->>I: fetch profile by university ID
  A->>A: upsert user, issue access JWT (15 min) + refresh token (30 d, rotating)
  A-->>U: tokens + profile
```

### Card purchase
```mermaid
sequenceDiagram
  participant U as User
  participant A as API
  participant G as SSLCommerz
  U->>A: POST /transport-cards {routeId}
  A->>A: resolve fee rule (semester x category), create card(pending_payment) + payment(initiated, tran_id)
  A->>G: create session (amount, tran_id, ipn_url)
  G-->>A: GatewayPageURL
  A-->>U: redirect to gateway
  U->>G: pays (bKash / card / Nagad)
  G->>A: POST /payments/sslcommerz/ipn (val_id, tran_id, ...)
  A->>G: validation API (val_id) + amount/currency/tran_id check
  A->>A: payment=success, card=active (idempotent), audit + push notification
```

### Daily prediction and allocation
```mermaid
sequenceDiagram
  participant J as Jobs
  participant A as API
  participant M as ML service
  participant Au as Authority
  J->>A: 05:00 run routine sync
  A->>M: /v1/routines/fetch for each source
  M-->>A: parsed sessions + content hash
  A->>A: new hash? store routine version as pending_review
  J->>A: 05:30 refresh forecast (today + 7 days)
  A->>M: /v1/forecast {users, sessions, slots, calendar, history}
  M-->>A: per route/slot/direction/audience: expected_max, predicted, p90
  A->>A: store predictions
  Au->>A: open dashboard, "Suggest allocation"
  A->>M: /v1/allocation/plan {demand, available fleet, windows}
  M-->>A: bus assignment per slot
  Au->>A: edit and publish
  A-->>Au: notify route subscribers (FCM)
```

## 2.4 Deployment view

- **Small (MVP, < 10k users):** one VM (4 vCPU / 8 GB) with Docker Compose: `api`, `jobs`, `ml`, `web` (static via Caddy/Nginx), `postgres` with daily off-site backups.
- **Production:** API ×2–4 replicas behind a load balancer, Socket.IO with the Redis adapter, managed PostgreSQL with a read replica for reports, ML ×1 (CPU is enough), object storage (S3-compatible), CDN for the web build. See [12-deployment-and-ops.md](12-deployment-and-ops.md).

## 2.5 Repository layout

```
apps/
  api/        Express API + jobs worker (TypeScript, Drizzle ORM)
  web/        Authority dashboard + user portal (React, Vite, Tailwind)
  mobile/     Student/faculty app (Expo, React Native)
packages/
  shared/     Types, enums, permissions, zod schemas, bus calculator
services/
  ml/         FastAPI service: routine parsing, forecasting, optimization
docs/         This specification
infra/        Docker, Caddy, deployment notes
```
