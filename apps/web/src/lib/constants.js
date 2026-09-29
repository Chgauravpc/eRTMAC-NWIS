/**
 * Hand copy of contract sections 5-9 (docs/team/00_SHARED_CONTRACTS.md). Any mismatch is a bug.
 * Field names are snake_case exactly as in the contract; nullable columns are marked `|null`.
 */

/** Contract section 5 enums */
export const USER_ROLES = Object.freeze(['rig_engineer', 'rtoc_engineer', 'office_engineer', 'reviewer', 'admin']);
export const PROVENANCES = Object.freeze(['direct', 'analog', 'synthetic']);
export const WELL_STATUSES = Object.freeze(['planned', 'drilling', 'completed']);
export const DOC_TYPES = Object.freeze(['wcr', 'ddr', 'mud_log', 'program', 'cement_report', 'incident', 'survey', 'las', 'witsml', 'other']);
export const JOB_STATUSES = Object.freeze(['queued', 'running', 'needs_review', 'done', 'failed']);
export const REVIEW_STATUSES = Object.freeze(['pending', 'approved', 'edited', 'rejected', 'auto_approved']);
export const EVENT_TYPES = Object.freeze(['loss_partial', 'loss_total', 'kick', 'stuck_pipe_diff', 'stuck_pipe_mech', 'tight_hole', 'pack_off', 'hole_instability', 'fishing', 'torque_spike', 'cement_failure', 'equipment_failure', 'other']);
export const RISK_TYPES = Object.freeze(['losses', 'stuck_pipe', 'kick', 'torque', 'cementing']);
export const RISK_BANDS = Object.freeze(['low', 'moderate', 'elevated', 'high', 'critical']);
export const ALERT_SEVERITIES = Object.freeze(['info', 'watch', 'warning', 'critical']);
export const ALERT_KINDS = Object.freeze(['lookahead', 'detector', 'system']);
export const ALERT_STATES = Object.freeze(['generated', 'sent', 'viewed', 'escalated', 'acknowledged', 'resolved', 'feedback']);
export const RESOLVE_HOWS = Object.freeze(['auto', 'manual', 'dismissed']);
export const ALERT_OUTCOMES = Object.freeze(['event_occurred', 'avoided', 'false_alarm', 'unknown']);
export const CONFIDENCE_LEVELS = Object.freeze(['high', 'medium', 'low']);
export const STREAM_STATUSES = Object.freeze(['stopped', 'live', 'stale', 'lost']);
export const TOP_SOURCES = Object.freeze(['actual', 'prognosis', 'predicted']);
export const EXTRACTED_ENTITIES = Object.freeze(['event', 'formation_top', 'hole_section', 'cement_job', 'mud_record', 'survey_station', 'well_header', 'time_log']);
export const JOB_STAGES = Object.freeze(['classify', 'ocr', 'extract', 'validate', 'index', 'done']);

export const EVENT_TO_RISK = Object.freeze({
  loss_partial: 'losses',
  loss_total: 'losses',
  kick: 'kick',
  stuck_pipe_diff: 'stuck_pipe',
  stuck_pipe_mech: 'stuck_pipe',
  tight_hole: 'stuck_pipe',
  pack_off: 'stuck_pipe',
  hole_instability: 'stuck_pipe',
  torque_spike: 'torque',
  cement_failure: 'cementing',
  fishing: null,
  equipment_failure: null,
  other: null,
});

export const RISK_LABELS = Object.freeze({
  losses: 'Mud losses',
  stuck_pipe: 'Stuck pipe',
  kick: 'Kick / overpressure',
  torque: 'Torque spike',
  cementing: 'Cementing issue',
});

export const ROLE_LABELS = Object.freeze({
  rig_engineer: 'Rig engineer',
  rtoc_engineer: 'RTOC engineer',
  office_engineer: 'Office engineer',
  reviewer: 'Reviewer',
  admin: 'Admin',
});

export const SEVERITY_LABELS = Object.freeze({ info: 'Info', watch: 'Watch', warning: 'Warning', critical: 'Critical' });

/** True when the app runs on MSW mocks (VITE_USE_MOCKS === 'true'). Evaluated at call time. */
export const isMockMode = () => import.meta.env.VITE_USE_MOCKS === 'true';

/**
 * Table profiles (contract 6).
 * @typedef {Object} Profile
 * @property {string} id
 * @property {string} email
 * @property {string} full_name
 * @property {'rig_engineer'|'rtoc_engineer'|'office_engineer'|'reviewer'|'admin'} role
 * @property {string[]} assigned_wellbore_ids
 * @property {string} [created_at]
 */

