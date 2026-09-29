-- db/tests/test_alert_rpcs.sql
-- Comprehensive test suite for DB-05 part 2:
-- Lifecycle RPCs (mark_alert_viewed, ack_alert, resolve_alert, dismiss_alert, rate_alert),
-- review_field, add_shift_note, and audit_log verification.

begin;

-- Step 1: Create test users, profiles, and fixtures
do $$
declare
  v_well_id uuid := 'b0000001-0000-0000-0000-000000000001';
  v_wb_a uuid := 'b0000002-0000-0000-0000-000000000001';
  v_wb_b uuid := 'b0000002-0000-0000-0000-000000000002';
  v_u_admin uuid := 'a0000001-0000-0000-0000-000000000001';
  v_u_rig uuid := 'a0000001-0000-0000-0000-000000000002';
  v_u_rtoc uuid := 'a0000001-0000-0000-0000-000000000003';
  v_u_office uuid := 'a0000001-0000-0000-0000-000000000004';
  v_u_reviewer uuid := 'a0000001-0000-0000-0000-000000000005';
begin
  -- Insert dummy users in auth.users
  insert into auth.users (id, email, raw_user_meta_data)
  values
    (v_u_admin, 'admin@example.com', '{"full_name":"Admin User"}'),
    (v_u_rig, 'rig@example.com', '{"full_name":"Rig Engineer"}'),
    (v_u_rtoc, 'rtoc@example.com', '{"full_name":"RTOC Engineer"}'),
    (v_u_office, 'office@example.com', '{"full_name":"Office Engineer"}'),
    (v_u_reviewer, 'reviewer@example.com', '{"full_name":"Reviewer User"}')
  on conflict (id) do nothing;

  -- Configure roles and assigned wellbores in profiles
  update profiles set role = 'admin', assigned_wellbore_ids = '{}' where id = v_u_admin;
  update profiles set role = 'rig_engineer', assigned_wellbore_ids = array[v_wb_a] where id = v_u_rig;
  update profiles set role = 'rtoc_engineer', assigned_wellbore_ids = '{}' where id = v_u_rtoc;
  update profiles set role = 'office_engineer', assigned_wellbore_ids = '{}' where id = v_u_office;
  update profiles set role = 'reviewer', assigned_wellbore_ids = '{}' where id = v_u_reviewer;

  -- Create test well and two wellbores (A = assigned, B = unassigned for rig engineer)
  insert into wells (id, name, field, basin, surface, provenance, status)
  values (v_well_id, 'SYN-RPC-WELL', 'TestField', 'Upper Assam', ST_GeogFromText('SRID=4326;POINT(95.30 27.35)'), 'synthetic', 'drilling')
  on conflict (id) do nothing;

  insert into wellbores (id, well_id, name, kind, is_primary)
  values
    (v_wb_a, v_well_id, 'SYN-RPC-WB-A', 'vertical', true),
    (v_wb_b, v_well_id, 'SYN-RPC-WB-B', 'deviated', false)
  on conflict (id) do nothing;
end;
$$;


--------------------------------------------------------------------------------
-- TEST 1: mark_alert_viewed
--------------------------------------------------------------------------------
do $$
declare
  v_alert_id uuid := 'c0000001-0000-0000-0000-000000000001';
  v_wb_a uuid := 'b0000002-0000-0000-0000-000000000001';
  v_wb_b uuid := 'b0000002-0000-0000-0000-000000000002';
  v_u_rig uuid := 'a0000001-0000-0000-0000-000000000002';
  v_state alert_state;
  v_views_count int;
  v_failed boolean;
