import io

from openpyxl import Workbook

from app.routine_parser import parse_cell, parse_file, parse_time_range

TEMPLATE = """department,batch,section,teacher_initial,day,start_time,end_time,course_code,room
SWE,41,G,MRH,Saturday,08:30,10:00,SE331,AB4-602
SWE,41,G,NRS,Sat,10:00,11:30,SE333,AB4-602
SWE,41,G,,Funday,10:00,11:30,SE999,AB4-602
"""


def test_time_ranges_and_afternoon_guess():
    assert parse_time_range("08:30 - 10:00") == (510, 600)
    assert parse_time_range("1:00-2:30") == (780, 870)
    assert parse_time_range("2:30 PM - 4:00 PM") == (870, 960)
    assert parse_time_range("room 602") is None


def test_cell_formats():
    [c] = parse_cell("SE331 (41_G) MRH")
    assert (c.course_code, c.batch, c.section, c.teacher_initial) == ("SE331", "41", "G", "MRH")
    [c] = parse_cell("CSE 223 [59-D] ABK")
    assert (c.course_code, c.batch, c.section, c.teacher_initial) == ("CSE223", "59", "D", "ABK")
    assert len(parse_cell("SE331 (41_G) MRH\nSE331 (41_H) MRH")) == 2
    assert parse_cell("Lunch break") == []


def test_template_csv():
    r = parse_file("routine.csv", TEMPLATE.encode(), "SWE")
    assert len(r.sessions) == 2
    s = r.sessions[0]
    assert (s.weekday, s.start_minutes, s.end_minutes, s.batch, s.section, s.teacher_initial) == (6, 510, 600, "41", "G", "MRH")
    assert any("row 4" in w for w in r.warnings)


def test_grid_with_times_across_the_top():
    csv_grid = "\n".join([
        "Saturday,,,",
        "Room,08:30-10:00,10:00-11:30,11:30-1:00",
        "AB4-602,SE331 (41_G) MRH,SE333 (41_G) NRS,",
        "AB4-603,,SE215 (43_A) TBR,SE217 (43_A) TBR",
        "Sunday,,,",
        "Room,08:30-10:00,10:00-11:30,11:30-1:00",
        "AB4-602,SE331 (41_H) MRH,,",
    ])
    r = parse_file("grid.csv", csv_grid.encode(), "SWE")
    keyed = {(s.weekday, s.start_minutes, s.batch, s.section) for s in r.sessions}
    assert keyed == {(6, 510, "41", "G"), (6, 600, "41", "G"), (6, 600, "43", "A"), (6, 690, "43", "A"), (0, 510, "41", "H")}
    assert {s.room for s in r.sessions if s.weekday == 0} == {"AB4-602"}


def test_xlsx_sheet_named_after_the_day():
    wb = Workbook()
    ws = wb.active
    ws.title = "Monday"
    ws.append(["Room", "08:30-10:00", "10:00-11:30"])
    ws.append(["AB4-701", "SE331 (41_G) MRH", "SE341 (42_B) KMR"])
    buf = io.BytesIO()
    wb.save(buf)
    r = parse_file("routine.xlsx", buf.getvalue(), "SWE")
    assert {(s.weekday, s.course_code) for s in r.sessions} == {(1, "SE331"), (1, "SE341")}


def test_same_classes_give_the_same_hash():
    a = parse_file("a.csv", TEMPLATE.encode(), "SWE")
    b = parse_file("b.csv", TEMPLATE.replace("AB4-602", "AB4-602").encode(), "SWE")
    assert a.content_hash == b.content_hash
    c = parse_file("c.csv", TEMPLATE.replace("08:30,10:00", "08:30,10:30").encode(), "SWE")
    assert c.content_hash != a.content_hash


def test_html_table():
    html = b"<table><tr><th>Day</th><th>08:30-10:00</th><th>10:00-11:30</th></tr><tr><td>Tuesday</td><td>SE331 (41_G) MRH</td><td></td></tr></table>"
    r = parse_file("r.html", html, "SWE")
    assert [(s.weekday, s.course_code) for s in r.sessions] == [(2, "SE331")]
