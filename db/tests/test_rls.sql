-- db/tests/test_rls.sql
-- Verification test for DB-05 part 1: Row Level Security policies

begin;

-- Step 1: Create test users and profiles as service role / superuser
do $$
begin
  -- Setup test users in auth.users (dummy records)
  insert into auth.users (id, email, raw_user_meta_data)
  values
    ('a0000001-0000-0000-0000-000000000001', 'admin@example.com', '{"full_name":"Admin User"}'),
    ('a0000001-0000-0000-0000-000000000002', 'rig@example.com', '{"full_name":"Rig Engineer"}'),
    ('a0000001-0000-0000-0000-000000000003', 'office@example.com', '{"full_name":"Office Engineer"}'),
    ('a0000001-0000-0000-0000-000000000004', 'reviewer@example.com', '{"full_name":"Reviewer User"}')
  on conflict (id) do nothing;

  -- Configure roles and assignments in profiles
  update profiles set role = 'admin' where id = 'a0000001-0000-0000-0000-000000000001';
  update profiles
  set role = 'rig_engineer',
      assigned_wellbore_ids = array['c0000001-0000-0000-0000-000000000001'::uuid]
  where id = 'a0000001-0000-0000-0000-000000000002';
  update profiles set role = 'office_engineer' where id = 'a0000001-0000-0000-0000-000000000003';
  update profiles set role = 'reviewer' where id = 'a0000001-0000-0000-0000-000000000004';
end;
$$;

-- Step 2: Setup test wells, wellbores, alerts, telemetry, jobs, and extracted fields
insert into wells (id, name, surface, provenance, status)
values
  ('b0000001-0000-0000-0000-000000000001', 'SYN-RLS-WELL-A', ST_GeogFromText('SRID=4326;POINT(95.31 27.36)'), 'synthetic', 'drilling'),
  ('b0000001-0000-0000-0000-000000000002', 'SYN-RLS-WELL-B', ST_GeogFromText('SRID=4326;POINT(95.32 27.37)'), 'synthetic', 'drilling');

insert into wellbores (id, well_id, name, kind, is_primary)
values
  ('c0000001-0000-0000-0000-000000000001', 'b0000001-0000-0000-0000-000000000001', 'SYN-RLS-WELL-A-WB1', 'deviated', true),
  ('c0000001-0000-0000-0000-000000000002', 'b0000001-0000-0000-0000-000000000002', 'SYN-RLS-WELL-B-WB1', 'deviated', true);

-- Alerts on both wells
insert into alerts (id, wellbore_id, kind, severity, dedup_key, title, message)
values
  ('d0000001-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000001', 'lookahead', 'watch', 'test:alert:assigned', 'Alert A', 'On assigned well A'),
  ('d0000001-0000-0000-0000-000000000002', 'c0000001-0000-0000-0000-000000000002', 'lookahead', 'watch', 'test:alert:unassigned', 'Alert B', 'On unassigned well B');

-- Stream state and depth_series for Well A (bit depth = 2000m)
insert into stream_state (wellbore_id, status, bit_md_m)
values ('c0000001-0000-0000-0000-000000000001', 'live', 2000.0);

insert into depth_series (wellbore_id, md_m, rop_m_h, torque_knm)
values
  ('c0000001-0000-0000-0000-000000000001', 1000.0, 15.0, 12.0),
  ('c0000001-0000-0000-0000-000000000001', 2000.0, 18.0, 14.0),
  ('c0000001-0000-0000-0000-000000000001', 3000.0, 22.0, 16.0); -- future telemetry, md > bit_md_m

-- Test document and jobs
insert into documents (id, well_id, doc_type, title, file_path, sha256)
values ('e0000001-0000-0000-0000-000000000001', 'b0000001-0000-0000-0000-000000000001', 'ddr', 'DDR 1', 'docs/1.pdf', 'sha256-rls-doc-1');

insert into jobs (id, doc_id, created_by, status)
values
  ('f0000001-0000-0000-0000-000000000001', 'e0000001-0000-0000-0000-000000000001', 'a0000001-0000-0000-0000-000000000003', 'done'), -- created by office user
  ('f0000001-0000-0000-0000-000000000002', 'e0000001-0000-0000-0000-000000000001', 'a0000001-0000-0000-0000-000000000001', 'done'); -- created by admin

insert into extracted_fields (id, doc_id, entity, field, value, confidence)
values ('f0000002-0000-0000-0000-000000000001', 'e0000001-0000-0000-0000-000000000001', 'event', 'md_from_m', '1900'::jsonb, 0.95);

insert into audit_log (user_id, action, entity, entity_id)
values ('a0000001-0000-0000-0000-000000000001', 'user.invite', 'user', 'a0000001-0000-0000-0000-000000000002');

