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
| 8 | **Routes, stops and slot timings** for each semester; shuttle details; stop coordinates and travel time per route | Transport office | Schedule and map. The seeded timetable is copied from the public transport page (see 10.2), but stop positions and trip durations are estimates. |
| 9 | **Routine sources**: which departments publish where, in what format; a contact per department | Departments / Academic affairs | Ingestion. Ideally, an agreement to upload in our template. |
| 10 | **Academic calendar** (holidays, exams) in a machine-readable form | Academic affairs | Prediction features. |
| 11 | **GPS**: permission to install trackers (or use supervisor phones), who pays, which vendor | Transport office + operators | Live tracking. |
| 12 | **Supervisor/driver phones** for boarding scans | Transport office | Ground truth for ML. |
| 13 | **Hosting**: university data centre or cloud; domain (e.g. `transport.daffodilvarsity.edu.bd`), SSL | IT division | Deployment. |
| 14 | **Support process**: who answers complaints/help requests, response time | Transport office | Workflow ownership. |

## 10.2 Assumptions made in this design

1. One active transport card per user per semester, tied to one home route; it allows riding any slot of that route and the shuttle. The boarding scan enforces this ("Card is for the Mirpur route"). Confirm with the transport office whether riders may sometimes take another route; if so, it is a one-line change in `apps/api/src/modules/boarding/routes.ts`.
2. Faculty buses and student buses are separate pools by default, but any bus can be assigned to either if the authority chooses.
3. A bus's busy window = departure time → arrival at the other end + 30 min turnaround (configurable per route).
4. "Day pass" is valid for one date and one route, both directions.
5. Fee rules are flat amounts per semester and category (no distance-based pricing).
6. Departments' routines identify student groups by **batch + section** (e.g. `41_G`) and teachers by **initial**.
7. Users travel on the latest morning slot that reaches campus before their first class, and the first evening slot after their last class.
8. Hall residents may still use routes on weekends; they have their own fee category.
9. **Timetable.** The seed uses DIU's published schedule ([daffodilvarsity.edu.bd/transport](https://daffodilvarsity.edu.bd/transport), "Transport Schedule Final Exam, Semester: Spring-2026", last updated 2026-04-23): 10 regular routes (R1–R10) and 3 shuttles (R11–R13), to DSC at 7:00 AM, 10:00 AM and 1:00 PM and back at 11:20 AM, 2:30 PM and 5:30 PM, Saturday to Thursday, with the remarks on partial trips. Buses **do run on Friday**: to DSC at 7:30 AM, back at 11:30 AM and 4:30 PM (Savar route 11:50 AM and 4:50 PM). No weekday is treated as a holiday in code; a day without trips is simply a day with no slots, and holidays come from the academic calendar. The source lives in `apps/api/src/db/diu-timetable.ts`; tests use a small separate sample timetable. Confirm the current semester's timetable before go-live.
10. The website's Friday table (F1 to F4, with F4 printed twice) is attached to the matching regular routes so riders keep their home route: F1 → R1 Dhanmondi, F4 → R2 Uttara-Rajlokkhi, F2 → R3 Tongi College Gate, F3 → R8 Savar, and the second F4 (Mirpur-10 → Sony) → R11. Where the Friday path differs, the trip carries a note. Confirm this mapping with the transport office.
11. The 4:20 PM bus ("only for employees") is a staff-only trip. Every other trip is a regular trip that students and staff both ride, so staff demand and staff schedules include them.

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
