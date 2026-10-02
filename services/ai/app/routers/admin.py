"""POST /v1/admin/retrain (BE-24, contract §9.2): retrain the L2 models in the background.

Admin only (X-User-Role). Returns 202 straight away with an empty `model_run_ids`: the rows appear in
`model_runs` as each risk type finishes and the frontend polls that table. Only one retrain runs at a time.
The CPU-bound fitting runs in a thread (`asyncio.to_thread`); reading the tables and storing the results stay
on the main event loop, whose connection pool they use. When training ends the active models are reloaded.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

from app.deps import current_user
from app.errors import NwisError
from app.logging import get_logger
from app.risk import l2
from app.routers.search import parse_body
from training import features, train_l2

logger = get_logger(__name__)

router = APIRouter()

ADMIN_ROLES = ("admin",)

_task: asyncio.Task | None = None


class RetrainRequest(BaseModel):
    risk_types: list[str] | None = None  # None or empty: every risk type


def retrain_running() -> bool:
    return _task is not None and not _task.done()


def resolve_risk_types(requested: list[str] | None) -> list[str]:
    if not requested:
        return list(features.RISK_TYPES)
    unknown = [r for r in requested if r not in features.RISK_TYPES]
    if unknown:
        raise NwisError("NWIS_BAD_REQUEST", "Unknown risk type", 400, {"risk_types": unknown, "allowed": list(features.RISK_TYPES)})
    return list(dict.fromkeys(requested))


async def _retrain(risk_types: list[str]) -> None:
    try:
        wells, strat_order = await features.load_wells()
        if len(wells) < 2:
            logger.warning("retrain_skipped completed_wells=%d", len(wells))
            return
        for risk in risk_types:
            result = await asyncio.to_thread(train_l2.train_risk, wells, strat_order, risk)  # off the event loop
            stored = await train_l2.store_result(result)
            logger.info("retrain_done risk_type=%s stored=%s", risk, stored)
        await l2.load_active()
    except Exception:  # noqa: BLE001 - the task has no caller to raise to
        logger.exception("retrain_failed risk_types=%s", risk_types)


def start_retrain(risk_types: list[str]) -> None:
    """Start the background retrain, or raise 409 if one is already running."""
    global _task
    if retrain_running():
        raise NwisError("NWIS_BAD_STATE", "A retrain is already running", 409)
    _task = asyncio.create_task(_retrain(risk_types))


@router.post("/admin/retrain")
async def retrain(request: Request, response: Response) -> dict:
    current_user(request).require_role(*ADMIN_ROLES)
    body = await parse_body(RetrainRequest, request)
    start_retrain(resolve_risk_types(body.risk_types))
    response.status_code = 202
    return {"model_run_ids": []}
