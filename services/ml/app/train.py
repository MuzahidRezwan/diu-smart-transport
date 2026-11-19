"""
Train, back-test and (if it is better) promote a ridership model.

  python -m app.train --synthetic            # build and test the pipeline without real data
  python -m app.train --input export.json    # real data exported by the API (same shape as a forecast request)

Promotion rule: the new model is served only if it beats the per-slot
historical baseline on WAPE and keeps P90 coverage at 85% or more.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from .demand import expected_demand
from .features import build_frame, slot_history_stats
from .model import ModelStore, baseline_rates, evaluate, to_counts, train
from .schemas import ForecastRequest
from .synthetic import generate

COLD_START = 0.85


def rolling_frame(dates: list[str], expected: dict, history: list[dict], slots: dict, calendar: list[dict]) -> pd.DataFrame:
    """Each day's features use only boardings from earlier days (no peeking at the answer)."""
    frames = []
    by_date: dict[str, list[dict]] = {}
    for h in history:
        by_date.setdefault(h["date"], []).append(h)
    for d in dates:
        rows = [{"date": d, "time_slot_id": h["time_slot_id"], "expected_max": expected.get((d, h["time_slot_id"]), 0), "boarded": h["boarded"]}
                for h in by_date.get(d, [])]
        rows = [r for r in rows if r["expected_max"] > 0]
        if not rows:
            continue
        stats = slot_history_stats(history, expected, before=d)
        frames.append(build_frame(rows, slots, calendar, stats))
    return pd.concat(frames, ignore_index=True)


MIN_TRAIN_DAYS = 20


class NotEnoughHistory(ValueError):
    """Too few days of boarding scans to train and back-test honestly."""


def backtest(data: dict, test_days: int = 24, store: ModelStore | None = None, promote: bool = True) -> dict:
    dates = sorted({h["date"] for h in data["history"]})
    if len(dates) < test_days + MIN_TRAIN_DAYS:
        raise NotEnoughHistory(
            f"Need at least {test_days + MIN_TRAIN_DAYS} days with boarding scans "
            f"({MIN_TRAIN_DAYS} to train, {test_days} to test); the export has {len(dates)}. "
            "Until then the service keeps using the routine count and the attendance factor."
        )
    split = dates[-test_days]
    frame = rolling_frame(dates, data["expected"], data["history"], data["slots"], data["calendar"])
    tr, te = frame[frame["date"] < split], frame[frame["date"] >= split]

    model = train(tr)
    exp_te, act_te = te["expected_max"].to_numpy(), te["boarded"].to_numpy()
    m_mean, m_hi = model.predict(te)
    b_mean, b_hi = baseline_rates(te, COLD_START)
    model_metrics = evaluate(exp_te, act_te, *to_counts(exp_te, m_mean, m_hi))
    base_metrics = evaluate(exp_te, act_te, *to_counts(exp_te, b_mean, b_hi))
    better = model_metrics["wape"] < base_metrics["wape"] and model_metrics["p90_coverage"] >= 0.85

    final = train(frame)  # retrain on everything before serving
    final.metrics = {"backtest": {"model": model_metrics, "baseline": base_metrics, "split": split}, "train_rows": int(len(frame))}
    if store:
        store.save(final, promote=promote and better)
    return {"version": final.version, "promoted": bool(promote and better), "model": model_metrics, "baseline": base_metrics, "split": split}


def load_input(path: Path) -> dict:
    raw = json.loads(path.read_text())
    req = ForecastRequest.model_validate(raw)
    hist_dates = sorted({h.date for h in req.history})
    exp = expected_demand(hist_dates, req.riders, req.sessions, req.slots, req.calendar).counts
    return {
        "history": [h.model_dump() for h in req.history],
        "expected": dict(exp),
        "slots": {s.time_slot_id: s.model_dump() for s in req.slots},
        "calendar": [c.model_dump() for c in req.calendar],
    }


def synthetic_input(seed: int = 42) -> dict:
    g = generate(seed=seed)
    return {
        "history": [h.model_dump() for h in g["history"]],
        "expected": g["expected"],
        "slots": {s.time_slot_id: s.model_dump() for s in g["slots"]},
        "calendar": [c.model_dump() for c in g["calendar"]],
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--synthetic", action="store_true")
    src.add_argument("--input", type=Path)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--no-promote", action="store_true")
    args = ap.parse_args()
    data = synthetic_input(args.seed) if args.synthetic else load_input(args.input)
    try:
        result = backtest(data, store=ModelStore(), promote=not args.no_promote)
    except NotEnoughHistory as err:
        raise SystemExit(f"Not trained: {err}") from None
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    np.seterr(all="ignore")
    main()
