"""Shared by the db scripts: the connection string from SUPABASE_DB_URL or the repo-root .env."""

from __future__ import annotations

import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = REPO_ROOT / "db" / "supabase" / "migrations"
TESTS = REPO_ROOT / "db" / "tests"


def db_url() -> str:
    url = os.environ.get("SUPABASE_DB_URL", "")
    env_file = REPO_ROOT / ".env"
    if not url and env_file.is_file():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            key, _, value = line.strip().partition("=")
            if key == "SUPABASE_DB_URL":
                url = value.strip().strip("\"'")
    if not url:
        sys.exit("SUPABASE_DB_URL is not set (put it in the repo-root .env).")
    return url


def host_of(url: str) -> str:
    """The host part only, for messages (never print the password)."""
    return url.rsplit("@", 1)[-1].split("/", 1)[0]