begin
  -- Setup alert in sent state on wellbore A (assigned to rig engineer)
  insert into alerts (id, wellbore_id, kind, severity, state, dedup_key, title, message)
  values (v_alert_id, v_wb_a, 'lookahead', 'watch', 'sent', 'test:view:1', 'Test Watch', 'Message')
  on conflict (id) do update set state = 'sent', wellbore_id = v_wb_a;

  -- Rig engineer views assigned alert -> state becomes 'viewed'
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000001-0000-0000-0000-000000000002"}';
  perform mark_alert_viewed(v_alert_id);

  select state into v_state from alerts where id = v_alert_id;
  if v_state <> 'viewed' then
    raise exception 'Assertion failed: alert state should be viewed, got %', v_state;
  end if;

  select count(*) into v_views_count from alert_views where alert_id = v_alert_id and user_id = v_u_rig;
  if v_views_count <> 1 then
    raise exception 'Assertion failed: alert_views entry missing';
  end if;

  -- Test forbidden: rig engineer viewing alert on unassigned wellbore B
  reset role;
  update alerts set wellbore_id = v_wb_b, state = 'sent' where id = v_alert_id;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000001-0000-0000-0000-000000000002"}';

  v_failed := false;
  begin
    perform mark_alert_viewed(v_alert_id);
  exception when others then
    if sqlerrm like '%NWIS_FORBIDDEN%' then
      v_failed := true;
    else
      raise exception 'Unexpected error on forbidden view: %', sqlerrm;
    end if;
  end;
  if not v_failed then
    raise exception 'Assertion failed: viewing unassigned alert should raise NWIS_FORBIDDEN';
  end if;
end;
$$;


--------------------------------------------------------------------------------
-- TEST 2: ack_alert
--------------------------------------------------------------------------------
do $$
declare
  v_alert_id uuid := 'c0000001-0000-0000-0000-000000000002';
  v_wb_a uuid := 'b0000002-0000-0000-0000-000000000001';
  v_wb_b uuid := 'b0000002-0000-0000-0000-000000000002';
  v_u_rig uuid := 'a0000001-0000-0000-0000-000000000002';
  v_res alerts;
  v_failed boolean;
begin
  reset role;
  -- Critical alert on assigned wellbore A
  insert into alerts (id, wellbore_id, kind, severity, state, dedup_key, title, message)
  values (v_alert_id, v_wb_a, 'detector', 'critical', 'sent', 'test:ack:1', 'Test Critical', 'Message')
  on conflict (id) do update set state = 'sent', wellbore_id = v_wb_a;

  -- Rig engineer acknowledges assigned critical alert -> succeeds
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000001-0000-0000-0000-000000000002"}';
  v_res := ack_alert(v_alert_id, 'Taking action on rig');

  if v_res.state <> 'acknowledged' or v_res.acknowledged_by <> v_u_rig or v_res.action_note <> 'Taking action on rig' then
    raise exception 'Assertion failed: ack_alert did not update row correctly: %', v_res;
  end if;

  -- Test bad state: acknowledging already acknowledged alert
  v_failed := false;
  begin
    perform ack_alert(v_alert_id);
  exception when others then
    if sqlerrm like '%NWIS_BAD_STATE%' then
      v_failed := true;
    end if;
  end;
  if not v_failed then
    raise exception 'Assertion failed: ack on acknowledged alert should raise NWIS_BAD_STATE';
  end if;

  -- Test forbidden: office engineer calling ack_alert
  reset role;
  update alerts set state = 'viewed' where id = v_alert_id;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000001-0000-0000-0000-000000000004"}'; -- office

  v_failed := false;
  begin
    perform ack_alert(v_alert_id);
  exception when others then
    if sqlerrm like '%NWIS_FORBIDDEN%' then
      v_failed := true;
    end if;
  end;
  if not v_failed then
    raise exception 'Assertion failed: office engineer calling ack_alert should raise NWIS_FORBIDDEN';
  end if;

  -- Test forbidden: unassigned rig engineer calling ack_alert on wellbore B
  reset role;
  update alerts set wellbore_id = v_wb_b, state = 'sent' where id = v_alert_id;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000001-0000-0000-0000-000000000002"}'; -- rig

  v_failed := false;
  begin
    perform ack_alert(v_alert_id);
  exception when others then
    if sqlerrm like '%NWIS_FORBIDDEN%' then
      v_failed := true;
    end if;
  end;
  if not v_failed then
    raise exception 'Assertion failed: unassigned rig engineer calling ack_alert should raise NWIS_FORBIDDEN';
  end if;
end;
$$;


--------------------------------------------------------------------------------
-- TEST 3: resolve_alert (manual)
--------------------------------------------------------------------------------
do $$
declare
  v_alert_id uuid := 'c0000001-0000-0000-0000-000000000003';
  v_wb_a uuid := 'b0000002-0000-0000-0000-000000000001';
  v_res alerts;
  v_failed boolean;
