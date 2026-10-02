-- db/supabase/migrations/0013_review_well_assignment.sql
-- review_field: assign a well to a document (contract §7, amendments of PR #10 and #11).
--
-- Replaces review_field (create or replace) with the version of 0009 plus the well_id branch:
--   * approve / edit of the well_header / well_id field sets documents.well_id from the value
--     (a wells.id that must exist, else NWIS_BAD_REQUEST) and documents.wellbore_id to that well's
--     primary wellbore (null if none). An approve with an empty value is NWIS_BAD_REQUEST.
--   * the document's records (events, formation_tops, hole_sections, cement_jobs, mud_records,
--     time_log) move to that wellbore; a formation top that would duplicate
--     (wellbore_id, formation, source) is deleted instead.
--   * reject leaves documents.well_id as it is.
-- Everything else behaves as in 0009 (this file also carries its protected-column, missing-target and
-- bad-value checks, so a database that has an older 0009 is brought up to date).
-- After this the caller asks the backend to read the document again: POST /api/documents/{id}/reprocess.

-- 1. review_field(p_field uuid, p_action text, p_value jsonb default null)
create or replace function public.review_field(
  p_field uuid,
  p_action text,
  p_value jsonb default null
)
returns extracted_fields
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role user_role;
  v_rec extracted_fields%rowtype;
  v_table text;
  v_data_type text;
  v_udt_name text;
  v_target_id uuid;
  v_wb_id uuid;
  v_md_m real;
  v_new_json jsonb;
  v_val_json jsonb;
  v_text_val text;
  v_well_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'NWIS_FORBIDDEN: authentication required';
  end if;

  select role into v_user_role from profiles where id = v_user_id;
  if v_user_role is null or v_user_role not in ('reviewer', 'admin') then
    raise exception using errcode = 'P0001', message = 'NWIS_FORBIDDEN: only reviewer or admin can review fields';
  end if;

  if p_action not in ('approve', 'edit', 'reject') then
    raise exception using errcode = 'P0001', message = 'NWIS_BAD_REQUEST: invalid review action ' || coalesce(p_action, 'null');
  end if;

  select * into v_rec from extracted_fields where id = p_field for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'NWIS_NOT_FOUND: extracted field not found';
  end if;

  -- Special case (contract §7): assign the document's well. The backend raises this field
  -- (entity 'well_header', field 'well_id', reason 'unmatched_well') when no well matched the report.
  -- The value is {"raw": "<name as read>", "value": null or "<wells.id>", "unit": null}.
  if v_rec.entity = 'well_header' and v_rec.field = 'well_id' then
    if p_action = 'edit' and p_value is null then
      raise exception using errcode = 'P0001', message = 'NWIS_BAD_REQUEST: value is required for edit action';
    end if;

    if p_action in ('approve', 'edit') then
      v_new_json := case when p_action = 'edit' then p_value else v_rec.value end;
      if jsonb_typeof(v_new_json) = 'object' then
        v_val_json := v_new_json -> 'value';
      else
        v_val_json := v_new_json;
      end if;
      v_text_val := case when v_val_json is null or jsonb_typeof(v_val_json) = 'null' then null else v_val_json #>> '{}' end;
      if v_text_val is null or v_text_val = '' then
        raise exception using errcode = 'P0001', message = 'NWIS_BAD_REQUEST: choose the well for this document (the value is empty)';
      end if;
      begin
        v_well_id := v_text_val::uuid;
      exception when invalid_text_representation then
        raise exception using errcode = 'P0001', message = 'NWIS_BAD_REQUEST: well_id must be the id (uuid) of a well';
      end;
      if not exists (select 1 from wells where id = v_well_id) then
        raise exception using errcode = 'P0001', message = 'NWIS_BAD_REQUEST: well ' || v_text_val || ' does not exist';
      end if;

      -- the well's primary wellbore (null when the well has none yet)
      select id into v_wb_id from wellbores where well_id = v_well_id and is_primary order by name limit 1;
      update documents set well_id = v_well_id, wellbore_id = v_wb_id where id = v_rec.doc_id;

      -- the document's records move with it
      if v_wb_id is not null then
        update events set wellbore_id = v_wb_id where doc_id = v_rec.doc_id;
        -- a top that would duplicate (wellbore_id, formation, source) is dropped instead of moved
        delete from formation_tops t
        where t.doc_id = v_rec.doc_id
          and exists (
            select 1 from formation_tops o
            where o.wellbore_id = v_wb_id and o.formation = t.formation and o.source = t.source and o.id <> t.id
          );
        update formation_tops set wellbore_id = v_wb_id where doc_id = v_rec.doc_id;
        update hole_sections set wellbore_id = v_wb_id where doc_id = v_rec.doc_id;
        update cement_jobs set wellbore_id = v_wb_id where doc_id = v_rec.doc_id;
        update mud_records set wellbore_id = v_wb_id where doc_id = v_rec.doc_id;
        update time_log set wellbore_id = v_wb_id where doc_id = v_rec.doc_id;
      end if;

      update extracted_fields
      set review_status = case when p_action = 'edit' then 'edited'::review_status else 'approved'::review_status end,
          value = case when p_action = 'edit' then p_value else value end,
          reviewed_by = v_user_id,
          reviewed_at = now()
      where id = p_field
      returning * into v_rec;
    else
      -- reject: documents.well_id stays as it is (null for an unmatched document)
      update extracted_fields
      set review_status = 'rejected', reviewed_by = v_user_id, reviewed_at = now()
      where id = p_field
      returning * into v_rec;
    end if;

    if v_rec.job_id is not null
       and not exists (select 1 from extracted_fields where job_id = v_rec.job_id and review_status = 'pending') then
      update jobs set status = 'done', stage = 'done', progress = 100, updated_at = now() where id = v_rec.job_id;
    end if;

    insert into audit_log (user_id, action, entity, entity_id, details)
    values (
      v_user_id,
      'field.' || p_action,
      'extracted_field',
      p_field,
      jsonb_build_object('entity', 'well_header', 'field', 'well_id', 'action', p_action, 'well_id', v_well_id)
    );

    return v_rec;
  end if;

  -- Whitelist mapping entity -> table
  case v_rec.entity
    when 'event' then v_table := 'events';
    when 'formation_top' then v_table := 'formation_tops';
    when 'hole_section' then v_table := 'hole_sections';
    when 'cement_job' then v_table := 'cement_jobs';
    when 'mud_record' then v_table := 'mud_records';
    when 'survey_station' then v_table := 'survey_stations';
    when 'time_log' then v_table := 'time_log';
    when 'well_header' then
      v_table := 'wells';
      if v_rec.field not in ('field', 'kb_elev_m', 'spud_date', 'td_md_m', 'td_tvd_m') then
        raise exception using errcode = 'P0001', message = 'NWIS_BAD_REQUEST: field ' || v_rec.field || ' not allowed for well_header';
      end if;
    else
      raise exception using errcode = 'P0001', message = 'NWIS_BAD_REQUEST: unsupported entity ' || v_rec.entity;
  end case;

  -- Structural / identity columns can never be changed through review
  if v_rec.field in ('id', 'wellbore_id', 'well_id', 'doc_id', 'job_id', 'provenance', 'review_status', 'created_at', 'updated_at') then
    raise exception using errcode = 'P0001', message = 'NWIS_BAD_REQUEST: column ' || v_rec.field || ' is protected and cannot be reviewed';
  end if;

  -- Verify column exists in information_schema.columns
  select data_type, udt_name into v_data_type, v_udt_name
  from information_schema.columns
  where table_schema = 'public'
    and table_name = v_table
    and column_name = v_rec.field;

  if not found then
    raise exception using errcode = 'P0001', message = 'NWIS_BAD_REQUEST: column ' || v_rec.field || ' does not exist on table ' || v_table;
  end if;

  -- Determine target ID
  if v_rec.entity = 'well_header' then
    select well_id into v_target_id from documents where id = v_rec.doc_id;
    if v_target_id is null and v_rec.entity_id is not null then
      v_target_id := v_rec.entity_id;
    end if;
  else
    v_target_id := v_rec.entity_id;
  end if;

  -- Perform action
  if p_action in ('approve', 'edit') then
    if p_action = 'edit' then
      if p_value is null then
        raise exception using errcode = 'P0001', message = 'NWIS_BAD_REQUEST: value is required for edit action';
      end if;
      v_new_json := p_value;
    else
      v_new_json := v_rec.value;
    end if;

    -- Extract value if object has 'value' key (e.g. {"raw":"...", "value":...})
    if jsonb_typeof(v_new_json) = 'object' and v_new_json ? 'value' then
      v_val_json := v_new_json->'value';
    else
      v_val_json := v_new_json;
    end if;

    if v_val_json is null or jsonb_typeof(v_val_json) = 'null' then
      v_text_val := null;
    elsif jsonb_typeof(v_val_json) = 'string' then
      v_text_val := v_val_json #>> '{}';
    else
      v_text_val := v_val_json::text;
    end if;

    -- Dynamic update using format() and %I with type-safe casting
    if v_rec.entity <> 'survey_station' and v_target_id is null then
      raise exception using errcode = 'P0001', message = 'NWIS_BAD_REQUEST: extracted field has no target row to update';
    end if;

    begin
    if v_rec.entity = 'survey_station' then
      v_wb_id := coalesce((v_new_json->>'wellbore_id')::uuid, (select wellbore_id from documents where id = v_rec.doc_id));
      v_md_m := coalesce((v_new_json->>'md_m')::real, (v_rec.value->>'md_m')::real);
      if v_wb_id is not null and v_md_m is not null then
        if v_text_val is null then
          execute format('update %I set %I = null where wellbore_id = $1 and md_m = $2', v_table, v_rec.field)
          using v_wb_id, v_md_m;
        else
          execute format('update %I set %I = ($1)::real where wellbore_id = $2 and md_m = $3', v_table, v_rec.field)
          using v_text_val, v_wb_id, v_md_m;
        end if;
      end if;
    elsif v_target_id is not null then
      if v_text_val is null then
        execute format('update %I set %I = null where id = $1', v_table, v_rec.field) using v_target_id;
      else
        if v_data_type = 'USER-DEFINED' then
          execute format('update %I set %I = ($1)::%I where id = $2', v_table, v_rec.field, v_udt_name)
          using v_text_val, v_target_id;
        elsif v_data_type in ('real', 'float4') then
          execute format('update %I set %I = ($1)::real where id = $2', v_table, v_rec.field)
          using v_text_val, v_target_id;
        elsif v_data_type in ('double precision', 'float8') then
          execute format('update %I set %I = ($1)::float8 where id = $2', v_table, v_rec.field)
          using v_text_val, v_target_id;
        elsif v_data_type in ('integer', 'int4') then
          execute format('update %I set %I = ($1)::integer where id = $2', v_table, v_rec.field)
          using v_text_val, v_target_id;
        elsif v_data_type in ('smallint', 'int2') then
          execute format('update %I set %I = ($1)::smallint where id = $2', v_table, v_rec.field)
          using v_text_val, v_target_id;
        elsif v_data_type in ('bigint', 'int8') then
          execute format('update %I set %I = ($1)::bigint where id = $2', v_table, v_rec.field)
          using v_text_val, v_target_id;
        elsif v_data_type = 'boolean' then
          execute format('update %I set %I = ($1)::boolean where id = $2', v_table, v_rec.field)
          using v_text_val, v_target_id;
        elsif v_data_type = 'date' then
          execute format('update %I set %I = ($1)::date where id = $2', v_table, v_rec.field)
          using v_text_val, v_target_id;
        elsif v_data_type like 'timestamp%' then
          execute format('update %I set %I = ($1)::timestamptz where id = $2', v_table, v_rec.field)
          using v_text_val, v_target_id;
        elsif v_data_type = 'jsonb' then
          execute format('update %I set %I = ($1)::jsonb where id = $2', v_table, v_rec.field)
          using v_text_val, v_target_id;
        else
          execute format('update %I set %I = ($1)::text where id = $2', v_table, v_rec.field)
          using v_text_val, v_target_id;
        end if;
      end if;
    end if;
    exception
      when data_exception or integrity_constraint_violation then
        raise exception using errcode = 'P0001', message = 'NWIS_BAD_REQUEST: value cannot be stored in ' || v_table || '.' || v_rec.field;
    end;

    -- Update extracted_fields
    if p_action = 'edit' then
      update extracted_fields
      set review_status = 'edited',
          value = p_value,
          reviewed_by = v_user_id,
          reviewed_at = now()
      where id = p_field
      returning * into v_rec;
    else
      update extracted_fields
      set review_status = 'approved',
          reviewed_by = v_user_id,
          reviewed_at = now()
      where id = p_field
      returning * into v_rec;
    end if;

  elsif p_action = 'reject' then
    update extracted_fields
    set review_status = 'rejected',
        reviewed_by = v_user_id,
        reviewed_at = now()
    where id = p_field
    returning * into v_rec;

    if v_rec.entity = 'event' and v_target_id is not null then
      update events set review_status = 'rejected' where id = v_target_id;
    elsif v_rec.entity not in ('event', 'well_header') and v_target_id is not null then
      -- Delete target row if every field of that entity_id is rejected
      if not exists (
        select 1 from extracted_fields
        where entity = v_rec.entity
          and entity_id = v_target_id
          and review_status <> 'rejected'
      ) then
        execute format('delete from %I where id = $1', v_table) using v_target_id;
      end if;
    end if;
  end if;

  -- Cascade for event review_status when all fields of the event are reviewed
  if v_rec.entity = 'event' and v_target_id is not null then
    if not exists (
      select 1 from extracted_fields
      where entity = 'event'
        and entity_id = v_target_id
        and review_status = 'pending'
    ) then
      if (select review_status from events where id = v_target_id) <> 'rejected' then
        if exists (
          select 1 from extracted_fields
          where entity = 'event'
            and entity_id = v_target_id
            and review_status = 'edited'
        ) then
          update events set review_status = 'edited' where id = v_target_id;
        else
          update events set review_status = 'approved' where id = v_target_id;
        end if;
      end if;
    end if;
  end if;

  -- Cascade for job status when all fields of the job are reviewed
  if v_rec.job_id is not null then
    if not exists (
      select 1 from extracted_fields
      where job_id = v_rec.job_id
        and review_status = 'pending'
    ) then
      update jobs
      set status = 'done',
          stage = 'done',
          progress = 100,
          updated_at = now()
      where id = v_rec.job_id;
    end if;
  end if;

  -- Audit log: field.approve, field.edit, field.reject
  insert into audit_log (user_id, action, entity, entity_id, details)
  values (
    v_user_id,
    'field.' || p_action,
    'extracted_field',
    p_field,
    jsonb_build_object('entity', v_rec.entity, 'field', v_rec.field, 'action', p_action)
  );

  return v_rec;
end;
$$;

grant execute on function public.review_field(uuid, text, jsonb) to authenticated, service_role;
