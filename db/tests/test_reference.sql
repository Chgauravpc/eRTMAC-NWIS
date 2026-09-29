-- db/tests/test_reference.sql
-- Verification script for DB-03: verifies reference data in formations, synonyms, and iadc_codes

do $$
declare
  v_formations_count int;
  v_synonyms_count int;
  v_iadc_count int;
  v_trouble_count int;
  v_resolved_formation text;
begin
  -- 1. Check formations count
  select count(*) into v_formations_count from formations;
  if v_formations_count <> 19 then
    raise exception 'Assertion failed: expected 19 formations, found %', v_formations_count;
  end if;

  -- 2. Check formation_synonyms count
  select count(*) into v_synonyms_count from formation_synonyms;
  if v_synonyms_count < 30 then
    raise exception 'Assertion failed: expected at least 30 synonyms, found %', v_synonyms_count;
  end if;

  -- 3. Check iadc_codes count
  select count(*) into v_iadc_count from iadc_codes;
  if v_iadc_count <> 34 then
    raise exception 'Assertion failed: expected 34 iadc_codes, found %', v_iadc_count;
  end if;

  -- 4. Check specific synonym resolution: 'tipam ss' -> 'Tipam'
  select formation into v_resolved_formation from formation_synonyms where alias = 'tipam ss';
  if v_resolved_formation is distinct from 'Tipam' then
    raise exception 'Assertion failed: alias "tipam ss" did not resolve to "Tipam" (got %)', v_resolved_formation;
  end if;

  -- 5. Check trouble code count (should be exactly 5: codes 3, 5, 19, 24, 27)
  select count(*) into v_trouble_count from iadc_codes where is_trouble = true;
  if v_trouble_count <> 5 then
    raise exception 'Assertion failed: expected 5 trouble codes, found %', v_trouble_count;
  end if;

  raise notice 'All DB-03 reference data assertions passed successfully!';
end;
$$;

-- Display counts summary
select 
  (select count(*) from formations) as formations_count,
  (select count(*) from formation_synonyms) as synonyms_count,
  (select count(*) from iadc_codes) as iadc_codes_count,
  (select count(*) from iadc_codes where is_trouble = true) as trouble_codes_count,
  (select formation from formation_synonyms where alias = 'tipam ss') as tipam_ss_maps_to;
