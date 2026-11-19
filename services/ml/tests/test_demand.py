from app.demand import expected_demand, norm_dept, weekday_js
from app.schemas import CalendarDay, Rider, Session, Slot

SAT = "2026-11-21"  # Saturday


def slot(sid, direction, dep, dur=75, aud="student", route="R-01"):
    return Slot(time_slot_id=sid, route_id=route, direction=direction, audience=aud, departure_minutes=dep, duration_minutes=dur, weekdays=[0, 1, 2, 3, 4, 6])


SLOTS = [slot("in-0700", "to_campus", 420), slot("in-0830", "to_campus", 510), slot("out-1300", "from_campus", 780), slot("out-1630", "from_campus", 990)]
KHALIL = Rider(rider_key="k", audience="student", route_id="R-01", department="Software Engineering", batch="41", section="G")


def test_weekday_matches_javascript():
    assert weekday_js(SAT) == 6
    assert weekday_js("2026-11-20") == 5


def test_department_names_are_normalised():
    assert norm_dept("Dept. of Software Engineering") == norm_dept("SWE") == "SWE"
    assert norm_dept("Computer Science and Engineering") == "CSE"


def test_rider_takes_latest_bus_that_arrives_in_time_and_first_bus_after_class():
    # Class 08:30-11:30: the 07:00 bus arrives 08:15 (ok), the 08:30 bus arrives 09:45 (late).
    sessions = [Session(department="SWE", batch="41", section="G", weekday=6, start_minutes=510, end_minutes=600),
                Session(department="SWE", batch="41", section="G", weekday=6, start_minutes=600, end_minutes=690)]
    d = expected_demand([SAT], [KHALIL], sessions, SLOTS, [])
    assert dict(d.counts) == {(SAT, "in-0700"): 1, (SAT, "out-1300"): 1}


def test_later_class_uses_later_bus():
    sessions = [Session(department="SWE", batch="41", section="G", weekday=6, start_minutes=600, end_minutes=870)]  # 10:00-14:30
    d = expected_demand([SAT], [KHALIL], sessions, SLOTS, [])
    assert dict(d.counts) == {(SAT, "in-0830"): 1, (SAT, "out-1630"): 1}


def test_no_class_no_trip_and_holidays_are_skipped():
    sessions = [Session(department="SWE", batch="41", section="G", weekday=0, start_minutes=510, end_minutes=600)]
    assert dict(expected_demand([SAT], [KHALIL], sessions, SLOTS, []).counts) == {}
    on_sat = [Session(department="SWE", batch="41", section="G", weekday=6, start_minutes=510, end_minutes=600)]
    closed = [CalendarDay(date=SAT, kind="holiday", cancels_service=True)]
    assert dict(expected_demand([SAT], [KHALIL], on_sat, SLOTS, closed).counts) == {}


def test_class_ending_after_last_bus_is_reported_as_unserved():
    sessions = [Session(department="SWE", batch="41", section="G", weekday=6, start_minutes=1020, end_minutes=1110)]  # 17:00-18:30
    d = expected_demand([SAT], [KHALIL], sessions, SLOTS, [])
    assert d.unserved_out == 1


def test_faculty_are_matched_by_teacher_initial():
    fac = Rider(rider_key="f", audience="faculty", route_id="R-01", teacher_initial="mrh")
    sessions = [Session(department="SWE", batch="41", section="G", teacher_initial="MRH", weekday=6, start_minutes=600, end_minutes=690)]
    slots = [slot("fin", "to_campus", 450, aud="faculty"), slot("fout", "from_campus", 1020, aud="faculty")]
    d = expected_demand([SAT], [fac], sessions, slots, [])
    assert dict(d.counts) == {(SAT, "fin"): 1, (SAT, "fout"): 1}
