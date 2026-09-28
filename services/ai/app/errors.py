"""NWIS error type (contract §4: error shape).

Handled by the exception handler in app.main and turned into
{"error": {"code": ..., "message": ..., "details": ...}}.
"""

from __future__ import annotations


class NwisError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = 400,
        details: dict | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}
