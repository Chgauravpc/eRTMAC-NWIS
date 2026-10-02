-- db/tests/test_views.sql
-- Verification test for DB-12: the five views of contract §6 (migration 0012_views.sql).
-- Inserts its own rows and rolls everything back.

begin;

-- users: a rig engineer assigned to wellbore A, a reviewer, an admin
insert into auth.users (id, email, raw_user_meta_data)
values
  ('a0000012-0000-0000-0000-000000000001', 'views-admin@example.com', '{"full_name":"Views Admin"}'),
  ('a0000012-0000-0000-0000-000000000002', 'views-rig@example.com', '{"full_name":"Views Rig"}'),
  ('a0000012-0000-0000-0000-000000000003', 'views-reviewer@example.com', '{"full_name":"Views Reviewer"}')
on conflict (id) do nothing;

update profiles set role = 'admin' where id = 'a0000012-0000-0000-0000-000000000001';
update profiles
set role = 'rig_engineer', assigned_wellbore_ids = array['c0000012-0000-0000-0000-000000000001'::uuid]
where id = 'a0000012-0000-0000-0000-000000000002';
update profiles set role = 'reviewer' where id = 'a0000012-0000-0000-0000-000000000003';

insert into wells (id, name, field, basin, surface, provenance, status, td_md_m)
values
  ('b0000012-0000-0000-0000-000000000001', 'VIEW-TEST-A', 'View Field', 'Upper Assam', ST_GeogFromText('SRID=4326;POINT(95.31 27.36)'), 'synthetic', 'drilling', 3000),
  ('b0000012-0000-0000-0000-000000000002', 'VIEW-TEST-B', 'View Field', 'Upper Assam', ST_GeogFromText('SRID=4326;POINT(95.40 27.40)'), 'direct', 'completed', 2500);

insert into wellbores (id, well_id, name, kind, is_primary)
values
  ('c0000012-0000-0000-0000-000000000001', 'b0000012-0000-0000-0000-000000000001', 'VIEW-TEST-A-WB1', 'deviated', true),
  ('c0000012-0000-0000-0000-000000000002', 'b0000012-0000-0000-0000-000000000002', 'VIEW-TEST-B-WB1', 'vertical', true);

-- events on A: 2 x losses (5 h, 7 h), 1 x stuck pipe (3 h), 1 with no risk type (2 h), 1 rejected (100 h)
insert into events (wellbore_id, event_type, risk_type, md_from_m, formation, npt_h, description, provenance, review_status)
values
  ('c0000012-0000-0000-0000-000000000001', 'loss_partial', 'losses', 2400, 'Tipam', 5, 'partial losses', 'synthetic', 'approved'),
  ('c0000012-0000-0000-0000-000000000001', 'loss_total', 'losses', 2450, 'Tipam', 7, 'total losses', 'synthetic', 'approved'),
  ('c0000012-0000-0000-0000-000000000001', 'stuck_pipe_mech', 'stuck_pipe', 2900, 'Barail', 3, 'stuck', 'synthetic', 'approved'),
  ('c0000012-0000-0000-0000-000000000001', 'other', null, 1000, 'Namsang', 2, 'something odd', 'synthetic', 'approved'),
  ('c0000012-0000-0000-0000-000000000001', 'loss_partial', 'losses', 2410, 'Tipam', 100, 'rejected by a reviewer', 'synthetic', 'rejected');

-- alerts: A has one open and one resolved, B has one open
insert into alerts (id, wellbore_id, kind, severity, state, dedup_key, title, message)
values
  ('d0000012-0000-0000-0000-000000000001', 'c0000012-0000-0000-0000-000000000001', 'lookahead', 'warning', 'sent', 'views:a:open', 'A open', 'open on A'),
  ('d0000012-0000-0000-0000-000000000002', 'c0000012-0000-0000-0000-000000000001', 'lookahead', 'watch', 'resolved', 'views:a:done', 'A resolved', 'resolved on A'),
  ('d0000012-0000-0000-0000-000000000003', 'c0000012-0000-0000-0000-000000000002', 'lookahead', 'watch', 'generated', 'views:b:open', 'B open', 'open on B');

