import React from 'react';
import { Check, Circle, ShieldAlert } from 'lucide-react';
import { format } from 'date-fns';
import { RISK_LABELS } from '../../lib/constants';
import { bandFor } from '../../lib/risk';
import { fmtDepth } from '../../lib/units';
import { useMarkViewedOnOpen, useMyAlertView, useWellNames } from '../../lib/hooks/alerts';
import { BandBadge, ConfidenceChip, SeverityBadge } from '../risk/BandBadge';
import { EvidencePanel } from './EvidencePanel';
import { AlertActions } from './AlertActions';
import { FeedbackBar } from './FeedbackBar';

const STATE_ORDER = ['generated', 'sent', 'viewed', 'escalated', 'acknowledged', 'resolved', 'feedback'];
const stamp = (iso) => (iso ? format(new Date(iso), 'dd MMM HH:mm:ss') : '');

function whoText(id, user) {
  if (!id) return '';
  return id === user?.id ? 'you' : 'another user';
}

/** Timeline steps (contract §12 lifecycle) with timestamps and who did it. */
export function buildTimeline(alert, user, myView) {
  const idx = STATE_ORDER.indexOf(alert.state);
  const steps = [
    { key: 'generated', label: 'Generated', time: alert.created_at, done: true },
    { key: 'sent', label: 'Sent', time: alert.sent_at, done: !!alert.sent_at || idx >= 1 },
    { key: 'viewed', label: 'Viewed', time: myView?.viewed_at, who: myView ? 'you' : '', done: !!myView || idx >= 2 },
  ];
  if (alert.escalated_at || alert.state === 'escalated') {
    steps.push({ key: 'escalated', label: 'Escalated', time: alert.escalated_at, who: 'system', done: true });
  }
  steps.push({
    key: 'acknowledged',
    label: 'Acknowledged',
    time: alert.acknowledged_at,
    who: whoText(alert.acknowledged_by, user),
    detail: alert.action_note || '',
    done: !!alert.acknowledged_at || idx >= 4,
  });
  const how = alert.resolved_how === 'auto' ? 'system (auto)' : whoText(alert.resolved_by, user);
  const outcome = alert.outcome ? String(alert.outcome).replace(/_/g, ' ') : '';
  steps.push({
    key: 'resolved',
    label: alert.resolved_how === 'dismissed' ? 'Dismissed' : 'Resolved',
    time: alert.resolved_at,
    who: how,
    detail: [outcome, alert.dismiss_reason].filter(Boolean).join(' · '),
    done: !!alert.resolved_at || idx >= 5,
  });
  steps.push({
    key: 'feedback',
    label: 'Feedback',
    time: alert.feedback_at,
    who: whoText(alert.feedback_by, user),
    detail: alert.useful == null ? '' : alert.useful ? 'useful' : 'not useful',
    done: !!alert.feedback_at || idx >= 6,
  });
  return steps;
}

