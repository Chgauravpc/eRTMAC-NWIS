"""NWIS AI service (Hugging Face Docker Space).

Contract: §3 (repo layout), §4 (error shape, logging), §9.1 (service-token
auth, request headers).
"""

from __future__ import annotations

import asyncio
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.db import close_pool
from app.errors import NwisError
from app.logging import configure_logging, get_logger, request_id_var, user_id_var
from app.routers import documents, health

settings = get_settings()
configure_logging(settings.LOG_LEVEL)
logger = get_logger(__name__)

async def _warm_up_models() -> None:
    """Load heavy models off the event loop so /v1/health answers immediately."""
    try:
        from app.search import embed

        await asyncio.to_thread(embed._model)
        logger.info("embedding model warmed up")
    except Exception:  # never let warm-up take the service down
        logger.exception("model warm-up failed; models will load lazily on first use")


@asynccontextmanager
async def lifespan(_: FastAPI):
    warmup = asyncio.create_task(_warm_up_models())
    try:
        yield
    finally:
        warmup.cancel()
        await close_pool()


app = FastAPI(title="NWIS AI", version="0.1.0", lifespan=lifespan)

app.include_router(health.router, prefix="/v1")
app.include_router(documents.router, prefix="/v1")


def _error_body(code: str, message: str, details: dict | None = None) -> dict:
    return {"error": {"code": code, "message": message, "details": details or {}}}


@app.middleware("http")
async def service_token_and_context(request: Request, call_next):
    request_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())
    user_id = request.headers.get("X-User-Id")
    user_role = request.headers.get("X-User-Role")

    request.state.request_id = request_id
    request.state.user_id = user_id
    request.state.user_role = user_role

    request_id_token = request_id_var.set(request_id)
    user_id_token = user_id_var.set(user_id)
    try:
        if request.url.path != "/v1/health":
            token = request.headers.get("X-Service-Token")
            if not settings.SERVICE_TOKEN or not token or token != settings.SERVICE_TOKEN:
                return JSONResponse(
                    status_code=401,
                    content=_error_body("NWIS_UNAUTHORIZED", "Missing or invalid service token"),
                    headers={"X-Request-Id": request_id},
                )

        response = await call_next(request)
        response.headers["X-Request-Id"] = request_id
        return response
    finally:
        request_id_var.reset(request_id_token)
        user_id_var.reset(user_id_token)


@app.exception_handler(NwisError)
async def nwis_error_handler(request: Request, exc: NwisError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=_error_body(exc.code, exc.message, exc.details),
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled_exception")
    return JSONResponse(status_code=500, content=_error_body("NWIS_INTERNAL", "Internal server error"))