-- a document with a page image, and extracted fields (two pending, one approved)
insert into documents (id, well_id, wellbore_id, doc_type, title, file_path, sha256)
values ('e0000012-0000-0000-0000-000000000001', 'b0000012-0000-0000-0000-000000000001', 'c0000012-0000-0000-0000-000000000001', 'ddr', 'DDR view test', 'x/y.pdf', 'sha-views-doc');
insert into document_pages (doc_id, page_no, image_path)
values ('e0000012-0000-0000-0000-000000000001', 1, 'e0000012/1.png');
insert into extracted_fields (id, doc_id, page, entity, field, value, confidence, review_status)
values
  ('f0000012-0000-0000-0000-000000000001', 'e0000012-0000-0000-0000-000000000001', 1, 'event', 'md_from_m', '1900'::jsonb, 0.4, 'pending'),
  ('f0000012-0000-0000-0000-000000000002', 'e0000012-0000-0000-0000-000000000001', 7, 'event', 'md_to_m', '1950'::jsonb, 0.4, 'pending'),
  ('f0000012-0000-0000-0000-000000000003', 'e0000012-0000-0000-0000-000000000001', 1, 'event', 'description', '"x"'::jsonb, 0.9, 'approved');

insert into trajectories (wellbore_id, geom)
values ('c0000012-0000-0000-0000-000000000001', ST_GeomFromText('SRID=4326;LINESTRING Z(95.31 27.36 0, 95.32 27.37 1000)'));


--------------------------------------------------------------------------------
-- TEST 1: every view runs with the caller's rights (security_invoker)
--------------------------------------------------------------------------------
do $$
declare
  v_name text;
  v_opts text[];
begin
  foreach v_name in array array['v_well_summary', 'v_npt_by_formation', 'v_open_alerts', 'v_review_queue', 'v_trajectory_geojson'] loop
    select reloptions into v_opts from pg_class where relname = v_name and relnamespace = 'public'::regnamespace;
    if v_opts is null then raise exception 'Assertion failed: view % does not exist', v_name; end if;
    if not ('security_invoker=true' = any(v_opts)) then
      raise exception 'Assertion failed: view % is not security_invoker (reloptions: %)', v_name, v_opts;
    end if;
  end loop;
end;
$$;


--------------------------------------------------------------------------------
-- TEST 2: v_well_summary: one row per wellbore, rejected events excluded, top risk type, lon/lat
--------------------------------------------------------------------------------
do $$
declare
  r record;
  v_rows int;
begin
  select count(*) into v_rows from v_well_summary where wellbore_id in ('c0000012-0000-0000-0000-000000000001', 'c0000012-0000-0000-0000-000000000002');
  if v_rows <> 2 then raise exception 'Assertion failed: expected 2 rows (one per wellbore), got %', v_rows; end if;

  select * into r from v_well_summary where wellbore_id = 'c0000012-0000-0000-0000-000000000001';
  if r.well_id <> 'b0000012-0000-0000-0000-000000000001' or r.well_name <> 'VIEW-TEST-A' then raise exception 'Assertion failed: A identity: %', r; end if;
  if r.field <> 'View Field' or r.basin <> 'Upper Assam' or r.status <> 'drilling' or r.provenance <> 'synthetic' then raise exception 'Assertion failed: A attributes: %', r; end if;
  if abs(r.lon - 95.31) > 1e-6 or abs(r.lat - 27.36) > 1e-6 then raise exception 'Assertion failed: A lon/lat: % %', r.lon, r.lat; end if;
  if r.td_md_m <> 3000 then raise exception 'Assertion failed: A td_md_m: %', r.td_md_m; end if;
  if r.event_count <> 4 then raise exception 'Assertion failed: A event_count should be 4 (rejected excluded), got %', r.event_count; end if;
  if r.npt_h_total <> 17 then raise exception 'Assertion failed: A npt_h_total should be 17 (rejected excluded), got %', r.npt_h_total; end if;
  if r.top_risk_type <> 'losses' then raise exception 'Assertion failed: A top_risk_type should be losses, got %', r.top_risk_type; end if;

  select * into r from v_well_summary where wellbore_id = 'c0000012-0000-0000-0000-000000000002';
  if r.event_count <> 0 or r.npt_h_total <> 0 or r.top_risk_type is not null then
    raise exception 'Assertion failed: B (no events) should be 0 / 0 / null, got % / % / %', r.event_count, r.npt_h_total, r.top_risk_type;
  end if;
end;
$$;


--------------------------------------------------------------------------------
-- TEST 3: v_npt_by_formation
--------------------------------------------------------------------------------
do $$
declare
  r record;
begin
  select * into r from v_npt_by_formation where formation = 'Tipam' and risk_type = 'losses'
    and well_count >= 1 and event_count = 2;
  if not found then raise exception 'Assertion failed: Tipam/losses row (2 events) missing'; end if;
  if r.npt_h_total <> 12 then raise exception 'Assertion failed: Tipam/losses npt should be 12 (rejected excluded), got %', r.npt_h_total; end if;
  if r.well_count <> 1 then raise exception 'Assertion failed: Tipam/losses well_count should be 1, got %', r.well_count; end if;

  select * into r from v_npt_by_formation where formation = 'Barail' and risk_type = 'stuck_pipe' and event_count = 1;
  if not found or r.npt_h_total <> 3 then raise exception 'Assertion failed: Barail/stuck_pipe row wrong: %', r; end if;

  if exists (select 1 from v_npt_by_formation where formation = 'Namsang' and risk_type is null) then
    raise exception 'Assertion failed: events without a risk type must not appear';
  end if;
