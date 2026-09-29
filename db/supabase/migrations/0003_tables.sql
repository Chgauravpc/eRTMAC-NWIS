-- 0003_tables.sql

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,                                 -- copied from auth.users at sign-up (admin screen)
  full_name text,
  role user_role not null default 'office_engineer',
  assigned_wellbore_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table wells (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  field text,
  basin text,
  operator text,
  surface geography(Point,4326) not null,
  datum_src text not null default 'WGS84',
  kb_elev_m real,
  spud_date date,
  td_md_m real,
  td_tvd_m real,
  status well_status not null default 'completed',
  provenance provenance not null,
  created_at timestamptz not null default now()
);

create table wellbores (
  id uuid primary key default gen_random_uuid(),
  well_id uuid not null references wells(id) on delete cascade,
  name text not null unique,
  kind text not null default 'deviated' check (kind in ('vertical','deviated','horizontal')),
  is_primary boolean not null default true
);

create table survey_stations (
  wellbore_id uuid not null references wellbores(id) on delete cascade,
  md_m real not null,
  inc_deg real not null,
  azi_deg real not null,
  tvd_m real not null,
  north_m real not null,
  east_m real not null,
  dls_deg_per_30m real,
  primary key (wellbore_id, md_m)
);

create table trajectories (
  wellbore_id uuid primary key references wellbores(id) on delete cascade,
  geom geometry(LineStringZ,4326) not null   -- x=lon, y=lat, z=tvd_m (positive down)
);

create table formations (
  name text primary key,
  basin text not null,
  strat_order int not null,                  -- 1 = shallowest
  lithology text,
  typical_risks risk_type[] not null default '{}'
);

