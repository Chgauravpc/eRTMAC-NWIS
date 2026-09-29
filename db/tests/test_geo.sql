-- db/tests/test_geo.sql
-- Verification test for DB-04 geo functions: well_position_at_md, formation_at_md, offsets_within, events_for_offsets

begin;

-- Create 3 test wells
-- Well 1: Active vertical well at (95.30, 27.35)
insert into wells (id, name, surface, provenance, status)
values ('11111111-0000-0000-0000-000000000001', 'SYN-GEO-V1', ST_GeogFromText('SRID=4326;POINT(95.30 27.35)'), 'synthetic', 'drilling');

insert into wellbores (id, well_id, name, kind, is_primary)
values ('11111111-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'SYN-GEO-V1-WB1', 'vertical', true);

-- Well 2: Deviated offset well 2 km east of Well 1
insert into wells (id, name, surface, provenance, status)
values (
  '22222222-0000-0000-0000-000000000001',
  'SYN-GEO-DEV2',
  ST_Project(ST_GeogFromText('SRID=4326;POINT(95.30 27.35)'), 2000.0, pi() / 2.0),
  'synthetic',
  'completed'
);

insert into wellbores (id, well_id, name, kind, is_primary)
values ('22222222-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000001', 'SYN-GEO-DEV2-WB1', 'deviated', true);

-- Survey stations for Well 2 reaching 500 m east displacement
insert into survey_stations (wellbore_id, md_m, inc_deg, azi_deg, tvd_m, north_m, east_m, dls_deg_per_30m)
values
  ('22222222-0000-0000-0000-000000000002', 0.0, 0.0, 90.0, 0.0, 0.0, 0.0, 0.0),
  ('22222222-0000-0000-0000-000000000002', 1000.0, 10.0, 90.0, 995.0, 0.0, 100.0, 0.3),
  ('22222222-0000-0000-0000-000000000002', 2500.0, 30.0, 90.0, 2400.0, 0.0, 500.0, 0.4);

-- Well 3: Far offset well ~20 km North
insert into wells (id, name, surface, provenance, status)
values (
  '33333333-0000-0000-0000-000000000001',
  'SYN-GEO-FAR3',
  ST_Project(ST_GeogFromText('SRID=4326;POINT(95.30 27.35)'), 20000.0, 0.0),
  'synthetic',
  'completed'
);

insert into wellbores (id, well_id, name, kind, is_primary)
values ('33333333-0000-0000-0000-000000000002', '33333333-0000-0000-0000-000000000001', 'SYN-GEO-FAR3-WB1', 'vertical', true);

-- Add formation tops on Well 1
insert into formation_tops (wellbore_id, formation, top_md_m, source, provenance)
values
  ('11111111-0000-0000-0000-000000000002', 'Girujan', 1000.0, 'actual', 'synthetic'),
  ('11111111-0000-0000-0000-000000000002', 'Tipam', 1800.0, 'actual', 'synthetic'),
  ('11111111-0000-0000-0000-000000000002', 'Barail', 2600.0, 'actual', 'synthetic');

-- Add an event on offset Well 2
insert into events (wellbore_id, event_type, risk_type, md_from_m, md_to_m, formation, description, provenance)
values ('22222222-0000-0000-0000-000000000002', 'loss_partial', 'losses', 1900.0, 1950.0, 'Tipam', 'Mud loss 20 m3', 'synthetic');

-- Executing assertions via PL/pgSQL
do $$
declare
  v_pos record;
  v_w2_surface geography;
  v_disp_dist real;
  v_count int;
  v_offset record;
  v_form record;
  v_ev record;
begin
  -- 1. Acceptance test: vertical well at 1000m has tvd=1000 and matches surface
  select * into v_pos from well_position_at_md('11111111-0000-0000-0000-000000000002', 1000.0);
  if abs(v_pos.tvd_m - 1000.0) > 0.01 or abs(v_pos.lon - 95.30) > 0.0001 or abs(v_pos.lat - 27.35) > 0.0001 then
    raise exception 'Assertion 1 failed: vertical well position incorrect: %', v_pos;
  end if;

  -- 2. Acceptance test: deviated well with 500m east displacement at TD (~2500m)
  select w.surface into v_w2_surface from wells w where w.id = '22222222-0000-0000-0000-000000000001';
  select * into v_pos from well_position_at_md('22222222-0000-0000-0000-000000000002', 2500.0);
  v_disp_dist := ST_Distance(v_w2_surface, ST_SetSRID(ST_MakePoint(v_pos.lon, v_pos.lat), 4326)::geography);
  if abs(v_disp_dist - 500.0) > 5.0 then
    raise exception 'Assertion 2 failed: deviated displacement distance % not close to 500m', v_disp_dist;
  end if;

  -- 3. Acceptance test: offsets_within(w1, 5000) returns only well 2, excludes w1 and w3
  select count(*) into v_count from offsets_within('11111111-0000-0000-0000-000000000002', 5000.0);
  if v_count <> 1 then
    raise exception 'Assertion 3 failed: expected 1 offset within 5km, got %', v_count;
  end if;

  select * into v_offset from offsets_within('11111111-0000-0000-0000-000000000002', 5000.0) limit 1;
  if v_offset.well_name <> 'SYN-GEO-DEV2' or abs(v_offset.surface_distance_m - 2000.0) > 20.0 then
    raise exception 'Assertion 3b failed: unexpected offset details: %', v_offset;
  end if;

  -- 4. Acceptance test: depth mode differs from surface mode
  select * into v_offset from offsets_within('11111111-0000-0000-0000-000000000002', 5000.0, 2500.0, 'depth') limit 1;
  if v_offset.depth_distance_m is null or abs(v_offset.depth_distance_m - v_offset.surface_distance_m) < 1.0 then
    raise exception 'Assertion 4 failed: depth distance should differ: %', v_offset;
  end if;

  -- 5. Acceptance test: formation_at_md
  select * into v_form from formation_at_md('11111111-0000-0000-0000-000000000002', 2000.0);
  if v_form.formation <> 'Tipam' or v_form.next_formation <> 'Barail' or abs(v_form.relative_depth - 0.25) > 0.02 then
    raise exception 'Assertion 5 failed: formation_at_md calculation incorrect: %', v_form;
  end if;

  -- 6. Acceptance test: events_for_offsets
  select * into v_ev from events_for_offsets('11111111-0000-0000-0000-000000000002', 5000.0) limit 1;
  if v_ev.well_name <> 'SYN-GEO-DEV2' or v_ev.event_type <> 'loss_partial' then
    raise exception 'Assertion 6 failed: events_for_offsets did not return offset event: %', v_ev;
  end if;

  raise notice 'All DB-04 geo function assertions passed successfully!';
end;
$$;

-- Ordering: add offsets at 1 km and 3 km, expect ascending surface distance
insert into wells (id, name, surface, provenance, status)
values
  ('44444444-0000-0000-0000-000000000001', 'SYN-GEO-N1', ST_Project(ST_GeogFromText('SRID=4326;POINT(95.30 27.35)'), 3000.0, pi()), 'synthetic', 'completed'),
  ('55555555-0000-0000-0000-000000000001', 'SYN-GEO-N2', ST_Project(ST_GeogFromText('SRID=4326;POINT(95.30 27.35)'), 1000.0, 0.0), 'synthetic', 'completed');
insert into wellbores (id, well_id, name, kind, is_primary)
values
  ('44444444-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000001', 'SYN-GEO-N1-WB1', 'vertical', true),
  ('55555555-0000-0000-0000-000000000002', '55555555-0000-0000-0000-000000000001', 'SYN-GEO-N2-WB1', 'vertical', true);

do $$
declare
  v_names text[];
  v_sorted text[];
begin
  select array_agg(well_name order by ord) into v_names
  from (select well_name, row_number() over () as ord
        from offsets_within('11111111-0000-0000-0000-000000000002', 5000.0)) s;
  if v_names is distinct from array['SYN-GEO-N2', 'SYN-GEO-DEV2', 'SYN-GEO-N1'] then
    raise exception 'Assertion 7 failed: offsets not ordered by distance / self not excluded: %', v_names;
  end if;
  if exists (select 1 from offsets_within('11111111-0000-0000-0000-000000000002', 5000.0)
             where surface_distance_m > 5000.0 or well_name = 'SYN-GEO-V1') then
    raise exception 'Assertion 7b failed: radius or self-exclusion violated';
  end if;
end;
$$;

-- Performance (DB-04 acceptance): every function < 200 ms with 50 wells
insert into wells (id, name, surface, provenance, status)
select gen_random_uuid(), 'SYN-PERF-' || g,
       ST_Project(ST_GeogFromText('SRID=4326;POINT(95.30 27.35)'), 500 + (g * 190)::float, (g * 0.7)::float),
       'synthetic', 'completed'
from generate_series(1, 50) g;
insert into wellbores (id, well_id, name, kind, is_primary)
select gen_random_uuid(), id, name || '-WB1', 'deviated', true from wells where name like 'SYN-PERF-%';
insert into survey_stations (wellbore_id, md_m, inc_deg, azi_deg, tvd_m, north_m, east_m, dls_deg_per_30m)
select b.id, s.md, 20, 45, s.md * 0.95, s.md * 0.1, s.md * 0.1, 0.3
from wellbores b, (values (0.0), (1000.0), (2000.0), (3000.0)) s(md)
where b.name like 'SYN-PERF-%';
insert into formation_tops (wellbore_id, formation, top_md_m, source, provenance)
select b.id, f.name, f.md, 'actual', 'synthetic'
from wellbores b, (values ('Girujan', 800.0), ('Tipam', 1800.0), ('Barail', 2600.0)) f(name, md)
where b.name like 'SYN-PERF-%';
insert into events (wellbore_id, event_type, risk_type, md_from_m, md_to_m, formation, description, provenance)
select b.id, 'loss_partial', 'losses', 1900.0, 1950.0, 'Tipam', 'perf', 'synthetic'
from wellbores b where b.name like 'SYN-PERF-%';

do $$
declare
  t0 timestamptz;
  ms numeric;
  n int;
begin
  t0 := clock_timestamp();
  select count(*) into n from offsets_within('11111111-0000-0000-0000-000000000002', 25000.0);
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  if n < 50 or ms > 200 then raise exception 'Assertion 8a failed: offsets_within % rows in % ms', n, ms; end if;

  t0 := clock_timestamp();
  select count(*) into n from offsets_within('11111111-0000-0000-0000-000000000002', 25000.0, 2000.0, 'depth');
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  if n < 50 or ms > 200 then raise exception 'Assertion 8b failed: offsets_within depth % rows in % ms', n, ms; end if;

  t0 := clock_timestamp();
  select count(*) into n from events_for_offsets('11111111-0000-0000-0000-000000000002', 25000.0);
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  if n < 50 or ms > 200 then raise exception 'Assertion 8c failed: events_for_offsets % rows in % ms', n, ms; end if;

  t0 := clock_timestamp();
  perform well_position_at_md(id, 1500.0) from wellbores where name like 'SYN-PERF-%' limit 1;
  perform formation_at_md(id, 1500.0) from wellbores where name like 'SYN-PERF-%' limit 1;
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  if ms > 200 then raise exception 'Assertion 8d failed: position/formation lookup % ms', ms; end if;

  raise notice 'DB-04 ordering and performance assertions passed (50 wells).';
end;
$$;

rollback;
