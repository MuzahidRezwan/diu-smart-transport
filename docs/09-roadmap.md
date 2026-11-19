# 9. Development Roadmap

Assumes a team of 4–6 students working part-time (~15 h/week each). Calendar weeks are rough.

## Team roles

| Role | Owns | People |
|---|---|---|
| Project lead / architect | Scope with the transport office, API design, code review, releases | 1 |
| Backend engineer | `apps/api`: auth, cards, payments, allocation, jobs | 1–2 |
| Frontend engineer | `apps/web` authority dashboard + user portal | 1 |
| Mobile engineer | `apps/mobile` user app + driver mode | 1 |
| ML / data engineer | `services/ml`, routine ingestion, data quality, evaluation | 1 |
| QA / DevOps (shared) | Test plans, CI, Docker, backups, monitoring | shared by the lead + backend |

## Phase 0 — Discovery & approvals (weeks 1–2)
- Meet the transport office; confirm every item in [10-risks-and-assumptions.md](10-risks-and-assumptions.md).
- Get written approval, SSO/API access (or at least a test tenant), fee rules, route/stop list, bus list.
- Collect 3–5 past routines from 3 departments to design the parser.
- Deliverable: signed-off requirements, sample data, UI wireframes.

## Phase 1 — MVP (weeks 3–10)
Goal: replace the paper/Facebook-post process for **one semester on 2–3 routes**.
1. Repo, CI, Docker, environments (done in this repo).
2. Auth: SSO (or mock), authority login + 2FA, RBAC, audit log.
3. Fleet, routes, stops, slots admin.
4. Transport card application + SSLCommerz sandbox payment + auto-approve; free grant; revoke.
5. One Day Pass with configurable limit.
6. Schedule & allocation: manual allocation with conflict checks, publish day/slot, notifications.
7. User app: My Bus, schedule, route map, digital card with rotating QR, notice board.
8. **Boarding scan** in driver mode (starts collecting ground truth on day 1).
9. Routine upload (CSV/XLSX template) + rule-based expected demand + bus calculator on the dashboard.
- Exit criteria: 2 routes live, > 80% of riders scanning, zero payment mismatches for 2 weeks.

## Phase 2 — Scale & intelligence (weeks 11–18)
- All routes and shuttles; faculty service.
- Department scrapers (PDF/HTML) with review queue; academic calendar.
- ML forecast model trained on ≥ 4 weeks of scans; P90-based suggestions; optimizer "Suggest allocation".
- GPS trackers + live map; delay alerts; dynamic dispatch view for evening rush.
- Reports (ridership, load factor, revenue, prediction accuracy), receipts, renewal reminders.
- Bangla localisation, offline card/schedule.

## Phase 3 — Polish & extend (weeks 19+)
- bKash direct, refunds, route change requests, seat reservation pilot, SOS, lost & found, operator billing reconciliation, traffic-aware ETA.
- Hardening: load test at 5k concurrent users, pen-test, disaster-recovery drill.

## Milestones

| Week | Milestone |
|---|---|
| 2 | Requirements signed off, access granted |
| 6 | Internal alpha: cards + payments (sandbox) + manual allocation |
| 10 | Pilot on 2–3 routes with real payments |
| 14 | All routes, scrapers, first trained model |
| 18 | GPS live tracking, reports, v1.0 release |

## Testing plan
- **Unit**: business rules (fee resolution, day-pass limit, allocation overlap, bus calculator, IPN validation) — Vitest/pytest, run on every push.
- **Integration**: API against PGlite/Postgres with seeded data; payment flow against SSLCommerz sandbox.
- **ML**: backtest on held-out weeks; must beat the baseline (expected × average show-up rate) on WAPE and under-capacity rate before promotion.
- **E2E**: Playwright for the dashboard happy paths; Maestro/Detox for the app (phase 2).
- **Load**: k6 script simulating the 07:00 rush (5k users opening My Bus within 10 minutes).
- **UAT**: transport office staff run the allocation flow for one week in parallel with the old process.
