"""Normalisation of LLM-extracted values (BE-08, contract §10 backend rules).

* units: reconcile a number the LLM returned against the snippet it quotes, so a
  value left in feet is converted to metres and the raw text is kept;
* formation names: resolved through formation_synonyms (cached 10 minutes);
* IADC codes inferred from keywords when a time-log line has none;
* event_type -> risk_type;
* bounding boxes of a snippet among a page's OCR boxes.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Any

from psycopg.types.json import Jsonb
from rapidfuzz import fuzz, process

from app import db
from app.ingest.parsers.units import UnknownUnitError, iter_quantities, to_si
from app.models.enums import EVENT_TO_RISK, EventType, RiskType

SYNONYM_CACHE_TTL_S = 600
FUZZY_FORMATION_MIN_RATIO = 90
BBOX_MIN_BOX_CHARS = 3
BBOX_MIN_RATIO = 90

# tolerance when checking that a returned number matches a quoted quantity (absolute floor; 0.5 % relative)
_ABS_TOLERANCE = {"m": 1.0, "m3": 0.05, "h": 0.05, "sg": 0.01}


def squash(text: str) -> str:
    """Lower-case with collapsed whitespace, for comparisons."""
    return re.sub(r"\s+", " ", text.strip().lower())


# ---------------------------------------------------------------- formations


class FormationResolver:
    """Canonical formation names from free text (case-insensitive, via aliases)."""

    def __init__(self, aliases: dict[str, str], canonical: dict[str, int]):
        self._lookup = {squash(alias): formation for alias, formation in aliases.items()}
        for name in canonical:
            self._lookup.setdefault(squash(name), name)
        self.strat_order = dict(canonical)  # canonical name -> strat_order (1 = shallowest)

    def resolve(self, name: str | None) -> str | None:
        if not name or not name.strip():
            return None
        key = squash(name)
        if key in self._lookup:
            return self._lookup[key]
        best = process.extractOne(key, self._lookup.keys(), scorer=fuzz.ratio, score_cutoff=FUZZY_FORMATION_MIN_RATIO)
        return self._lookup[best[0]] if best else None


_resolver: tuple[float, FormationResolver] | None = None


async def get_resolver() -> FormationResolver:
    """Formation resolver, reloaded from the database every SYNONYM_CACHE_TTL_S."""
    global _resolver
    if _resolver is None or time.monotonic() - _resolver[0] > SYNONYM_CACHE_TTL_S:
        synonyms = await db.fetch_all("select alias, formation from formation_synonyms")
        formations = await db.fetch_all("select name, strat_order from formations")
        resolver = FormationResolver(
            {row["alias"]: row["formation"] for row in synonyms},
            {row["name"]: row["strat_order"] for row in formations},
        )
        _resolver = (time.monotonic(), resolver)
    return _resolver[1]


def clear_resolver_cache() -> None:
    global _resolver
    _resolver = None


# ---------------------------------------------------------------- wells

WELL_MATCH_MIN_RATIO = 90


async def match_well(well_name: str) -> str | None:
    """wells.id whose name matches `well_name` (case-insensitive, rapidfuzz ratio >= 90).

    An exact match always wins. A fuzzy match must be unambiguous: names that
    differ by one character score 90 (SYN-DLJ-03 vs SYN-DLJ-04), so if two
    wells tie for best we leave the well unassigned for a reviewer instead of
    guessing.
    """
    wells = await db.fetch_all("select id, name from wells")
    choices = {str(w["id"]): w["name"].lower() for w in wells}
    query = well_name.strip().lower()
    for well_id, name in choices.items():
        if name == query:
            return well_id
    ranked = process.extract(query, choices, scorer=fuzz.ratio, score_cutoff=WELL_MATCH_MIN_RATIO, limit=2)
    if not ranked or (len(ranked) == 2 and ranked[0][1] == ranked[1][1]):
        return None
    return ranked[0][2]


async def flag_unmatched_well(job_id: str | None, doc_id: str, well_name: str | None) -> None:
    """Ask a reviewer to assign the well (confidence 0 keeps it in the review queue).

    contract §7: the reviewer picks the well and review_field writes documents.well_id.
    Skipped when the document already has a pending one (a retried job runs this again).
    """
    value = Jsonb({"raw": well_name, "value": None, "unit": None}) if well_name else None
    await db.execute(
        """
        insert into extracted_fields (job_id, doc_id, entity, field, value, confidence, reason)
        select %(job_id)s, %(doc_id)s, 'well_header', 'well_id', %(value)s, 0, 'unmatched_well'
        where not exists (
            select 1 from extracted_fields
            where doc_id = %(doc_id)s and entity = 'well_header' and field = 'well_id'
              and review_status = 'pending'
        )
        """,
        {"job_id": job_id, "doc_id": doc_id, "value": value},
    )


# ---------------------------------------------------------------- units


@dataclass(frozen=True)
class Reconciled:
    value: float | None
    raw: str | None  # the quantity as written in the snippet, e.g. "7870 ft"
    unit: str | None  # SI unit of `value`


def reconcile_quantity(value: float | None, snippet: str | None, si_unit: str) -> Reconciled:
    """Check `value` (expected in `si_unit`) against the quantities quoted in `snippet`.

    1. If a quoted quantity converts to ~`value`, the LLM converted correctly: keep it, remember the raw text.
    2. Else if a quoted non-SI quantity has the same *number* as `value`, the LLM copied the number without
       converting (e.g. feet): convert it here.
    3. Otherwise keep `value` and no raw text.
    """
    if value is None:
        return Reconciled(None, None, None)
    candidates = []
    for number, unit in iter_quantities(snippet or ""):
        try:
            converted, unit_si = to_si(number, unit)
        except UnknownUnitError:
            continue
        if unit_si == si_unit:
            candidates.append((number, unit, converted))

    def tolerance(reference: float) -> float:
        return max(0.005 * abs(reference), _ABS_TOLERANCE.get(si_unit, 0.01))

    for number, unit, converted in candidates:
        if abs(converted - value) <= tolerance(converted):
            return Reconciled(value, f"{number:g} {unit}", si_unit)
    for number, unit, converted in candidates:
        if abs(converted - number) > 1e-9 and abs(number - value) <= tolerance(number):
            return Reconciled(converted, f"{number:g} {unit}", si_unit)
    return Reconciled(value, None, si_unit)


# ---------------------------------------------------------------- IADC codes

# first match wins; trouble codes first (3 reaming, 5 circulate, 19 fishing, 24 NPT, 27 well control)
_IADC_RULES: tuple[tuple[re.Pattern[str], int], ...] = (
    (re.compile(r"\bfishing\b|\bovershot\b|\bjarring\b", re.I), 19),
    (re.compile(r"\bkick\b|well control|shut[- ]?in\b|flow ?check|\bsidpp\b|\bsicp\b", re.I), 27),
    (re.compile(r"\bream(ing|ed)?\b|back[- ]?ream", re.I), 3),
    (re.compile(r"wait(ing)? on cement|\bwoc\b", re.I), 13),
    (re.compile(r"\bbop test|test(ing)? (the )?bop", re.I), 15),
    (re.compile(r"run(ning)? (\S+ )?casing|casing run", re.I), 12),
    (re.compile(r"\bpooh\b|\brih\b|\btrip(ping)?\b|wiper trip", re.I), 6),
    (re.compile(r"wireline|\blogging\b|\blogs? run", re.I), 11),
    (re.compile(r"\bdrill(ed|ing)?\b", re.I), 2),
    (re.compile(r"\bcirculat", re.I), 5),
)
_LOSS_RE = re.compile(r"\blosses\b|\bloss of (returns|circulation)\b|\blcm\b|lost circulation", re.I)


def infer_iadc_code(text: str | None) -> int | None:
    """IADC DDR Plus code from keywords in a time-log line, None if nothing matches."""
    if not text:
        return None
    if _LOSS_RE.search(text):
        return 5 if re.search(r"circulat", text, re.I) else 24
    for pattern, code in _IADC_RULES:
        if pattern.search(text):
            return code
    return None


# ---------------------------------------------------------------- events


def risk_type_for(event_type: EventType | str) -> RiskType | None:
    return EVENT_TO_RISK[EventType(event_type)]


# ---------------------------------------------------------------- bounding boxes


def find_bbox(snippet: str | None, boxes: list[dict[str, Any]] | None) -> dict[str, float] | None:
    """Union of the OCR boxes whose text lies inside `snippet`, as page fractions; None if none do."""
    if not snippet or not boxes:
        return None
    target = squash(snippet)
    matched = []
    for box in boxes:
        text = squash(box.get("text") or "")
        if len(text) < BBOX_MIN_BOX_CHARS:
            continue
        if text in target or fuzz.partial_ratio(text, target) >= BBOX_MIN_RATIO:
            matched.append(box["bbox"])
    if not matched:
        return None
    x0 = min(b["x"] for b in matched)
    y0 = min(b["y"] for b in matched)
    x1 = max(b["x"] + b["w"] for b in matched)
    y1 = max(b["y"] + b["h"] for b in matched)
    return {"x": round(x0, 5), "y": round(y0, 5), "w": round(x1 - x0, 5), "h": round(y1 - y0, 5)}
