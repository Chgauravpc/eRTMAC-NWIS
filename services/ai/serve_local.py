"""Run the AI service locally on Windows (or anywhere).

psycopg's async pool needs the selector event loop, and uvicorn on Windows picks the Proactor loop, so
`uvicorn app.main:app` does not work there. This launcher sets the policy first.

    cd services/ai && .venv/Scripts/python serve_local.py            # port 7860
    SERVICE_TOKEN=... .venv/Scripts/python serve_local.py --port 8000

SERVICE_TOKEN comes from the repo-root .env or the environment; if neither has one a random token is
generated for this run and written to the file named by --token-file (default: not written).
"""

from __future__ import annotations

import argparse
import asyncio
import os
import secrets
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import uvicorn  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7860)
    parser.add_argument("--token-file", help="write the SERVICE_TOKEN used by this run to this file")
    args = parser.parse_args()

    from app.config import get_settings

    token = os.environ.get("SERVICE_TOKEN") or get_settings().SERVICE_TOKEN
    if not token:
        token = secrets.token_urlsafe(32)
        os.environ["SERVICE_TOKEN"] = token  # read by Settings when app.main is imported
        get_settings.cache_clear()
    if args.token_file:
        with open(args.token_file, "w", encoding="utf-8") as handle:
            handle.write(token)

    from app.main import app

    # uvicorn.run() builds its own loop, and on Windows that is a Proactor loop whatever the policy says
    # (psycopg's async pool then cannot connect). Serving from our own asyncio.run keeps the selector loop.
    config = uvicorn.Config(app, host=args.host, port=args.port, log_level="info", loop="none")
    asyncio.run(uvicorn.Server(config).serve())


if __name__ == "__main__":
    main()
