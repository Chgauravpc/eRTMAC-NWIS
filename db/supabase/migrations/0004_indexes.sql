-- 0004_indexes.sql
create index on wells using gist (surface);
create index on trajectories using gist (geom);
create index on events (wellbore_id, md_from_m);
create index on events (formation, risk_type);
create index on chunks using gin (tsv);
create index on chunks using hnsw (embedding vector_cosine_ops);
create index on extracted_fields (review_status) where review_status = 'pending';
create index on alerts (wellbore_id, state);
create index on formation_tops (wellbore_id, top_md_m);
create index on time_log (wellbore_id, md_m);