/**
 * View v_well_summary (contract 6).
 * @typedef {Object} WellSummary
 * @property {string} wellbore_id
 * @property {string} well_id
 * @property {string} well_name
 * @property {string} field
 * @property {string} basin
 * @property {string} status
 * @property {string} provenance
 * @property {number} lon
 * @property {number} lat
 * @property {number} td_md_m
 * @property {number} event_count
 * @property {number} npt_h_total
 * @property {string|null} top_risk_type
 */

/**
 * Table alerts (contract 6); v_open_alerts adds well_name.
 * @typedef {Object} Alert
 * @property {string} id
 * @property {string} wellbore_id
 * @property {string} kind
 * @property {string|null} [risk_type] null for system alerts
 * @property {string} severity
 * @property {string} state
 * @property {string} dedup_key
 * @property {number} [zone_md_from_m]
 * @property {number} [zone_md_to_m]
 * @property {number} [expected_md_m]
 * @property {string} [formation]
 * @property {number} [score]
 * @property {string} [confidence]
 * @property {string} title
 * @property {string} message
 * @property {string} [recommendation]
 * @property {AlertEvidence} evidence
 * @property {string} [model_version]
 * @property {string} created_at
 * @property {string} [sent_at]
 * @property {string} [escalated_at]
 * @property {string} [acknowledged_by]
 * @property {string} [acknowledged_at]
 * @property {string} [action_note]
 * @property {string} [resolved_by]
 * @property {string} [resolved_at]
 * @property {string} [resolved_how]
 * @property {string} [outcome]
 * @property {string} [dismiss_reason]
 * @property {boolean} [useful]
 * @property {string} [feedback_by]
 * @property {string} [feedback_at]
 * @property {string} [well_name] only on v_open_alerts
 */

/**
 * Alert evidence JSON (contract 11.6).
 * @typedef {Object} AlertEvidence
 * @property {Array<{wellbore_id: string, well_name: string, depth_distance_m: number, events: Array<{id: string, event_type: string, md_from_m: number, npt_h: number, doc_id: string, page: number}>}>} [offsets]
 * @property {Array<{id: string, title: string, mitigation: string, success_rate: number}>} [lessons]
 * @property {Array<{feature: string, value: number}>} [shap]
 * @property {{name: string, signal: Object}|null} [detector]
 * @property {{l1: number|null, l2: number|null, l3: number|null}} [layers]
 * @property {Array<{doc_id: string, doc_title: string, page: number}>} [sources]
 */

/**
 * Table risk_scores (contract 6). Primary key (wellbore_id, md_from_m, risk_type).
 * @typedef {Object} RiskScore
 * @property {string} wellbore_id
 * @property {number} md_from_m
 * @property {number} md_to_m
 * @property {'losses'|'stuck_pipe'|'kick'|'torque'|'cementing'} risk_type
 * @property {number|null} [l1] probability 0..1, null if the layer is unavailable
 * @property {number|null} [l2]
 * @property {number|null} [l3]
 * @property {number} fused 0..100
 * @property {'low'|'moderate'|'elevated'|'high'|'critical'} band
 * @property {'high'|'medium'|'low'} confidence
 * @property {string|null} [confidence_reason]
 * @property {Array<Object>} reasons e.g. {kind:'offset_event', event_id} or {kind:'shap', feature, value}
 * @property {string|null} [formation]
 * @property {string|null} [model_version]
 * @property {string} [computed_at]
 */

/**
 * Table stream_state (contract 6). One row per wellbore.
 * @typedef {Object} StreamState
 * @property {string} wellbore_id
 * @property {'stopped'|'live'|'stale'|'lost'} status
 * @property {string|null} [source] 'volve' | 'synthetic' | 'witsml'
 * @property {number} speed
 * @property {number|null} [bit_md_m]
 * @property {number|null} [hole_md_m]
 * @property {string|null} [last_sample_at]
 * @property {Object|null} [latest] keys = depth_series column names (rop_m_h, wob_kn, torque_knm, ...)
 * @property {string} [updated_at]
 */

