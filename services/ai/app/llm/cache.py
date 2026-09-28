"""LLM response cache (contract §6: llm_cache table).

llm_cache has no RLS policy for any client role (§8) — it's a backend-only
table, read and written exclusively through this module via the service
role connection in app.db.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from app.db import execute, fetch_one


def cache_key(system: str, user: str, schema_name: str) -> str:
    """sha256 of the provider-independent prompt (contract §6 comment on prompt_hash)."""
    digest_input = f"{system}\n{user}\n{schema_name}".encode("utf-8")
    return hashlib.sha256(digest_input).hexdigest()


async def get_cached(prompt_hash: str) -> dict[str, Any] | None:
    return await fetch_one(
        "select provider, model, response from llm_cache where prompt_hash = %(prompt_hash)s",
        {"prompt_hash": prompt_hash},
    )


async def set_cached(prompt_hash: str, provider: str, model: str, response: Any) -> None:
    await execute(
        """
        insert into llm_cache (prompt_hash, provider, model, response)
        values (%(prompt_hash)s, %(provider)s, %(model)s, %(response)s::jsonb)
        on conflict (prompt_hash) do update
          set provider = excluded.provider,
              model = excluded.model,
              response = excluded.response
        """,
        {
            "prompt_hash": prompt_hash,
            "provider": provider,
            "model": model,
            "response": json.dumps(response),
        },
    )
