"""Pydantic models for the LLM extraction output (contract §10).

Every field is optional except `page`, `confidence` and an event's `description`.
Inputs are parsed leniently, because one sloppy value should not discard a whole
window of extraction: an unknown `event_type` becomes `other`, an unparseable
date becomes None, and a confidence given on a 0-100 scale is rescaled.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from app.models.enums import DocType, EventType


def _lenient_date(value: Any) -> date | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value).strip()[:10])
    except ValueError:
        return None


def _lenient_datetime(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except ValueError:
        return None


class _Item(BaseModel):
    page: int
    snippet: str | None = None  # verbatim from the page, <= 300 chars
    confidence: float = Field(ge=0.0, le=1.0)

    @field_validator("confidence", mode="before")
    @classmethod
    def _scale_confidence(cls, value: Any) -> Any:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return value
        if 1.0 < number <= 100.0:
            number /= 100.0
        return min(1.0, max(0.0, number))

    @field_validator("snippet", mode="after")
    @classmethod
    def _cap_snippet(cls, value: str | None) -> str | None:
        return value[:300] if value else value


class WellHeader(BaseModel):
    field: str | None = None
    surface_lat: float | None = None
    surface_lon: float | None = None
    datum: str | None = None
    kb_elev_m: float | None = None
    spud_date: date | None = None
    td_md_m: float | None = None
    td_tvd_m: float | None = None

    @field_validator("spud_date", mode="before")
    @classmethod
    def _date(cls, value: Any) -> date | None:
        return _lenient_date(value)


class EventItem(_Item):
    event_type: EventType
    description: str
    md_from_m: float | None = None
    md_to_m: float | None = None
    formation: str | None = None
    cause: str | None = None
    action: str | None = None
    outcome: str | None = None
    npt_h: float | None = None
    volume_m3: float | None = None
    event_date: date | None = None

    @field_validator("event_type", mode="before")
    @classmethod
    def _known_event_type(cls, value: Any) -> Any:
        text = str(value).strip().lower() if value is not None else ""
        return text if text in {e.value for e in EventType} else EventType.OTHER.value

    @field_validator("event_date", mode="before")
    @classmethod
    def _date(cls, value: Any) -> date | None:
        return _lenient_date(value)


class FormationTopItem(_Item):
    formation: str
    top_md_m: float | None = None
    top_tvdss_m: float | None = None
    source: Literal["actual", "prognosis"] = "actual"

    @field_validator("source", mode="before")
    @classmethod
    def _source(cls, value: Any) -> str:
        return "prognosis" if str(value).strip().lower() in {"prognosis", "prognosed", "planned"} else "actual"


class HoleSectionItem(_Item):
    hole_size_in: float | None = None
    md_from_m: float | None = None
    md_to_m: float | None = None
    casing_od_in: float | None = None
    casing_weight_ppf: float | None = None
    casing_grade: str | None = None
    shoe_md_m: float | None = None
    toc_md_m: float | None = None


class CementJobItem(_Item):
    job_type: str | None = None
    casing_od_in: float | None = None
    slurry_density_sg: float | None = None
    volume_m3: float | None = None
    returns_to_surface: bool | None = None
    plug_bumped: bool | None = None
    woc_h: float | None = None
    cbl_result: str | None = None
    issue: str | None = None


class MudRecordItem(_Item):
    report_date: date | None = None
    md_m: float | None = None
    mud_type: str | None = None
    mw_sg: float | None = None
    pv_cp: float | None = None
    yp_lbf100ft2: float | None = None
    ecd_sg: float | None = None

    @field_validator("report_date", mode="before")
    @classmethod
    def _date(cls, value: Any) -> date | None:
        return _lenient_date(value)


class TimeLogItem(_Item):
    t_start: datetime | None = None
    t_end: datetime | None = None
    hours: float | None = None
    md_m: float | None = None
    phase: str | None = None
    iadc_code: int | None = None
    state: str | None = None
    comment: str | None = None

    @field_validator("t_start", "t_end", mode="before")
    @classmethod
    def _datetime(cls, value: Any) -> datetime | None:
        return _lenient_datetime(value)

    @field_validator("iadc_code", mode="before")
    @classmethod
    def _code(cls, value: Any) -> int | None:
        try:
            return int(value)
        except (TypeError, ValueError):
            return None


class SurveyStationItem(_Item):
    md_m: float | None = None
    inc_deg: float | None = None
    azi_deg: float | None = None


class ExtractionResult(BaseModel):
    doc_type: DocType | None = None
    well_name: str | None = None
    report_date: date | None = None
    well_header: WellHeader | None = None
    events: list[EventItem] = Field(default_factory=list)
    formation_tops: list[FormationTopItem] = Field(default_factory=list)
    hole_sections: list[HoleSectionItem] = Field(default_factory=list)
    cement_jobs: list[CementJobItem] = Field(default_factory=list)
    mud_records: list[MudRecordItem] = Field(default_factory=list)
    time_log: list[TimeLogItem] = Field(default_factory=list)
    survey_stations: list[SurveyStationItem] = Field(default_factory=list)

    @field_validator("doc_type", mode="before")
    @classmethod
    def _doc_type(cls, value: Any) -> Any:
        return value if value in {d.value for d in DocType} else None

    @field_validator("report_date", mode="before")
    @classmethod
    def _date(cls, value: Any) -> date | None:
        return _lenient_date(value)

    @field_validator(
        "events", "formation_tops", "hole_sections", "cement_jobs", "mud_records", "time_log", "survey_stations",
        mode="before",
    )
    @classmethod
    def _null_list(cls, value: Any) -> Any:
        return [] if value is None else value
