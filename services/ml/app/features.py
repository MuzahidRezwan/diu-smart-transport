"""Feature engineering shared by training and prediction."""
from __future__ import annotations

from collections import defaultdict
from datetime import date as Date, timedelta

import numpy as np
import pandas as pd

from .demand import weekday_js

FEATURES = [
    "expected_max", "weekday", "departure_minutes", "is_incoming", "is_faculty", "duration_minutes",
    "is_exam_week", "holiday_adjacent", "slot_rate_mean", "slot_rate_p90", "slot_obs",
]


def calendar_flags(dates: list[str], calendar: list[dict]) -> dict[str, tuple[int, int]]:
    """(is_exam_week, holiday_adjacent) per date."""
    exams = {c["date"] for c in calendar if c["kind"] == "exam"}
    off = {c["date"] for c in calendar if c["kind"] in ("holiday", "closure") or c.get("cancels_service")}
    flags = {}
    for d in dates:
        day = Date.fromisoformat(d)
        near = [(day + timedelta(days=k)).isoformat() for k in (-1, 1)]
        week = [(day + timedelta(days=k)).isoformat() for k in range(-3, 4)]
        flags[d] = (int(any(w in exams for w in week)), int(any(n in off for n in near)))
    return flags


def slot_history_stats(history: list[dict], expected: dict[tuple[str, str], int], before: str | None = None) -> dict[str, tuple[float, float, int]]:
    """Per slot: mean and 90th percentile of the show-up rate (boarded / expected) seen so far."""
    rates: dict[str, list[float]] = defaultdict(list)
    for h in history:
        if before and h["date"] >= before:
            continue
        e = expected.get((h["date"], h["time_slot_id"]), 0)
        if e > 0:
            rates[h["time_slot_id"]].append(min(1.5, h["boarded"] / e))
    return {k: (float(np.mean(v)), float(np.quantile(v, 0.9)), len(v)) for k, v in rates.items()}


def build_frame(rows: list[dict], slots: dict[str, dict], calendar: list[dict], stats: dict[str, tuple[float, float, int]]) -> pd.DataFrame:
    """rows: [{date, time_slot_id, expected_max, (boarded)}] -> feature frame."""
    flags = calendar_flags(sorted({r["date"] for r in rows}), calendar)
    out = []
    for r in rows:
        s = slots[r["time_slot_id"]]
        mean, p90, n = stats.get(r["time_slot_id"], (np.nan, np.nan, 0))
        exam, hol = flags[r["date"]]
        out.append({
            "date": r["date"],
            "time_slot_id": r["time_slot_id"],
            "expected_max": r["expected_max"],
            "weekday": weekday_js(r["date"]),
            "departure_minutes": s["departure_minutes"],
            "is_incoming": int(s["direction"] == "to_campus"),
            "is_faculty": int(s["audience"] == "faculty"),
            "duration_minutes": s["duration_minutes"],
            "is_exam_week": exam,
            "holiday_adjacent": hol,
            "slot_rate_mean": mean,
            "slot_rate_p90": p90,
            "slot_obs": n,
            **({"boarded": r["boarded"]} if "boarded" in r else {}),
        })
    return pd.DataFrame(out)
