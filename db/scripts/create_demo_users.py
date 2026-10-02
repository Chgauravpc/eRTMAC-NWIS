"""Create the five demo accounts (one per role) in Supabase Auth and give them their roles.

  python db/scripts/create_demo_users.py

Idempotent: an account that exists is left alone (its password is not reset). A new account gets a random password,
which is appended to the repo-root .env as DEMO_PASSWORD (one shared password for the five demo accounts) together
with TEST_EMAIL / TEST_PASSWORD for scripts/warmup.py. The password is never printed. Needs SUPABASE_URL,
SUPABASE_SERVICE_ROLE_KEY and SUPABASE_DB_URL in the environment or the repo-root .env.

These are DEMO accounts with a shared password: delete them (Authentication -> Users) before real users are invited.
"""

from __future__ import annotations

import json
import os
import secrets
import sys
import urllib.error
import urllib.request

import psycopg

from dbenv import REPO_ROOT, db_url, host_of

DEMO = [
    ("admin@nwis.test", "Demo Admin", "admin"),
    ("rtoc@nwis.test", "Demo RTOC Engineer", "rtoc_engineer"),
    ("reviewer@nwis.test", "Demo Reviewer", "reviewer"),
    ("office@nwis.test", "Demo Office Engineer", "office_engineer"),
    ("rig@nwis.test", "Demo Rig Engineer", "rig_engineer"),
]
RIG_WELL = "SYN-DLJ-03"  # the rig engineer is assigned to the first demo drilling well


def read_env() -> dict[str, str]:
    env: dict[str, str] = {}
    f = REPO_ROOT / ".env"
    if f.is_file():
        for line in f.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip().strip("\"'")
    return {**env, **{k: v for k, v in os.environ.items() if k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DEMO_PASSWORD")}}


def set_env_var(name: str, value: str) -> None:
    f = REPO_ROOT / ".env"
    lines = f.read_text(encoding="utf-8").splitlines() if f.is_file() else []
    for i, line in enumerate(lines):
        if line.split("=", 1)[0].strip() == name:
            lines[i] = f"{name}={value}"
            break
    else:
        lines.append(f"{name}={value}")
    f.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def admin_create(url: str, key: str, email: str, password: str, name: str) -> str:
    body = json.dumps({"email": email, "password": password, "email_confirm": True, "user_metadata": {"full_name": name}}).encode()
    req = urllib.request.Request(f"{url}/auth/v1/admin/users", data=body, method="POST",
                                 headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return "created" if r.status in (200, 201) else f"HTTP {r.status}"
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        if e.code == 422 and "already" in detail.lower():
            return "exists"
        raise SystemExit(f"creating {email} failed: HTTP {e.code} {detail[:200]}")


def main() -> int:
    env = read_env()
    url, key = env.get("SUPABASE_URL", "").rstrip("/"), env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url.startswith("http") or not key:
        sys.exit("SUPABASE_URL (with https://) and SUPABASE_SERVICE_ROLE_KEY are needed in the repo-root .env")
    password = env.get("DEMO_PASSWORD") or secrets.token_urlsafe(14)
    print(f"project: {url}  database: {host_of(db_url())}")

    created_any = False
    for email, name, _ in DEMO:
        state = admin_create(url, key, email, password, name)
        created_any |= state == "created"
        print(f"  {email:22} {state}")
    if created_any and not env.get("DEMO_PASSWORD"):
        set_env_var("DEMO_PASSWORD", password)
        if not env.get("TEST_EMAIL"):
            set_env_var("TEST_EMAIL", "rtoc@nwis.test")
        if not env.get("TEST_PASSWORD"):
            set_env_var("TEST_PASSWORD", password)
        print("  the shared password was written to the repo-root .env as DEMO_PASSWORD (not shown)")
    elif created_any:
        print("  new accounts use the DEMO_PASSWORD already in .env")

    with psycopg.connect(db_url(), connect_timeout=20) as conn:
        wb = conn.execute("select wb.id from wellbores wb join wells w on w.id = wb.well_id where w.name = %s", (RIG_WELL,)).fetchone()
        assigned = [wb[0]] if wb else []
        for email, name, role in DEMO:
            cur = conn.execute(
                "update profiles set role = %s, full_name = %s, assigned_wellbore_ids = %s where id = (select id from auth.users where email = %s)",
                (role, name, assigned if role == "rig_engineer" else [], email),
            )
            print(f"  {email:22} role {role:16}" + ("" if cur.rowcount else "  (no profile row yet!)") + (f"  assigned to {RIG_WELL}" if role == "rig_engineer" and assigned else ""))
        conn.commit()
    return 0


if __name__ == "__main__":
    sys.exit(main())
