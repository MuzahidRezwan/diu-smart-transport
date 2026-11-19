"""
Class routine parsing.

Two layouts are understood:

1. The standard template (recommended; see data/routine-template.csv):
     department,batch,section,teacher_initial,day,start_time,end_time,course_code,room

2. The usual department "grid": time ranges across the top (or down the side),
   rooms on the other axis, a day name above each block, and cells such as
     "SE331 (41_G) MRH"   ->  course SE331, batch 41, section G, teacher MRH

Files: CSV, XLSX, PDF (tables via pdfplumber) and HTML tables.
Anything that cannot be read is listed in `warnings` so a person can check it
before the routine is activated.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import re
from dataclasses import dataclass

from .schemas import ParsedRoutine, Session

DAYS = {
    "sun": 0, "sunday": 0, "mon": 1, "monday": 1, "tue": 2, "tues": 2, "tuesday": 2, "wed": 3, "wednesday": 3,
    "thu": 4, "thur": 4, "thurs": 4, "thursday": 4, "fri": 5, "friday": 5, "sat": 6, "saturday": 6,
}
TIME_RANGE = re.compile(r"(\d{1,2})[:.](\d{2})\s*(am|pm)?\s*(?:-|–|—|to)\s*(\d{1,2})[:.](\d{2})\s*(am|pm)?", re.I)
TIME_ONE = re.compile(r"^\s*(\d{1,2})[:.](\d{2})\s*(am|pm)?\s*$", re.I)
COURSE = re.compile(r"\b([A-Z]{2,4})\s?-?(\d{3,4})\b")
BATCH_SECTION_BRACKETED = re.compile(r"[(\[]\s*(\d{2,3})\s*[_\-/ ]?\s*([A-Z])\d?\s*[)\]]")
BATCH_SECTION_PLAIN = re.compile(r"(?<![\dA-Za-z])(\d{2,3})\s*[_\-]\s*([A-Z])(?![A-Za-z])")
INITIALS = re.compile(r"\b([A-Z]{2,5})\b")
TEMPLATE_COLUMNS = {"department", "batch", "section", "teacher_initial", "day", "start_time", "end_time"}


def _minutes(h: str, m: str, ap: str | None, assume_pm_below: int = 8) -> int:
    hour, minute = int(h), int(m)
    if ap:
        ap = ap.lower()
        if ap == "pm" and hour != 12:
            hour += 12
        if ap == "am" and hour == 12:
            hour = 0
    elif 1 <= hour < assume_pm_below:
        hour += 12  # "1:00-2:30" in a university routine means afternoon
    return hour * 60 + minute


def parse_time_range(text: str) -> tuple[int, int] | None:
    m = TIME_RANGE.search(text or "")
    if not m:
        return None
    start = _minutes(m.group(1), m.group(2), m.group(3) or m.group(6))
    end = _minutes(m.group(4), m.group(5), m.group(6) or m.group(3))
    if end <= start:
        end += 12 * 60 if end + 12 * 60 > start else 0
    return (start, end) if end > start else None


def parse_day(text: str) -> int | None:
    t = (text or "").strip().lower().rstrip(".:")
    if t in DAYS:
        return DAYS[t]
    if t.isdigit() and 0 <= int(t) <= 6:
        return int(t)
    first = re.split(r"[\s,(]", t)[0] if t else ""
    return DAYS.get(first)


@dataclass
class CellClass:
    course_code: str | None
    batch: str | None
    section: str | None
    teacher_initial: str | None


def parse_cell(text: str) -> list[CellClass]:
    """A cell can hold more than one class (merged sections or two lines)."""
    out = []
    for part in re.split(r"\n|;|\s{3,}", text or ""):
        part = part.strip()
        if not part:
            continue
        course = COURSE.search(part)
        bs = BATCH_SECTION_BRACKETED.search(part) or BATCH_SECTION_PLAIN.search(part)
        if not course and not bs:
            continue
        rest = part
        for m in (course, bs):
            if m:
                rest = rest.replace(m.group(0), " ")
        initials = [t for t in INITIALS.findall(rest) if not (course and t == course.group(1))]
        out.append(CellClass(
            course_code=f"{course.group(1)}{course.group(2)}" if course else None,
            batch=bs.group(1) if bs else None,
            section=bs.group(2) if bs else None,
            teacher_initial=initials[-1] if initials else None,
        ))
    return out


def _clean(rows: list[list]) -> list[list[str]]:
    return [[("" if c is None else str(c)).strip() for c in row] for row in rows]


def parse_template(rows: list[list[str]], department: str) -> tuple[list[Session], list[str]]:
    header = [h.strip().lower() for h in rows[0]]
    idx = {name: header.index(name) for name in header if name}
    sessions, warnings = [], []
    for n, row in enumerate(rows[1:], start=2):
        if not any(row):
            continue
        get = lambda k: row[idx[k]].strip() if k in idx and idx[k] < len(row) else ""  # noqa: E731
        day = parse_day(get("day"))
        t = parse_time_range(f"{get('start_time')}-{get('end_time')}")
        if day is None or t is None:
            warnings.append(f"row {n}: could not read day/time ({get('day')!r}, {get('start_time')!r}-{get('end_time')!r})")
            continue
        sessions.append(Session(
            department=get("department") or department, batch=get("batch") or None, section=(get("section") or None),
            teacher_initial=(get("teacher_initial") or None), weekday=day, start_minutes=t[0], end_minutes=t[1],
            course_code=get("course_code") or None, room=get("room") or None,
        ))
    return sessions, warnings


def parse_grid(rows: list[list[str]], department: str, day_hint: int | None = None) -> tuple[list[Session], list[str]]:
    sessions: list[Session] = []
    warnings: list[str] = []
    day = day_hint
    time_cols: dict[int, tuple[int, int]] = {}
    room_cols: dict[int, str] = {}
    transposed = False

    for r, row in enumerate(rows):
        nonempty = [c for c in row if c]
        if not nonempty:
            continue
        # A row that only names a day starts a new block.
        if (len(nonempty) <= 2 and parse_day(nonempty[0]) is not None and not any(parse_time_range(c) for c in nonempty)
                and not any(parse_cell(c) for c in nonempty[1:])):
            day = parse_day(nonempty[0])
            continue
        ranges = {i: parse_time_range(c) for i, c in enumerate(row)}
        ranges = {i: t for i, t in ranges.items() if t}
        if len(ranges) >= 2:  # header of times across the top
            time_cols, transposed = ranges, False
            if parse_day(row[0]) is not None:
                day = parse_day(row[0])
            continue
        if not time_cols and not transposed and r + 1 < len(rows) and len(nonempty) >= 2 and parse_time_range(rows[r + 1][0] if rows[r + 1] else ""):
            room_cols, transposed = {i: c for i, c in enumerate(row) if c and i > 0}, True  # rooms across the top, times down the side
            continue

        if parse_day(row[0]) is not None and not parse_time_range(row[0]):
            day = parse_day(row[0])
        cells: list[tuple[str, tuple[int, int], str | None]] = []
        if transposed and parse_time_range(row[0]):
            t = parse_time_range(row[0])
            cells = [(c, t, room_cols.get(i)) for i, c in enumerate(row) if i > 0 and c]  # type: ignore[misc]
        elif time_cols:
            room = row[0] if row and row[0] and parse_day(row[0]) is None else None
            cells = [(row[i], t, room) for i, t in time_cols.items() if i < len(row) and row[i]]
        for text, (start, end), room in cells:
            found = parse_cell(text)
            if not found:
                if len(text) > 2:
                    warnings.append(f"row {r + 1}: could not read cell {text[:40]!r}")
                continue
            if day is None:
                warnings.append(f"row {r + 1}: class {text[:40]!r} has no day above it")
                continue
            for c in found:
                sessions.append(Session(department=department, batch=c.batch, section=c.section, teacher_initial=c.teacher_initial,
                                        weekday=day, start_minutes=start, end_minutes=end, course_code=c.course_code, room=room))
    return sessions, warnings


def parse_rows(rows: list[list], department: str, day_hint: int | None = None) -> tuple[list[Session], list[str]]:
    rows = _clean(rows)
    rows = [r for r in rows if any(r)]
    if not rows:
        return [], ["empty table"]
    header = {c.strip().lower() for c in rows[0]}
    if TEMPLATE_COLUMNS <= header:
        return parse_template(rows, department)
    return parse_grid(rows, department, day_hint)


def _tables_from_file(name: str, data: bytes) -> list[tuple[list[list], int | None]]:
    lower = name.lower()
    if lower.endswith(".csv"):
        return [(list(csv.reader(io.StringIO(data.decode("utf-8-sig", errors="replace")))), None)]
    if lower.endswith(".xlsx"):
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        return [([list(r) for r in ws.iter_rows(values_only=True)], parse_day(ws.title)) for ws in wb.worksheets]
    if lower.endswith(".pdf"):
        import pdfplumber
        out = []
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            for page in pdf.pages:
                text = page.extract_text() or ""
                hint = next((parse_day(w) for w in text.split()[:12] if parse_day(w) is not None), None)
                for table in page.extract_tables():
                    out.append((table, hint))
        return out
    if lower.endswith((".html", ".htm")):
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(data, "lxml")
        out = []
        for table in soup.find_all("table"):
            rows = [[cell.get_text("\n", strip=True) for cell in tr.find_all(["td", "th"])] for tr in table.find_all("tr")]
            out.append((rows, None))
        return out
    raise ValueError("Unsupported file type. Use CSV, XLSX, PDF or HTML.")


def content_hash(sessions: list[Session]) -> str:
    """Hash of the classes, not the file bytes: re-exporting the same routine is not a 'new' routine."""
    key = sorted(json.dumps(s.model_dump(), sort_keys=True) for s in sessions)
    return hashlib.sha256("\n".join(key).encode()).hexdigest()


def parse_file(name: str, data: bytes, department: str) -> ParsedRoutine:
    sessions: list[Session] = []
    warnings: list[str] = []
    for rows, hint in _tables_from_file(name, data):
        s, w = parse_rows(rows, department, hint)
        sessions.extend(s)
        warnings.extend(w)
    # Drop exact duplicates (same class printed in two tables).
    unique = {json.dumps(s.model_dump(), sort_keys=True): s for s in sessions}
    sessions = list(unique.values())
    if not sessions:
        warnings.append("No classes found. Upload the standard CSV template instead.")
    return ParsedRoutine(content_hash=content_hash(sessions), department=department, sessions=sessions, warnings=warnings[:50])
