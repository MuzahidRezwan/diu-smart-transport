# 5. API Reference

Base URL: `PUBLIC_API_URL` (for example `https://api.transport.diu.edu.bd`). JSON in and out, UTF-8. Dates are `YYYY-MM-DD` in Asia/Dhaka; times of day are minutes after midnight in storage and `h:mm AM` labels in responses meant for display.

Request bodies are validated with the zod schemas in [`packages/shared/src/schemas.ts`](../packages/shared/src/schemas.ts); the web dashboard and mobile app import the same schemas, so client and server never disagree on a field.

## 5.1 Conventions

**Authentication.** `Authorization: Bearer <access token>` (JWT, 15 minutes). Web keeps the refresh token in an `HttpOnly` cookie (`diu_rt`, path `/auth`); the mobile app sends it in the body of `/auth/refresh`.

**Errors.** Every error has the same shape:

```json
{ "error": { "code": "validation_error", "message": "Some fields are not valid", "details": [{ "path": "routeId", "message": "Invalid UUID" }], "requestId": "…" } }
```

| Status | `code` | When |
|---|---|---|
| 400 | `validation_error`, `bad_request`, `bad_time` | Input failed validation, or the request makes no sense |
| 401 | `unauthorized`, `invalid_credentials`, `invalid_code` | Missing or expired token, wrong password, wrong or reused one-time code |
| 403 | `forbidden` | Signed in but missing the permission or the role |
| 404 | `not_found` | Unknown endpoint or object (also returned for objects that belong to someone else) |
| 409 | `conflict`, `bus_conflict` | Card already exists; bus already busy in an overlapping slot |
| 413 | `too_large` | Body over 100 kB (routine uploads: 5 MB) |
| 422 | `unprocessable`, `no_prediction`, `day_pass_limit` | Valid input, but the action cannot run (no forecast yet, day-pass limit reached) |
| 423 | `locked` | Authority account locked after 5 wrong passwords (15 minutes) |
| 429 | `rate_limited` | Too many requests (300/min per IP overall, 20/min on `/auth`, 30 rider lookups per hour per officer) |
| 503 | `upstream_unavailable`, `ml_unavailable` | University SSO, directory, gateway or the ML service is down |
| 500 | `internal` | A bug. Quote the `requestId`. |

**Permissions.** Every `/admin` route names one permission from [`permissions.ts`](../packages/shared/src/permissions.ts). The Main Admin has all of them. Missing permission → 403. Every write under `/admin` is recorded in `audit_logs`.

## 5.2 Health

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | none | Process is up |
| GET | `/ready` | none | Database answers; use for load balancer readiness |

## 5.3 Sign-in (`/auth`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/auth/sso/start?client=web\|mobile` | none | Creates OAuth `state` + PKCE verifier and returns `{ authorizationUrl }` for the university login page |
| GET | `/auth/sso/callback` | none (browser) | University redirects here. Exchanges the code, reads the university ID from the ID token, syncs the profile from the directory, then redirects to the web app (`/auth/callback?code=…`) or the app (`diutransport://auth?code=…`) with a one-time code valid for 2 minutes. On failure redirects with `?error=` (`sign_in_cancelled`, `sign_in_failed`, `university_unavailable`, `not_in_directory`, `use_authority_login`). |
| POST | `/auth/sso/complete` | none | `{ code }` → `{ accessToken, refreshToken? }`. The code works once. |
| POST | `/auth/authority/login` | none | `{ universityId, password }` → `{ challengeId, mustEnrollTotp, enrollment?, mustChangePassword }`. 5 wrong passwords lock the account for 15 minutes. |
| POST | `/auth/authority/totp` | none | `{ challengeId, code }` → tokens. First login also confirms TOTP enrolment. |
| POST | `/auth/authority/change-password` | authority | `{ currentPassword, newPassword }`. Signs out every device. |
| POST | `/auth/refresh` | refresh token | Rotates the refresh token. A reused token revokes its whole family. |
| POST | `/auth/logout` | refresh token | Revokes this device's token family |
| POST | `/auth/logout-all` | any | Revokes every session of the user |
| GET | `/auth/sso/mock-authorize` | none | **Development only.** Stand-in university login page; absent when `SSO_MODE=oidc` or in production. |

## 5.4 Public (no sign-in)

