"""Validation rules and confidence for extracted items (BE-08, contract §10).

Pure functions, no database. A rule failure costs RULE_PENALTY confidence per
failed rule and caps the item at RULE_CONFIDENCE_CAP (contract: "<= 0.5"), so a
failed item is never auto-approved.

Reason strings (stored in extracted_fields.reason, shown by the review screen):
  failed_rule:depth_gt_td | failed_rule:depth_negative | failed_rule:formation_order |
  failed_rule:date_out_of_range | failed_rule:mw_out_of_range | snippet_not_found |
  unknown_formation | low_ocr_confidence
`Verdict.reason` is the single most important one; `Verdict.reasons` lists all.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any

from rapidfuzz import fuzz

from app.ingest.normalize import squash
from app.models.enums import ReviewStatus

AUTO_APPROVE_AT = 0.85
RULE_PENALTY = 0.3
CONFIDENCE_FLOOR = 0.05
RULE_CONFIDENCE_CAP = 0.5
UNKNOWN_FORMATION_CAP = 0.80  # below the auto-approve line: a person confirms the formation
LOW_OCR_BELOW = 0.60
TD_TOLERANCE_M = 50.0
MIN_DATE = date(1950, 1, 1)
MW_RANGE_SG = (0.8, 2.4)
SNIPPET_MIN_RATIO = 80

DEPTH_FIELDS = ("md_from_m", "md_to_m", "top_md_m", "md_m", "shoe_md_m", "toc_md_m", "md_from", "md_to")
DATE_FIELDS = ("event_date", "report_date", "spud_date")

# order of importance for the single `reason` shown to the reviewer
_REASON_PRIORITY = (
    "failed_rule:depth_gt_td",
    "failed_rule:depth_negative",
    "failed_rule:formation_order",
    "failed_rule:date_out_of_range",
    "failed_rule:mw_out_of_range",
    "snippet_not_found",
    "unknown_formation",
    "low_ocr_confidence",
)


@dataclass(frozen=True)
class Verdict:
    confidence: float
    review_status: ReviewStatus
    failed_rules: tuple[str, ...] = field(default=())
    reasons: tuple[str, ...] = field(default=())

    @property
    def reason(self) -> str | None:
        return self.reasons[0] if self.reasons else None


def snippet_found(snippet: str | None, page_text: str | None) -> bool:
    """The quoted snippet appears on the page (fuzzy: OCR noise and spacing are tolerated)."""
    if not snippet or not snippet.strip() or page_text is None:
        return False
    return fuzz.partial_ratio(squash(snippet), squash(page_text)) >= SNIPPET_MIN_RATIO


def check_formation_order(tops: list[tuple[float, int]]) -> set[int]:
    """Indexes of tops that break the stratigraphic order.

    `tops` is [(top_md_m, strat_order)] per top (index = position in the list). Going down the
    hole the strat_order must not decrease; a top that is shallower in the column than one already
    seen at smaller depth is flagged.
    """
    flagged: set[int] = set()
    deepest_order = None
    for index, (_md, order) in sorted(enumerate(tops), key=lambda pair: pair[1][0]):
        if deepest_order is not None and order < deepest_order:
            flagged.add(index)
        else:
            deepest_order = order
    return flagged


def check_item(
    values: dict[str, Any],
    *,
    llm_confidence: float,
    snippet: str | None,
    page_text: str | None,
    ocr_confidence: float | None,
    td_md_m: float | None = None,
    formation_order_ok: bool = True,
    unknown_formation: bool = False,
    check_snippet: bool = True,
    today: date | None = None,
) -> Verdict:
    """Apply the contract §10 rules to one item and combine the confidence.

    `values` holds the item's numbers/dates in SI under their column names
    (md_from_m, top_md_m, mw_sg, event_date, ...). Rules whose inputs are missing are skipped.
    """
    today = today or date.today()
    failed: list[str] = []

    depths = [values[name] for name in DEPTH_FIELDS if values.get(name) is not None]
    if td_md_m is not None and any(depth > td_md_m + TD_TOLERANCE_M for depth in depths):
        failed.append("failed_rule:depth_gt_td")
    if any(depth < 0 for depth in depths):
        failed.append("failed_rule:depth_negative")
    if not formation_order_ok:
        failed.append("failed_rule:formation_order")
    dates = [values[name] for name in DATE_FIELDS if values.get(name) is not None]
    if any(d < MIN_DATE or d > today for d in dates):
        failed.append("failed_rule:date_out_of_range")
    mw = values.get("mw_sg")
    if mw is not None and not MW_RANGE_SG[0] <= mw <= MW_RANGE_SG[1]:
        failed.append("failed_rule:mw_out_of_range")
    if check_snippet and page_text is not None and not snippet_found(snippet, page_text):
        failed.append("snippet_not_found")

    reasons = list(failed)
    if unknown_formation:
        reasons.append("unknown_formation")
    if ocr_confidence is not None and ocr_confidence < LOW_OCR_BELOW:
        reasons.append("low_ocr_confidence")
    reasons.sort(key=_REASON_PRIORITY.index)

    confidence = min(llm_confidence, ocr_confidence if ocr_confidence is not None else 1.0)
    confidence = max(CONFIDENCE_FLOOR, confidence - RULE_PENALTY * len(failed))
    if failed:
        confidence = min(confidence, RULE_CONFIDENCE_CAP)
    if unknown_formation:
        confidence = min(confidence, UNKNOWN_FORMATION_CAP)

    status = ReviewStatus.AUTO_APPROVED if confidence >= AUTO_APPROVE_AT else ReviewStatus.PENDING
    return Verdict(round(confidence, 4), status, tuple(failed), tuple(reasons))
