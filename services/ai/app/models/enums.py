"""Contract §5: enums and the event_type -> risk_type mapping."""

from __future__ import annotations

from enum import StrEnum


class UserRole(StrEnum):
    RIG_ENGINEER = "rig_engineer"
    RTOC_ENGINEER = "rtoc_engineer"
    OFFICE_ENGINEER = "office_engineer"
    REVIEWER = "reviewer"
    ADMIN = "admin"


class Provenance(StrEnum):
    DIRECT = "direct"
    ANALOG = "analog"
    SYNTHETIC = "synthetic"


class WellStatus(StrEnum):
    PLANNED = "planned"
    DRILLING = "drilling"
    COMPLETED = "completed"


class DocType(StrEnum):
    WCR = "wcr"
    DDR = "ddr"
    MUD_LOG = "mud_log"
    PROGRAM = "program"
    CEMENT_REPORT = "cement_report"
    INCIDENT = "incident"
    SURVEY = "survey"
    LAS = "las"
    WITSML = "witsml"
    OTHER = "other"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    NEEDS_REVIEW = "needs_review"
    DONE = "done"
    FAILED = "failed"


class ReviewStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    EDITED = "edited"
    REJECTED = "rejected"
    AUTO_APPROVED = "auto_approved"


class EventType(StrEnum):
    LOSS_PARTIAL = "loss_partial"
    LOSS_TOTAL = "loss_total"
    KICK = "kick"
    STUCK_PIPE_DIFF = "stuck_pipe_diff"
    STUCK_PIPE_MECH = "stuck_pipe_mech"
    TIGHT_HOLE = "tight_hole"
    PACK_OFF = "pack_off"
    HOLE_INSTABILITY = "hole_instability"
    FISHING = "fishing"
    TORQUE_SPIKE = "torque_spike"
    CEMENT_FAILURE = "cement_failure"
    EQUIPMENT_FAILURE = "equipment_failure"
    OTHER = "other"


class RiskType(StrEnum):
    LOSSES = "losses"
    STUCK_PIPE = "stuck_pipe"
    KICK = "kick"
    TORQUE = "torque"
    CEMENTING = "cementing"


class RiskBand(StrEnum):
    LOW = "low"
    MODERATE = "moderate"
    ELEVATED = "elevated"
    HIGH = "high"
    CRITICAL = "critical"


class AlertSeverity(StrEnum):
    INFO = "info"
    WATCH = "watch"
    WARNING = "warning"
    CRITICAL = "critical"


class AlertKind(StrEnum):
    LOOKAHEAD = "lookahead"
    DETECTOR = "detector"
    SYSTEM = "system"


class AlertState(StrEnum):
    GENERATED = "generated"
    SENT = "sent"
    VIEWED = "viewed"
    ESCALATED = "escalated"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"
    FEEDBACK = "feedback"


class ResolveHow(StrEnum):
    AUTO = "auto"
    MANUAL = "manual"
    DISMISSED = "dismissed"


class AlertOutcome(StrEnum):
    EVENT_OCCURRED = "event_occurred"
    AVOIDED = "avoided"
    FALSE_ALARM = "false_alarm"
    UNKNOWN = "unknown"


class ConfidenceLevel(StrEnum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class StreamStatus(StrEnum):
    STOPPED = "stopped"
    LIVE = "live"
    STALE = "stale"
    LOST = "lost"


class TopSource(StrEnum):
    ACTUAL = "actual"
    PROGNOSIS = "prognosis"
    PREDICTED = "predicted"


# contract §5: "event_type -> risk_type mapping". fishing / equipment_failure / other
# are stored but not scored, so they map to None rather than being omitted.
EVENT_TO_RISK: dict[EventType, RiskType | None] = {
    EventType.LOSS_PARTIAL: RiskType.LOSSES,
    EventType.LOSS_TOTAL: RiskType.LOSSES,
    EventType.KICK: RiskType.KICK,
    EventType.STUCK_PIPE_DIFF: RiskType.STUCK_PIPE,
    EventType.STUCK_PIPE_MECH: RiskType.STUCK_PIPE,
    EventType.TIGHT_HOLE: RiskType.STUCK_PIPE,
    EventType.PACK_OFF: RiskType.STUCK_PIPE,
    EventType.HOLE_INSTABILITY: RiskType.STUCK_PIPE,
    EventType.TORQUE_SPIKE: RiskType.TORQUE,
    EventType.CEMENT_FAILURE: RiskType.CEMENTING,
    EventType.FISHING: None,
    EventType.EQUIPMENT_FAILURE: None,
    EventType.OTHER: None,
}
