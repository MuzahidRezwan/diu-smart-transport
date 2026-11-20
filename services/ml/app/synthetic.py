"""
Synthetic but realistic data, so the whole pipeline can be built, trained and
tested before DIU shares real routines and boarding scans.

The "true" show-up behaviour is hidden in `_true_rate`. A good model should
learn it from the boarding history and beat the per-slot average baseline.
"""
from __future__ import annotations

from datetime import date as Date, timedelta

import numpy as np

from .demand import expected_demand, weekday_js
from .schemas import CalendarDay, HistoryRow, Rider, Session, Slot

FRIDAY = 5
SERVICE_DAYS = [0, 1, 2, 3, 4, 5, 6]  # DIU runs buses on Friday too, at Friday times
ROUTES = [("R-01", 75, 0, 0.26), ("R-02", 60, 0, 0.22), ("R-03", 95, 20, 0.18), ("R-04", 55, 0, 0.12), ("R-05", 45, 0, 0.10), ("SH-1", 40, 0, 0.12)]
WAVES = {"student": {"to_campus": ["07:00", "08:30", "10:00"], "from_campus": ["13:00", "14:30", "16:30", "18:00"]},
         "faculty": {"to_campus": ["07:30"], "from_campus": ["17:00"]}}
FRIDAY_WAVES = {"to_campus": ["07:30"], "from_campus": ["11:30", "16:30"]}  # shared by students and staff
DEPARTMENTS = ["SWE", "CSE", "EEE", "BBA"]
CLASS_STARTS = [8 * 60 + 30, 10 * 60, 11 * 60 + 30, 13 * 60, 14 * 60 + 30, 16 * 60]
WEEKDAY_EFFECT = {6: 1.04, 0: 1.02, 1: 1.0, 2: 0.99, 3: 0.95, 4: 0.86, 5: 0.78}


def _hhmm(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def build_slots() -> list[Slot]:
    slots = []
    for code, dur, early, _ in ROUTES:
        for aud in ("student", "faculty"):
            if aud == "faculty" and code in ("R-05", "SH-1"):
                continue
            for direction, waves in WAVES[aud].items():
                for w in waves:
                    dep = _hhmm(w) - (early if direction == "to_campus" else 0) + (15 if code == "SH-1" else 0)
                    slots.append(Slot(time_slot_id=f"{code}|{aud}|{direction}|{w}", route_id=code, direction=direction, audience=aud,
                                      departure_minutes=dep, duration_minutes=dur, weekdays=[d for d in SERVICE_DAYS if d != FRIDAY]))
        for direction, waves in FRIDAY_WAVES.items():
            for w in waves:
                slots.append(Slot(time_slot_id=f"{code}|student|{direction}|{w}|fri", route_id=code, direction=direction, audience="student",
                                  departure_minutes=_hhmm(w), duration_minutes=dur, weekdays=[FRIDAY]))
    return slots


def generate(seed: int = 42, weeks: int = 16, n_students: int = 2400, start: str = "2026-05-02"):
    rng = np.random.default_rng(seed)
    sessions: list[Session] = []
    teachers = [f"T{chr(65 + i // 26)}{chr(65 + i % 26)}" for i in range(140)]
    groups = [(d, str(b), s) for d in DEPARTMENTS for b in range(41, 46) for s in "ABCDEF"]
    for dept, batch, sec in groups:
        for wd in SERVICE_DAYS:
            friday = wd == FRIDAY
            if rng.random() < (0.75 if friday else 0.22):
                continue  # free day; most sections have no Friday class
            first = int(rng.integers(1, 3)) if friday else int(rng.integers(0, 4))
            for k in range(int(rng.integers(1, 3 if friday else 4))):
                if first + k >= len(CLASS_STARTS):
                    break
                st = CLASS_STARTS[first + k]
                sessions.append(Session(department=dept, batch=batch, section=sec, teacher_initial=teachers[int(rng.integers(0, len(teachers)))],
                                        weekday=wd, start_minutes=st, end_minutes=st + 90, course_code=f"{dept}{int(rng.integers(100, 499))}"))

    weights = np.array([r[3] for r in ROUTES])
    riders = []
    for i in range(n_students):
        dept, batch, sec = groups[int(rng.integers(0, len(groups)))]
        route = ROUTES[int(rng.choice(len(ROUTES), p=weights / weights.sum()))][0]
        riders.append(Rider(rider_key=f"s{i}", audience="student", route_id=route, department=dept, batch=batch, section=sec))
    for i, t in enumerate(teachers[:110]):
        route = ROUTES[int(rng.choice(4))][0]
        riders.append(Rider(rider_key=f"f{i}", audience="faculty", route_id=route, teacher_initial=t))

    day0 = Date.fromisoformat(start)
    dates = [(day0 + timedelta(days=i)).isoformat() for i in range(weeks * 7)]
    dates = [d for d in dates if weekday_js(d) in SERVICE_DAYS]
    calendar = [CalendarDay(date=dates[int(rng.integers(5, len(dates) - 5))], kind="holiday", cancels_service=True) for _ in range(3)]
    for wk in (6, weeks - 2, weeks - 1):  # mid-term and finals
        for d in dates:
            if (Date.fromisoformat(d) - day0).days // 7 == wk:
                calendar.append(CalendarDay(date=d, kind="exam", cancels_service=False))

    slots = build_slots()
    exp = expected_demand(dates, riders, sessions, slots, calendar).counts
    rain = {d for d in dates if rng.random() < 0.1}
    bias = {s.time_slot_id: float(rng.normal(1.0, 0.05)) for s in slots}
    slot_by_id = {s.time_slot_id: s for s in slots}
    exam_days = {c.date for c in calendar if c.kind == "exam"}
    off = {c.date for c in calendar if c.cancels_service}

    history = []
    for (d, sid), e in exp.items():
        s = slot_by_id[sid]
        p = _true_rate(d, s, exam_days, off, rain, bias[sid])
        history.append(HistoryRow(date=d, time_slot_id=sid, boarded=int(rng.binomial(e, p))))
    return {"dates": dates, "riders": riders, "sessions": sessions, "slots": slots, "calendar": calendar, "history": history, "expected": dict(exp)}


def _true_rate(d: str, s: Slot, exam_days: set[str], off: set[str], rain: set[str], bias: float) -> float:
    day = Date.fromisoformat(d)
    rate = 0.84 * WEEKDAY_EFFECT[weekday_js(d)] * bias
    near_off = any((day + timedelta(days=k)).isoformat() in off for k in (-1, 1))
    if near_off:
        rate *= 0.62
    if d in exam_days:
        rate *= 1.08 if s.direction == "to_campus" else 0.9
    if d in rain:
        rate *= 0.85
    if s.direction == "from_campus" and s.departure_minutes >= 17 * 60 + 30:
        rate *= 0.9
    return float(np.clip(rate, 0.05, 1.0))