| Method | Path | Description |
|---|---|---|
| GET | `/routes` | Active routes with stops and coordinates (cached 5 min) |
| GET | `/schedule?date=&routeId=&audience=` | Departure times for a day, each with `audience` and the timetable `note`. **Times only; bus numbers are never public.** (cached 1 min) |

## 5.5 Rider (`/me`)

Signed-in students, faculty and staff. Every query is scoped to the caller (`WHERE user_id = me`); there is no way to pass another person's ID.

| Method | Path | Description |
|---|---|---|
| GET | `/me` | Own identity, profile, card summary, permissions (authority only) |
| POST, DELETE | `/me/devices` | Register / remove a push token `{ token, platform }` |
| GET | `/me/card` | Current card with status, route, expiry and the QR seed for the rotating code |
| POST | `/me/card` | `{ routeId }` → `{ redirectUrl }`. The gateway is the server's setting, not the client's. Creates a `pending_payment` card and a payment session with the configured gateway (SSLCommerz: cards, bKash, Nagad, Rocket). The card turns `active` only after the server-validated IPN. |
| POST | `/me/card/free-request` | `{ routeId, note }`. Asks the office for free access; goes to the card requests queue. |
| GET | `/me/payments` | Own payment history |
| GET, POST | `/me/day-passes` | List / request `{ travelDate, routeId }`. Auto-approved up to the semester limit; then rejected or queued for manual approval (setting). |
| GET | `/me/schedule?date=&routeId=&audience=` | Day schedule. Card holders also see the **published** bus numbers for their route. The staff schedule lists the regular trips and staff-only trips; faculty can view the student schedule too. |
| GET | `/me/my-bus?direction=&audience=` | The next relevant departure for the rider's route, with published buses. If nothing is left today, the first trip on the next day that has one (`isToday: false`). |
| GET | `/me/live` | Last known positions of buses currently on the rider's route (card holders only) |
| GET | `/me/notices` | Notices for everyone, the rider's audience and their route |
| POST | `/me/tickets` | Complaint/suggestion `{ kind, category, body, routeId?, busCode?, hideIdentityFromDriver }` or help `{ kind: "help", subject, body }` → `{ id, number, status }` |
| GET | `/me/tickets`, `/me/tickets/:id` | Own tickets and the reply thread |
| POST | `/me/tickets/:id/messages` | Reply on an own ticket |

## 5.6 Payments (gateway callbacks)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/payments/sslcommerz/ipn` | SSLCommerz | Instant Payment Notification. The API checks `verify_sign`, then calls the SSLCommerz **validation API** with `val_id` and checks amount, currency and `tran_id` against the stored payment before marking it `success` (conditional update, so a replay changes nothing). The browser's success redirect is never trusted. |
| GET, POST | `/payments/return/success\|fail\|cancel` | none (browser) | Where the gateway sends the rider's browser afterwards. Only redirects to the app's result page; **never changes a payment** (the IPN does that). |
| GET, POST | `/payments/mock/pay`, `/payments/mock/complete` | none | **Development only** fake gateway page (bKash / Nagad / Card / fail buttons). Not mounted in production. |

## 5.7 Supervisor boarding (`/boarding`)

Role `supervisor` (a bus attendant account).

| Method | Path | Description |
|---|---|---|
| GET | `/boarding/buses` | Active buses, to pick which bus the scanner is on |
| POST | `/boarding/scan` | `{ qrToken, busId, timeSlotId?, method, scannedAt }` → `{ valid, reason, name }`. Checks the rotating code (30 s steps, ±60 s, so a screenshot stops working within a minute), the card or pass status, and the route: a card is valid on its home route and on shuttles; a day pass on its own route, its own date and shuttles (and is marked used). The supervisor sees only valid/invalid, the reason (e.g. "Card is for the Mirpur route") and the name to match the photo. Every scan is stored in `boarding_events`. |

## 5.8 GPS devices (`/devices`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/devices/gps` | Headers `x-device-id`, `x-timestamp` (Unix seconds), `x-signature = HMAC-SHA256(device key, "<timestamp>.<raw body>")` | `{ lat, lng, speedKmh?, heading?, recordedAt }`. Requests older than 60 s are rejected. Position is pushed live to the office and, only while the bus is on a trip, to that route's riders. |

