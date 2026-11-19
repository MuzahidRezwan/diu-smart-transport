"""Forecast pipeline: routine -> expected demand -> show-up model -> predicted and P90 riders per slot."""
from __future__ import annotations

from .demand import expected_demand, weekday_js
from .features import build_frame, slot_history_stats
from .model import ModelStore, baseline_rates, to_counts
from .schemas import ForecastRequest, ForecastResponse, ForecastRow


def run_forecast(req: ForecastRequest, store: ModelStore | None) -> ForecastResponse:
    target = expected_demand(req.dates, req.riders, req.sessions, req.slots, req.calendar)

    # Expected demand on past days, so past boardings can be turned into show-up rates.
    past_dates = sorted({h.date for h in req.history})
    past = expected_demand(past_dates, req.riders, req.sessions, req.slots, req.calendar) if past_dates else None
    history = [h.model_dump() for h in req.history]
    stats = slot_history_stats(history, dict(past.counts) if past else {})

    slots = {s.time_slot_id: s.model_dump() for s in req.slots}
    rows = []
    for d in req.dates:
        for s in req.slots:
            if weekday_js(d) in s.weekdays:
                rows.append({"date": d, "time_slot_id": s.time_slot_id, "expected_max": target.counts.get((d, s.time_slot_id), 0)})
    if not rows:
        return ForecastResponse(model_version="none", rows=[], unserved={"in": target.unserved_in, "out": target.unserved_out})

    frame = build_frame(rows, slots, [c.model_dump() for c in req.calendar], stats)
    model = store.latest() if store else None
    if model is not None and len(history) >= 50:
        mean_rate, p90_rate = model.predict(frame)
        version = model.version
    else:
        mean_rate, p90_rate = baseline_rates(frame, req.attendance_factor_cold_start)
        version = "baseline-history" if stats else "cold-start"
    expected = frame["expected_max"].to_numpy()
    predicted, p90 = to_counts(expected, mean_rate, p90_rate)

    return ForecastResponse(
        model_version=version,
        rows=[
            ForecastRow(date=r["date"], time_slot_id=r["time_slot_id"], expected_max=int(e), predicted=int(p), p90=int(q))
            for r, e, p, q in zip(rows, expected, predicted, p90)
        ],
        unserved={"in": target.unserved_in, "out": target.unserved_out},
    )
