"""Windows defaults to ProactorEventLoop, which psycopg's async pool cannot
use (see the psycopg docs on Windows support). Switch to the selector-based
policy before pytest-asyncio creates any event loop. No-op on Linux/macOS,
where the Space container actually runs.
"""

import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
