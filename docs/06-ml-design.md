# 6. ML Design: Daily Demand Prediction and Bus Allocation

Code: [`services/ml`](../services/ml). Run `python -m app.train --synthetic` to reproduce the numbers below.

## 6.1 Is this rule-based, ML, or both?

**Hybrid, in three layers.**

| Layer | What it answers | Method | Needs |
|---|---|---|---|
| 1. Expected demand ("routine max") | Who *could* ride each trip? | Rules: match each card holder's batch/section (or teacher initial) to the routine, pick the latest bus that reaches DSC 10 min before the first class and the first bus 5 min after the last class. Students use student trips; staff use those and staff-only trips (DIU's 4:20 PM employee bus) | Routines + card holders |
| 2. Ridership forecast | How many *will* ride? | ML: gradient-boosted trees predict the **show-up rate** (mean and 90th percentile) | Boarding scans (history), calendar |
| 3. Allocation | Which buses go where? | Optimization: mixed-integer program | Layer 2 output + available fleet |

Routines give an upper bound. Actual riders are fewer and vary with weekday, exams, holidays, weather and strikes. That gap is what the model learns. Without boarding data the system still works: it uses the routine count times a configurable attendance factor (cold start).

## 6.2 Data

| Data | Source | Notes |
|---|---|---|
| Card holders: route, audience, department, batch, section, teacher initial | API (`transport_cards`, `user_profiles`) | Sent to the ML service **pseudonymised** (salted hash key). The ML service never sees names or IDs. |
| Class sessions | Routine upload or daily scrape, after human review | `class_sessions` of the active routine version per department |
| Time slots, route durations | API | Arrival time = departure + route duration |
| Academic calendar | Authority | Holidays (no service), exam weeks, closures |
| **Boarding scans** | Supervisor app (QR) | Ground truth. Without it there is no real ML. |
| Weather (P2) | e.g. Open-Meteo daily rain for Dhaka | Feature slot already planned |
| Authority edits | Allocation changes, "bus full" reports | Logged; used to audit where the plan was wrong |

## 6.3 Features and target

Target: `rate = boarded / expected_max` for one slot on one day. Predicting a **rate** instead of a count keeps the model valid for routes and slot sizes it has not seen, and makes the routine count the scale.

Features (`app/features.py`): expected_max, weekday, departure time, direction, audience, route duration, exam week, day next to a holiday/closure, and the slot's own history: mean and 90th-percentile show-up rate so far and how many observations there are (capped at 20: past that it would only count days, and trees cannot extrapolate a counter beyond the training range, which made the P90 too low in backtests). History features are computed **only from earlier days** (no leakage).

## 6.4 Models

* **Mean rate**: `HistGradientBoostingRegressor(loss="squared_error")`, weighted by expected_max.
* **P90 rate**: same with `loss="quantile", quantile=0.9`. **Seats are allocated for P90**, so on about 9 of 10 days the planned seats are enough.
* **Baseline** (what the model must beat): per-slot historical average and P90 rate, falling back to the cold-start factor (default 0.85).

## 6.5 Evaluation (synthetic back-test, last 24 service days held out)

| Metric | Baseline | Model |
|---|---|---|
| WAPE (riders) | 12.6% | **9.0%** |
| MAE (riders per trip) | 7.2 | **5.1** |
| P90 coverage (seats were enough) | 92.3% | 90.5% |
| Empty seats in the plan | 16.1% | **10.9%** |

Metric definitions (`app/model.py:evaluate`):
* **WAPE** = Σ|actual − predicted| / Σ actual. Headline accuracy number.
* **P90 coverage** = share of trips where actual riders ≤ P90. Target ≥ 85–90%.
* **Under-capacity rate** = 1 − coverage: trips where people would be left behind. The number the transport office cares about.
* **Empty-seat rate**: cost side.

**Promotion rule:** a newly trained model is served only if it beats the baseline WAPE and keeps P90 coverage ≥ 85%. Otherwise the previous model (or the baseline) stays.

> These numbers come from synthetic data with a known hidden pattern (`app/synthetic.py`). They prove the pipeline works; real accuracy is known only after 4–6 weeks of real boarding scans.

## 6.6 Retraining

* Weekly (Saturday night) on the last 120 days of scans: `npm run ml:export` (API) writes the pseudonymised training file, then `python -m app.train --input training-export.json`. Commands for the docker deployment are in [12.9](12-deployment-and-ops.md#129-ml-retraining). Training refuses to run with fewer than 44 days of scans and keeps the current model.
* The nightly forecast job (05:30 Dhaka) predicts today + 7 days; a second run at 13:00 updates the evening trips.
* New routine activated → forecast re-run immediately.
* Drift check: if last week's WAPE is 1.5× the back-test WAPE, alert and fall back to the baseline.
* Artifacts are versioned files (`artifacts/<version>.joblib` + `.metrics.json`); `latest.json` points to the served one, so a rollback is one file change.

## 6.7 Allocation optimization

`app/optimizer.py`, PuLP with the bundled CBC solver (20 s limit, greedy fallback).

* `x[b,s] ∈ {0,1}`: bus b serves slot s. `short[s] ≥ 0`: seats still missing.
* Cover: Σ capacity·x + short ≥ ⌈P90 × (1 + buffer)⌉ for each slot.
* No double-booking: for every bus, at most one slot among those whose busy windows overlap (window = departure → arrival + turnaround for inbound; departure → back at DSC for outbound). Encoded as interval-graph cliques.
* Objective, in priority order: no shortage (×1000) → fewest buses (×10) → fewest empty seats (×0.01/seat) → avoid taking the other pool's buses (+25).
* Buses the authority already fixed are kept and blocked from overlapping slots.
* Output includes the **shortfall per slot**, so the authority sees "Dhanmondi 4:30 PM is 24 seats short" and can hire a bus or stagger a slot.

Known simplification: the model does not track where a bus physically is (a bus that finishes an inbound Mirpur trip at DSC is assumed free for any later slot). A vehicle-scheduling extension with deadhead times between route ends is a phase-3 item.

## 6.8 Collecting routines reliably

1. **Primary: template upload.** Each department (or the transport office) uploads `data/routine-template.csv` or XLSX through the dashboard. One row per class.
2. **Secondary: daily scrape** of each department's routine page (`routine_sources`). The fetcher only downloads HTTPS files from allow-listed university hosts and blocks private addresses (SSRF protection).
3. **Grid parser** for the usual department layout (times across the top, rooms down the side, cells like `SE331 (41_G) MRH`), PDF tables via pdfplumber, HTML tables.
4. Every new version is stored as **pending review** with warnings for unreadable cells; a person activates it. The content hash is computed from the parsed classes, so re-exporting the same routine is not a "new" routine.
5. Image-only routines (scanned PDFs, photos): OCR is possible but unreliable for grids. Ask the department for the template instead.

## 6.9 How the authority improves the model

* Boarding scans happen automatically; the "predicted vs actual" report (`/admin/reports/summary`) shows yesterday's error per route.
* Editing a suggested allocation is logged; repeated manual increases on one slot are a signal the model under-predicts there.
* "Bus full, people waiting" button in the supervisor app (P2) records unmet demand that scans cannot see.
