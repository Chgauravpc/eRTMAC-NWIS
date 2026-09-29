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
