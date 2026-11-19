"""
Bus allocation as a mixed-integer program (PuLP + CBC).

  x[b, s] = 1 when bus b serves slot s
  short[s] = seats still missing in slot s

  minimise   1000 * sum(short)                  # cover demand first
           +   10 * sum(x)                      # then use as few buses as possible
           + 0.01 * sum(capacity * x)           # then waste as few seats as possible
           +   25 * sum(x on the other pool)    # student buses for faculty only if needed

  subject to sum(capacity[b] * x[b, s]) + short[s] >= target[s]      for every slot
             a bus serves at most one of any set of slots whose busy windows overlap

Buses the authority already fixed stay where they are and are blocked
from overlapping slots. If CBC is unavailable or times out, a greedy plan is used.
"""
from __future__ import annotations

import math

from .schemas import Assignment, PlanBus, PlanRequest, PlanResponse, PlanSlot

TIME_LIMIT_SECONDS = 20


def _overlap(a: PlanSlot, b: PlanSlot) -> bool:
    return a.window_start < b.window_end and b.window_start < a.window_end


def _targets(req: PlanRequest) -> dict[str, int]:
    return {s.time_slot_id: math.ceil(s.demand * (1 + req.buffer_pct)) for s in req.slots}


def _blocked(req: PlanRequest, slots: dict[str, PlanSlot]) -> dict[str, list[tuple[int, int]]]:
    """Busy windows of buses already fixed by the authority."""
    out: dict[str, list[tuple[int, int]]] = {}
    for f in req.fixed:
        s = slots.get(f.time_slot_id)
        if not s:
            continue
        for b in f.bus_ids:
            out.setdefault(b, []).append((s.window_start, s.window_end))
    return out


def greedy_plan(req: PlanRequest) -> PlanResponse:
    targets = _targets(req)
    slots = {s.time_slot_id: s for s in req.slots}
    fixed_ids = {f.time_slot_id for f in req.fixed}
    busy = _blocked(req, slots)
    out = []
    for s in sorted((x for x in req.slots if x.time_slot_id not in fixed_ids), key=lambda x: x.window_start):
        free = [b for b in req.buses if b.pool == s.audience and not any(st < s.window_end and s.window_start < en for st, en in busy.get(b.bus_id, []))]
        free.sort(key=lambda b: (-b.capacity, b.code))
        need, chosen = targets[s.time_slot_id], []
        while need > 0 and free:
            fits = [b for b in free if b.capacity >= need]
            bus = min(fits, key=lambda b: (b.capacity, b.code)) if fits else free[0]
            free.remove(bus)
            chosen.append(bus)
            need -= bus.capacity
            busy.setdefault(bus.bus_id, []).append((s.window_start, s.window_end))
        seats = sum(b.capacity for b in chosen)
        out.append(Assignment(time_slot_id=s.time_slot_id, bus_ids=[b.bus_id for b in chosen], seats=seats, shortfall=max(0, targets[s.time_slot_id] - seats)))
    return PlanResponse(status="greedy", assignments=out)


def optimize(req: PlanRequest) -> PlanResponse:
    try:
        import pulp
    except ImportError:  # pragma: no cover
        return greedy_plan(req)

    targets = _targets(req)
    all_slots = {s.time_slot_id: s for s in req.slots}
    fixed_ids = {f.time_slot_id for f in req.fixed}
    slots = [s for s in req.slots if s.time_slot_id not in fixed_ids and targets[s.time_slot_id] > 0]
    if not slots:
        return PlanResponse(status="optimal", assignments=[])
    busy = _blocked(req, all_slots)

    def usable(b: PlanBus, s: PlanSlot) -> bool:
        return not any(st < s.window_end and s.window_start < en for st, en in busy.get(b.bus_id, []))

    prob = pulp.LpProblem("bus_allocation", pulp.LpMinimize)
    x = {(b.bus_id, s.time_slot_id): pulp.LpVariable(f"x_{i}_{j}", cat="Binary")
         for i, b in enumerate(req.buses) for j, s in enumerate(slots) if usable(b, s)}
    short = {s.time_slot_id: pulp.LpVariable(f"short_{j}", lowBound=0) for j, s in enumerate(slots)}
    bus_by_id = {b.bus_id: b for b in req.buses}

    prob += (
        1000 * pulp.lpSum(short.values())
        + pulp.lpSum((10 + 0.01 * bus_by_id[b].capacity + (25 if bus_by_id[b].pool != all_slots[s].audience else 0)) * v for (b, s), v in x.items())
    )
    for s in slots:
        prob += pulp.lpSum(bus_by_id[b].capacity * v for (b, sid), v in x.items() if sid == s.time_slot_id) + short[s.time_slot_id] >= targets[s.time_slot_id]

    # Interval-graph cliques: at each slot start, all slots running at that moment.
    for b in req.buses:
        mine = [s for s in slots if (b.bus_id, s.time_slot_id) in x]
        for s in mine:
            clique = [t for t in mine if t.window_start <= s.window_start < t.window_end]
            if len(clique) > 1:
                prob += pulp.lpSum(x[(b.bus_id, t.time_slot_id)] for t in clique) <= 1

    status = prob.solve(pulp.PULP_CBC_CMD(msg=0, timeLimit=TIME_LIMIT_SECONDS))
    if pulp.LpStatus[status] not in ("Optimal", "Not Solved") and pulp.value(prob.objective) is None:
        return greedy_plan(req)
    if any(v.value() is None for v in x.values()):
        return greedy_plan(req)

    out = []
    for s in slots:
        chosen = sorted((b for (b, sid), v in x.items() if sid == s.time_slot_id and v.value() > 0.5), key=lambda b: bus_by_id[b].code)
        seats = sum(bus_by_id[b].capacity for b in chosen)
        out.append(Assignment(time_slot_id=s.time_slot_id, bus_ids=chosen, seats=seats, shortfall=max(0, targets[s.time_slot_id] - seats)))
    label = "optimal" if pulp.LpStatus[status] == "Optimal" else "feasible"
    if any(a.shortfall > 0 for a in out):
        label = "partial"
    return PlanResponse(status=label, assignments=out)