begin
  reset role;
  -- Case A: Rig engineer resolving watch alert on assigned wellbore from 'sent' -> succeeds
  insert into alerts (id, wellbore_id, kind, severity, state, dedup_key, title, message)
  values (v_alert_id, v_wb_a, 'lookahead', 'watch', 'sent', 'test:resolve:1', 'Test Watch', 'Message')
  on conflict (id) do update set state = 'sent', severity = 'watch', wellbore_id = v_wb_a;

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000001-0000-0000-0000-000000000002"}'; -- rig
  v_res := resolve_alert(v_alert_id, 'avoided', 'Mud weight increased');
  if v_res.state <> 'resolved' or v_res.resolved_how <> 'manual' or v_res.outcome <> 'avoided' then
    raise exception 'Assertion failed: resolve_alert for rig engineer watch failed';
  end if;

  -- Case B: Rig engineer trying to resolve critical alert -> NWIS_FORBIDDEN
  reset role;
  update alerts set severity = 'critical', state = 'acknowledged' where id = v_alert_id;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000001-0000-0000-0000-000000000002"}'; -- rig

  v_failed := false;
  begin
    perform resolve_alert(v_alert_id, 'avoided');
  exception when others then
    if sqlerrm like '%NWIS_FORBIDDEN%' then
      v_failed := true;
    end if;
  end;
  if not v_failed then
    raise exception 'Assertion failed: rig engineer resolving critical alert should raise NWIS_FORBIDDEN';
  end if;

  -- Case C: RTOC engineer resolving critical alert when NOT acknowledged (e.g. 'viewed') -> NWIS_BAD_STATE
  reset role;
  update alerts set severity = 'critical', state = 'viewed' where id = v_alert_id;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000001-0000-0000-0000-000000000003"}'; -- rtoc

  v_failed := false;
  begin
    perform resolve_alert(v_alert_id, 'avoided');
  exception when others then
    if sqlerrm like '%NWIS_BAD_STATE%' then
      v_failed := true;
    end if;
  end;
  if not v_failed then
    raise exception 'Assertion failed: resolving unacknowledged critical alert should raise NWIS_BAD_STATE';
  end if;

  -- Case D: RTOC engineer resolving critical alert after acknowledged -> succeeds
  reset role;
  update alerts set state = 'acknowledged' where id = v_alert_id;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000001-0000-0000-0000-000000000003"}'; -- rtoc
  v_res := resolve_alert(v_alert_id, 'event_occurred', 'Packoff occurred as predicted');
  if v_res.state <> 'resolved' or v_res.outcome <> 'event_occurred' then
    raise exception 'Assertion failed: rtoc resolving acknowledged critical alert failed';
  end if;
end;
$$;


--------------------------------------------------------------------------------
-- TEST 4: dismiss_alert
--------------------------------------------------------------------------------
do $$
declare
  v_alert_id uuid := 'c0000001-0000-0000-0000-000000000004';
  v_wb_a uuid := 'b0000002-0000-0000-0000-000000000001';
  v_res alerts;
  v_failed boolean;
begin
  reset role;
  -- Case A: Dismiss critical alert -> NWIS_BAD_STATE
  insert into alerts (id, wellbore_id, kind, severity, state, dedup_key, title, message)
  values (v_alert_id, v_wb_a, 'detector', 'critical', 'sent', 'test:dismiss:1', 'Test Critical', 'Message')
  on conflict (id) do update set state = 'sent', severity = 'critical', wellbore_id = v_wb_a;

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000001-0000-0000-0000-000000000002"}'; -- rig

  v_failed := false;
  begin
    perform dismiss_alert(v_alert_id, 'Sensor faulty');
  exception when others then
    if sqlerrm like '%NWIS_BAD_STATE%' then
      v_failed := true;
    end if;
  end;
  if not v_failed then
    raise exception 'Assertion failed: dismissing critical alert should raise NWIS_BAD_STATE';
  end if;

  -- Case B: Dismiss watch alert with reason < 5 chars -> NWIS_BAD_REQUEST
  reset role;
  update alerts set severity = 'watch', state = 'sent' where id = v_alert_id;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000001-0000-0000-0000-000000000002"}'; -- rig

  v_failed := false;
  begin
    perform dismiss_alert(v_alert_id, 'bad');
  exception when others then
    if sqlerrm like '%NWIS_BAD_REQUEST%' then
      v_failed := true;
    end if;
  end;
  if not v_failed then
    raise exception 'Assertion failed: dismiss reason < 5 chars should raise NWIS_BAD_REQUEST';
  end if;

  -- Case C: Rig engineer dismissing watch alert from sent with valid reason -> succeeds
  v_res := dismiss_alert(v_alert_id, 'Pressure transducer baseline calibrated');
  if v_res.state <> 'resolved' or v_res.resolved_how <> 'dismissed' or v_res.outcome <> 'false_alarm' then
    raise exception 'Assertion failed: dismiss_alert should resolve with dismissed and false_alarm';
  end if;