function Timeline({ alert, user }) {
  const { data: myView } = useMyAlertView(alert.id);
  const steps = buildTimeline(alert, user, myView);
  return (
    <ol aria-label="Alert timeline" className="mb-5 flex flex-wrap gap-2 text-sm">
      {steps.map((s) => (
        <li
          key={s.key}
          data-step={s.key}
          data-done={s.done ? 'true' : 'false'}
          className={`flex items-start gap-1.5 rounded border px-2 py-1 ${s.done ? 'border-gray-700 bg-white text-gray-900' : 'border-dashed border-gray-500 text-gray-700'}`}
        >
          {s.done ? <Check size={14} aria-hidden="true" className="mt-0.5" /> : <Circle size={14} aria-hidden="true" className="mt-0.5" />}
          <span>
            <strong>{s.label}</strong>
            {s.time ? ` ${stamp(s.time)}` : ''}
            {s.who ? ` by ${s.who}` : ''}
            {s.detail ? ` (${s.detail})` : ''}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * One alert: severity + band, confidence, score, risk type, zone, expected depth, formation, time,
 * state timeline, message, recommendation, evidence and the lifecycle actions.
 * Opening the card records a view once per user (mark_alert_viewed) whatever the state.
 */
export function AlertCard({ alert, user, large = false }) {
  useMarkViewedOnOpen(alert.id, user?.id);
  const wellNames = useWellNames();
  const isSystem = alert.kind === 'system';
  const band = alert.score != null ? bandFor(alert.score) : null;
  const well = wellNames[alert.wellbore_id] ?? alert.well_name ?? null;

  return (
    <article
      aria-label={`Alert: ${alert.title}`}
      data-alert-id={alert.id}
      data-state={alert.state}
      className={`relative rounded-xl border-2 bg-white p-5 text-gray-900 shadow-sm ${isSystem ? 'border-gray-900' : 'border-gray-400'} ${large ? 'text-lg' : ''}`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {isSystem && (
          <span className="inline-flex items-center gap-1 rounded bg-gray-900 px-2 py-0.5 text-xs font-bold uppercase text-white">
            <ShieldAlert size={14} aria-hidden="true" /> System
          </span>
        )}
        <SeverityBadge severity={alert.severity} kind={alert.kind} />
        {band && <BandBadge band={band} score={alert.score} />}
        {!isSystem && <ConfidenceChip level={alert.confidence} reason={alert.evidence?.confidence_reason} />}
        {alert.state === 'escalated' && (
          <span className="rounded border-2 border-red-800 bg-red-50 px-2 py-0.5 text-xs font-bold uppercase text-red-900">
            Escalated to RTOC lead
          </span>
        )}
      </div>

      <h2 className="mb-2 text-2xl font-black">{alert.title}</h2>

      <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-3">
        <div>
          <dt className="inline font-semibold">Well: </dt>
          <dd className="inline">{well ?? 'Unknown well'}</dd>
        </div>
        {alert.risk_type && (
          <div>
            <dt className="inline font-semibold">Risk: </dt>
            <dd className="inline">{RISK_LABELS[alert.risk_type] ?? alert.risk_type}</dd>
          </div>
        )}
        {alert.score != null && (
          <div>
            <dt className="inline font-semibold">Score: </dt>
            <dd className="inline">{Math.round(alert.score)} / 100</dd>
          </div>
        )}
        {alert.zone_md_from_m != null && (
          <div>
            <dt className="inline font-semibold">Zone: </dt>
            <dd className="inline">
              {alert.zone_md_from_m}–{alert.zone_md_to_m} m
            </dd>
          </div>
        )}
        {alert.expected_md_m != null && (
          <div>
            <dt className="inline font-semibold">Expected depth: </dt>
            <dd className="inline">{fmtDepth(alert.expected_md_m)}</dd>
          </div>
        )}
        {alert.formation && (
          <div>
            <dt className="inline font-semibold">Formation: </dt>
            <dd className="inline">{alert.formation}</dd>
          </div>
        )}
        <div>
          <dt className="inline font-semibold">Raised: </dt>
          <dd className="inline">{stamp(alert.created_at)}</dd>
        </div>
      </dl>

      <div className="mb-4 rounded-lg border border-gray-400 bg-gray-50 p-4">
        <p className="font-medium">{alert.message}</p>
        {alert.recommendation && (
          <p className="mt-3 rounded border border-blue-800 bg-blue-50 p-3 text-blue-950">
            <strong className="block text-xs uppercase tracking-wide">Recommendation</strong>
            {alert.recommendation}
          </p>
        )}
      </div>

      <Timeline alert={alert} user={user} />

      {!isSystem && <EvidencePanel alert={alert} />}

      <AlertActions alert={alert} user={user} />
      <FeedbackBar alert={alert} user={user} />
    </article>
  );
}

export default AlertCard;
