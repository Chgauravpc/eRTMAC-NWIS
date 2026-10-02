"""Stream replay control (BE-18, contract §9.2): start, stop, speed, drop."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.deps import current_user
from app.routers.search import parse_body
from app.stream import replay

router = APIRouter()

STREAM_ROLES = ("rtoc_engineer", "admin")


class StartRequest(BaseModel):
    wellbore_id: UUID
    source: Literal["volve", "synthetic", "witsml"]
    speed: int = Field(default=1, ge=1, le=replay.MAX_SPEED)
    start_md_m: float | None = None


class StopRequest(BaseModel):
    wellbore_id: UUID


class SpeedRequest(BaseModel):
    wellbore_id: UUID
    speed: int = Field(ge=1, le=replay.MAX_SPEED)


class DropRequest(BaseModel):
    wellbore_id: UUID
    seconds: int = Field(ge=1, le=replay.MAX_DROP_S)


@router.post("/stream/start")
async def start(request: Request) -> dict:
    current_user(request).require_role(*STREAM_ROLES)
    body = await parse_body(StartRequest, request)
    return await replay.registry.start(str(body.wellbore_id), body.source, body.speed, body.start_md_m)


@router.post("/stream/stop")
async def stop(request: Request) -> dict:
    current_user(request).require_role(*STREAM_ROLES)
    body = await parse_body(StopRequest, request)
    return await replay.registry.stop(str(body.wellbore_id))


@router.post("/stream/speed")
async def speed(request: Request) -> dict:
    current_user(request).require_role(*STREAM_ROLES)
    body = await parse_body(SpeedRequest, request)
    return await replay.registry.set_speed(str(body.wellbore_id), body.speed)


@router.post("/stream/drop")
async def drop(request: Request) -> dict:
    current_user(request).require_role(*STREAM_ROLES)
    body = await parse_body(DropRequest, request)
    return await replay.registry.drop(str(body.wellbore_id), body.seconds)
