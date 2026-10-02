"""Run the SQL test scripts in db/tests against the database in SUPABASE_DB_URL.

  python db/scripts/run_sql_tests.py                  # every test_*.sql
  python db/scripts/run_sql_tests.py views geo        # only test_views.sql and test_geo.sql

Each script is written as `begin; ... rollback;`, so it leaves nothing behind. To prove it, the script counts the rows
of the main tables before and after and fails if they differ. A script passes when it runs without an exception
(its own `raise exception 'Assertion failed: ...'` lines are the assertions). Exit code 1 if anything failed.
"""

from __future__ import annotations

import re
import sys

import psycopg

from dbenv import TESTS, db_url, host_of

COUNTED = ("wells", "wellbores", "events", "alerts", "documents", "extracted_fields", "profiles", "formations", "audit_log", "jobs")


def snapshot(conn: psycopg.Connection) -> dict[str, int]:
    return {t: conn.execute(f"select count(*) from public.{t}").fetchone()[0] for t in COUNTED}


def main(argv: list[str]) -> int:
    names = [f"test_{a.removeprefix('test_').removesuffix('.sql')}.sql" for a in argv]
    files = sorted(TESTS.glob("test_*.sql"))
    if names:
        files = [f for f in files if f.name in names]
        missing = set(names) - {f.name for f in files}
        if missing:
            sys.exit("no such test: " + ", ".join(sorted(missing)))

    notices: list[str] = []
    failed = 0
    print(f"database: {host_of(db_url())}")
    with psycopg.connect(db_url(), autocommit=True, connect_timeout=20) as conn:
        conn.add_notice_handler(lambda d: notices.append(d.message_primary))
        before = snapshot(conn)
        for path in files:
            notices.clear()
            try:
                conn.execute(path.read_text(encoding="utf-8"))
                status = "PASS"
            except Exception as exc:
                failed += 1
                status = "FAIL: " + str(exc).strip().splitlines()[0][:240]
            if conn.info.transaction_status != 0:
                conn.execute("rollback")
            print(f"{path.name:36} {status}")
            for n in notices:
                if re.search(r"passed|assert", n, re.I):
                    print(f"{'':36}   {n[:140]}")
        after = snapshot(conn)
    if before != after:
        failed += 1
        print("\nFAIL: the tests changed the data:", {t: (before[t], after[t]) for t in COUNTED if before[t] != after[t]})
    print(f"\n{len(files) - failed if failed <= len(files) else 0} of {len(files)} passed" + ("" if before == after else " (data changed!)"))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
