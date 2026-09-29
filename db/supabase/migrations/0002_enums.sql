-- 0002_enums.sql
create type user_role as enum ('rig_engineer','rtoc_engineer','office_engineer','reviewer','admin');
create type provenance as enum ('direct','analog','synthetic');
create type well_status as enum ('planned','drilling','completed');
create type doc_type as enum ('wcr','ddr','mud_log','program','cement_report','incident','survey','las','witsml','other');
create type job_status as enum ('queued','running','needs_review','done','failed');
create type review_status as enum ('pending','approved','edited','rejected','auto_approved');
create type event_type as enum ('loss_partial','loss_total','kick','stuck_pipe_diff','stuck_pipe_mech','tight_hole','pack_off','hole_instability','fishing','torque_spike','cement_failure','equipment_failure','other');
create type risk_type as enum ('losses','stuck_pipe','kick','torque','cementing');
create type risk_band as enum ('low','moderate','elevated','high','critical');
create type alert_severity as enum ('info','watch','warning','critical');
create type alert_kind as enum ('lookahead','detector','system');
create type alert_state as enum ('generated','sent','viewed','escalated','acknowledged','resolved','feedback');
create type resolve_how as enum ('auto','manual','dismissed');
create type alert_outcome as enum ('event_occurred','avoided','false_alarm','unknown');
create type confidence_level as enum ('high','medium','low');
create type stream_status as enum ('stopped','live','stale','lost');
create type top_source as enum ('actual','prognosis','predicted');
