-- db/tests/test_review_well_assignment.sql
-- Verification test for migration 0013: review_field assigns a well to a document (contract §7).
-- Inserts its own rows and rolls everything back.

begin;

insert into auth.users (id, email, raw_user_meta_data)
values
  ('a0000013-0000-0000-0000-000000000001', 'wa-reviewer@example.com', '{"full_name":"WA Reviewer"}'),
  ('a0000013-0000-0000-0000-000000000002', 'wa-office@example.com', '{"full_name":"WA Office"}')
on conflict (id) do nothing;
update profiles set role = 'reviewer' where id = 'a0000013-0000-0000-0000-000000000001';
update profiles set role = 'office_engineer' where id = 'a0000013-0000-0000-0000-000000000002';

-- W1 has a primary and a non-primary wellbore, W2 has none; "OLD" is where a document's records were parked
insert into wells (id, name, surface, provenance)
values
  ('b0000013-0000-0000-0000-000000000001', 'WA-TEST-1', ST_GeogFromText('SRID=4326;POINT(95.31 27.36)'), 'synthetic'),
  ('b0000013-0000-0000-0000-000000000002', 'WA-TEST-2', ST_GeogFromText('SRID=4326;POINT(95.32 27.37)'), 'synthetic'),
  ('b0000013-0000-0000-0000-000000000003', 'WA-TEST-OLD', ST_GeogFromText('SRID=4326;POINT(95.33 27.38)'), 'synthetic');
insert into wellbores (id, well_id, name, kind, is_primary)
values
  ('c0000013-0000-0000-0000-000000000001', 'b0000013-0000-0000-0000-000000000001', 'WA-TEST-1-WB1', 'deviated', true),
  ('c0000013-0000-0000-0000-000000000011', 'b0000013-0000-0000-0000-000000000001', 'WA-TEST-1-SIDETRACK', 'deviated', false),
  ('c0000013-0000-0000-0000-000000000003', 'b0000013-0000-0000-0000-000000000003', 'WA-TEST-OLD-WB1', 'vertical', true);

-- six unmatched documents, one job and one well_id field each
insert into documents (id, doc_type, title, file_path, sha256)
select ('e0000013-0000-0000-0000-00000000000' || n)::uuid, 'ddr', 'WA doc ' || n, 'x/' || n || '.pdf', 'sha-wa-' || n
from generate_series(1, 6) n;
insert into jobs (id, doc_id, status)
select ('d0000013-0000-0000-0000-00000000000' || n)::uuid, ('e0000013-0000-0000-0000-00000000000' || n)::uuid, 'needs_review'
from generate_series(1, 6) n;

insert into extracted_fields (id, job_id, doc_id, entity, field, value, confidence, reason)
values
  -- 1: no well chosen yet (value null), 2: the value already holds W1, 3: W2 (no wellbore), 4: to be rejected,
  -- 5: for a value that is not a uuid, 6: for a well that does not exist
  ('f0000013-0000-0000-0000-000000000001', 'd0000013-0000-0000-0000-000000000001', 'e0000013-0000-0000-0000-000000000001', 'well_header', 'well_id', '{"raw":"Unknown-1","value":null,"unit":null}', 0, 'unmatched_well'),
  ('f0000013-0000-0000-0000-000000000002', 'd0000013-0000-0000-0000-000000000002', 'e0000013-0000-0000-0000-000000000002', 'well_header', 'well_id', '{"raw":"WA-TEST-1","value":"b0000013-0000-0000-0000-000000000001","unit":null}', 0, 'unmatched_well'),
  ('f0000013-0000-0000-0000-000000000003', 'd0000013-0000-0000-0000-000000000003', 'e0000013-0000-0000-0000-000000000003', 'well_header', 'well_id', '{"raw":"Unknown-3","value":null,"unit":null}', 0, 'unmatched_well'),
  ('f0000013-0000-0000-0000-000000000004', 'd0000013-0000-0000-0000-000000000004', 'e0000013-0000-0000-0000-000000000004', 'well_header', 'well_id', '{"raw":"Unknown-4","value":null,"unit":null}', 0, 'unmatched_well'),
  ('f0000013-0000-0000-0000-000000000005', 'd0000013-0000-0000-0000-000000000005', 'e0000013-0000-0000-0000-000000000005', 'well_header', 'well_id', '{"raw":"Unknown-5","value":null,"unit":null}', 0, 'unmatched_well'),
  ('f0000013-0000-0000-0000-000000000006', 'd0000013-0000-0000-0000-000000000006', 'e0000013-0000-0000-0000-000000000006', 'well_header', 'well_id', '{"raw":"Unknown-6","value":null,"unit":null}', 0, 'unmatched_well');

