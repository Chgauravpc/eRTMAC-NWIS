"""Compare the functions defined in db/supabase/migrations with the ones in the live database.

  python db/scripts/check_drift.py

For every `create or replace function public.NAME(...) ... $$ body $$` in the migrations, the body (whitespace
ignored) is compared with the body of the function of that name in the database. A later migration that redefines
a function replaces the earlier definition, so the last one in file order is the one compared. Only functions are
checked (tables, policies and grants are covered by the SQL tests). Exit code 1 if anything differs.
"""

from __future__ import annotations

import re
import sys

import psycopg

from dbenv import MIGRATIONS, db_url, host_of

FUNC_RE = re.compile(
    r"create\s+or\s+replace\s+function\s+(?:public\.)?(\w+)\s*\((.*?)\)\s*returns.*?\$(\w*)\$(.*?)\$\3\$",
    re.S | re.I,
)


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def main() -> int:
    wanted: dict[str, tuple[str, str]] = {}  # name -> (file, normalised body); the last definition wins
    for path in sorted(MIGRATIONS.glob("*.sql")):
        for m in FUNC_RE.finditer(path.read_text(encoding="utf-8")):
            wanted[m.group(1)] = (path.name, norm(m.group(4)))

    print(f"database: {host_of(db_url())}")
    bad = 0
    with psycopg.connect(db_url(), connect_timeout=20) as conn:
        for name, (file, body) in sorted(wanted.items()):
            rows = conn.execute(
                "select pg_get_functiondef(p.oid) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = %s",
                (name,),
            ).fetchall()
            if not rows:
                print(f"  MISSING   {name:24} ({file})")
                bad += 1
                continue
            live = [norm(m.group(4)) for r in rows for m in FUNC_RE.finditer(r[0])]
            if body in live:
                print(f"  same      {name:24} ({file})")
            else:
                print(f"  DIFFERENT {name:24} ({file})")
                bad += 1
    print(f"\n{len(wanted) - bad} of {len(wanted)} functions match")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
