# 10. Risks, Assumptions and What to Get from the University

## 10.1 What to ask the university for (before writing production code)

| # | Item | From whom | Why |
|---|---|---|---|
| 1 | **Written approval** to build and pilot the system, and who the product owner is | Transport head / Registrar | Nothing goes live without it. |
| 2 | **SSO access**: OIDC client ID/secret (or SAML), redirect URLs, test accounts | IT division | Login with the official account. If impossible, a credential-verification API over a secure channel. |
| 3 | **Student & faculty info API** (read-only): ID, name, department, program type, batch, section, phone, photo, teacher initial, designation | IT division / Registrar | Profile + fee category + routine matching. |
| 4 | **Data-sharing agreement / privacy policy approval** | Registrar / legal | We process personal data and payments. |
| 5 | **Fee rules** per category and semester, refund rules, free-access policy | Accounts + transport office | Configured in the fee rules table. |
| 6 | **Payment merchant account** (SSLCommerz store ID or bKash merchant) in the university's name, and where money settles | Accounts | We must not collect money into a personal account. |
| 7 | **Bus list**: code, operator, seat count, registration, driver contact; Surjomukhi seat counts | Transport office | Capacity planning. |
| 8 | **Routes, stops and slot timings** for each semester; shuttle details | Transport office | Schedule and map. |
| 9 | **Routine sources**: which departments publish where, in what format; a contact per department | Departments / Academic affairs | Ingestion. Ideally, an agreement to upload in our template. |
| 10 | **Academic calendar** (holidays, exams) in a machine-readable form | Academic affairs | Prediction features. |
| 11 | **GPS**: permission to install trackers (or use supervisor phones), who pays, which vendor | Transport office + operators | Live tracking. |
| 12 | **Supervisor/driver phones** for boarding scans | Transport office | Ground truth for ML. |
| 13 | **Hosting**: university data centre or cloud; domain (e.g. `transport.daffodilvarsity.edu.bd`), SSL | IT division | Deployment. |
| 14 | **Support process**: who answers complaints/help requests, response time | Transport office | Workflow ownership. |

## 10.2 Assumptions made in this design

1. One active transport card per user per semester, tied to one home route; it allows riding any slot of that route (and the shuttle).
2. Faculty buses and student buses are separate pools by default, but any bus can be assigned to either if the authority chooses.
3. A bus's busy window = departure time → arrival at the other end + 30 min turnaround (configurable per route).
4. "Day pass" is valid for one date and one route, both directions.
5. Fee rules are flat amounts per semester and category (no distance-based pricing).
6. Departments' routines identify student groups by **batch + section** (e.g. `41_G`) and teachers by **initial**.
7. Users travel on the latest morning slot that reaches campus before their first class, and the first evening slot after their last class.
8. Hall residents may still use routes on weekends; they have their own fee category.

## 10.3 Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| University does not grant SSO/API access | Medium | High | Start with the mock provider; fallback to CSV import of student lists each semester; keep the auth module behind an interface. |
| Routines published in inconsistent PDF/image formats | **High** | High | Template upload as the primary path; scrapers as a convenience; human review before activation; OCR only as a last resort. |
| Low boarding-scan adoption → no ground truth | Medium | High | Make scanning part of the supervisor's duty; offline scanning; show supervisors their scan rate; keep the rule-based baseline working without ML. |
| Demand far above fleet capacity at peak | High | Medium | The optimizer reports a shortfall per slot, so the authority can request extra buses or stagger slots; reports quantify the need. |
| Payment disputes / mismatches | Medium | High | Server-side validation, idempotent IPN, daily reconciliation report against the gateway settlement. |
| Peak-time load (thousands open the app at 7 AM) | High | Medium | Cache schedules/allocations (they change rarely), CDN, horizontal scaling, load test before launch. |
| GPS hardware cost / operator refusal | Medium | Medium | Supervisor phone GPS during trips as fallback. |
| Privacy complaints | Low | High | Bus-only tracking, minimal data, consent screen, retention limits, audit log. |
| Team turnover (students graduate) | High | High | Documentation (this folder), typed code, tests, handover checklist each semester. |
| Strikes, floods, sudden closures | Medium | Medium | Calendar override ("cancel all trips today") + bulk notice. |
