"""Async Postgres access layer (contract §7: RPC functions; §6/§8: depth_series visibility).

Every helper takes SQL with %(name)s placeholders and a params dict — never an
f-string with user input concatenated into the query.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import AsyncIterator
from typing import Any
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from app.config import get_settings

# contract §7: the only functions call_fn() may invoke. The function name is
# always checked against this allowlist, never interpolated from a caller-
# supplied string without validation.
ALLOWED_FUNCTIONS = frozenset(
    {
        "current_user_role",
        "well_position_at_md",
        "formation_at_md",
        "offsets_within",
        "events_for_offsets",
        "hybrid_search",
        "mark_alert_viewed",
        "ack_alert",
        "resolve_alert",
        "dismiss_alert",
        "rate_alert",
        "review_field",
        "add_shift_note",
    }
)

_pool: AsyncConnectionPool | None = None
_pool_lock = asyncio.Lock()


async def get_pool() -> AsyncConnectionPool:
    """Lazily create and open the pool (min_size=1, max_size=5 — Supabase's
    free tier has limited connections)."""
    global _pool
    if _pool is None:
        async with _pool_lock:
            if _pool is None:
                settings = get_settings()
                pool = AsyncConnectionPool(
                    conninfo=settings.SUPABASE_DB_URL,
                    min_size=1,
                    max_size=5,
                    kwargs={"row_factory": dict_row},
                    open=False,
                )
                await pool.open(wait=True)
                _pool = pool
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def get_conn() -> AsyncIterator[AsyncConnection]:
    """FastAPI dependency: yields a pooled connection."""
    pool = await get_pool()
    async with pool.connection() as conn:
        yield conn


async def fetch_all(sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    pool = await get_pool()
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute(sql, params)
        return await cur.fetchall()


async def fetch_one(sql: str, params: dict[str, Any] | None = None) -> dict[str, Any] | None:
    pool = await get_pool()
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute(sql, params)
        return await cur.fetchone()


async def execute(sql: str, params: dict[str, Any] | None = None) -> None:
    pool = await get_pool()
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute(sql, params)


async def execute_many(sql: str, params_seq: list[dict[str, Any]]) -> None:
    pool = await get_pool()
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.executemany(sql, params_seq)


_PARAM_NAME_RE = re.compile(r"^p_[a-z][a-z0-9_]*$")


async def call_fn(name: str, **params: Any) -> list[dict[str, Any]]:
    """Call a contract §7 RPC function by (validated) name with keyword args.

    e.g. await call_fn("offsets_within", p_wellbore=..., p_radius_m=...)
    """
    if name not in ALLOWED_FUNCTIONS:
        raise ValueError(f"{name!r} is not an allowed contract §7 function")

    for key in params:
        if not _PARAM_NAME_RE.match(key):
            # keys reach here via **params, so an unvalidated one could inject
            # SQL through the identifier position even though values are safe
            raise ValueError(f"{key!r} is not a valid contract §7 parameter name (p_*)")

    args_sql = ", ".join(f"{key} => %({key})s" for key in params)
    sql = f"select * from public.{name}({args_sql})"
    return await fetch_all(sql, params)


async def visible_depth_limit(wellbore_id: UUID | str) -> float | None:
    """contract §6 NOTE / §8 depth_series rule: rows with md_m above the
    current bit depth are "future" data and must never be returned to users.
    Returns stream_state.bit_md_m, or None when the well isn't being drilled
    (or has no stream_state row yet) — i.e. no depth cap applies."""
    row = await fetch_one(
        "select bit_md_m from stream_state where wellbore_id = %(wellbore_id)s",
        {"wellbore_id": str(wellbore_id)},
    )
    if row is None:
        return None
    return row["bit_md_m"]
