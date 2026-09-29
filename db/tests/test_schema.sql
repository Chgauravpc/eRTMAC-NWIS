-- db/tests/test_schema.sql
-- Verification script for DB-02: inserts entities, tests unique dedup_key on open alerts,
-- verifies table counts, and rolls back cleanly.

begin;

-- 1. Insert test well
insert into wells (
  id,
  name,
  surface,
  provenance
) values (
  '11111111-1111-1111-1111-111111111111',
  'SYN-TEST-01',
  ST_GeogFromText('POINT(95.31 27.36)'),
  'synthetic'
);

-- 2. Insert test wellbore
insert into wellbores (
  id,
  well_id,
  name,
  kind,
  is_primary
) values (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  'SYN-TEST-01-WB01',
  'deviated',
  true
);

-- 3. Insert three survey stations
insert into survey_stations (
  wellbore_id, md_m, inc_deg, azi_deg, tvd_m, north_m, east_m, dls_deg_per_30m
) values
  ('22222222-2222-2222-2222-222222222222', 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0),
  ('22222222-2222-2222-2222-222222222222', 1000.0, 5.0, 45.0, 998.7, 30.8, 30.8, 0.15),
  ('22222222-2222-2222-2222-222222222222', 2000.0, 15.0, 60.0, 1980.2, 120.5, 185.3, 0.30);

-- 4. Insert formation
insert into formations (
  name,
  basin,
  strat_order,
  typical_risks
) values (
  'Tipam',
  'Upper Assam',
  5,
  array['losses'::risk_type]
);

-- 5. Insert formation top
insert into formation_tops (
  id,
  wellbore_id,
  formation,
  top_md_m,
  source,
  provenance
) values (
  '33333333-3333-3333-3333-333333333333',
  '22222222-2222-2222-2222-222222222222',
  'Tipam',
  1850.0,
  'actual',
  'synthetic'
);

-- 6. Insert event
insert into events (
  id,
  wellbore_id,
  event_type,
  risk_type,
  md_from_m,
  description,
  provenance
) values (
  '44444444-4444-4444-4444-444444444444',
  '22222222-2222-2222-2222-222222222222',
  'loss_partial',
  'losses',
  1900.0,
  'Partial mud losses in Tipam sandstone',
  'synthetic'
);

-- 7. Insert first open alert
insert into alerts (
  id,
  wellbore_id,
  kind,
  severity,
  dedup_key,
  title,
  message
) values (
  '55555555-5555-5555-5555-555555555555',
  '22222222-2222-2222-2222-222222222222',
  'lookahead',
  'watch',
  'x:losses:2400',
  't',
  'm'
);

-- 8. Verify unique partial index on dedup_key for open alerts using a savepoint
savepoint duplicate_alert_test;

do $$
declare
  caught_violation boolean := false;
begin
  begin
    insert into alerts (
      wellbore_id,
      kind,
      severity,
      dedup_key,
      title,
      message
    ) values (
      '22222222-2222-2222-2222-222222222222',
      'lookahead',
      'watch',
      'x:losses:2400',
      't_dup',
      'm_dup'
    );
  exception
    when unique_violation then
      caught_violation := true;
      raise notice 'Success: Duplicate dedup_key correctly rejected by alerts_one_open_per_key';
  end;

  if not caught_violation then
    raise exception 'TEST FAILED: Unique partial index alerts_one_open_per_key did not reject duplicate open alert';
  end if;
end;
$$;

rollback to savepoint duplicate_alert_test;

-- 9. Select counts to verify inserted rows exist
select 
  (select count(*) from wells where name = 'SYN-TEST-01') as wells_count,
  (select count(*) from wellbores where name = 'SYN-TEST-01-WB01') as wellbores_count,
  (select count(*) from survey_stations where wellbore_id = '22222222-2222-2222-2222-222222222222') as survey_stations_count,
  (select count(*) from formations where name = 'Tipam') as formations_count,
  (select count(*) from formation_tops where wellbore_id = '22222222-2222-2222-2222-222222222222') as formation_tops_count,
  (select count(*) from events where wellbore_id = '22222222-2222-2222-2222-222222222222') as events_count,
  (select count(*) from alerts where dedup_key = 'x:losses:2400') as alerts_count;

rollback;
