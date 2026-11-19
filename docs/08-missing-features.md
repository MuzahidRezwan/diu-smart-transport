# 8. Features and Problems Not in the Original Idea

Ordered by how much they matter. **MVP** = build in phase 1, **P2** = phase 2, **P3** = later.

| # | Feature / problem | Why it matters | Priority |
|---|---|---|---|
| 1 | **Boarding scan (QR on card, scanned by supervisor/driver phone)** | Without it the "ML" model has no ground truth: you only know who *could* ride (routine), never who *did*. Scans also stop fare-dodging and mark one-day passes as used. | **MVP** |
| 2 | **Driver / supervisor app mode** | Starts/ends a trip, scans QR, reports "bus full" or breakdown. Also a GPS fallback if a bus has no tracker (phone GPS while the trip is active). | **MVP** |
| 3 | **Dynamic dispatch for the evening rush** | Today the 2nd bus leaves only when the 1st is full. Real-time boarding counts + queue size per route let the authority (or the system) dispatch the next bus early. | P2 |
| 4 | **Academic calendar** (holidays, exam weeks, registration week, strikes/hartals) | Demand drops to ~0 on holidays and changes shape in exam weeks. The model needs it as a feature and the schedule needs it to hide cancelled trips. | **MVP** |
| 5 | **Routine review step** | Scraped routines can be wrong; a wrong routine silently breaks every prediction. A department admin or transport staff approves a new routine version before it becomes active. | **MVP** |
| 6 | **Semester renewal & expiry** | Cards must expire at semester end, users need reminders 14/7/1 days before, and the authority needs a renewal report. | **MVP** |
| 7 | **Fee receipts & payment history** | Users need proof of payment (PDF receipt) for disputes; finance office needs exportable reports. | **MVP** |
| 8 | **Refund policy & partial-semester pricing** | Students who join late, drop out or switch route. Needs a written policy plus a refund workflow with permission and audit. | P2 |
| 9 | **Route change requests** | Students move houses. A request → approval flow rather than buying a second card. | P2 |
| 10 | **Waitlist / seat reservation for peak slots** | If demand > fleet, a fair "reserve a seat for 4:30 PM" option (opens the day before) prevents crowding and gives precise demand. | P3 (pilot on one route) |
| 11 | **Trip delay & cancellation alerts** | "Bus H-10 is 20 min late due to traffic" push to the route; reduces calls to the office. | P2 |
| 12 | **Emergency / SOS** | Button in app → calls transport office + shares the bus code and location; incident log for the authority. Important for female students on late buses. | P2 |
| 13 | **Lost & found** | Simple post/claim board per bus and date. | P3 |
| 14 | **Analytics & reports** | Ridership per route/slot, load factor (passengers / seats), prediction accuracy, revenue per route, complaint trends. This is what convinces the university to keep funding the project. | P2 |
| 15 | **Operator billing reconciliation** | Operators are paid per trip/bus. Allocations + GPS trips give an auditable trip count per operator per month. | P3 |
| 16 | **Bangla + English UI** | Many users (and drivers) are more comfortable in Bangla. | **MVP** (strings in i18n files from day 1) |
| 17 | **Offline mode** | Schedule and card (with last valid QR seed) must work without internet at the bus stop. | **MVP** for card + schedule |
| 18 | **Accessibility** | Screen-reader labels, colour contrast, large text. Students with disabilities may need a reserved front seat. | P2 |
| 19 | **Women-only or priority seating info** | If DIU runs female-only trips, they need to be a slot attribute so they show correctly. | Confirm with authority |
| 20 | **Notification preferences & quiet hours** | Avoid spamming users with notices for routes they don't use. | P2 |
| 21 | **Device/session management** | "Log out of all devices" when a phone is lost; limits card sharing. | **MVP** |
| 22 | **Data retention & consent screen** | Users should know what's collected (especially if seat booking or scans are added). | **MVP** |
| 23 | **Admin action audit log** | Required for disputes ("who revoked my card?"). | **MVP** |
| 24 | **Disaster recovery & backups** | Payments and cards are financial records. | **MVP** |
| 25 | **Feedback loop for predictions** | Authority edits and actual scans feed back into training; dashboard shows "predicted vs actual" for yesterday. | P2 |
| 26 | **Traffic-aware ETA** | ETA to each stop from live GPS + historical travel times. | P3 |
| 27 | **Bus capacity per trip state** | Supervisor taps "full" → app shows "next bus in 15 min" to waiting users. | P2 |
| 28 | **Fraud controls for day pass** | One per semester is enforced by university ID, but also rate-limit by device to stop scripted abuse. | **MVP** |
| 29 | **Content moderation for complaints** | Profanity filter and an "anonymous to driver" option so students feel safe reporting. | P3 |
| 30 | **Status page / maintenance mode** | Tells users when the system is down instead of silently failing at 7 AM. | P2 |
