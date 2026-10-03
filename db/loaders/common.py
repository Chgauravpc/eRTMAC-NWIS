"""Shared helpers for the data loaders: the connection, bulk COPY, and unit conversion (contract §4)."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any, Iterable, Sequence

import psycopg

REPO_ROOT = Path(__file__).resolve().parents[2]

# contract §4: internal storage is SI-ish; convert at ingestion. value_in_unit * FACTOR = stored value.
UNIT_FACTORS: dict[str, float] = {
    "ft": 0.3048,  # -> m
    "ppg": 1 / 8.345,  # -> sg
    "bbl": 0.158987,  # -> m3
    "gpm": 3.78541,  # -> L/min
    "psi": 0.0689476,  # -> bar
    "klbf": 4.44822,  # -> kN
    "kft.lbf": 1.35582,  # -> kN.m
    "ft/h": 0.3048,  # -> m/h
}


def to_si(value: float | None, unit: str) -> float | None:
    """Convert `value` given in `unit` (a key of UNIT_FACTORS) to the stored unit. None stays None."""
    if value is None:
        return None
    try:
        return float(value) * UNIT_FACTORS[unit]
    except KeyError:
        raise ValueError(f"unknown unit {unit!r}; known: {', '.join(UNIT_FACTORS)}") from None


def _db_url() -> str:
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


def get_conn(autocommit: bool = False) -> psycopg.Connection:
    """Connection from SUPABASE_DB_URL (environment or the repo-root .env)."""
    return psycopg.connect(_db_url(), autocommit=autocommit, connect_timeout=20)


def copy_rows(conn: psycopg.Connection, table: str, columns: Sequence[str], rows: Iterable[Sequence[Any]]) -> int:
    """Bulk insert with COPY ... FROM STDIN. Returns the number of rows written."""
    cols = ", ".join(columns)
    n = 0
    with conn.cursor() as cur:
        with cur.copy(f"copy {table} ({cols}) from stdin") as copy:
            for row in rows:
                copy.write_row(row)
                n += 1
    return n
