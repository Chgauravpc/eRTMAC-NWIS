-- db/tests/test_search.sql
-- Verification test for DB-04 hybrid_search function

begin;

-- Create test well
insert into wells (id, name, field, basin, surface, provenance)
values (
  '44444444-0000-0000-0000-000000000001',
  'SYN-SEARCH-W1',
  'Dikom',
  'Upper Assam',
  ST_GeogFromText('SRID=4326;POINT(95.30 27.35)'),
  'synthetic'
);

-- Create test document
insert into documents (id, well_id, doc_type, title, file_path, sha256)
values (
  '55555555-0000-0000-0000-000000000001',
  '44444444-0000-0000-0000-000000000001',
  'wcr',
  'Dikom Well Completion Report',
  'documents/test/wcr.pdf',
  'sha256-test-search-doc-0001'
);

-- Create test chunks (with dummy 384-dimensional vector)
insert into chunks (id, doc_id, page, text, well_id, formation, md_from_m, md_to_m, embedding)
values
  (
    '66666666-0000-0000-0000-000000000001',
    '55555555-0000-0000-0000-000000000001',
    1,
    'Significant mud losses observed while drilling Tipam sandstone formation at depth 1920m.',
    '44444444-0000-0000-0000-000000000001',
    'Tipam',
    1900.0,
    1950.0,
    array_fill(0.05::real, array[384])::vector(384)
  ),
  (
    '66666666-0000-0000-0000-000000000002',
    '55555555-0000-0000-0000-000000000001',
    2,
    'BOP pressure testing completed satisfactorily according to safety guidelines.',
    '44444444-0000-0000-0000-000000000001',
    'Girujan',
    1200.0,
    1250.0,
    array_fill(0.01::real, array[384])::vector(384)
  );

-- Executing assertions via PL/pgSQL
do $$
declare
  v_res record;
  v_count int;
  v_dummy_embed vector(384) := array_fill(0.05::real, array[384])::vector(384);
begin
  -- 1. Keyword search matches 'tipam losses'
  select count(*) into v_count from hybrid_search('tipam losses', null);
  if v_count < 1 then
    raise exception 'Assertion 1 failed: keyword search returned 0 results';
  end if;

  select * into v_res from hybrid_search('tipam losses', null) limit 1;
  if v_res.chunk_id <> '66666666-0000-0000-0000-000000000001' or v_res.score <= 0.0 then
    raise exception 'Assertion 1b failed: unexpected top result: %', v_res;
  end if;

  -- 2. Hybrid search with vector returns fused results
  select count(*) into v_count from hybrid_search('tipam losses', v_dummy_embed);
  if v_count < 1 then
    raise exception 'Assertion 2 failed: fused search returned 0 results';
  end if;

  -- 3. Filter by formation
  select count(*) into v_count from hybrid_search('tipam losses', null, p_formation := 'Tipam');
  if v_count <> 1 then
    raise exception 'Assertion 3 failed: formation filter failed';
  end if;

  select count(*) into v_count from hybrid_search('tipam losses', null, p_formation := 'Barail');
  if v_count <> 0 then
    raise exception 'Assertion 3b failed: non-matching formation should return 0 results';
  end if;

  raise notice 'All DB-04 hybrid_search assertions passed successfully!';
end;
$$;

rollback;
