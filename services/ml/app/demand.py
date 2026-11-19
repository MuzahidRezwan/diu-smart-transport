"""
Rule-based expected demand ("routine max").

For every transport-card holder and every date:
  * incoming trip: the latest morning slot on their route that reaches DSC at
    least ARRIVAL_BUFFER minutes before their first class;
  * outgoing trip: the first afternoon slot that leaves at least WALK_BUFFER
    minutes after their last class.

This is the most people who *could* ride. The forecast model then estimates
how many actually do.
"""
from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date as Date

from .schemas import CalendarDay, Rider, Session, Slot

ARRIVAL_BUFFER = 10
WALK_BUFFER = 5


def weekday_js(iso: str) -> int:
    """0 = Sunday ... 6 = Saturday, like JavaScript and the API."""
    return (Date.fromisoformat(iso).weekday() + 1) % 7


def norm_dept(value: str | None) -> str:
    """'Dept. of Software Engineering' / 'SWE' / 'software engineering' -> 'SWE'."""
    if not value:
        return ""
    v = re.sub(r"[^a-z ]", " ", value.lower())
    v = re.sub(r"\b(department|dept|of|and|the|bsc|in)\b", " ", v)
    v = " ".join(v.split())
    aliases = {
        "software engineering": "SWE", "swe": "SWE", "se": "SWE",
        "computer science engineering": "CSE", "cse": "CSE", "computer science": "CSE",
        "electrical electronic engineering": "EEE", "eee": "EEE",
        "business administration": "BBA", "bba": "BBA",
        "multimedia creative technology": "MCT", "mct": "MCT",
    }
    return aliases.get(v, v.upper().replace(" ", "_"))


def norm_batch(value: str | None) -> str:
    return re.sub(r"\D", "", value or "")


def norm_section(value: str | None) -> str:
    return (value or "").strip().upper()[:2]


@dataclass
class DayDemand:
    counts: dict[tuple[str, str], int] = field(default_factory=lambda: defaultdict(int))  # (date, slotId) -> riders
    unserved_in: int = 0
    unserved_out: int = 0


def _session_index(sessions: list[Session]):
    by_group: dict[tuple[str, str, str, int], list[Session]] = defaultdict(list)
    by_teacher: dict[tuple[str, int], list[Session]] = defaultdict(list)
    for s in sessions:
        if s.batch and s.section:
            by_group[(norm_dept(s.department), norm_batch(s.batch), norm_section(s.section), s.weekday)].append(s)
        if s.teacher_initial:
            by_teacher[(s.teacher_initial.strip().upper(), s.weekday)].append(s)
    return by_group, by_teacher


def expected_demand(dates: list[str], riders: list[Rider], sessions: list[Session], slots: list[Slot], calendar: list[CalendarDay]) -> DayDemand:
    closed = {c.date for c in calendar if c.cancels_service}
    by_group, by_teacher = _session_index(sessions)
    slots_by_route: dict[tuple[str, str, str], list[Slot]] = defaultdict(list)
    for s in slots:
        slots_by_route[(s.route_id, s.audience, s.direction)].append(s)
    for lst in slots_by_route.values():
        lst.sort(key=lambda s: s.departure_minutes)

    out = DayDemand()
    for d in dates:
        if d in closed:
            continue
        wd = weekday_js(d)
        for r in riders:
            if r.audience == "student":
                mine = by_group.get((norm_dept(r.department), norm_batch(r.batch), norm_section(r.section), wd), [])
            else:
                mine = by_teacher.get(((r.teacher_initial or "").strip().upper(), wd), [])
            if not mine:
                continue
            first = min(s.start_minutes for s in mine)
            last = max(s.end_minutes for s in mine)

            incoming = [s for s in slots_by_route.get((r.route_id, r.audience, "to_campus"), []) if wd in s.weekdays]
            if incoming:
                on_time = [s for s in incoming if s.departure_minutes + s.duration_minutes <= first - ARRIVAL_BUFFER]
                pick = on_time[-1] if on_time else incoming[0]  # nothing early enough: they take the first bus
                out.counts[(d, pick.time_slot_id)] += 1
            else:
                out.unserved_in += 1

            outgoing = [s for s in slots_by_route.get((r.route_id, r.audience, "from_campus"), []) if wd in s.weekdays]
            after = [s for s in outgoing if s.departure_minutes >= last + WALK_BUFFER]
            if after:
                out.counts[(d, after[0].time_slot_id)] += 1
            else:
                out.unserved_out += 1  # class ends after the last bus: a real gap to report
    return out