end;
$$;


--------------------------------------------------------------------------------
-- TEST 4: v_open_alerts and the rig engineer's row level security
--------------------------------------------------------------------------------
do $$
declare
  v_n int;
  r record;
begin
  -- as the service owner: both open alerts, the resolved one is not listed
  select count(*) into v_n from v_open_alerts where id in ('d0000012-0000-0000-0000-000000000001', 'd0000012-0000-0000-0000-000000000002', 'd0000012-0000-0000-0000-000000000003');
  if v_n <> 2 then raise exception 'Assertion failed: expected 2 open alerts, got %', v_n; end if;
  select * into r from v_open_alerts where id = 'd0000012-0000-0000-0000-000000000001';
  if r.well_name <> 'VIEW-TEST-A' or r.title <> 'A open' or r.severity <> 'warning' then raise exception 'Assertion failed: alert columns / well_name: %', r; end if;

  -- as the rig engineer assigned to A: only A's open alert
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000012-0000-0000-0000-000000000002"}';
  select count(*) into v_n from v_open_alerts where id in ('d0000012-0000-0000-0000-000000000001', 'd0000012-0000-0000-0000-000000000003');
  if v_n <> 1 then raise exception 'Assertion failed: rig engineer should see 1 open alert (the assigned well), got %', v_n; end if;
  if not exists (select 1 from v_open_alerts where id = 'd0000012-0000-0000-0000-000000000001') then
    raise exception 'Assertion failed: rig engineer cannot see the alert of the assigned well';
  end if;
  reset role;
end;
$$;


--------------------------------------------------------------------------------
-- TEST 5: v_review_queue
--------------------------------------------------------------------------------
do $$
declare
  r record;
  v_n int;
begin
  select count(*) into v_n from v_review_queue where doc_id = 'e0000012-0000-0000-0000-000000000001';
  if v_n <> 2 then raise exception 'Assertion failed: only the 2 pending fields belong in the queue, got %', v_n; end if;

  select * into r from v_review_queue where id = 'f0000012-0000-0000-0000-000000000001';
  if r.doc_title <> 'DDR view test' or r.doc_type <> 'ddr' or r.image_path <> 'e0000012/1.png' then
    raise exception 'Assertion failed: queue columns for page 1: %', r;
  end if;
  if r.field <> 'md_from_m' or r.review_status <> 'pending' then raise exception 'Assertion failed: extracted_fields columns missing: %', r; end if;

  select * into r from v_review_queue where id = 'f0000012-0000-0000-0000-000000000002';
  if r.image_path is not null then raise exception 'Assertion failed: a page without an image has image_path null, got %', r.image_path; end if;

  -- a reviewer sees the queue, a rig engineer does not
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000012-0000-0000-0000-000000000003"}';
  select count(*) into v_n from v_review_queue where doc_id = 'e0000012-0000-0000-0000-000000000001';
  if v_n <> 2 then raise exception 'Assertion failed: reviewer should see 2 queue rows, got %', v_n; end if;
  set local request.jwt.claims = '{"sub":"a0000012-0000-0000-0000-000000000002"}';
  select count(*) into v_n from v_review_queue where doc_id = 'e0000012-0000-0000-0000-000000000001';
  if v_n <> 0 then raise exception 'Assertion failed: rig engineer must not see the review queue, got % rows', v_n; end if;
  reset role;
end;
$$;


--------------------------------------------------------------------------------
-- TEST 6: v_trajectory_geojson: a 2D GeoJSON line
--------------------------------------------------------------------------------
do $$
declare
  r record;
begin
  select * into r from v_trajectory_geojson where wellbore_id = 'c0000012-0000-0000-0000-000000000001';
  if not found then raise exception 'Assertion failed: trajectory row missing'; end if;
  if r.well_name <> 'VIEW-TEST-A' then raise exception 'Assertion failed: well_name %', r.well_name; end if;
  if r.geojson->>'type' <> 'LineString' then raise exception 'Assertion failed: geojson type %', r.geojson->>'type'; end if;
  if json_array_length(r.geojson->'coordinates') <> 2 then raise exception 'Assertion failed: expected 2 points'; end if;
  if json_array_length((r.geojson->'coordinates')->0) <> 2 then raise exception 'Assertion failed: points must be 2D (lon, lat), got %', (r.geojson->'coordinates')->0; end if;
end;
$$;

do $$ begin raise notice 'All DB-12 view assertions passed successfully!'; end; $$;

rollback;
