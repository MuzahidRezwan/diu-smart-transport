# 1. Requirements Specification

Version 0.1 · Scope: Daffodil International University (DIU) transport, main campus Daffodil Smart City (DSC), Ashulia.

## 1.1 Actors

| Actor | Description |
|---|---|
| **Main Admin** | Transport head. Full access. Manages co-admins and their permissions. |
| **Co-Admin** | Transport office staff with a subset of permissions (e.g. allocation only, card approval only). |
| **Student** | Any enrolled student (tri-semester, bi-semester, thesis-only, short-course, hall resident). |
| **Faculty / Admin staff** | Teachers and university officers. Has a faculty bus service and can optionally follow the student schedule. |
| **Driver / Supervisor** (proposed) | Scans boarding QR codes, starts/ends trips. Gives us the ground truth for the ML model. |
| **GPS device** | Hardware tracker on each bus that posts location pings. |
| **External systems** | University SSO, student/faculty info API, payment gateways, push/SMS/email providers, maps. |

## 1.2 Functional requirements

### FR-1 Authentication & accounts
- FR-1.1 Students, faculty and staff sign in with their **official university account through the university SSO** (OIDC/OAuth2 preferred). The system never sees or stores the university password when OIDC is available.
- FR-1.2 On first sign-in, profile data is pulled from the university info API: name, ID, department, batch, section, phone (students); name, ID, department, designation, teacher initial, phone (faculty/staff).
- FR-1.3 Users stay signed in through rotating refresh tokens (30 days, revocable per device).
- FR-1.4 Authority users sign in with ID + password + **TOTP 2FA** (mandatory for every authority account).
- FR-1.5 The Main Admin can create, suspend and delete co-admins and assign permissions individually or by preset.

### FR-2 Fleet, routes and schedule
- FR-2.1 Manage operators (Hanif `H`, Monir `M`, Surjomukhi `S`, more later) with **configurable seat capacity per bus** (not per operator: two Hanif buses may differ).
- FR-2.2 Manage buses: code (`H-10`), operator, seat capacity, registration number, driver name/phone, GPS device ID, active flag.
- FR-2.3 Mark buses unavailable for a date range (maintenance, breakdown, operator holiday).
- FR-2.4 Manage routes (regular routes and shuttles) with ordered stops, coordinates and the map path.
- FR-2.5 Manage time slots per route: direction (to campus / from campus), departure time, audience (student / faculty), active weekdays, semester.

### FR-3 Demand prediction (ML)
- FR-3.1 Show today's predicted totals: students in/out, faculty in/out.
- FR-3.2 Show predicted demand for **each route × direction × slot × audience** for today and the next 7 days.
- FR-3.3 Convert demand to required buses: only-H, only-M, only-S and a mixed combination, based on the real capacities of available buses.
- FR-3.4 The prediction is a **suggestion**. Authority edits are final and are logged as feedback for the model.
- FR-3.5 Class routines are ingested daily (scraper + manual upload), validated by a human before they replace the active routine.

### FR-4 Bus allocation
- FR-4.1 Allocate buses to a slot on a date, as **draft → published → (edited) → cancelled**.
- FR-4.2 Publish a **whole day** at once, or **one slot at a time**, and edit later.
- FR-4.3 A bus already allocated to a slot cannot be allocated to an overlapping slot (time window = departure → arrival + turnaround).
- FR-4.4 Faculty and student buses are allocated separately.
- FR-4.5 "Suggest allocation" fills a draft with the optimizer's plan; the authority can change it before publishing.
- FR-4.6 Publishing or changing an allocation notifies the affected route's subscribers.

### FR-5 Transport card (semester subscription)
- FR-5.1 A user applies for a transport card for the current semester by choosing their route, then pays the fee through a payment gateway.
- FR-5.2 Fee amount comes from **configurable fee rules** per semester × user category (tri-semester student, bi-semester student, thesis-only, short-course, faculty, admin staff, hall resident).
- FR-5.3 A successful, **server-verified** payment auto-approves the card. Otherwise the request waits for manual approval.
- FR-5.4 Authority can grant a card without payment (free access) with a reason; this is audit-logged.
- FR-5.5 Authority can revoke a card.
- FR-5.6 The digital card shows photo, name, department, ID, route, issue and expiry date, and a **signed, rotating QR code** for boarding.
- FR-5.7 Cards expire at the end of the semester; renewal reminders are sent before that.
- FR-5.8 **Payments & collection report** for the authority: pick a day (or a date range) and see how many riders paid, the total collected, a breakdown by payment method and by rider type, failed/pending and refunded counts, and whether the day matches the gateway settlement.
- FR-5.9 The list (date, time, transaction ID, university ID, name, rider type, route, semester, amount, method, status) can be **downloaded as Excel (.xlsx) or CSV**, filtered by status and method. The file never contains phone, email or department. Download needs the `payments.export` permission and every download is audit-logged.

### FR-6 One Day Pass
- FR-6.1 A user without an active card can request a one-day pass for a date and route.
- FR-6.2 The first N requests per semester (N configurable, default 1) are auto-approved; requests beyond N are rejected, or queued for manual approval if the authority enables that.
- FR-6.3 A pass is valid only on its date and is marked used on first boarding scan.

