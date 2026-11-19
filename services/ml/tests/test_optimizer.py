from app.optimizer import greedy_plan, optimize
from app.schemas import FixedAllocation, PlanBus, PlanRequest, PlanSlot


def bus(code, cap, pool="student"):
    return PlanBus(bus_id=code, code=code, operator_code=code[0], capacity=cap, pool=pool)


def slot(sid, demand, start, end, aud="student"):
    return PlanSlot(time_slot_id=sid, demand=demand, window_start=start, window_end=end, audience=aud)


FLEET = [bus("H-10", 40), bus("H-12", 40), bus("M-03", 36), bus("S-01", 30), bus("S-02", 30)]


def by_slot(plan):
    return {a.time_slot_id: a for a in plan.assignments}


def test_covers_demand_with_few_buses_and_little_waste():
    plan = optimize(PlanRequest(date="2026-11-21", slots=[slot("a", 70, 420, 525)], buses=FLEET, buffer_pct=0))
    a = by_slot(plan)["a"]
    assert plan.status == "optimal"
    assert a.shortfall == 0
    assert len(a.bus_ids) == 2
    assert a.seats == 70  # H 40 + S 30, no empty seats


def test_never_puts_one_bus_on_overlapping_trips():
    slots = [slot("a", 80, 420, 525), slot("b", 80, 450, 560), slot("c", 40, 600, 700)]
    plan = optimize(PlanRequest(date="d", slots=slots, buses=FLEET, buffer_pct=0))
    p = by_slot(plan)
    assert not set(p["a"].bus_ids) & set(p["b"].bus_ids)
    # The 10:00 trip does not overlap, so buses can be reused.
    assert p["c"].shortfall == 0


def test_reports_shortfall_when_the_fleet_is_too_small():
    plan = optimize(PlanRequest(date="d", slots=[slot("a", 300, 420, 525)], buses=FLEET, buffer_pct=0))
    assert plan.status == "partial"
    assert by_slot(plan)["a"].shortfall == 300 - 176


def test_keeps_fixed_buses_and_blocks_them_from_overlapping_slots():
    slots = [slot("fixed", 40, 420, 525), slot("other", 40, 450, 560)]
    plan = optimize(PlanRequest(date="d", slots=slots, buses=FLEET, fixed=[FixedAllocation(time_slot_id="fixed", bus_ids=["H-10"])], buffer_pct=0))
    p = by_slot(plan)
    assert "fixed" not in p
    assert "H-10" not in p["other"].bus_ids


def test_prefers_own_pool_buses():
    fleet = [bus("H-10", 40), bus("H-30", 40, pool="faculty")]
    plan = optimize(PlanRequest(date="d", slots=[slot("f", 30, 450, 560, aud="faculty")], buses=fleet, buffer_pct=0))
    assert by_slot(plan)["f"].bus_ids == ["H-30"]


def test_buffer_adds_safety_seats():
    plan = optimize(PlanRequest(date="d", slots=[slot("a", 60, 420, 525)], buses=FLEET, buffer_pct=0.2))
    assert by_slot(plan)["a"].seats >= 72


def test_greedy_fallback_respects_overlaps_too():
    slots = [slot("a", 80, 420, 525), slot("b", 80, 450, 560)]
    p = by_slot(greedy_plan(PlanRequest(date="d", slots=slots, buses=FLEET, buffer_pct=0)))
    assert not set(p["a"].bus_ids) & set(p["b"].bus_ids)