end;
$$;


--------------------------------------------------------------------------------
-- TEST 5: rate_alert
--------------------------------------------------------------------------------
do $$
declare
  v_alert_id uuid := 'c0000001-0000-0000-0000-000000000005';
  v_wb_a uuid := 'b0000002-0000-0000-0000-000000000001';
  v_u_rtoc uuid := 'a0000001-0000-0000-0000-000000000003';
  v_u_office uuid := 'a0000001-0000-0000-0000-000000000004';
  v_res alerts;
  v_failed boolean;
begin
  reset role;
  -- Case A: rate_alert on an unresolved alert -> NWIS_BAD_STATE
  insert into alerts (id, wellbore_id, kind, severity, state, dedup_key, title, message)
  values (v_alert_id, v_wb_a, 'lookahead', 'watch', 'acknowledged', 'test:rate:1', 'Test', 'Msg')
  on conflict (id) do update set state = 'acknowledged', wellbore_id = v_wb_a;

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000001-0000-0000-0000-000000000003"}'; -- rtoc

  v_failed := false;
  begin
    perform rate_alert(v_alert_id, true);
  exception when others then
    if sqlerrm like '%NWIS_BAD_STATE%' then
      v_failed := true;
    end if;
  end;
  if not v_failed then
    raise exception 'Assertion failed: rate_alert on unresolved alert should raise NWIS_BAD_STATE';
  end if;

  -- Case B: rate_alert by unauthorized user (office engineer not resolver) -> NWIS_FORBIDDEN
  reset role;
  update alerts set state = 'resolved', resolved_by = v_u_rtoc where id = v_alert_id;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000001-0000-0000-0000-000000000004"}'; -- office

  v_failed := false;
  begin
    perform rate_alert(v_alert_id, true);
  exception when others then
    if sqlerrm like '%NWIS_FORBIDDEN%' then
      v_failed := true;
    end if;
  end;
  if not v_failed then
    raise exception 'Assertion failed: rate_alert by unauthorized user should raise NWIS_FORBIDDEN';
  end if;

  -- Case C: rate_alert by resolver (RTOC) -> state becomes 'feedback'
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000001-0000-0000-0000-000000000003"}'; -- rtoc
  v_res := rate_alert(v_alert_id, true);
  if v_res.state <> 'feedback' or v_res.useful is not true or v_res.feedback_by <> v_u_rtoc then
    raise exception 'Assertion failed: rate_alert failed to update feedback state';
  end if;
end;
$$;


--------------------------------------------------------------------------------
-- TEST 6: add_shift_note
--------------------------------------------------------------------------------
do $$
declare
  v_wb_a uuid := 'b0000002-0000-0000-0000-000000000001';
  v_wb_b uuid := 'b0000002-0000-0000-0000-000000000002';
  v_note shift_notes;
  v_failed boolean;
