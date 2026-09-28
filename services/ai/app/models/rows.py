"""Pydantic v2 models mirroring contract §6 table rows the backend reads/writes.

Field names are identical to column names; a field is Optional exactly where
the column is nullable. Tables not read/written directly by the backend
(formations, hole_sections, cement_jobs, mud_records, time_log, ...) are out
of scope for this module.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import (
    AlertKind,
    AlertOutcome,
    AlertSeverity,
    AlertState,
    ConfidenceLevel,
    DocType,
    EventType,
    JobStatus,
    Provenance,
    ResolveHow,
    ReviewStatus,
    RiskBand,
    RiskType,
    StreamStatus,
    TopSource,
    WellStatus,
)


class NwisRow(BaseModel):
    """Base for row models: tolerant of columns not yet mirrored here."""

    model_config = ConfigDict(extra="ignore")


WellboreKind = Literal["vertical", "deviated", "horizontal"]
ExtractedFieldEntity = Literal[
    "event",
    "formation_top",
    "hole_section",
    "cement_job",
    "mud_record",
    "survey_station",
    "well_header",
    "time_log",
]


class Well(NwisRow):
    id: UUID
    name: str
    field: str | None = None
    basin: str | None = None
    operator: str | None = None
    surface: str | None = None  # geography(Point,4326); WKB/GeoJSON depending on the query
    datum_src: str = "WGS84"
    kb_elev_m: float | None = None
    spud_date: date | None = None
    td_md_m: float | None = None
    td_tvd_m: float | None = None
    status: WellStatus = WellStatus.COMPLETED
    provenance: Provenance
    created_at: datetime


class Wellbore(NwisRow):
    id: UUID
    well_id: UUID
    name: str
    kind: WellboreKind = "deviated"
    is_primary: bool = True


class SurveyStation(NwisRow):
    wellbore_id: UUID
    md_m: float
    inc_deg: float
    azi_deg: float
    tvd_m: float
    north_m: float
    east_m: float
    dls_deg_per_30m: float | None = None


class FormationTop(NwisRow):
    id: UUID
    wellbore_id: UUID
    formation: str
    top_md_m: float
    top_tvdss_m: float | None = None
    source: TopSource = TopSource.ACTUAL
    uncertainty_m: float | None = None
    n_offsets: int | None = None
    provenance: Provenance
    doc_id: UUID | None = None
    page: int | None = None


class Event(NwisRow):
    id: UUID
    wellbore_id: UUID
    event_type: EventType
    risk_type: RiskType | None = None
    md_from_m: float
    md_to_m: float | None = None
    formation: str | None = None
    relative_depth: float | None = None
    severity: int | None = Field(default=None, ge=1, le=5)
    npt_h: float | None = None
    volume_m3: float | None = None
    description: str
    cause: str | None = None
    action: str | None = None
    outcome: str | None = None
    event_date: date | None = None
    doc_id: UUID | None = None
    page: int | None = None
    snippet: str | None = None
    confidence: float | None = None
    provenance: Provenance
    review_status: ReviewStatus = ReviewStatus.PENDING
    created_at: datetime


class Document(NwisRow):
    id: UUID
    well_id: UUID | None = None
    wellbore_id: UUID | None = None
    doc_type: DocType = DocType.OTHER
    title: str
    file_path: str
    sha256: str
    pages: int | None = None
    has_text_layer: bool | None = None
    ocr_engine: str | None = None
    provenance: Provenance = Provenance.DIRECT
    uploaded_by: UUID | None = None
    created_at: datetime


class DocumentPage(NwisRow):
    doc_id: UUID
    page_no: int
    image_path: str | None = None
    text: str | None = None
    ocr_confidence: float | None = None
    engine: str | None = None


class Job(NwisRow):
    id: UUID
    doc_id: UUID
    status: JobStatus = JobStatus.QUEUED
    stage: str | None = None
    progress: int = Field(default=0, ge=0, le=100)
    error: str | None = None
    created_by: UUID | None = None
    created_at: datetime
    updated_at: datetime


class ExtractedField(NwisRow):
    id: UUID
    job_id: UUID | None = None
    doc_id: UUID
    page: int | None = None
    entity: ExtractedFieldEntity
    entity_id: UUID | None = None
    field: str
    value: Any = None
    confidence: float
    reason: str | None = None
    bbox: dict[str, float] | None = None
    review_status: ReviewStatus = ReviewStatus.PENDING
    reviewed_by: UUID | None = None
    reviewed_at: datetime | None = None


class Chunk(NwisRow):
    id: UUID
    doc_id: UUID
    page: int | None = None
    text: str
    embedding: list[float] | None = None
    well_id: UUID | None = None
    formation: str | None = None
    md_from_m: float | None = None
    md_to_m: float | None = None


class Lesson(NwisRow):
    id: UUID
    formation: str | None = None
    event_type: EventType
    title: str
    problem: str
    cause: str | None = None
    mitigation: str | None = None
    outcome: str | None = None
    event_ids: list[UUID] = Field(default_factory=list)
    well_count: int = 0
    success_rate: float | None = None
    updated_at: datetime


class RiskScore(NwisRow):
    wellbore_id: UUID
    md_from_m: float
    md_to_m: float
    risk_type: RiskType
    l1: float | None = None
    l2: float | None = None
    l3: float | None = None
    fused: float
    band: RiskBand
    confidence: ConfidenceLevel
    confidence_reason: str | None = None
    reasons: list[dict[str, Any]] = Field(default_factory=list)
    formation: str | None = None
    model_version: str | None = None
    computed_at: datetime


class StreamState(NwisRow):
    wellbore_id: UUID
    status: StreamStatus = StreamStatus.STOPPED
    source: str | None = None
    speed: int = 1
    bit_md_m: float | None = None
    hole_md_m: float | None = None
    last_sample_at: datetime | None = None
    latest: dict[str, Any] | None = None
    updated_at: datetime


class Alert(NwisRow):
    id: UUID
    wellbore_id: UUID
    kind: AlertKind
    risk_type: RiskType | None = None
    severity: AlertSeverity
    state: AlertState = AlertState.GENERATED
    dedup_key: str
    zone_md_from_m: float | None = None
    zone_md_to_m: float | None = None
    expected_md_m: float | None = None
    formation: str | None = None
    score: float | None = None
    confidence: ConfidenceLevel | None = None
    title: str
    message: str
    recommendation: str | None = None
    evidence: dict[str, Any] = Field(default_factory=dict)
    model_version: str | None = None
    created_at: datetime
    sent_at: datetime | None = None
    escalated_at: datetime | None = None
    acknowledged_by: UUID | None = None
    acknowledged_at: datetime | None = None
    action_note: str | None = None
    resolved_by: UUID | None = None
    resolved_at: datetime | None = None
    resolved_how: ResolveHow | None = None
    outcome: AlertOutcome | None = None
    dismiss_reason: str | None = None
    useful: bool | None = None
    feedback_by: UUID | None = None
    feedback_at: datetime | None = None


class ModelRun(NwisRow):
    id: UUID
    risk_type: RiskType
    version: str
    metrics: dict[str, Any]
    params: dict[str, Any] | None = None
    artifact_path: str | None = None
    is_active: bool = False
    created_at: datetime
