-- db/supabase/migrations/0006_geo_functions.sql
-- Spatial and interpolation functions for eRTMAC-NWIS (SIH26121)

-- 1. well_position_at_md
create or replace function well_position_at_md(
  p_wellbore uuid,
  p_md real
)
returns table (
  lon float8,
  lat float8,
  tvd_m real
)
language plpgsql
stable
security invoker
as $$
declare
  v_surface geography(Point, 4326);
  v_s1_md real;
  v_s1_tvd real;
  v_s1_north real;
  v_s1_east real;
  v_s2_md real;
  v_s2_tvd real;
  v_s2_north real;
  v_s2_east real;
  v_f real := 0.0;
  v_north real;
  v_east real;
  v_tvd real;
  v_pt geography;
  v_azi_north float8;
  v_azi_east float8;
begin
  -- Get surface coordinate of the well
  select w.surface into v_surface
  from wellbores wb
  join wells w on w.id = wb.well_id
  where wb.id = p_wellbore;

  if v_surface is null then
    return;
  end if;

  -- Find station with largest md <= p_md
  select ss.md_m, ss.tvd_m, ss.north_m, ss.east_m
  into v_s1_md, v_s1_tvd, v_s1_north, v_s1_east
  from survey_stations ss
  where ss.wellbore_id = p_wellbore and ss.md_m <= p_md
  order by ss.md_m desc
  limit 1;

  -- Find station with smallest md >= p_md
  select ss.md_m, ss.tvd_m, ss.north_m, ss.east_m
  into v_s2_md, v_s2_tvd, v_s2_north, v_s2_east
  from survey_stations ss
  where ss.wellbore_id = p_wellbore and ss.md_m >= p_md
  order by ss.md_m asc
  limit 1;

  -- If no stations exist, assume vertical well at surface
  if v_s1_md is null and v_s2_md is null then
    return query select ST_X(v_surface::geometry), ST_Y(v_surface::geometry), p_md;
    return;
  end if;

  -- If p_md is before first station, use first station
  if v_s1_md is null then
    v_s1_md := v_s2_md;
    v_s1_tvd := v_s2_tvd;
    v_s1_north := v_s2_north;
    v_s1_east := v_s2_east;
  end if;

  -- If p_md is beyond last station, clamp to last station
  if v_s2_md is null then
    v_s2_md := v_s1_md;
    v_s2_tvd := v_s1_tvd;
    v_s2_north := v_s1_north;
    v_s2_east := v_s1_east;
  end if;

  -- Linear interpolation factor
  if v_s2_md > v_s1_md then
    v_f := (p_md - v_s1_md) / (v_s2_md - v_s1_md);
  else
    v_f := 0.0;
  end if;

  v_north := v_s1_north + v_f * (v_s2_north - v_s1_north);
  v_east  := v_s1_east  + v_f * (v_s2_east  - v_s1_east);
  v_tvd   := v_s1_tvd   + v_f * (v_s2_tvd   - v_s1_tvd);

  -- Project north then east on WGS84 spheroid (azimuth in radians, distance in metres)
  v_azi_north := case when v_north >= 0 then 0.0 else pi() end;
  v_pt := ST_Project(v_surface, abs(v_north)::float8, v_azi_north);

  v_azi_east := case when v_east >= 0 then pi() / 2.0 else 3.0 * pi() / 2.0 end;
  v_pt := ST_Project(v_pt, abs(v_east)::float8, v_azi_east);

  return query select ST_X(v_pt::geometry), ST_Y(v_pt::geometry), v_tvd;
end;
$$;

grant execute on function well_position_at_md(uuid, real) to authenticated, service_role;


-- 2. formation_at_md
create or replace function formation_at_md(
  p_wellbore uuid,
  p_md real
)
returns table (
  formation text,
  top_md_m real,
  next_formation text,
  next_top_md_m real,
  relative_depth real,
  source top_source
)
language plpgsql
stable
security invoker
as $$
declare
  v_curr_formation text;
  v_curr_top_md real;
  v_curr_source top_source;
  v_next_formation text;
  v_next_top_md real;
  v_rel real := null;
begin
  -- Best formation top at or above p_md
  with ranked_tops as (
    select distinct on (ft.formation)
      ft.formation,
      ft.top_md_m,
      ft.source
    from formation_tops ft
    where ft.wellbore_id = p_wellbore
    order by ft.formation,
      case ft.source
        when 'actual' then 1
        when 'predicted' then 2
        when 'prognosis' then 3
        else 4
      end asc
  )
  select rt.formation, rt.top_md_m, rt.source
  into v_curr_formation, v_curr_top_md, v_curr_source
  from ranked_tops rt
  where rt.top_md_m <= p_md
  order by rt.top_md_m desc
  limit 1;

  if v_curr_formation is null then
    return;
  end if;

  -- Next formation top below p_md
  with ranked_tops as (
    select distinct on (ft.formation)
      ft.formation,
      ft.top_md_m
    from formation_tops ft
    where ft.wellbore_id = p_wellbore
    order by ft.formation,
      case ft.source
        when 'actual' then 1
        when 'predicted' then 2
        when 'prognosis' then 3
        else 4
      end asc
  )
  select rt.formation, rt.top_md_m
  into v_next_formation, v_next_top_md
  from ranked_tops rt
  where rt.top_md_m > p_md
  order by rt.top_md_m asc
  limit 1;

  if v_next_formation is not null and v_next_top_md > v_curr_top_md then
    v_rel := (p_md - v_curr_top_md) / (v_next_top_md - v_curr_top_md);
    if v_rel < 0.0 then v_rel := 0.0; end if;
    if v_rel > 1.0 then v_rel := 1.0; end if;
  else
    v_rel := null;
  end if;

  return query select
    v_curr_formation,
    v_curr_top_md,
    v_next_formation,
    v_next_top_md,
    v_rel,
    v_curr_source;