insert into llm_cache (prompt_hash, provider, model, response)
values ('hash-test-01', 'groq', 'test-model', '{"ok":true}'::jsonb);


-- Step 3: Run RLS assertions

-- Test A: Rig Engineer perspective
do $$
declare
  v_count int;
begin
  -- Switch context to Rig Engineer
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"a0000001-0000-0000-0000-000000000002"}', true);

  -- 1. Must see alerts only on assigned well A, NOT on unassigned well B
  select count(*) into v_count from alerts where wellbore_id = 'c0000001-0000-0000-0000-000000000002';
  if v_count <> 0 then
    raise exception 'RLS Failure: Rig engineer saw alert on unassigned well (count = %)', v_count;
  end if;

  select count(*) into v_count from alerts where wellbore_id = 'c0000001-0000-0000-0000-000000000001';
  if v_count <> 1 then
    raise exception 'RLS Failure: Rig engineer could not see alert on assigned well (count = %)', v_count;
  end if;

  -- 2. Depth series: rows with md_m > 2000m must be hidden
  select count(*) into v_count from depth_series where wellbore_id = 'c0000001-0000-0000-0000-000000000001';
  if v_count <> 2 then
    raise exception 'RLS Failure: Depth series future hiding failed (expected 2 rows <= 2000m, got %)', v_count;
  end if;

  select count(*) into v_count from depth_series where wellbore_id = 'c0000001-0000-0000-0000-000000000001' and md_m > 2000.0;
  if v_count <> 0 then
    raise exception 'RLS Failure: Future depth telemetry leaked past bit depth! (count = %)', v_count;
  end if;

  -- 3. Profiles: Rig engineer sees only their own profile
  select count(*) into v_count from profiles;
  if v_count <> 1 then
    raise exception 'RLS Failure: Rig engineer should only see own profile (got count = %)', v_count;
  end if;

  -- 4. Extracted fields and Audit log should be hidden from Rig Engineer
  select count(*) into v_count from extracted_fields;
  if v_count <> 0 then
    raise exception 'RLS Failure: Extracted fields visible to rig engineer!';
  end if;

  select count(*) into v_count from audit_log;
  if v_count <> 0 then
    raise exception 'RLS Failure: Audit log visible to rig engineer!';
  end if;

  -- 5. LLM cache must be completely hidden
  select count(*) into v_count from llm_cache;
  if v_count <> 0 then
    raise exception 'RLS Failure: LLM cache visible to user!';
  end if;

  raise notice 'Rig Engineer RLS checks passed.';
end;
$$;


-- Test B: Office Engineer perspective
do $$
declare
  v_count int;
begin
  -- Switch context to Office Engineer
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"a0000001-0000-0000-0000-000000000003"}', true);

  -- 1. Office engineer sees all alerts
  select count(*) into v_count from alerts;
  if v_count < 2 then
    raise exception 'RLS Failure: Office engineer should see all alerts (got %)', v_count;
  end if;

  -- 2. Office engineer sees extracted fields
  select count(*) into v_count from extracted_fields;
  if v_count < 1 then
    raise exception 'RLS Failure: Office engineer should see extracted fields';
  end if;

  -- 3. Office engineer sees only own created jobs
  select count(*) into v_count from jobs;
  if v_count <> 1 then
    raise exception 'RLS Failure: Office engineer saw unowned job (expected 1, got %)', v_count;
  end if;

  raise notice 'Office Engineer RLS checks passed.';
end;
$$;


-- Test C: Reviewer perspective
do $$
declare
  v_count int;
begin
  -- Switch context to Reviewer
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"a0000001-0000-0000-0000-000000000004"}', true);

  -- 1. Reviewer sees all jobs
  select count(*) into v_count from jobs;
  if v_count < 2 then
    raise exception 'RLS Failure: Reviewer should see all jobs (got %)', v_count;
  end if;

  -- 2. Reviewer sees extracted fields
  select count(*) into v_count from extracted_fields;
  if v_count < 1 then
    raise exception 'RLS Failure: Reviewer should see extracted fields';
  end if;

  raise notice 'Reviewer RLS checks passed.';
end;
$$;


-- Test D: Admin perspective
do $$
declare
  v_count int;
begin
  -- Switch context to Admin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"a0000001-0000-0000-0000-000000000001"}', true);

  -- 1. Admin sees all profiles
  select count(*) into v_count from profiles;
  if v_count < 4 then
    raise exception 'RLS Failure: Admin should see all profiles (got %)', v_count;
  end if;

  -- 2. Admin sees all audit log rows
  select count(*) into v_count from audit_log;
  if v_count < 1 then
    raise exception 'RLS Failure: Admin should see audit log rows';
  end if;

  raise notice 'Admin RLS checks passed.';
  raise notice 'ALL DB-05 RLS ASSERTIONS PASSED SUCCESSFULLY!';
end;
$$;

rollback;