## 5.9 Authority dashboard (`/admin`)

All routes need an authority token. The permission is in the last column.

**Feed, prediction and allocation**

| Method | Path | Description | Permission |
|---|---|---|---|
| GET | `/admin/feed?limit=` | Activity feed (requests, payments, tickets, publishes) | `dashboard.view` |
| GET | `/admin/predictions?from=&days=1..8` | Per date and slot: expected max, predicted, P90, and buses needed for only-H / only-M / only-S / mixed | `predictions.view` |
| POST | `/admin/predictions/refresh` | Re-run the forecast through the ML service | `predictions.run` |
| GET | `/admin/allocations?date=` | Allocations for a day with buses and status | `dashboard.view` |
| GET | `/admin/allocations/options?date=&timeSlotId=` | Buses free for that slot (busy windows and unavailability removed), grouped by operator | `allocation.manage` |
| PUT | `/admin/allocations` | `{ serviceDate, timeSlotId, busIds, status: draft\|published, notes? }`. 409 if a bus overlaps another slot. Publishing notifies the route. | `allocation.manage` (+ `allocation.publish` to publish) |
| POST | `/admin/allocations/suggest` | `{ serviceDate, onlyEmpty }` → drafts from the ML optimizer (falls back to a greedy plan if it is down). Never publishes. | `allocation.manage` |
| POST | `/admin/allocations/publish-day` | `{ serviceDate }`. Publishes every draft of the day at once. | `allocation.publish` |
| DELETE | `/admin/allocations/:id` | Withdraw an allocation; riders of that route are told | `allocation.manage` |

**Fleet, routes and calendar**

| Method | Path | Description | Permission |
|---|---|---|---|
| GET, POST | `/admin/fleet/operators` | Operators (H, M, S, …) | `fleet.view` / `fleet.manage` |
| GET, POST | `/admin/fleet/buses` | Bus list with operator, seats, driver | `fleet.view` / `fleet.manage` |
| PATCH | `/admin/fleet/buses/:id` | Edit a bus | `fleet.manage` |
| POST | `/admin/fleet/buses/:id/device-key` | Issue a new GPS device key (shown once) | `fleet.manage` |
| POST | `/admin/fleet/buses/:id/unavailability`, DELETE `/admin/fleet/unavailability/:id` | Mark a bus off the road for dates | `fleet.manage` |
| GET | `/admin/fleet/availability?from=&days=1..14` | Available and allocated buses per day (today and next 7 days) | `fleet.view` |
| GET, POST, PATCH | `/admin/routes`, `/admin/routes/:id` | Routes with stops, duration, turnaround | `fleet.view` / `routes.manage` |
| GET, POST, PATCH | `/admin/slots`, `/admin/slots/:id` | Fixed departure times per route, direction and audience | `fleet.view` / `routes.manage` |
| GET, POST | `/admin/semesters`; POST `/admin/semesters/:id/make-current` | Semesters | `dashboard.view` / `semesters.manage` |
| GET, POST, DELETE | `/admin/calendar`, `/admin/calendar/:id` | Holidays, exams, closures | `dashboard.view` / `semesters.manage` |
| GET, PUT | `/admin/fees` | Fee per category per semester | `payments.view` / `fees.manage` |
| GET, PATCH | `/admin/settings` | Day-pass limit and over-limit rule, buffer, turnaround, cold-start factor | `dashboard.view` / `settings.manage` |

**Cards, passes, payments and access**

| Method | Path | Description | Permission |
|---|---|---|---|
| GET | `/admin/cards/requests` | Cards waiting for a decision (free requests, manual approvals) | `cards.approve` |
| GET | `/admin/cards/auto-approved` | Cards activated by payment, for information | `cards.approve` |
| POST | `/admin/cards/:id/decision` | `{ decision: approve\|reject, reason? }` | `cards.approve` |
| GET | `/admin/day-passes` | Pending and recent day passes | `daypass.approve` |
| POST | `/admin/day-passes/:id/decision` | `{ decision, reason? }` | `daypass.approve` |
| GET | `/admin/access/:universityId` | **Transport-only** view of one rider (name, type, route, card status) plus their card, pass and payment history. No profile fields. Rate-limited and audited. | `access.lookup` |
| POST | `/admin/access/:universityId/grant`, `/revoke` | Give or take free access, `{ routeId?, reason }` (reason required) | `access.grant_revoke` |
| GET | `/admin/payments?from=&to=&status=&method=` | Payments in a range (≤ 93 days) with totals by method and category | `payments.view` |
| GET | `/admin/payments/export?…&format=xlsx\|csv` | Download the same list (Summary + Payments sheets). Cells starting with `= + - @` are escaped to stop spreadsheet formula injection. | `payments.export` |
| GET | `/admin/reports/summary?from=&to=` | Rides per route; forecast accuracy against boarding scans (MAE, WAPE, P90 coverage); overcrowded trips; load factor of published seats | `reports.view` |