/**
 * Table events (contract 6). Rows from RPC events_for_offsets add well_name and surface_distance_m.
 * @typedef {Object} EventRow
 * @property {string} id
 * @property {string} wellbore_id
 * @property {string} event_type
 * @property {string|null} [risk_type]
 * @property {number} md_from_m
 * @property {number|null} [md_to_m]
 * @property {string|null} [formation]
 * @property {number|null} [relative_depth]
 * @property {number|null} [severity] 1..5
 * @property {number|null} [npt_h]
 * @property {number|null} [volume_m3]
 * @property {string} description
 * @property {string|null} [cause]
 * @property {string|null} [action]
 * @property {string|null} [outcome]
 * @property {string|null} [event_date]
 * @property {string|null} [doc_id]
 * @property {number|null} [page]
 * @property {string|null} [snippet]
 * @property {number|null} [confidence] 0..1
 * @property {'direct'|'analog'|'synthetic'} provenance
 * @property {'pending'|'approved'|'edited'|'rejected'|'auto_approved'} review_status
 * @property {string} [created_at]
 * @property {string} [well_name] events_for_offsets only
 * @property {number} [surface_distance_m] events_for_offsets only
 */

/**
 * Table documents (contract 6).
 * @typedef {Object} DocumentRow
 * @property {string} id
 * @property {string|null} [well_id]
 * @property {string|null} [wellbore_id]
 * @property {string} doc_type
 * @property {string} title
 * @property {string} file_path
 * @property {string} sha256
 * @property {number|null} [pages]
 * @property {boolean|null} [has_text_layer]
 * @property {string|null} [ocr_engine]
 * @property {'direct'|'analog'|'synthetic'} provenance
 * @property {string|null} [uploaded_by]
 * @property {string} [created_at]
 */

/**
 * Table jobs (contract 6).
 * @typedef {Object} JobRow
 * @property {string} id
 * @property {string} doc_id
 * @property {'queued'|'running'|'needs_review'|'done'|'failed'} status
 * @property {string|null} [stage] classify | ocr | extract | validate | index | done
 * @property {number} progress 0..100
 * @property {string|null} [error]
 * @property {string|null} [created_by]
 * @property {string} [created_at]
 * @property {string} [updated_at]
 */

/**
 * Table extracted_fields (contract 6). View v_review_queue adds doc title, doc_type and page image_path.
 * @typedef {Object} ExtractedField
 * @property {string} id
 * @property {string|null} [job_id]
 * @property {string} doc_id
 * @property {number|null} [page]
 * @property {'event'|'formation_top'|'hole_section'|'cement_job'|'mud_record'|'survey_station'|'well_header'|'time_log'} entity
 * @property {string|null} [entity_id]
 * @property {string} field
 * @property {*} value jsonb, e.g. {raw: '15 bbl/hr', value: 2.38, unit: 'm3/h'}
 * @property {number} confidence 0..1
 * @property {string|null} [reason] e.g. 'low_ocr_confidence', 'failed_rule:depth_gt_td'
 * @property {{x: number, y: number, w: number, h: number}|null} [bbox] fractions of the page
 * @property {'pending'|'approved'|'edited'|'rejected'|'auto_approved'} review_status
 * @property {string|null} [reviewed_by]
 * @property {string|null} [reviewed_at]
 */

/**
 * Row returned by RPC offsets_within (contract 7).
 * @typedef {Object} OffsetRow
 * @property {string} wellbore_id
 * @property {string} well_id
 * @property {string} well_name
 * @property {string} field
 * @property {'direct'|'analog'|'synthetic'} provenance
 * @property {number} lon
 * @property {number} lat
 * @property {number} surface_distance_m
 * @property {number|null} [depth_distance_m] only when p_md was given
 * @property {number} event_count
 */

/**
 * Row returned by RPC formation_at_md (contract 7).
 * @typedef {Object} FormationAtMd
 * @property {string} formation
 * @property {number} top_md_m
 * @property {string|null} [next_formation]
 * @property {number|null} [next_top_md_m]
 * @property {number} relative_depth 0..1
 * @property {'actual'|'prognosis'|'predicted'} source
 */

/**
 * Row returned by RPC hybrid_search (contract 7).
 * @typedef {Object} HybridSearchRow
 * @property {string} chunk_id
 * @property {string} doc_id
 * @property {string} doc_title
 * @property {number} page
 * @property {string} text
 * @property {string|null} [well_name]
 * @property {string|null} [formation]
 * @property {number} score
 */

/**
 * Table lessons (contract 6).
 * @typedef {Object} Lesson
 * @property {string} id
 * @property {string|null} [formation]
 * @property {string} event_type
 * @property {string} title
 * @property {string} problem
 * @property {string|null} [cause]
 * @property {string|null} [mitigation]
 * @property {string|null} [outcome]
 * @property {string[]} event_ids
 * @property {number} well_count
 * @property {number|null} [success_rate] 0..1
 * @property {string} [updated_at]
 */

