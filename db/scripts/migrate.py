"""Apply the SQL migrations in db/supabase/migrations to the database in SUPABASE_DB_URL.

Works without the Supabase CLI and uses the same history table (supabase_migrations.schema_migrations),
so `supabase db push` and this script agree on what has been applied.

  python db/scripts/migrate.py                      # status only: which files are applied, which are pending
  python db/scripts/migrate.py --apply              # apply every pending file in order, one transaction each
  python db/scripts/migrate.py --apply 0012 0013    # apply just these (they must not be recorded yet)
  python db/scripts/migrate.py --mark-applied 0008 0010 0011
                                                    # only record files that were applied by hand (nothing is run)

A failing file is rolled back and stops the run; nothing after it is applied.
"""

from __future__ import annotations

import argparse
import re
import sys

import psycopg

from dbenv import MIGRATIONS, db_url, host_of

HISTORY_DDL = """
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
"""


def migration_files() -> list[tuple[str, str, str]]:
    """[(version, name, path)] sorted by version."""
    out = []
    for path in sorted(MIGRATIONS.glob("*.sql")):
        m = re.match(r"^(\d+)_(.+)\.sql$", path.name)
        if m:
            out.append((m.group(1), m.group(2), str(path)))
    return out


def applied_versions(conn: psycopg.Connection) -> set[str]:
    conn.execute(HISTORY_DDL)
    conn.commit()
    return {r[0] for r in conn.execute("select version from supabase_migrations.schema_migrations")}


def record(conn: psycopg.Connection, version: str, name: str, sql: str | None) -> None:
    conn.execute(
        "insert into supabase_migrations.schema_migrations (version, name, statements) values (%s, %s, %s) on conflict (version) do nothing",
        (version, name, [sql] if sql else None),
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", nargs="*", metavar="VERSION", help="apply pending migrations (all, or only the listed versions)")
    ap.add_argument("--mark-applied", nargs="+", metavar="VERSION", help="record versions as applied without running them")
    args = ap.parse_args(argv)

    files = migration_files()
    by_version = {v: (n, p) for v, n, p in files}
    url = db_url()
    print(f"database: {host_of(url)}")

    with psycopg.connect(url, connect_timeout=20) as conn:
        done = applied_versions(conn)

        if args.mark_applied:
            for v in args.mark_applied:
                if v not in by_version:
                    sys.exit(f"no migration file with version {v}")
                if v in done:
                    print(f"  {v} already recorded")
                    continue
                record(conn, v, by_version[v][0], None)
                conn.commit()
                print(f"  {v} {by_version[v][0]}: recorded as applied (not run)")
            done = applied_versions(conn)

        if args.apply is not None:
            wanted = args.apply or [v for v, _, _ in files if v not in done]
            for v in wanted:
                if v not in by_version:
                    sys.exit(f"no migration file with version {v}")
                if v in done:
                    sys.exit(f"{v} is already recorded as applied; refusing to run it again")
            for v in sorted(wanted):
                name, path = by_version[v]
                sql = open(path, encoding="utf-8").read()
                try:
                    conn.execute(sql)
                    record(conn, v, name, sql)
                    conn.commit()
                except Exception as exc:  # roll the whole file back
                    conn.rollback()
                    print(f"  {v} {name}: FAILED and rolled back: {str(exc).strip().splitlines()[0]}")
                    return 1
                print(f"  {v} {name}: applied")
            done = applied_versions(conn)

        print("\nstatus:")
        for v, name, _ in files:
            print(f"  {v} {name:28} {'applied' if v in done else 'PENDING'}")
        extra = sorted(done - set(by_version))
        if extra:
            print("recorded in the database but with no file here:", ", ".join(extra))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