-- records of document 1, parked on the OLD wellbore; WA-TEST-1 already has a Tipam top of its own
insert into events (id, wellbore_id, event_type, md_from_m, description, provenance, doc_id)
values ('a1000013-0000-0000-0000-000000000001', 'c0000013-0000-0000-0000-000000000003', 'other', 100, 'parked event', 'synthetic', 'e0000013-0000-0000-0000-000000000001');
insert into formation_tops (id, wellbore_id, formation, top_md_m, source, provenance, doc_id)
values
  ('a2000013-0000-0000-0000-000000000001', 'c0000013-0000-0000-0000-000000000001', 'Tipam', 2200, 'actual', 'synthetic', null),
  ('a2000013-0000-0000-0000-000000000002', 'c0000013-0000-0000-0000-000000000003', 'Tipam', 2210, 'actual', 'synthetic', 'e0000013-0000-0000-0000-000000000001'),
  ('a2000013-0000-0000-0000-000000000003', 'c0000013-0000-0000-0000-000000000003', 'Barail', 2850, 'actual', 'synthetic', 'e0000013-0000-0000-0000-000000000001');
insert into hole_sections (id, wellbore_id, provenance, doc_id)
values ('a3000013-0000-0000-0000-000000000001', 'c0000013-0000-0000-0000-000000000003', 'synthetic', 'e0000013-0000-0000-0000-000000000001');
insert into cement_jobs (id, wellbore_id, job_type, provenance, doc_id)
values ('a4000013-0000-0000-0000-000000000001', 'c0000013-0000-0000-0000-000000000003', 'primary', 'synthetic', 'e0000013-0000-0000-0000-000000000001');
insert into mud_records (id, wellbore_id, provenance, doc_id)
values ('a5000013-0000-0000-0000-000000000001', 'c0000013-0000-0000-0000-000000000003', 'synthetic', 'e0000013-0000-0000-0000-000000000001');
insert into time_log (id, wellbore_id, doc_id)
values ('a6000013-0000-0000-0000-000000000001', 'c0000013-0000-0000-0000-000000000003', 'e0000013-0000-0000-0000-000000000001');

-- the same kind of parked records on document 3, whose well has no wellbore: they must stay where they are
insert into events (id, wellbore_id, event_type, md_from_m, description, provenance, doc_id)
values ('a1000013-0000-0000-0000-000000000003', 'c0000013-0000-0000-0000-000000000003', 'other', 300, 'stays', 'synthetic', 'e0000013-0000-0000-0000-000000000003');


--------------------------------------------------------------------------------
-- TEST 1: who may use it, and an empty value
--------------------------------------------------------------------------------
do $$
declare
  v_msg text;
begin
  set local role authenticated;

  -- office engineers cannot review
  set local request.jwt.claims = '{"sub":"a0000013-0000-0000-0000-000000000002"}';
  begin
    perform review_field('f0000013-0000-0000-0000-000000000001', 'edit', '{"raw":"x","value":"b0000013-0000-0000-0000-000000000001"}');
    raise exception 'Assertion failed: an office engineer assigned a well';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'NWIS_FORBIDDEN%' then raise exception 'Assertion failed: office engineer, wrong error: %', v_msg; end if;
  end;

  -- reviewer: approving with no well chosen is refused, the field stays pending, the document stays unmatched
  set local request.jwt.claims = '{"sub":"a0000013-0000-0000-0000-000000000001"}';
  begin
    perform review_field('f0000013-0000-0000-0000-000000000001', 'approve');
    raise exception 'Assertion failed: approve with an empty value was accepted';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'NWIS_BAD_REQUEST%' then raise exception 'Assertion failed: empty value, wrong error: %', v_msg; end if;
  end;
  begin
    perform review_field('f0000013-0000-0000-0000-000000000001', 'edit', null);
    raise exception 'Assertion failed: edit without a value was accepted';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'NWIS_BAD_REQUEST%' then raise exception 'Assertion failed: edit without value, wrong error: %', v_msg; end if;
  end;
  reset role;
  if (select review_status from extracted_fields where id = 'f0000013-0000-0000-0000-000000000001') <> 'pending' then
    raise exception 'Assertion failed: the field must stay pending after a refused review';
  end if;
  if (select well_id from documents where id = 'e0000013-0000-0000-0000-000000000001') is not null then
    raise exception 'Assertion failed: the document got a well from a refused review';
  end if;
