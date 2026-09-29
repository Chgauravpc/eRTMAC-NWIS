import { severityRank } from '../../lib/risk';
import { UNACKED_STATES } from './sound';

export { UNACKED_STATES };
export const LOUD_SEVERITIES = Object.freeze(['warning', 'critical']);

export const isUnacked = (a) => !!a && UNACKED_STATES.includes(a.state);
export const isLoud = (a) => !!a && LOUD_SEVERITIES.includes(a.severity);
/** Unacknowledged warning/critical: pinned on top of the RTOC page, shown in the banner. */
export const isPinned = (a) => isUnacked(a) && isLoud(a);

/** Metres between the bit and where the alert expects trouble (null when unknown or a system alert). */
export function aheadMeters(alert, bitMd) {
  if (!alert || alert.kind === 'system') return null;
  const md = alert.expected_md_m ?? alert.zone_md_from_m;
  if (md == null || bitMd == null) return null;
  return Math.max(0, Math.round(md - bitMd));
}

/** "~55 m ahead", "at the bit", or "at 2460 m" when the bit depth is unknown. */
export function depthPhrase(alert, bitMd) {
  if (!alert || alert.kind === 'system') return '';
  const ahead = aheadMeters(alert, bitMd);
  if (ahead != null) return ahead === 0 ? 'at the bit' : `~${ahead} m ahead`;
  const md = alert.expected_md_m ?? alert.zone_md_from_m;
  return md != null ? `at ${Math.round(md)} m` : '';
}

/** Severity first (critical on top), then the oldest first so overdue alerts stay visible. */
export function compareBySeverityThenAge(a, b) {
  return severityRank(b.severity) - severityRank(a.severity) || Date.parse(a.created_at) - Date.parse(b.created_at);
}

/** Age as "mm:ss" under an hour, otherwise "Hh MMm". */
export function fmtAge(fromIso, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - Date.parse(fromIso)) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h >= 1) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Text for a browser notification: well name + depth (contract: never an id). */
export function notificationBody(alert, wellName, bitMd) {
  const phrase = depthPhrase(alert, bitMd);
  const md = alert.expected_md_m ?? alert.zone_md_from_m;
  const parts = [wellName || 'Unknown well'];
  if (phrase) parts.push(phrase);
  if (md != null && alert.kind !== 'system') parts.push(`${Math.round(md)} m MD`);
  return parts.join(' · ');
}

/**
 * Should this Realtime change raise a banner / sound / notification?
 * New warning|critical alerts, or re-notified ones (sent_at changed, or freshly escalated).
 * `notified` maps alert id -> the sent_at we already notified for.
 */
export function shouldNotify(prev, next, notified) {
  if (!next || !isLoud(next) || !isUnacked(next)) return false;
  if (!prev) return !notified.has(next.id);
  if (prev.sent_at && next.sent_at && prev.sent_at !== next.sent_at) return true;
  if (!prev.sent_at && next.sent_at) return !notified.has(next.id);
  if (next.escalated_at && next.escalated_at !== prev.escalated_at) return true;
  return false;
}
