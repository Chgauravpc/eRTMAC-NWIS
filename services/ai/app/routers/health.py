from __future__ import annotations

from fastapi import APIRouter

from app.risk import l2

router = APIRouter()


@router.get("/health")
async def health() -> dict:
    return {"ok": True, "version": "0.1.0", "models": {"l2": sorted(l2.active_versions())}}