end;
$$;

grant execute on function formation_at_md(uuid, real) to authenticated, service_role;


-- 3. offsets_within
create or replace function offsets_within(
  p_wellbore uuid,
  p_radius_m real,
  p_md real default null,
  p_mode text default 'surface'
)
returns table (
  wellbore_id uuid,
  well_id uuid,
  well_name text,
  field text,
  provenance provenance,
  lon float8,
  lat float8,
  surface_distance_m real,
  depth_distance_m real,
  event_count int
)
language plpgsql
stable
security invoker
as $$
declare
  v_active_surface geography(Point, 4326);
  v_active_lon float8;
  v_active_lat float8;
  v_active_tvd real;
begin
  -- Get active surface
  select w.surface into v_active_surface
  from wellbores wb
  join wells w on w.id = wb.well_id
  where wb.id = p_wellbore;

  if v_active_surface is null then
    return;
  end if;

  -- If p_md is supplied, get active 3D position
  if p_md is not null then
    select p.lon, p.lat, p.tvd_m
    into v_active_lon, v_active_lat, v_active_tvd
    from well_position_at_md(p_wellbore, p_md) p;
  end if;

  return query
  with candidates as (
    select
      wb.id as wb_id,
      w.id as w_id,
      w.name as w_name,
      w.field as w_field,
      w.provenance as w_provenance,
      ST_X(w.surface::geometry) as s_lon,
      ST_Y(w.surface::geometry) as s_lat,
      ST_Distance(w.surface, v_active_surface)::real as s_dist,
      w.surface as w_surface
    from wellbores wb
    join wells w on w.id = wb.well_id
    where wb.id <> p_wellbore
      and ST_DWithin(w.surface, v_active_surface, (p_radius_m + 5000.0)::float8)
  ),
  with_depth as (
    select
      c.*,
      case
        when p_md is not null and v_active_lon is not null then
          (
            select
              sqrt(
                power(ST_Distance(ST_SetSRID(ST_MakePoint(v_active_lon, v_active_lat), 4326)::geography, ST_SetSRID(ST_MakePoint(q.lon, q.lat), 4326)::geography), 2) +
                power((v_active_tvd - q.tvd_m)::float8, 2)
              )::real
            from (
              select coalesce(
                (select ss.md_m from survey_stations ss where ss.wellbore_id = c.wb_id order by abs(ss.tvd_m - v_active_tvd) limit 1),
                v_active_tvd
              ) as target_md
            ) t
            cross join lateral well_position_at_md(c.wb_id, t.target_md) q
          )
        else
          null::real
      end as d_dist
    from candidates c
  ),
  with_events as (
    select
      wd.*,
      coalesce((
        select count(*)::int
        from events e
        where e.wellbore_id = wd.wb_id
          and e.review_status <> 'rejected'
      ), 0) as ev_count
    from with_depth wd
  )
  select
    we.wb_id,
    we.w_id,
    we.w_name,
    we.w_field,
    we.w_provenance,
    we.s_lon,
    we.s_lat,
    we.s_dist,
    we.d_dist,
    we.ev_count
  from with_events we
  where (
    case
      when p_mode = 'depth' and we.d_dist is not null then we.d_dist <= p_radius_m
      else we.s_dist <= p_radius_m
    end
  )
  order by
    case
      when p_mode = 'depth' and we.d_dist is not null then we.d_dist
      else we.s_dist
    end asc;
end;
$$;

grant execute on function offsets_within(uuid, real, real, text) to authenticated, service_role;


-- 4. events_for_offsets
create or replace function events_for_offsets(
  p_wellbore uuid,
  p_radius_m real,
  p_formations text[] default null,
  p_limit int default 200
)
returns table (
  id uuid,
  wellbore_id uuid,
  event_type event_type,
  risk_type risk_type,
  md_from_m real,
  md_to_m real,
  formation text,
  relative_depth real,
  severity smallint,
  npt_h real,
  volume_m3 real,
  description text,
  cause text,
  action text,
  outcome text,
  event_date date,
  doc_id uuid,
  page int,
  snippet text,
  confidence real,
  provenance provenance,
  review_status review_status,
  created_at timestamptz,
  well_name text,
  surface_distance_m real
)
language sql
stable
security invoker
as $$
  select
    e.id,
    e.wellbore_id,
    e.event_type,
    e.risk_type,
    e.md_from_m,
    e.md_to_m,
    e.formation,
    e.relative_depth,
    e.severity,
    e.npt_h,
    e.volume_m3,
    e.description,
    e.cause,
    e.action,
    e.outcome,
    e.event_date,
    e.doc_id,
    e.page,
    e.snippet,
    e.confidence,
    e.provenance,
    e.review_status,
    e.created_at,
    o.well_name,
    o.surface_distance_m
  from offsets_within(p_wellbore, p_radius_m, null, 'surface') o
  join events e on e.wellbore_id = o.wellbore_id
  where e.review_status <> 'rejected'
    and (p_formations is null or e.formation = any(p_formations))
  order by o.surface_distance_m asc, e.md_from_m asc
  limit p_limit;
$$;

grant execute on function events_for_offsets(uuid, real, text[], int) to authenticated, service_role;