create table formation_synonyms (
  alias text primary key,                    -- lowercase, trimmed
  formation text not null references formations(name)
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  well_id uuid references wells(id) on delete set null,
  wellbore_id uuid references wellbores(id) on delete set null,
  doc_type doc_type not null default 'other',
  title text not null,
  file_path text not null,                   -- storage path in bucket 'documents'
  sha256 text not null unique,
  pages int,
  has_text_layer boolean,
  ocr_engine text,
  provenance provenance not null default 'direct',
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table document_pages (
  doc_id uuid not null references documents(id) on delete cascade,
  page_no int not null,                      -- 1-based
  image_path text,                           -- storage path in bucket 'page-images'
  text text,
  ocr_confidence real,                       -- 0..1, null if text layer
  engine text,                               -- 'text_layer' | 'rapidocr' | 'tesseract'
  primary key (doc_id, page_no)
);

create table formation_tops (
  id uuid primary key default gen_random_uuid(),
  wellbore_id uuid not null references wellbores(id) on delete cascade,
  formation text not null references formations(name),
  top_md_m real not null,
  top_tvdss_m real,
  source top_source not null default 'actual',
  uncertainty_m real,
  n_offsets int,                             -- predicted only
  provenance provenance not null,
  doc_id uuid references documents(id) on delete set null,
  page int,
  unique (wellbore_id, formation, source)
);

create table hole_sections (
  id uuid primary key default gen_random_uuid(),
  wellbore_id uuid not null references wellbores(id) on delete cascade,
  hole_size_in real,
  md_from_m real,
  md_to_m real,
  casing_od_in real,
  casing_weight_ppf real,
  casing_grade text,
  shoe_md_m real,
  toc_md_m real,
  planned boolean not null default false,
  provenance provenance not null,
  doc_id uuid references documents(id) on delete set null,
  page int
);

create table cement_jobs (
  id uuid primary key default gen_random_uuid(),
  wellbore_id uuid not null references wellbores(id) on delete cascade,
  job_type text not null check (job_type in ('primary','squeeze','plug')),
  casing_od_in real,
  slurry_density_sg real,
  volume_m3 real,
  returns_to_surface boolean,
  plug_bumped boolean,
  woc_h real,
  cbl_result text,
  issue text,
  provenance provenance not null,
  doc_id uuid references documents(id) on delete set null,
  page int
);

create table mud_records (
  id uuid primary key default gen_random_uuid(),
  wellbore_id uuid not null references wellbores(id) on delete cascade,
  report_date date,
  md_m real,
  mud_type text,
  mw_sg real,
  pv_cp real,
  yp_lbf100ft2 real,
  gel10s_lbf100ft2 real,
  gel10m_lbf100ft2 real,
  filtrate_ml real,
  ecd_sg real,
  chlorides_mgl real,
  provenance provenance not null,
  doc_id uuid references documents(id) on delete set null,
  page int
);

create table iadc_codes (
  code int primary key,
  name text not null,
  is_trouble boolean not null default false
);

create table time_log (
  id uuid primary key default gen_random_uuid(),
  wellbore_id uuid not null references wellbores(id) on delete cascade,
  report_date date,
  t_start timestamptz,
  t_end timestamptz,
  hours real,
  md_m real,
  phase text,
  iadc_code int references iadc_codes(code),
  state text,
  comment text,
  doc_id uuid references documents(id) on delete set null,
  page int
);

create table depth_series (
  wellbore_id uuid not null references wellbores(id) on delete cascade,
  md_m real not null,
  t timestamptz,
  rop_m_h real, wob_kn real, rpm real, torque_knm real, spp_bar real,
  flow_in_lpm real, flow_out_lpm real, pit_vol_m3 real, hookload_kn real,
  mw_sg real, ecd_sg real, gas_total_pct real, dxc real,
  gr_api real,                                -- gamma ray (API units), for correlation tracks
  primary key (wellbore_id, md_m)
);
-- NOTE: for wells being drilled (live or replayed), rows with md_m > stream_state.bit_md_m are
-- "future" data. RLS hides them from users (§8) and the backend must never return them.

create table events (
  id uuid primary key default gen_random_uuid(),
  wellbore_id uuid not null references wellbores(id) on delete cascade,
  event_type event_type not null,
  risk_type risk_type,                        -- from mapping in §5
  md_from_m real not null,
  md_to_m real,
  formation text references formations(name),
  relative_depth real,                        -- 0..1 inside formation
  severity smallint check (severity between 1 and 5),
  npt_h real,
  volume_m3 real,
  description text not null,
  cause text,
  action text,
  outcome text,
  event_date date,
  doc_id uuid references documents(id) on delete set null,
  page int,
  snippet text,
  confidence real,                            -- 0..1
  provenance provenance not null,
  review_status review_status not null default 'pending',
  created_at timestamptz not null default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references documents(id) on delete cascade,
  status job_status not null default 'queued',
  stage text,                                 -- 'classify'|'ocr'|'extract'|'validate'|'index'|'done'
  progress int not null default 0 check (progress between 0 and 100),
  error text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table extracted_fields (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade,
  doc_id uuid not null references documents(id) on delete cascade,
  page int,
  entity text not null check (entity in ('event','formation_top','hole_section','cement_job','mud_record','survey_station','well_header','time_log')),
  entity_id uuid,                             -- row created in the target table (null for well_header)
  field text not null,
  value jsonb,
  confidence real not null,
  reason text,                                -- why flagged, e.g. 'low_ocr_confidence', 'failed_rule:depth_gt_td'
  bbox jsonb,                                 -- {"x":0.12,"y":0.40,"w":0.30,"h":0.03} fractions of page
  review_status review_status not null default 'pending',
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz
);

create table chunks (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references documents(id) on delete cascade,
  page int,
  text text not null,
  tsv tsvector generated always as (to_tsvector('english', text)) stored,
  embedding vector(384),
  well_id uuid references wells(id) on delete set null,
  formation text references formations(name),
  md_from_m real,
  md_to_m real
);

create table lessons (
  id uuid primary key default gen_random_uuid(),
  formation text references formations(name),
  event_type event_type not null,
  title text not null,
  problem text not null,
  cause text,
  mitigation text,
  outcome text,
  event_ids uuid[] not null default '{}',
  well_count int not null default 0,
  success_rate real,                          -- share of events where mitigation worked, 0..1
  updated_at timestamptz not null default now()
);

create table risk_scores (
  wellbore_id uuid not null references wellbores(id) on delete cascade,
  md_from_m real not null,
  md_to_m real not null,
  risk_type risk_type not null,
  l1 real, l2 real, l3 real,                  -- probabilities 0..1, null if layer unavailable
  fused real not null,                        -- 0..100
  band risk_band not null,
  confidence confidence_level not null,
  confidence_reason text,
  reasons jsonb not null default '[]',        -- [{"kind":"offset_event","event_id":"..."},{"kind":"shap","feature":"torque_trend","value":0.12}]
  formation text,
  model_version text,
  computed_at timestamptz not null default now(),
  primary key (wellbore_id, md_from_m, risk_type)
);

create table stream_state (
  wellbore_id uuid primary key references wellbores(id) on delete cascade,
  status stream_status not null default 'stopped',
  source text,                                -- 'volve' | 'synthetic' | 'witsml'
  speed int not null default 1,
  bit_md_m real,
  hole_md_m real,
  last_sample_at timestamptz,
  latest jsonb,                               -- latest channel values, keys = depth_series column names
  updated_at timestamptz not null default now()
);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  wellbore_id uuid not null references wellbores(id) on delete cascade,
  kind alert_kind not null,
  risk_type risk_type,                        -- null for system alerts
  severity alert_severity not null,
  state alert_state not null default 'generated',
  dedup_key text not null,
  zone_md_from_m real,
  zone_md_to_m real,
  expected_md_m real,
  formation text,
  score real,
  confidence confidence_level,
  title text not null,
  message text not null,
  recommendation text,
  evidence jsonb not null default '{}',       -- see §11.6
  model_version text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  escalated_at timestamptz,
  acknowledged_by uuid references auth.users(id),
  acknowledged_at timestamptz,
  action_note text,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  resolved_how resolve_how,
  outcome alert_outcome,
  dismiss_reason text,
  useful boolean,
  feedback_by uuid references auth.users(id),
  feedback_at timestamptz
);
create unique index alerts_one_open_per_key on alerts(dedup_key)
  where state not in ('resolved','feedback');

create table alert_views (
  alert_id uuid not null references alerts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (alert_id, user_id)
);

create table model_runs (
  id uuid primary key default gen_random_uuid(),
  risk_type risk_type not null,
  version text not null unique,               -- e.g. 'l2-stuck_pipe-2026-10-04-01'
  metrics jsonb not null,                     -- {"pr_auc":0.41,"baseline_pr_auc":0.28,"precision":..,"recall":..,"n_wells":..}
  params jsonb,
  artifact_path text,                         -- storage path in bucket 'models'
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create table llm_cache (
  prompt_hash text primary key,               -- sha256 of provider-independent prompt
  provider text not null,
  model text not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);

create table shift_notes (
  id uuid primary key default gen_random_uuid(),
  wellbore_id uuid not null references wellbores(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  text text not null,
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigint generated always as identity primary key,
  user_id uuid,
  action text not null,                       -- 'alert.ack', 'field.approve', 'doc.upload', 'user.invite', ...
  entity text not null,
  entity_id uuid,
  details jsonb not null default '{}',
  at timestamptz not null default now()
);

-- Trigger function for automatic updated_at maintenance
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tr_jobs_set_updated_at
  before update on jobs
  for each row
  execute function set_updated_at();

create trigger tr_stream_state_set_updated_at
  before update on stream_state
  for each row
  execute function set_updated_at();

-- Enable Row Level Security (RLS) on all tables created in this migration
alter table profiles enable row level security;
alter table wells enable row level security;
alter table wellbores enable row level security;
alter table survey_stations enable row level security;
alter table trajectories enable row level security;
alter table formations enable row level security;
alter table formation_synonyms enable row level security;
alter table documents enable row level security;
alter table document_pages enable row level security;
alter table formation_tops enable row level security;
alter table hole_sections enable row level security;
alter table cement_jobs enable row level security;
alter table mud_records enable row level security;
alter table iadc_codes enable row level security;
alter table time_log enable row level security;
alter table depth_series enable row level security;
alter table events enable row level security;
alter table jobs enable row level security;
alter table extracted_fields enable row level security;
alter table chunks enable row level security;
alter table lessons enable row level security;
alter table risk_scores enable row level security;
alter table stream_state enable row level security;
alter table alerts enable row level security;
alter table alert_views enable row level security;
alter table model_runs enable row level security;
alter table llm_cache enable row level security;
alter table shift_notes enable row level security;
alter table audit_log enable row level security;
