"""Well routes: predicted tops (BE-12), correlation (BE-13), risk scores (BE-17)."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, ValidationError

from app.deps import ROLES, current_user
from app.errors import NwisError
from app.geo import correlation, tops
from app.risk import fuse

router = APIRouter()

PREDICT_ROLES = ("rtoc_engineer", "office_engineer", "admin")
MAX_RADIUS_M = 50000.0


class PredictTopsRequest(BaseModel):
    radius_m: float = Field(default=tops.DEFAULT_RADIUS_M, gt=0, le=MAX_RADIUS_M)


def wellbore_uuid(value: str) -> str:
    try:
        return str(UUID(value))
    except ValueError as exc:
        raise NwisError("NWIS_BAD_REQUEST", "wellbore_id must be a uuid", 400) from exc


async def optional_body(model: type[BaseModel], request: Request):
    """Body is optional: an empty body means all defaults. Invalid ones get contract §4's 400."""
    raw = await request.body()
    try:
        return model.model_validate_json(raw) if raw.strip() else model()
    except ValidationError as exc:
        raise NwisError(
            "NWIS_BAD_REQUEST", "Invalid request body", 400,
            {"errors": exc.errors(include_url=False, include_context=False, include_input=False)},
        ) from exc  # fmt: skip


@router.post("/wells/{wellbore_id}/predict-tops")
async def predict_tops(wellbore_id: str, request: Request) -> dict:
    current_user(request).require_role(*PREDICT_ROLES)
    wellbore = wellbore_uuid(wellbore_id)
    body = await optional_body(PredictTopsRequest, request)
    predicted = await tops.predict_tops(wellbore, body.radius_m)
    return {"tops": [t.as_response() for t in predicted]}


class RiskRequest(BaseModel):
    md_from_m: float | None = None
    md_to_m: float | None = None


@router.post("/wells/{wellbore_id}/risk")
async def compute_risk(wellbore_id: str, request: Request) -> dict:
    current_user(request).require_role(*ROLES)
    wellbore = wellbore_uuid(wellbore_id)
    body = await optional_body(RiskRequest, request)
    return {"scores": await fuse.compute_and_store(wellbore, body.md_from_m, body.md_to_m)}


@router.get("/wells/{wellbore_id}/correlation")
async def get_correlation(
    wellbore_id: str, request: Request, offsets: str | None = None, flatten: str | None = None,
    channels: str | None = None,
) -> dict:  # fmt: skip
    current_user(request).require_role(*ROLES)
    return await correlation.build_correlation(wellbore_uuid(wellbore_id), offsets, flatten, channels)
