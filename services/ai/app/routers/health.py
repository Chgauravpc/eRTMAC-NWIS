from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health() -> dict:
    return {"ok": True, "version": "0.1.0", "models": {"l2": []}}