### FR-7 User app (student/faculty)
- FR-7.1 Free users: route schedule (times only, no bus numbers), route map, apply for card, one day pass, contacts.
- FR-7.2 Card holders: "My Bus" home with the next relevant departure and its allocated buses, today's full schedule for their route, route map, shuttle card, live map, digital card, notifications.
- FR-7.3 Faculty see the faculty schedule by default and can add the student schedule of any route to their dashboard.
- FR-7.4 Complaints & suggestions, help requests, contacts, useful links.

### FR-8 Live tracking
- FR-8.1 GPS devices post location pings; the authority sees all buses on a map, and can search by bus or route.
- FR-8.2 Card holders see live positions of buses allocated to their route.
- FR-8.3 Location is shown only while a bus is on an active trip.

### FR-9 Communication
- FR-9.1 Authority publishes notices to all users, one audience (students/faculty), or one route. Users get a push notification and see it in the in-app notice board.
- FR-9.2 Complaints and help requests have a status workflow (open → in progress → resolved → closed) with authority replies and unread badges.

### FR-10 Administration
- FR-10.1 **Transport access lookup** by the **full** university ID only (no name/phone search, no partial IDs, no list browsing). The result shows only the transport record: ID, name, rider type, route, card/pass status. Grant free access or revoke access from there.
- FR-10.1a The lookup also shows that rider's **transport history**: total paid, last payment, every payment attempt (date, time, transaction ID, semester, amount, method, status, failure reason), transport cards per semester (status, validity, paid or granted), One Day Pass history, and every access change made by the transport office with the admin's name and reason. The transaction IDs match the Payments & collection report.
- FR-10.2 Audit log for every authority action (who, what, when, before/after). Granting, revoking and approving without payment require a written reason.
- FR-10.3 Activity feed for the authority home tab (new card requests, payments, complaints, published allocations).
- FR-10.4 Reports: ridership by route/slot/day, fee collection, prediction accuracy, complaints by category. Reports are aggregated; they never list individual riders.
- FR-10.5 "Preview the app" opens the student/faculty app with a **sample account in read-only mode**. It never opens a real rider's account.

### FR-11 Authority data boundary (privacy)
- FR-11.1 Authority users (main admin and co-admins) **cannot view student or faculty profiles**: no phone, email, department, batch, section, photo, results or other university data.
- FR-11.2 Authority users **cannot sign in as, impersonate, or act inside** a rider's account, and cannot edit any rider profile field. There is no permission for this, so the main admin cannot grant it either.
- FR-11.3 Authority users change only transport-owned records: allocations, schedules, fleet, fee rules, notices, card and day-pass status, ticket replies.
- FR-11.4 Complaints and help requests are shown by ticket number and route. Replies reach the rider inside the ticket in their app, so the authority never needs their contact details.
- FR-11.5 What riders see is exactly what the authority **published**: drafts are never sent to the app, and a deleted allocation disappears from the app.

## 1.3 Non-functional requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-1 | Performance | p95 API latency < 300 ms for read endpoints at peak; the "My Bus" screen loads in < 2 s on a 3G connection. |
| NFR-2 | Scalability | Handle ~30,000 registered users and peak bursts of ~5,000 concurrent app opens (07:00–08:30, 16:00–18:00). Stateless API, horizontally scalable. |
| NFR-3 | Availability | 99.5% monthly during semester; graceful degradation if ML or GPS is down (last good prediction / schedule-only mode). |
| NFR-4 | Security | OWASP ASVS L2 for the API; 2FA for authority; least-privilege RBAC; secrets in a vault, never in git. |
| NFR-5 | Privacy | Live location only for buses (never for users). Personal data minimized and retained per policy. Compliant with Bangladesh's personal data protection rules as they apply. |
| NFR-6 | Auditability | Every authority write is audit-logged and immutable for at least 2 years. |
| NFR-7 | Correctness | Payments are idempotent; the card status is changed only from a gateway-validated transaction. |
| NFR-8 | Usability | Bangla and English; works on low-end Android; key actions reachable in ≤ 2 taps. |
| NFR-9 | Accessibility | WCAG 2.1 AA for the web dashboard; large tap targets and screen-reader labels in the app. |
| NFR-10 | Maintainability | Typed contracts shared by API, web and app; > 70% unit test coverage on business rules; CI on every push. |
| NFR-11 | Observability | Structured logs, request IDs, metrics (latency, error rate, prediction error), alerts. |
| NFR-12 | Data retention | GPS pings: 90 days raw, then aggregated. Boarding events: 3 years (model training). Payments: per finance policy (≥ 5 years). |

## 1.4 Assumptions (to confirm, see [10-risks-and-assumptions.md](10-risks-and-assumptions.md))

1. DIU can provide an SSO/OIDC endpoint or an authenticated API to validate students and faculty, plus a read API for profile data.
2. A route has a fixed set of slots per semester; the authority can still add ad-hoc slots.
3. "Students In" means people travelling **to** DSC; "Students Out" means **from** DSC.
4. One transport card covers one home route; changing route is a request the authority approves.
5. Hall residents mostly use shuttles and are a separate fee category.
6. The bus operators accept a GPS tracker (or a driver phone app as a fallback) on every bus.
