-- db/supabase/migrations/0011_realtime.sql
-- Realtime publication and replica identity configuration for eRTMAC-NWIS (SIH26121)
-- Contract §8

-- 1. Add tables to supabase_realtime publication
-- Contract §8: tables in publication supabase_realtime: alerts, stream_state, risk_scores, jobs
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'alerts'
  ) then
    alter publication supabase_realtime add table public.alerts;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'stream_state'
  ) then
    alter publication supabase_realtime add table public.stream_state;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'risk_scores'
  ) then
    alter publication supabase_realtime add table public.risk_scores;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'jobs'
  ) then
    alter publication supabase_realtime add table public.jobs;
  end if;
end;
$$;

-- 2. Set replica identity to full on alerts, stream_state, jobs
-- Contract §8: alter table alerts replica identity full (so updates carry the full row) — same for stream_state, jobs
alter table public.alerts replica identity full;
alter table public.stream_state replica identity full;
alter table public.jobs replica identity full;
