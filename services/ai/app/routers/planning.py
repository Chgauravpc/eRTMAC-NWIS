"""POST /v1/planning/brief (BE-23, contract §9.4): a read-only brief for a virtual vertical well."""

from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.deps import current_user
from app.geo import planning, tops
from app.routers.search import parse_body

router = APIRouter()

PLANNING_ROLES = ("office_engineer", "admin")
MAX_PLANNED_TD_M = 10000.0
MAX_RADIUS_M = 50000.0


class BriefRequest(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    planned_td_m: float = Field(gt=0, le=MAX_PLANNED_TD_M)
    radius_m: float = Field(default=tops.DEFAULT_RADIUS_M, gt=0, le=MAX_RADIUS_M)


@router.post("/planning/brief")
async def planning_brief(request: Request) -> dict:
    current_user(request).require_role(*PLANNING_ROLES)
    body = await parse_body(BriefRequest, request)
    return await planning.brief(body.lat, body.lon, body.planned_td_m, body.radius_m)
