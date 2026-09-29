-- db/tests/test_realtime.sql
-- Verification test for DB-07: Realtime publication and replica identities

begin;

do $$
declare
  v_pub_tables text[];
  v_expected text[] := array['alerts', 'stream_state', 'risk_scores', 'jobs'];
  v_tbl text;
  v_replident "char";
begin
  -- 1. Check publication tables in supabase_realtime
  select array_agg(tablename::text) into v_pub_tables
  from pg_publication_tables
  where pubname = 'supabase_realtime';

  foreach v_tbl in array v_expected loop
    if not (v_tbl = any(v_pub_tables)) then
      raise exception 'Assertion failed: table % missing from supabase_realtime publication (found: %)', v_tbl, v_pub_tables;
    end if;
  end loop;

  -- 2. Check replica identity full ('f') on alerts, stream_state, jobs
  select relreplident into v_replident from pg_class where relname = 'alerts';
  if v_replident <> 'f' then
    raise exception 'Assertion failed: alerts replica identity should be "f" (full), got "%"', v_replident;
  end if;

  select relreplident into v_replident from pg_class where relname = 'stream_state';
  if v_replident <> 'f' then
    raise exception 'Assertion failed: stream_state replica identity should be "f" (full), got "%"', v_replident;
  end if;

  select relreplident into v_replident from pg_class where relname = 'jobs';
  if v_replident <> 'f' then
    raise exception 'Assertion failed: jobs replica identity should be "f" (full), got "%"', v_replident;
  end if;
end;
$$;

rollback;
