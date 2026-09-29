-- db/supabase/migrations/0008_alert_rpcs.sql
-- Alert lifecycle RPCs for eRTMAC-NWIS (SIH26121)
-- Contract §7, §11, §12

-- 1. mark_alert_viewed(p_alert uuid)
create or replace function public.mark_alert_viewed(p_alert uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role user_role;
  v_assigned_wb uuid[];
  v_alert alerts%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'NWIS_FORBIDDEN: authentication required';
  end if;

  select role, assigned_wellbore_ids into v_user_role, v_assigned_wb
  from profiles where id = v_user_id;
  if v_user_role is null then
    raise exception using errcode = 'P0001', message = 'NWIS_FORBIDDEN: user profile not found';
  end if;

  select * into v_alert from alerts where id = p_alert for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'NWIS_NOT_FOUND: alert not found';
  end if;

  -- Rig engineer can only view alerts for assigned wellbores
  if v_user_role = 'rig_engineer' and not (v_alert.wellbore_id = any(v_assigned_wb)) then
    raise exception using errcode = 'P0001', message = 'NWIS_FORBIDDEN: rig engineer not assigned to wellbore';
  end if;

  -- Record view in alert_views
  insert into alert_views (alert_id, user_id, viewed_at)
  values (p_alert, v_user_id, now())
  on conflict (alert_id, user_id) do nothing;

  -- If state = 'sent' → 'viewed'
  if v_alert.state = 'sent' then
    update alerts set state = 'viewed' where id = p_alert;
  end if;

  -- Audit log entry
  insert into audit_log (user_id, action, entity, entity_id, details)
  values (v_user_id, 'alert.view', 'alert', p_alert, jsonb_build_object('state', v_alert.state));
end;
$$;

grant execute on function public.mark_alert_viewed(uuid) to authenticated, service_role;


-- 2. ack_alert(p_alert uuid, p_note text default null)
create or replace function public.ack_alert(p_alert uuid, p_note text default null)
returns alerts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role user_role;
  v_assigned_wb uuid[];
  v_alert alerts%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'NWIS_FORBIDDEN: authentication required';
  end if;

  select role, assigned_wellbore_ids into v_user_role, v_assigned_wb
  from profiles where id = v_user_id;
  if v_user_role is null then
    raise exception using errcode = 'P0001', message = 'NWIS_FORBIDDEN: user profile not found';
  end if;

  select * into v_alert from alerts where id = p_alert for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'NWIS_NOT_FOUND: alert not found';
  end if;

  -- Who: rig_engineer assigned to the wellbore; rtoc_engineer; admin
  if v_user_role = 'rig_engineer' then
    if not (v_alert.wellbore_id = any(v_assigned_wb)) then
      raise exception using errcode = 'P0001', message = 'NWIS_FORBIDDEN: rig engineer not assigned to wellbore';
    end if;
  elsif v_user_role not in ('rtoc_engineer', 'admin') then
    raise exception using errcode = 'P0001', message = 'NWIS_FORBIDDEN: role ' || v_user_role || ' cannot acknowledge alerts';
  end if;

  -- Allowed from state: sent, viewed, escalated
  if v_alert.state not in ('sent', 'viewed', 'escalated') then
    raise exception using errcode = 'P0001', message = 'NWIS_BAD_STATE: alert in state ' || v_alert.state || ' cannot be acknowledged';
  end if;

  update alerts
  set state = 'acknowledged',
      acknowledged_by = v_user_id,
      acknowledged_at = now(),
      action_note = coalesce(p_note, action_note)
  where id = p_alert
  returning * into v_alert;

  insert into audit_log (user_id, action, entity, entity_id, details)
  values (v_user_id, 'alert.ack', 'alert', p_alert, jsonb_build_object('note', p_note));

  return v_alert;
end;
$$;

grant execute on function public.ack_alert(uuid, text) to authenticated, service_role;


-- 3. resolve_alert(p_alert uuid, p_outcome alert_outcome, p_note text default null)
create or replace function public.resolve_alert(
  p_alert uuid,
  p_outcome alert_outcome,
  p_note text default null
)
returns alerts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role user_role;
  v_assigned_wb uuid[];
  v_alert alerts%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'NWIS_FORBIDDEN: authentication required';
  end if;

  select role, assigned_wellbore_ids into v_user_role, v_assigned_wb
  from profiles where id = v_user_id;
  if v_user_role is null then
    raise exception using errcode = 'P0001', message = 'NWIS_FORBIDDEN: user profile not found';
  end if;

  select * into v_alert from alerts where id = p_alert for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'NWIS_NOT_FOUND: alert not found';
  end if;

  -- Who: rtoc_engineer, admin: any severity; rig_engineer (assigned): info, watch
  if v_user_role = 'rig_engineer' then
    if not (v_alert.wellbore_id = any(v_assigned_wb)) then
      raise exception using errcode = 'P0001', message = 'NWIS_FORBIDDEN: rig engineer not assigned to wellbore';
    end if;
    if v_alert.severity in ('warning', 'critical') then
      raise exception using errcode = 'P0001', message = 'NWIS_FORBIDDEN: rig engineer cannot resolve warning or critical alerts';
    end if;
  elsif v_user_role not in ('rtoc_engineer', 'admin') then
    raise exception using errcode = 'P0001', message = 'NWIS_FORBIDDEN: role ' || v_user_role || ' cannot resolve alerts';
  end if;

  -- Allowed from state:
  -- warning/critical: acknowledged
  -- info/watch: sent, viewed, acknowledged
  if v_alert.severity in ('warning', 'critical') then
    if v_alert.state <> 'acknowledged' then
      raise exception using errcode = 'P0001', message = 'NWIS_BAD_STATE: ' || v_alert.severity || ' alerts must be acknowledged before resolving';
    end if;
  else
    if v_alert.state not in ('sent', 'viewed', 'acknowledged') then
      raise exception using errcode = 'P0001', message = 'NWIS_BAD_STATE: alert in state ' || v_alert.state || ' cannot be resolved';
    end if;
  end if;

  update alerts
  set state = 'resolved',
      resolved_by = v_user_id,
      resolved_at = now(),
      resolved_how = 'manual',
      outcome = p_outcome,
      action_note = coalesce(p_note, action_note)
  where id = p_alert
  returning * into v_alert;

  insert into audit_log (user_id, action, entity, entity_id, details)
  values (v_user_id, 'alert.resolve', 'alert', p_alert, jsonb_build_object('outcome', p_outcome, 'note', p_note));

  return v_alert;
end;
$$;

grant execute on function public.resolve_alert(uuid, alert_outcome, text) to authenticated, service_role;


-- 4. dismiss_alert(p_alert uuid, p_reason text)
create or replace function public.dismiss_alert(p_alert uuid, p_reason text)
returns alerts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role user_role;
  v_assigned_wb uuid[];
  v_alert alerts%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'NWIS_FORBIDDEN: authentication required';
  end if;

  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception using errcode = 'P0001', message = 'NWIS_BAD_REQUEST: dismiss reason must be at least 5 characters';
  end if;

  select role, assigned_wellbore_ids into v_user_role, v_assigned_wb
  from profiles where id = v_user_id;
  if v_user_role is null then
    raise exception using errcode = 'P0001', message = 'NWIS_FORBIDDEN: user profile not found';
  end if;

  select * into v_alert from alerts where id = p_alert for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'NWIS_NOT_FOUND: alert not found';
  end if;

  -- Who: rig_engineer (assigned), rtoc_engineer, admin
  if v_user_role = 'rig_engineer' then
    if not (v_alert.wellbore_id = any(v_assigned_wb)) then
      raise exception using errcode = 'P0001', message = 'NWIS_FORBIDDEN: rig engineer not assigned to wellbore';
    end if;
  elsif v_user_role not in ('rtoc_engineer', 'admin') then
    raise exception using errcode = 'P0001', message = 'NWIS_FORBIDDEN: role ' || v_user_role || ' cannot dismiss alerts';
  end if;

  -- Severity limit: info, watch only
  if v_alert.severity not in ('info', 'watch') then
    raise exception using errcode = 'P0001', message = 'NWIS_BAD_STATE: only info and watch alerts can be dismissed';
  end if;

  -- Allowed from state: sent, viewed
  if v_alert.state not in ('sent', 'viewed') then
    raise exception using errcode = 'P0001', message = 'NWIS_BAD_STATE: alert in state ' || v_alert.state || ' cannot be dismissed';
  end if;

  update alerts
  set state = 'resolved',
      resolved_by = v_user_id,
      resolved_at = now(),
      resolved_how = 'dismissed',
      outcome = 'false_alarm',
      dismiss_reason = trim(p_reason)
  where id = p_alert
  returning * into v_alert;

  insert into audit_log (user_id, action, entity, entity_id, details)
  values (v_user_id, 'alert.dismiss', 'alert', p_alert, jsonb_build_object('reason', trim(p_reason)));

  return v_alert;
end;
$$;

grant execute on function public.dismiss_alert(uuid, text) to authenticated, service_role;


-- 5. rate_alert(p_alert uuid, p_useful boolean)
create or replace function public.rate_alert(p_alert uuid, p_useful boolean)
returns alerts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role user_role;
  v_assigned_wb uuid[];
  v_alert alerts%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'NWIS_FORBIDDEN: authentication required';
  end if;

  select role, assigned_wellbore_ids into v_user_role, v_assigned_wb
  from profiles where id = v_user_id;
  if v_user_role is null then
    raise exception using errcode = 'P0001', message = 'NWIS_FORBIDDEN: user profile not found';
  end if;

  select * into v_alert from alerts where id = p_alert for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'NWIS_NOT_FOUND: alert not found';
  end if;

  -- Allowed from state: resolved
  if v_alert.state <> 'resolved' then
    raise exception using errcode = 'P0001', message = 'NWIS_BAD_STATE: only resolved alerts can be rated';
  end if;

  -- Who: the resolver, or any rig/rtoc engineer on that well, or admin
  if v_alert.resolved_by = v_user_id then
    null;
  elsif v_user_role = 'admin' then
    null;
  elsif v_user_role = 'rtoc_engineer' then
    null;
  elsif v_user_role = 'rig_engineer' and (v_alert.wellbore_id = any(v_assigned_wb)) then
    null;
  else
    raise exception using errcode = 'P0001', message = 'NWIS_FORBIDDEN: user not permitted to rate this alert';
  end if;

  update alerts
  set state = 'feedback',
      useful = p_useful,
      feedback_by = v_user_id,
      feedback_at = now()
  where id = p_alert
  returning * into v_alert;

  insert into audit_log (user_id, action, entity, entity_id, details)
  values (v_user_id, 'alert.rate', 'alert', p_alert, jsonb_build_object('useful', p_useful));

  return v_alert;
end;
$$;

grant execute on function public.rate_alert(uuid, boolean) to authenticated, service_role;
