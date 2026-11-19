"""Request/response models. Field names are camelCase on the wire to match the TypeScript API."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")


Audience = Literal["student", "faculty"]
Direction = Literal["to_campus", "from_campus"]


class Rider(Model):
    rider_key: str
    audience: Audience
    route_id: str
    department: str | None = None
    batch: str | None = None
    section: str | None = None
    teacher_initial: str | None = None


class Session(Model):
    department: str
    batch: str | None = None
    section: str | None = None
    teacher_initial: str | None = None
    weekday: int = Field(ge=0, le=6)
    start_minutes: int = Field(ge=0, lt=1440)
    end_minutes: int = Field(ge=0, le=1440)
    course_code: str | None = None
    room: str | None = None


class Slot(Model):
    time_slot_id: str
    route_id: str
    direction: Direction
    audience: Audience
    departure_minutes: int
    duration_minutes: int
    weekdays: list[int]


class CalendarDay(Model):
    date: str
    kind: str
    cancels_service: bool = False


class HistoryRow(Model):
    date: str
    time_slot_id: str
    boarded: int


class ForecastRequest(Model):
    dates: list[str] = Field(min_length=1, max_length=31)
    riders: list[Rider]
    sessions: list[Session]
    slots: list[Slot]
    calendar: list[CalendarDay] = []
    history: list[HistoryRow] = []
    attendance_factor_cold_start: float = Field(default=0.85, ge=0.3, le=1.0)


class ForecastRow(Model):
    date: str
    time_slot_id: str
    expected_max: int
    predicted: int
    p90: int


class ForecastResponse(Model):
    model_version: str
    rows: list[ForecastRow]
    unserved: dict[str, int] = {}


class PlanSlot(Model):
    time_slot_id: str
    demand: int = Field(ge=0)
    window_start: int
    window_end: int
    audience: Audience


class PlanBus(Model):
    bus_id: str
    code: str
    operator_code: str
    capacity: int = Field(gt=0)
    pool: Audience


class FixedAllocation(Model):
    time_slot_id: str
    bus_ids: list[str]


class PlanRequest(Model):
    date: str
    slots: list[PlanSlot]
    buses: list[PlanBus]
    fixed: list[FixedAllocation] = []
    buffer_pct: float = Field(default=0.1, ge=0, le=0.5)


class Assignment(Model):
    time_slot_id: str
    bus_ids: list[str]
    seats: int
    shortfall: int


class PlanResponse(Model):
    status: Literal["optimal", "feasible", "partial", "greedy"]
    assignments: list[Assignment]


class ParsedRoutine(Model):
    content_hash: str
    department: str
    sessions: list[Session]
    warnings: list[str]


class FetchRequest(Model):
    url: str
    department: str
