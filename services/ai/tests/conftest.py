"""Windows defaults to ProactorEventLoop, which psycopg's async pool cannot
use (see the psycopg docs on Windows support). Switch to the selector-based
policy before pytest-asyncio creates any event loop. No-op on Linux/macOS,
where the Space container actually runs.
"""

import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


# Unit tests must never see real credentials: the repo-root .env (read by app.config) holds the real Supabase and LLM
# keys of a developer machine, and several tests assume that nothing is configured (a configured database would start
# the real engine loop and database jobs). An empty environment variable beats a value from .env, so blank them here;
# a test that needs a value sets it with monkeypatch.setenv.
import os  # noqa: E402

for _name in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL", "SERVICE_TOKEN", "GROQ_API_KEY", "OPENROUTER_API_KEY"):
    os.environ[_name] = ""

from app.config import get_settings  # noqa: E402

get_settings.cache_clear()