**Notices, support, routines, tracking and admins**

| Method | Path | Description | Permission |
|---|---|---|---|
| GET, POST, DELETE | `/admin/notices`, `/admin/notices/:id` | Notices to all, students, faculty or one route; sent as push | `dashboard.view` / `notices.publish` |
| GET | `/admin/tickets?kind=complaint\|help`, `/admin/tickets/:id` | Tickets by number, category and route, **without who wrote them** | `support.manage` |
| POST | `/admin/tickets/:id/reply` | `{ body, status? }`; the rider gets a push | `support.manage` |
| GET | `/admin/routines`, `/admin/routines/:id/sessions` | Routine versions and parsed class sessions | `routines.manage` |
| POST | `/admin/routines/upload` | Multipart file (PDF, XLSX, CSV) + department → parsed version in `pending_review` | `routines.manage` |
| POST | `/admin/routines/:id/activate`, `/reject` | Review result; activating supersedes the old version and refreshes the forecast | `routines.manage` |
| GET, POST | `/admin/routines/sources` | Department URLs checked daily | `routines.manage` |
| GET | `/admin/tracking/live` | Latest position of every bus | `tracking.view` |
| GET, POST, PATCH | `/admin/admins`, `/admin/admins/:userId` | Co-admins: create (temporary password shown once), change permissions, deactivate | `admins.manage` |

There is deliberately **no** endpoint to read a rider's profile, sign in as a rider, or edit anything inside a rider's account ([07-security.md](07-security.md)).

## 5.10 Realtime (Socket.IO)

Path `/realtime`, authenticated with the access token in the handshake (`auth: { token }`).

| Room | Who joins | Events |
|---|---|---|
| `authority` | Authority accounts | `bus.position`, `payment.success`, `ticket.created` |
| `riders` | Every rider | `notice.published` (audience all/students/faculty) |
| `route:<id>` | Riders with an active card on that route | `allocation.published`, `allocation.withdrawn`, `notice.published` (route notices), `bus.position` (only while the bus is on that route's trip) |

## 5.11 ML service (internal only)

Not reachable from the internet. Every call carries `Authorization: Bearer <ML_SERVICE_TOKEN>`. Riders are sent pseudonymised (salted hash keys, no names or IDs).

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Up, with the active model version |
| POST | `/v1/forecast` | Card holders' groups, class sessions, slots, calendar, boarding history → per date and slot: `expectedMax`, `predicted`, `p90` |
| POST | `/v1/allocation/plan` | Demand targets, available buses, busy windows → bus assignment per slot (mixed-integer program, 20 s limit) |
| POST | `/v1/routines/parse` | Upload (PDF/XLSX/CSV/HTML) → class sessions + warnings |
| POST | `/v1/routines/fetch` | `{ url, department }` → same, fetched with an allow-listed, SSRF-safe downloader |

## 5.12 External services

| Service | Used for | Notes |
|---|---|---|
| DIU SSO (OIDC) | Rider sign-in | Authorization Code + PKCE; needs client ID/secret and a university-ID claim from the IT division |
| DIU directory API | Name, category, department, batch, section, teacher initial, phone | Read at each sign-in; needs a service token |
| SSLCommerz | Card fee (cards, bKash, Nagad, Rocket) | Sandbox first; IPN + validation API |
| Expo push (FCM/APNs) | Notices, allocation changes, ticket replies, renewal reminders | `EXPO_ACCESS_TOKEN` |
| OpenStreetMap tiles | Route and live maps | Respect the tile usage policy, or host tiles for production |
| GPS trackers | Live bus positions | Any device that can send HTTPS with an HMAC header; or a vendor bridge |
