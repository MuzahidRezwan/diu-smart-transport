# 11. UI/UX Review of the Sketches

## 11.1 Authority dashboard

**What works in the sketch:** prediction first, allocation one click away, badges on pending queues, live route and notice as first-class tabs.

**Suggested changes**

1. **One primary navigation, not two.** The sketch has a left sidebar *and* a bottom tab bar. On desktop, put everything in the left sidebar grouped into sections (*Today*, *Requests*, *Fleet*, *People*, *Communication*, *Admin*). Keep a bottom bar only on narrow screens.
2. **Today screen = a timeline, not a list.** Show today's slots on a horizontal timeline (07:00 … 19:00) with one row per route. Each cell shows `predicted / allocated seats` and turns **red** when seats < P90 demand, **amber** when within 10%, **green** when covered. This answers "where am I short?" at a glance.
3. **Prediction panel:** show three numbers per card — *expected max* (from routine), *predicted* (ML), *P90 (safe)* — and allocate against P90. Show "only H / only M / only S / mixed" as a compact chip row, and grey out options that are impossible with today's available fleet.
4. **Allocation as a side drawer**, opened from any slot: left = demand and suggestion, right = available buses grouped by operator as selectable chips with seat count; a running "seats selected vs needed" bar; buses busy in an overlapping slot are shown disabled with a tooltip "allocated to R-03 07:00". Buttons: *Save draft*, *Publish*, *Unpublish*.
5. **Bulk actions:** "Apply suggestion to all slots", "Copy yesterday's allocation", "Publish whole day".
6. **Requests inbox:** card requests and day-pass requests as one inbox with filters and keyboard shortcuts (A = approve, R = reject); show payment status inline.
7. **Live map:** filter chips per route, bus markers coloured by operator, a side list sorted by "distance to DSC".
8. **Header:** keep the greeting and name, but also show the **active semester** and a **system status** dot (ML, GPS, payments).
9. **Audit trail** visible on every allocation ("Published by Anisur Rahman 06:42, edited by … 07:05").

## 11.2 Student/faculty app

1. **Home = "My Bus" card that answers one question: "Which bus do I take next, and when?"** Large departure time, a countdown ("in 25 min"), the stop, and bus numbers as chips coloured by operator. Swipe to see the next slot.
2. **Direction toggle** (To campus / To home) that switches automatically by time of day.
3. **Student/Faculty service toggle** only for faculty, as a segmented control at the top.
4. **Bus numbers** in the sketch are long strings. Use chips (`H-10` `H-12` `M-08`) and tap a chip → live position of that bus.
5. **Route strip:** horizontal stepper of stops with "you are here" only if location permission is given; tap → full map.
6. **My Card:** full-screen card with brightness boost and the rotating QR, readable offline; show status clearly (Active until 31 Dec / Expired / Day pass for 19 Nov).
7. **Free users:** show the same home layout with times only and a clear CTA "Get your transport card — ৳X for Fall 2026" instead of hiding the home screen.
8. **Notifications:** group by route and by date; pin urgent notices (delays, cancellations).
9. **Bangla/English switch** in the side menu, remembered per device; Bangla digits optional.
10. **Accessibility:** min 44 pt tap targets, dynamic font size, colour is never the only signal (icons + text for status).
11. **Empty and error states:** "No bus allocated yet for 4:30 PM — usually published by 2 PM", "Offline — showing schedule from 07:10".

## 11.3 Design system

- Colours: DIU blue as primary, semantic greens/ambers/reds only for status; operator colours: H = indigo, M = teal, S = orange.
- Typography: Inter / Hind Siliguri (Bangla).
- Components shared between web and app through the same naming (Card, Chip, StatTile, SlotRow, BusChip).
