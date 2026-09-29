/**
 * Contract §5 Enums
 */
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
  losses: "Mud losses",
  stuck_pipe: "Stuck pipe",
  kick: "Kick / overpressure",
  torque: "Torque spike",
  cementing: "Cementing issue",
});

/**
 * @typedef {Object} Profile
 * @property {string} id
 * @property {string} email
 * @property {string} full_name
 * @property {string} role
 * @property {string[]} assigned_wellbore_ids
 */

/**
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
 * @typedef {Object} Alert
 * @property {string} id
 * @property {string} wellbore_id
 * @property {string} kind
 * @property {string} [risk_type]
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
 * @property {Object} evidence
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
 */
