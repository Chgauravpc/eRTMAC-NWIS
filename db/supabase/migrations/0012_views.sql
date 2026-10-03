-- db/supabase/migrations/0012_views.sql
-- The five views of contract §6 (DB-12). The frontend reads all of them.
--
-- security_invoker = true: the views run with the caller's rights, so the row level security of the
-- base tables applies (a rig engineer sees only the alerts of assigned wells in v_open_alerts, a
-- reader without access to extracted_fields gets an empty v_review_queue, and so on).

-- One row per wellbore. Rejected events do not count.
create or replace view public.v_well_summary
with (security_invoker = true) as
select
  wb.id as wellbore_id,
  w.id as well_id,
  w.name as well_name,
  w.field,
  w.basin,
  w.status,
  w.provenance,
  st_x(w.surface::geometry) as lon,
  st_y(w.surface::geometry) as lat,
  w.td_md_m,
  coalesce(e.event_count, 0)::int as event_count,
  coalesce(e.npt_h_total, 0)::real as npt_h_total,
  e.top_risk_type
from public.wellbores wb
join public.wells w on w.id = wb.well_id
left join lateral (
  select
    count(*) as event_count,
    sum(x.npt_h) as npt_h_total,
    -- the risk type with the most events (ties: alphabetical); null when no event has a risk type
    (
      select ev.risk_type
      from public.events ev
      where ev.wellbore_id = wb.id
        and ev.review_status <> 'rejected'
        and ev.risk_type is not null
      group by ev.risk_type
      order by count(*) desc, ev.risk_type::text
      limit 1
    ) as top_risk_type
  from public.events x
  where x.wellbore_id = wb.id
    and x.review_status <> 'rejected'
) e on true;

-- NPT and event counts per formation and risk type (events that are not rejected and have a risk type).
create or replace view public.v_npt_by_formation
with (security_invoker = true) as
select
  e.formation,
  e.risk_type,
  count(*)::int as event_count,
  coalesce(sum(e.npt_h), 0)::real as npt_h_total,
  count(distinct wb.well_id)::int as well_count
from public.events e
join public.wellbores wb on wb.id = e.wellbore_id
where e.review_status <> 'rejected'
  and e.risk_type is not null
group by e.formation, e.risk_type;

-- Open alerts (not resolved, no feedback yet) with the well name.
create or replace view public.v_open_alerts
with (security_invoker = true) as
select
  a.*,
  w.name as well_name
from public.alerts a
join public.wellbores wb on wb.id = a.wellbore_id
join public.wells w on w.id = wb.well_id
where a.state not in ('resolved', 'feedback');

-- Pending extracted fields with the document title and type and the image of their page.
create or replace view public.v_review_queue
with (security_invoker = true) as
select
  f.*,
  d.title as doc_title,
  d.doc_type,
  p.image_path
from public.extracted_fields f
join public.documents d on d.id = f.doc_id
left join public.document_pages p on p.doc_id = f.doc_id and p.page_no = f.page
where f.review_status = 'pending';

-- Trajectories as 2D GeoJSON lines for the map.
create or replace view public.v_trajectory_geojson
with (security_invoker = true) as
select
  t.wellbore_id,
  w.name as well_name,
  st_asgeojson(st_force2d(t.geom))::json as geojson
from public.trajectories t
join public.wellbores wb on wb.id = t.wellbore_id
join public.wells w on w.id = wb.well_id;

grant select on
  public.v_well_summary,
  public.v_npt_by_formation,
  public.v_open_alerts,
  public.v_review_queue,
  public.v_trajectory_geojson
to authenticated, service_role;