begin
  -- Case A: Rig engineer adding note to assigned wellbore -> succeeds
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000001-0000-0000-0000-000000000002"}'; -- rig
  v_note := add_shift_note(v_wb_a, 'Handover completed, drilling 8-1/2 section');
  if v_note.wellbore_id <> v_wb_a or v_note.text <> 'Handover completed, drilling 8-1/2 section' then
    raise exception 'Assertion failed: add_shift_note failed for assigned rig engineer';
  end if;

  -- Case B: Rig engineer adding note to unassigned wellbore -> NWIS_FORBIDDEN
  v_failed := false;
  begin
    perform add_shift_note(v_wb_b, 'Note on unassigned well');
  exception when others then
    if sqlerrm like '%NWIS_FORBIDDEN%' then
      v_failed := true;
    end if;
  end;
  if not v_failed then
    raise exception 'Assertion failed: rig engineer adding note on unassigned well should raise NWIS_FORBIDDEN';
  end if;

  -- Case C: Reviewer adding shift note -> NWIS_FORBIDDEN
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000001-0000-0000-0000-000000000005"}'; -- reviewer
  v_failed := false;
  begin
    perform add_shift_note(v_wb_a, 'Reviewer note');
  exception when others then
    if sqlerrm like '%NWIS_FORBIDDEN%' then
      v_failed := true;
    end if;
  end;
  if not v_failed then
    raise exception 'Assertion failed: reviewer adding note should raise NWIS_FORBIDDEN';
  end if;
end;
$$;


--------------------------------------------------------------------------------
-- TEST 7: review_field (approve, edit, reject, cascade, job done)
--------------------------------------------------------------------------------
do $$
declare
  v_well_id uuid := 'b0000001-0000-0000-0000-000000000001';
  v_wb_a uuid := 'b0000002-0000-0000-0000-000000000001';
  v_doc_id uuid := 'd0000001-0000-0000-0000-000000000001';
  v_job_id uuid := 'd0000002-0000-0000-0000-000000000001';
  v_event_id uuid := 'e0000001-0000-0000-0000-000000000001';
  v_top_id uuid := 'e0000002-0000-0000-0000-000000000001';
  v_field_1 uuid := 'f0000001-0000-0000-0000-000000000001';
  v_field_2 uuid := 'f0000001-0000-0000-0000-000000000002';
  v_field_3 uuid := 'f0000001-0000-0000-0000-000000000003';
  v_res extracted_fields;
  v_ev_status review_status;
  v_ev_desc text;
  v_ev_depth real;
  v_job_st job_status;
  v_top_exists boolean;
  v_failed boolean;