end;
$$;


--------------------------------------------------------------------------------
-- TEST 2: bad values: not a uuid, a well that does not exist
--------------------------------------------------------------------------------
do $$
declare
  v_msg text;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000013-0000-0000-0000-000000000001"}';

  begin
    perform review_field('f0000013-0000-0000-0000-000000000005', 'edit', '{"raw":"x","value":"not-a-uuid"}');
    raise exception 'Assertion failed: a value that is not a uuid was accepted';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'NWIS_BAD_REQUEST%' then raise exception 'Assertion failed: bad uuid, wrong error: %', v_msg; end if;
  end;

  begin
    perform review_field('f0000013-0000-0000-0000-000000000006', 'edit', '{"raw":"x","value":"99999999-9999-4999-8999-999999999999"}');
    raise exception 'Assertion failed: a well that does not exist was accepted';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'NWIS_BAD_REQUEST%' then raise exception 'Assertion failed: unknown well, wrong error: %', v_msg; end if;
  end;
  reset role;

  if exists (select 1 from extracted_fields where id in ('f0000013-0000-0000-0000-000000000005', 'f0000013-0000-0000-0000-000000000006') and review_status <> 'pending') then
    raise exception 'Assertion failed: refused reviews must leave the fields pending';
  end if;
end;
$$;


--------------------------------------------------------------------------------
-- TEST 3: edit with a chosen well: document, primary wellbore, records move, job done, audit
--------------------------------------------------------------------------------
do $$
declare
  v_doc documents%rowtype;
  v_field extracted_fields%rowtype;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000013-0000-0000-0000-000000000001"}';
  v_field := review_field('f0000013-0000-0000-0000-000000000001', 'edit', '{"raw":"Unknown-1","value":"b0000013-0000-0000-0000-000000000001","unit":null}');
  reset role;

  if v_field.review_status <> 'edited' then raise exception 'Assertion failed: field status should be edited, got %', v_field.review_status; end if;
  if v_field.reviewed_by <> 'a0000013-0000-0000-0000-000000000001' then raise exception 'Assertion failed: reviewed_by not set'; end if;

  select * into v_doc from documents where id = 'e0000013-0000-0000-0000-000000000001';
  if v_doc.well_id <> 'b0000013-0000-0000-0000-000000000001' then raise exception 'Assertion failed: documents.well_id not set, got %', v_doc.well_id; end if;
  if v_doc.wellbore_id <> 'c0000013-0000-0000-0000-000000000001' then raise exception 'Assertion failed: documents.wellbore_id must be the PRIMARY wellbore, got %', v_doc.wellbore_id; end if;

  -- records moved to the new wellbore
  if (select wellbore_id from events where id = 'a1000013-0000-0000-0000-000000000001') <> 'c0000013-0000-0000-0000-000000000001' then raise exception 'Assertion failed: event did not move'; end if;
  if (select wellbore_id from hole_sections where id = 'a3000013-0000-0000-0000-000000000001') <> 'c0000013-0000-0000-0000-000000000001' then raise exception 'Assertion failed: hole section did not move'; end if;
  if (select wellbore_id from cement_jobs where id = 'a4000013-0000-0000-0000-000000000001') <> 'c0000013-0000-0000-0000-000000000001' then raise exception 'Assertion failed: cement job did not move'; end if;
  if (select wellbore_id from mud_records where id = 'a5000013-0000-0000-0000-000000000001') <> 'c0000013-0000-0000-0000-000000000001' then raise exception 'Assertion failed: mud record did not move'; end if;
  if (select wellbore_id from time_log where id = 'a6000013-0000-0000-0000-000000000001') <> 'c0000013-0000-0000-0000-000000000001' then raise exception 'Assertion failed: time log row did not move'; end if;

  -- the Tipam top would have duplicated the wellbore's own one: dropped, the own one is untouched; Barail moved
  if exists (select 1 from formation_tops where id = 'a2000013-0000-0000-0000-000000000002') then raise exception 'Assertion failed: the duplicate Tipam top should have been deleted'; end if;
  if (select top_md_m from formation_tops where id = 'a2000013-0000-0000-0000-000000000001') <> 2200 then raise exception 'Assertion failed: the wellbore''s own Tipam top was changed'; end if;
  if (select wellbore_id from formation_tops where id = 'a2000013-0000-0000-0000-000000000003') <> 'c0000013-0000-0000-0000-000000000001' then raise exception 'Assertion failed: the Barail top did not move'; end if;

  -- the only pending field of the job was reviewed: the job is done
  if (select status from jobs where id = 'd0000013-0000-0000-0000-000000000001') <> 'done' then raise exception 'Assertion failed: the job should be done'; end if;

  -- audit
  if not exists (select 1 from audit_log where action = 'field.edit' and entity_id = 'f0000013-0000-0000-0000-000000000001' and details->>'well_id' = 'b0000013-0000-0000-0000-000000000001') then
    raise exception 'Assertion failed: audit_log row with the well id is missing';
  end if;
