# Database: eRTMAC-NWIS

Database schema, migrations, reference data, and loaders for the Nearby Wells Intelligence System (SIH26121, Oil India Limited).

## Setup

1. **Install Supabase CLI**
   - Via npm:
     ```bash
     npm install -g supabase
     ```
   - Via Scoop (Windows):
     ```bash
     scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
     scoop install supabase
     ```
   - Via Homebrew (macOS / Linux):
     ```bash
     brew install supabase/tap/supabase
     ```

2. **Authenticate with Supabase**
   ```bash
   supabase login
   ```

3. **Initialize Supabase inside `db/`**
   ```bash
   cd db
   supabase init
   ```

4. **Link to Supabase Project**
   Create a project on [Supabase](https://supabase.com) (recommended region: Mumbai `ap-south-1` if available or closest to India). Then link the project:
   ```bash
   supabase link --project-ref <project-ref>
   ```

5. **Push Migrations**
   Apply migrations to the remote database:
   ```bash
   supabase db push
   ```

6. **Verify Installed Extensions**
   Run the following query in the Supabase SQL Editor or via `psql`:
   ```sql
   select extname from pg_extension;
   ```
   Confirm that the following three extensions are present:
   - `postgis`
   - `vector`
   - `pg_trgm`

## Secrets

Environment variables used by the database loaders and services:

| Variable | Scope | Description |
| --- | --- | --- |
| `SUPABASE_URL` | Public / Shared | Supabase project URL (`https://<project-ref>.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | Supabase service role key (bypasses RLS). Shared **only** with Backend and loaders. Never expose to client. |
| `SUPABASE_DB_URL` | **Secret** | Postgres connection string (connection pooler / direct). Shared **only** with Backend and loaders. |

### Security Rules
- `.env` is **never committed** to source control (it is git-ignored).
- Store template keys with empty values in `.env.example` at the repository root.
- Share the project URL and anon public key with the entire team.
- Share `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` strictly with Backend (Person B).
- In production, set secrets in the Hugging Face Space settings and Vercel project environment variables.

## Testing & Verification

1. Verify that `0001_extensions.sql` contains only the three extension definitions:
   ```sql
   create extension if not exists postgis;
   create extension if not exists vector;
   create extension if not exists pg_trgm;
   ```
2. Verify extension status in PostgreSQL:
   ```sql
   select extname from pg_extension where extname in ('postgis', 'vector', 'pg_trgm');
   ```
   Expected result: 3 rows returned (`postgis`, `vector`, `pg_trgm`).

## Test accounts and roles

New sign-ups get the default role `office_engineer` (trigger `handle_new_user`). Create five accounts in
**Authentication -> Users** (or let them sign up), then promote them in the SQL editor:

```sql
update profiles set role = 'admin',         full_name = 'Test Admin'    where id = (select id from auth.users where email = 'admin@nwis.test');
update profiles set role = 'rtoc_engineer', full_name = 'Test RTOC'     where id = (select id from auth.users where email = 'rtoc@nwis.test');
update profiles set role = 'reviewer',      full_name = 'Test Reviewer' where id = (select id from auth.users where email = 'reviewer@nwis.test');
update profiles set role = 'office_engineer', full_name = 'Test Office' where id = (select id from auth.users where email = 'office@nwis.test');
-- rig engineers only see alerts on wellbores in assigned_wellbore_ids
update profiles set role = 'rig_engineer',  full_name = 'Test Rig',
       assigned_wellbore_ids = array[]::uuid[]  -- fill with wellbore ids once wells exist
 where id = (select id from auth.users where email = 'rig@nwis.test');
```

## Applying migrations without the Supabase CLI

`db/scripts/` has small Python tools that need only `SUPABASE_DB_URL` (from the environment or the repo-root `.env`)
and the backend's virtualenv (`psycopg`). They use the same history table as the CLI
(`supabase_migrations.schema_migrations`), so `supabase db push` and these scripts agree.

```bash
cd db/scripts
python migrate.py                          # status: which files are applied, which are pending
python migrate.py --apply                  # apply every pending file, one transaction each (a failure rolls back and stops)
python migrate.py --apply 0012 0013        # only these
python migrate.py --mark-applied 0008      # record a file that was applied by hand (nothing is run)
python check_drift.py                      # compare every function in the migrations with the live database
python run_sql_tests.py                    # run db/tests/*.sql, prove the row counts are unchanged afterwards
python run_sql_tests.py views              # one test (test_views.sql)
```

State of the shared Supabase project (3 Oct 2026): `0001`-`0013` are applied and recorded, `check_drift.py` reports all
15 functions equal to the repo, and `run_sql_tests.py` passes all 10 scripts. `0008`-`0011` had been applied by hand
before and were recorded with `--mark-applied` after `check_drift.py` and the tests confirmed they match.
`0007` was applied again because the live `hybrid_search` was an older variant (no top-50 shortlist, no id tie-break).

## Running the SQL tests

Every file in `db/tests/` is a self-contained script that ends in `rollback;` and raises an exception on
any failed assertion. `python db/scripts/run_sql_tests.py` (above) runs them all. With `psql`: apply migrations
`0001`-`0013` and `seed.sql` first, then run each file, e.g.

```bash
for t in db/tests/*.sql; do psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$t" || break; done
```

A non-zero exit code means a failed assertion. To run against a throw-away local database, use the
`supabase/postgres` Docker image (it ships PostGIS and pgvector) and create minimal `auth`/`storage` stubs,
or use `supabase start` from `db/`.