begin
  reset role;
  -- Setup document and job
  insert into documents (id, well_id, wellbore_id, doc_type, title, file_path, sha256)
  values (v_doc_id, v_well_id, v_wb_a, 'ddr', 'Test DDR', 'incoming/test.pdf', 'hash-test-rf-01')
  on conflict (id) do nothing;

  insert into jobs (id, doc_id, status, stage, progress)
  values (v_job_id, v_doc_id, 'needs_review', 'extract', 50)
  on conflict (id) do update set status = 'needs_review', stage = 'extract', progress = 50;

  -- Setup target event row with 2 pending extracted fields
  insert into events (id, wellbore_id, event_type, md_from_m, description, provenance, review_status)
  values (v_event_id, v_wb_a, 'loss_partial', 2390.0, 'Initial description', 'synthetic', 'pending')
  on conflict (id) do update set review_status = 'pending', md_from_m = 2390.0, description = 'Initial description';

  -- Setup target formation_top with 1 pending field
  insert into formations (name, basin, strat_order)
  values ('Tipam', 'Upper Assam', 5)
  on conflict (name) do nothing;

  insert into formation_tops (id, wellbore_id, formation, top_md_m, provenance)
  values (v_top_id, v_wb_a, 'Tipam', 2300.0, 'synthetic')
  on conflict (id) do nothing;

  -- Field 1: approve description on event
  insert into extracted_fields (id, job_id, doc_id, entity, entity_id, field, value, confidence, review_status)
  values (v_field_1, v_job_id, v_doc_id, 'event', v_event_id, 'description', '{"raw":"Mud losses 10 m3/h", "value":"Mud losses 10 m3/h"}', 0.7, 'pending')
  on conflict (id) do update set review_status = 'pending', value = '{"raw":"Mud losses 10 m3/h", "value":"Mud losses 10 m3/h"}';

  -- Field 2: edit md_from_m on event
  insert into extracted_fields (id, job_id, doc_id, entity, entity_id, field, value, confidence, review_status)
  values (v_field_2, v_job_id, v_doc_id, 'event', v_event_id, 'md_from_m', '{"raw":"2395 m", "value":2395.0}', 0.6, 'pending')
  on conflict (id) do update set review_status = 'pending', value = '{"raw":"2395 m", "value":2395.0}';

  -- Field 3: reject field on formation_top
  insert into extracted_fields (id, job_id, doc_id, entity, entity_id, field, value, confidence, review_status)
  values (v_field_3, v_job_id, v_doc_id, 'formation_top', v_top_id, 'top_md_m', '{"value":2300.0}', 0.4, 'pending')
  on conflict (id) do update set review_status = 'pending';

  -- Case A: Rig engineer trying to call review_field -> NWIS_FORBIDDEN
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000001-0000-0000-0000-000000000002"}'; -- rig
  v_failed := false;
  begin
    perform review_field(v_field_1, 'approve');
  exception when others then
    if sqlerrm like '%NWIS_FORBIDDEN%' then
      v_failed := true;
    end if;
  end;
  if not v_failed then
    raise exception 'Assertion failed: rig engineer calling review_field should raise NWIS_FORBIDDEN';
  end if;

  -- Case B: Reviewer approving field 1 -> updates events.description
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000001-0000-0000-0000-000000000005"}'; -- reviewer
  v_res := review_field(v_field_1, 'approve');

  if v_res.review_status <> 'approved' then
    raise exception 'Assertion failed: field 1 review_status should be approved';
  end if;

  select description, review_status into v_ev_desc, v_ev_status from events where id = v_event_id;
  if v_ev_desc <> 'Mud losses 10 m3/h' then
    raise exception 'Assertion failed: events.description was not updated by approve: %', v_ev_desc;
  end if;
  -- Event should still be pending since field 2 is still pending
  if v_ev_status <> 'pending' then
    raise exception 'Assertion failed: event status should still be pending, got %', v_ev_status;
  end if;

  -- Case C: Reviewer editing field 2 with p_value -> updates events.md_from_m and cascades event to 'edited'
  v_res := review_field(v_field_2, 'edit', '{"value": 2405.5}');
  if v_res.review_status <> 'edited' then
    raise exception 'Assertion failed: field 2 review_status should be edited';
  end if;

  select md_from_m, review_status into v_ev_depth, v_ev_status from events where id = v_event_id;
  if v_ev_depth <> 2405.5 then
    raise exception 'Assertion failed: events.md_from_m was not updated to edited value: %', v_ev_depth;
  end if;
  -- Event has no more pending fields and has one edited field -> review_status should be 'edited'
  if v_ev_status <> 'edited' then
    raise exception 'Assertion failed: event review_status should cascade to edited, got %', v_ev_status;
  end if;

  -- Job should still be 'needs_review' because field 3 is pending
  select status into v_job_st from jobs where id = v_job_id;
  if v_job_st <> 'needs_review' then
    raise exception 'Assertion failed: job should still be needs_review, got %', v_job_st;
  end if;

  -- Case D: Reviewer rejecting field 3 on formation_top -> deletes target row if all fields rejected
  -- and flips job to 'done', stage='done', progress=100
  v_res := review_field(v_field_3, 'reject');
  if v_res.review_status <> 'rejected' then
    raise exception 'Assertion failed: field 3 review_status should be rejected';
  end if;

  select exists(select 1 from formation_tops where id = v_top_id) into v_top_exists;
  if v_top_exists then
    raise exception 'Assertion failed: formation_tops row should be deleted when all fields are rejected';
  end if;

  -- Verify job transitioned to done (last pending field reviewed)
  select status into v_job_st from jobs where id = v_job_id;
  if v_job_st <> 'done' then
    raise exception 'Assertion failed: job status should transition to done, got %', v_job_st;
  end if;
end;
$$;


--------------------------------------------------------------------------------
-- TEST 8: audit_log check
--------------------------------------------------------------------------------
do $$
declare
  v_actions text[];
  v_expected text[] := array['alert.view', 'alert.ack', 'alert.resolve', 'alert.dismiss', 'alert.rate', 'note.add', 'field.approve', 'field.edit', 'field.reject'];
  v_act text;
begin
  select array_agg(distinct action) into v_actions from audit_log;
  foreach v_act in array v_expected loop
    if not (v_act = any(v_actions)) then
      raise exception 'Assertion failed: audit_log is missing action % (found: %)', v_act, v_actions;
    end if;
  end loop;
end;
$$;

rollback;
