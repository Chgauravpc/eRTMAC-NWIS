-- db/supabase/migrations/0005_auth_rls.sql
-- Authentication triggers and Row Level Security (RLS) policies for eRTMAC-NWIS (SIH26121)

-- 1. Trigger function on auth.users AFTER INSERT
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$;

-- Drop trigger if already exists and recreate
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- 2. current_user_role() helper
create or replace function public.current_user_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

grant execute on function public.current_user_role() to authenticated, service_role;


-- 3. Row Level Security Policies (Naming convention: <table>_<action>_<who>)

-- profiles
drop policy if exists profiles_select_own_or_admin on profiles;
create policy profiles_select_own_or_admin on profiles
  for select to authenticated
  using ((id = auth.uid()) or (current_user_role() = 'admin'));

drop policy if exists profiles_update_admin on profiles;
create policy profiles_update_admin on profiles
  for update to authenticated
  using (current_user_role() = 'admin')
  with check (current_user_role() = 'admin');

-- reference tables: formations, formation_synonyms, iadc_codes
drop policy if exists formations_select_authenticated on formations;
create policy formations_select_authenticated on formations
  for select to authenticated
  using (true);

drop policy if exists formations_all_admin on formations;
create policy formations_all_admin on formations
  for all to authenticated
  using (current_user_role() = 'admin')
  with check (current_user_role() = 'admin');

drop policy if exists formation_synonyms_select_authenticated on formation_synonyms;
create policy formation_synonyms_select_authenticated on formation_synonyms
  for select to authenticated
  using (true);

drop policy if exists formation_synonyms_all_admin on formation_synonyms;
create policy formation_synonyms_all_admin on formation_synonyms
  for all to authenticated
  using (current_user_role() = 'admin')
  with check (current_user_role() = 'admin');

drop policy if exists iadc_codes_select_authenticated on iadc_codes;
create policy iadc_codes_select_authenticated on iadc_codes
  for select to authenticated
  using (true);

drop policy if exists iadc_codes_all_admin on iadc_codes;
create policy iadc_codes_all_admin on iadc_codes
  for all to authenticated
  using (current_user_role() = 'admin')
  with check (current_user_role() = 'admin');

-- well data tables (read by any authenticated user; modified only by backend service role)
drop policy if exists wells_select_authenticated on wells;
create policy wells_select_authenticated on wells
  for select to authenticated
  using (true);

drop policy if exists wellbores_select_authenticated on wellbores;
create policy wellbores_select_authenticated on wellbores
  for select to authenticated
  using (true);

drop policy if exists survey_stations_select_authenticated on survey_stations;
create policy survey_stations_select_authenticated on survey_stations
  for select to authenticated
  using (true);

drop policy if exists trajectories_select_authenticated on trajectories;
create policy trajectories_select_authenticated on trajectories
  for select to authenticated
  using (true);

drop policy if exists formation_tops_select_authenticated on formation_tops;
create policy formation_tops_select_authenticated on formation_tops
  for select to authenticated
  using (true);

drop policy if exists hole_sections_select_authenticated on hole_sections;
create policy hole_sections_select_authenticated on hole_sections
  for select to authenticated
  using (true);

drop policy if exists cement_jobs_select_authenticated on cement_jobs;
create policy cement_jobs_select_authenticated on cement_jobs
  for select to authenticated
  using (true);

drop policy if exists mud_records_select_authenticated on mud_records;
create policy mud_records_select_authenticated on mud_records
  for select to authenticated
  using (true);

drop policy if exists time_log_select_authenticated on time_log;
create policy time_log_select_authenticated on time_log
  for select to authenticated
  using (true);

drop policy if exists events_select_authenticated on events;
create policy events_select_authenticated on events
  for select to authenticated
  using (true);

drop policy if exists lessons_select_authenticated on lessons;
create policy lessons_select_authenticated on lessons
  for select to authenticated
  using (true);

drop policy if exists risk_scores_select_authenticated on risk_scores;
create policy risk_scores_select_authenticated on risk_scores
  for select to authenticated
  using (true);

drop policy if exists stream_state_select_authenticated on stream_state;
create policy stream_state_select_authenticated on stream_state
  for select to authenticated
  using (true);

drop policy if exists documents_select_authenticated on documents;
create policy documents_select_authenticated on documents
  for select to authenticated
  using (true);

drop policy if exists document_pages_select_authenticated on document_pages;
create policy document_pages_select_authenticated on document_pages
  for select to authenticated
  using (true);

drop policy if exists chunks_select_authenticated on chunks;
create policy chunks_select_authenticated on chunks
  for select to authenticated
  using (true);

drop policy if exists model_runs_select_authenticated on model_runs;
create policy model_runs_select_authenticated on model_runs
  for select to authenticated
  using (true);

-- depth_series: hide rows below current bit depth (future telemetry)
drop policy if exists depth_series_select_authenticated on depth_series;
create policy depth_series_select_authenticated on depth_series
  for select to authenticated
  using (
    not exists (
      select 1 from stream_state s
      where s.wellbore_id = depth_series.wellbore_id
        and s.bit_md_m is not null
        and depth_series.md_m > s.bit_md_m
    )
  );

-- jobs: visible to creator, reviewer, and admin
drop policy if exists jobs_select_creator_reviewer_admin on jobs;
create policy jobs_select_creator_reviewer_admin on jobs
  for select to authenticated
  using (
    (created_by = auth.uid()) or (current_user_role() in ('reviewer', 'admin'))
  );

-- extracted_fields: visible to reviewer, admin, and office_engineer
drop policy if exists extracted_fields_select_reviewer_admin_office on extracted_fields;
create policy extracted_fields_select_reviewer_admin_office on extracted_fields
  for select to authenticated
  using (
    current_user_role() in ('reviewer', 'admin', 'office_engineer')
  );

-- alerts: rig_engineer sees only assigned wellbores; other roles see all
drop policy if exists alerts_select_user on alerts;
create policy alerts_select_user on alerts
  for select to authenticated
  using (
    (current_user_role() <> 'rig_engineer')
    or (wellbore_id = any(coalesce((select assigned_wellbore_ids from profiles where id = auth.uid()), '{}')))
  );

-- alert_views: user sees own viewed alerts
drop policy if exists alert_views_select_own on alert_views;
create policy alert_views_select_own on alert_views
  for select to authenticated
  using (user_id = auth.uid());

-- shift_notes: any authenticated can view
drop policy if exists shift_notes_select_authenticated on shift_notes;
create policy shift_notes_select_authenticated on shift_notes
  for select to authenticated
  using (true);

-- audit_log: visible to admin only
drop policy if exists audit_log_select_admin on audit_log;
create policy audit_log_select_admin on audit_log
  for select to authenticated
  using (current_user_role() = 'admin');

-- llm_cache: no policies for authenticated (backend service_role only)