end;
$$;


--------------------------------------------------------------------------------
-- TEST 4: approve when the value already holds a well
--------------------------------------------------------------------------------
do $$
declare
  v_doc documents%rowtype;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000013-0000-0000-0000-000000000001"}';
  perform review_field('f0000013-0000-0000-0000-000000000002', 'approve');
  reset role;

  select * into v_doc from documents where id = 'e0000013-0000-0000-0000-000000000002';
  if v_doc.well_id <> 'b0000013-0000-0000-0000-000000000001' or v_doc.wellbore_id <> 'c0000013-0000-0000-0000-000000000001' then
    raise exception 'Assertion failed: approve did not assign the well: %', v_doc;
  end if;
  if (select review_status from extracted_fields where id = 'f0000013-0000-0000-0000-000000000002') <> 'approved' then
    raise exception 'Assertion failed: field status should be approved';
  end if;
end;
$$;


--------------------------------------------------------------------------------
-- TEST 5: a well that has no wellbore yet: wellbore_id null, records stay where they are
--------------------------------------------------------------------------------
do $$
declare
  v_doc documents%rowtype;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000013-0000-0000-0000-000000000001"}';
  perform review_field('f0000013-0000-0000-0000-000000000003', 'edit', '{"raw":"Unknown-3","value":"b0000013-0000-0000-0000-000000000002"}');
  reset role;

  select * into v_doc from documents where id = 'e0000013-0000-0000-0000-000000000003';
  if v_doc.well_id <> 'b0000013-0000-0000-0000-000000000002' then raise exception 'Assertion failed: well_id not set for a well without wellbores'; end if;
  if v_doc.wellbore_id is not null then raise exception 'Assertion failed: wellbore_id must be null when the well has no wellbore, got %', v_doc.wellbore_id; end if;
  if (select wellbore_id from events where id = 'a1000013-0000-0000-0000-000000000003') <> 'c0000013-0000-0000-0000-000000000003' then
    raise exception 'Assertion failed: records must not move when there is no target wellbore';
  end if;
end;
$$;


--------------------------------------------------------------------------------
-- TEST 6: reject leaves the document without a well
--------------------------------------------------------------------------------
do $$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000013-0000-0000-0000-000000000001"}';
  perform review_field('f0000013-0000-0000-0000-000000000004', 'reject');
  reset role;

  if (select review_status from extracted_fields where id = 'f0000013-0000-0000-0000-000000000004') <> 'rejected' then
    raise exception 'Assertion failed: field status should be rejected';
  end if;
  if (select well_id from documents where id = 'e0000013-0000-0000-0000-000000000004') is not null then
    raise exception 'Assertion failed: reject must leave documents.well_id null';
  end if;
end;
$$;


--------------------------------------------------------------------------------
-- TEST 7: the identity columns of other entities are still protected (0009 behaviour kept)
--------------------------------------------------------------------------------
do $$
declare
  v_msg text;
begin
  insert into events (id, wellbore_id, event_type, md_from_m, description, provenance)
  values ('a1000013-0000-0000-0000-000000000007', 'c0000013-0000-0000-0000-000000000001', 'other', 1, 'e', 'synthetic');
  insert into extracted_fields (id, doc_id, entity, entity_id, field, value, confidence)
  values ('f0000013-0000-0000-0000-000000000007', 'e0000013-0000-0000-0000-000000000005', 'event', 'a1000013-0000-0000-0000-000000000007', 'wellbore_id', to_jsonb('c0000013-0000-0000-0000-000000000003'::text), 0.5);

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000013-0000-0000-0000-000000000001"}';
  begin
    perform review_field('f0000013-0000-0000-0000-000000000007', 'approve');
    raise exception 'Assertion failed: events.wellbore_id was accepted through review';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'NWIS_BAD_REQUEST%' then raise exception 'Assertion failed: protected column, wrong error: %', v_msg; end if;
  end;
  reset role;
end;
$$;

do $$ begin raise notice 'All review well-assignment assertions passed successfully!'; end; $$;

rollback;
