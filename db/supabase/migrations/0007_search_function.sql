-- db/supabase/migrations/0007_search_function.sql
-- Hybrid search function combining full-text search and vector similarity with Reciprocal Rank Fusion (RRF)

create or replace function hybrid_search(
  p_query text,
  p_embedding vector(384),
  p_formation text default null,
  p_event_type text default null,
  p_field text default null,
  p_md_from real default null,
  p_md_to real default null,
  p_limit int default 20
)
returns table (
  chunk_id uuid,
  doc_id uuid,
  doc_title text,
  page int,
  text text,
  well_name text,
  formation text,
  score real
)
language sql
stable
security invoker
as $$
  with kw_top as (
    select
      c.id,
      ts_rank_cd(c.tsv, websearch_to_tsquery('english', p_query)) as s
    from chunks c
    where p_query is not null
      and trim(p_query) <> ''
      and c.tsv @@ websearch_to_tsquery('english', p_query)
    order by s desc, c.id
    limit 50
  ),
  kw as (
    select id, row_number() over (order by s desc, id) as rank_ix from kw_top
  ),
  vec_top as (
    select
      c.id,
      c.embedding <=> p_embedding as dist
    from chunks c
    where p_embedding is not null
    order by c.embedding <=> p_embedding
    limit 50
  ),
  vec as (
    select id, row_number() over (order by dist, id) as rank_ix from vec_top
  ),
  fused as (
    select
      coalesce(kw.id, vec.id) as chunk_id,
      (
        coalesce(1.0 / (60.0 + kw.rank_ix), 0.0) +
        coalesce(1.0 / (60.0 + vec.rank_ix), 0.0)
      )::real as rrf_score
    from kw
    full outer join vec on kw.id = vec.id
  )
  select
    c.id as chunk_id,
    c.doc_id,
    d.title as doc_title,
    c.page,
    c.text,
    w.name as well_name,
    c.formation,
    f.rrf_score as score
  from fused f
  join chunks c on c.id = f.chunk_id
  join documents d on d.id = c.doc_id
  left join wells w on w.id = c.well_id
  where (p_formation is null or c.formation = p_formation)
    and (p_field is null or w.field = p_field)
    and (p_md_from is null or c.md_to_m is null or c.md_to_m >= p_md_from)
    and (p_md_to is null or c.md_from_m is null or c.md_from_m <= p_md_to)
    and (
      p_event_type is null or exists (
        select 1
        from events e
        where e.doc_id = c.doc_id
          and (c.page is null or e.page = c.page)
          and e.event_type = p_event_type::event_type
      )
    )
  order by f.rrf_score desc
  limit p_limit;
$$;

grant execute on function hybrid_search(text, vector, text, text, text, real, real, int) to authenticated, service_role;
