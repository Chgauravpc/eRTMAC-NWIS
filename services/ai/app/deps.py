"""Shared FastAPI dependencies (contract §9.1: identity comes from the Node layer's headers)."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Request

from app.config import Settings, get_settings
from app.db import get_conn  # noqa: F401  (re-exported so routers import all deps from one place)
from app.errors import NwisError

ROLES = {"rig_engineer", "rtoc_engineer", "office_engineer", "reviewer", "admin"}


@dataclass(frozen=True)
class CurrentUser:
    id: str | None
    role: str | None
    request_id: str | None

    def require_role(self, *allowed: str) -> "CurrentUser":
        if self.role not in allowed:
            raise NwisError("NWIS_FORBIDDEN", f"Role {self.role or 'unknown'} may not call this endpoint", 403)
        return self


def settings_dep() -> Settings:
    return get_settings()


def current_user(request: Request) -> CurrentUser:
    """User identity forwarded by the Node API layer (already authenticated there)."""
    role = getattr(request.state, "user_role", None)
    return CurrentUser(
        id=getattr(request.state, "user_id", None),
        role=role if role in ROLES else None,
        request_id=getattr(request.state, "request_id", None),
    )