/**
 * Table model_runs (contract 6).
 * @typedef {Object} ModelRun
 * @property {string} id
 * @property {string} risk_type
 * @property {string} version
 * @property {Object} metrics e.g. {pr_auc, baseline_pr_auc, precision, recall, n_wells}
 * @property {Object|null} [params]
 * @property {string|null} [artifact_path]
 * @property {boolean} is_active
 * @property {string} [created_at]
 */

/**
 * POST /api/documents/upload-url response (contract 9.2). Request: {filename, size_bytes, mime_type}.
 * @typedef {Object} UploadUrlResponse
 * @property {string} upload_id
 * @property {string} storage_path
 * @property {string} signed_url
 * @property {string} token
 */

/**
 * POST /api/documents response (contract 9.2): 202 when new, 200 when duplicate.
 * Request: {storage_path, filename, well_id, wellbore_id, doc_type, provenance}.
 * @typedef {Object} RegisterDocumentResponse
 * @property {string} document_id
 * @property {string|null} job_id
 * @property {boolean} duplicate
 */

/**
 * One item of POST /api/search results (contract 9.2).
 * Request: {q, filters: {formation, event_type, field, md_from, md_to}, limit}.
 * @typedef {Object} SearchResult
 * @property {string} chunk_id
 * @property {string} doc_id
 * @property {string} doc_title
 * @property {number} page
 * @property {string} snippet
 * @property {string|null} [well_name]
 * @property {string|null} [formation]
 * @property {number} score
 */

/**
 * POST /api/search response.
 * @typedef {Object} SearchResponse
 * @property {SearchResult[]} results
 */

/**
 * One citation of POST /api/ask (contract 9.2).
 * @typedef {Object} AskCitation
 * @property {number} n
 * @property {string} chunk_id
 * @property {string} doc_id
 * @property {string} doc_title
 * @property {number} page
 * @property {string} snippet
 */

/**
 * POST /api/ask response. Request: {question, filters, wellbore_id}.
 * @typedef {Object} AskResponse
 * @property {string} answer_md
 * @property {'sufficient'|'insufficient'} evidence
 * @property {AskCitation[]} citations
 * @property {string} provider
 * @property {string} model
 * @property {boolean} cached
 */

/**
 * One item of POST /api/wells/{id}/predict-tops (contract 9.2). Request: {radius_m}.
 * @typedef {Object} PredictedTop
 * @property {string} formation
 * @property {number} top_md_m
 * @property {number} top_tvdss_m
 * @property {number} uncertainty_m
 * @property {number} n_offsets
 */

/**
 * POST /api/wells/{id}/predict-tops response.
 * @typedef {Object} PredictTopsResponse
 * @property {PredictedTop[]} tops
 */

/**
 * POST /api/wells/{id}/risk response (contract 9.2). Request: {md_from_m, md_to_m} (optional).
 * @typedef {Object} RiskResponse
 * @property {RiskScore[]} scores
 */

/**
 * One well of the correlation response (contract 9.3).
 * @typedef {Object} CorrelationWell
 * @property {string} wellbore_id
 * @property {string} name
 * @property {boolean} is_active
 * @property {number} shift_m added to every MD so the flatten-formation tops line up with the active well
 * @property {Array<{formation: string, top_md_m: number, source: string, uncertainty_m: number|null}>} tops
 * @property {Array<{casing_od_in: number, shoe_md_m: number}>} casing
 * @property {Array<{id: string, event_type: string, md_from_m: number, severity: number|null, description: string}>} events
 * @property {Object<string, number[]>} tracks md_m plus channel arrays (gr_api, rop_m_h, mw_sg, ecd_sg, ...)
 */

/**
 * GET /api/wells/{id}/correlation response (contract 9.3).
 * @typedef {Object} CorrelationResponse
 * @property {string} flatten_formation
 * @property {CorrelationWell[]} wells
 */

/**
 * POST /api/planning/brief response (contract 9.4). Request: {lat, lon, planned_td_m, radius_m}.
 * @typedef {Object} PlanningBrief
 * @property {{lat: number, lon: number}} location
 * @property {Array<{wellbore_id: string, well_name: string, surface_distance_m: number}>} offsets
 * @property {Array<{formation: string, top_md_m: number, uncertainty_m: number, n_offsets: number}>} predicted_tops
 * @property {Array<{md_from_m: number, md_to_m: number, risk_type: string, fused: number, band: string, confidence: string}>} risk_profile
 * @property {Array<{id: string, formation: string, event_type: string, title: string, mitigation: string, well_count: number}>} lessons
 */

/**
 * Error body of every /api route (contract 4).
 * @typedef {Object} ApiErrorBody
 * @property {{code: string, message: string, details: Object}} error
 */
