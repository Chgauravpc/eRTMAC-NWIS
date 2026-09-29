-- db/supabase/migrations/0009_review_rpcs.sql
-- Review and shift note RPCs for eRTMAC-NWIS (SIH26121)
-- Contract §7, §12

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


-- 2. add_shift_note(p_wellbore uuid, p_text text)
create or replace function public.add_shift_note(
  p_wellbore uuid,
  p_text text
)
returns shift_notes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role user_role;
  v_assigned_wb uuid[];
  v_note shift_notes%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'NWIS_FORBIDDEN: authentication required';
  end if;

  if p_text is null or length(trim(p_text)) = 0 then
    raise exception using errcode = 'P0001', message = 'NWIS_BAD_REQUEST: shift note text cannot be empty';
  end if;

  select role, assigned_wellbore_ids into v_user_role, v_assigned_wb
  from profiles where id = v_user_id;
  if v_user_role is null then
    raise exception using errcode = 'P0001', message = 'NWIS_FORBIDDEN: user profile not found';
  end if;

  -- Allowed roles: rig_engineer (assigned), rtoc_engineer, office_engineer, admin
  if v_user_role = 'rig_engineer' then
    if not (p_wellbore = any(v_assigned_wb)) then
      raise exception using errcode = 'P0001', message = 'NWIS_FORBIDDEN: rig engineer not assigned to wellbore';
    end if;
  elsif v_user_role not in ('rtoc_engineer', 'office_engineer', 'admin') then
    raise exception using errcode = 'P0001', message = 'NWIS_FORBIDDEN: role ' || v_user_role || ' cannot add shift notes';
  end if;

  insert into shift_notes (wellbore_id, user_id, text)
  values (p_wellbore, v_user_id, trim(p_text))
  returning * into v_note;

  insert into audit_log (user_id, action, entity, entity_id, details)
  values (
    v_user_id,
    'note.add',
    'shift_note',
    v_note.id,
    jsonb_build_object('wellbore_id', p_wellbore)
  );

  return v_note;
end;
$$;

grant execute on function public.add_shift_note(uuid, text) to authenticated, service_role;
