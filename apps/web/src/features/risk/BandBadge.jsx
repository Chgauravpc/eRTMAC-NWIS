import React from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, Eye, Info, ShieldAlert } from 'lucide-react';
import { BAND_META, SEVERITY_META, bandFor } from '../../lib/risk';

// Static class names so Tailwind can see them.
const RIG_BORDER = {
  low: 'border-risk-low',
  moderate: 'border-risk-moderate',
  elevated: 'border-risk-elevated',
  high: 'border-risk-high',
  critical: 'border-risk-critical',
};

const ICONS = { check: CheckCircle2, info: Info, eye: Eye, alert: AlertTriangle, octagon: AlertOctagon };

export function BandIcon({ band, size = 16, className = '' }) {
  const Icon = ICONS[BAND_META[band]?.icon] || Info;
  return <Icon size={size} aria-hidden="true" className={className} />;
}

/**
 * Band = colour + icon + WORD (colour is never the only signal). `variant="rig"` keeps the text in the
 * theme foreground (>= 7:1 on the dark rig background) and carries the colour on the border only.
 */
export function BandBadge({ band, score = null, variant = 'light', className = '' }) {
  const meta = BAND_META[band];
  if (!meta) return null;
  const tone = variant === 'rig' ? `border-2 ${RIG_BORDER[band]} text-white bg-black` : `border ${meta.color}`;
  return (
    <span
      data-band={band}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 ${variant === 'rig' ? 'text-lg' : 'text-sm'} font-semibold ${tone} ${className}`}
    >
      <BandIcon band={band} />
      {score != null && <span className="tabular-nums">{Math.round(score)}</span>}
      <span>{meta.label}</span>
    </span>
  );
}

const SEVERITY_TONE = {
  info: 'bg-sky-100 text-sky-900 border-sky-600',
  watch: 'bg-amber-100 text-amber-900 border-amber-500',
  warning: 'bg-orange-100 text-orange-900 border-orange-600',
  critical: 'bg-red-100 text-red-900 border-red-600',
};

export function SeverityBadge({ severity, kind, large = false, className = '' }) {
  const meta = SEVERITY_META[severity];
  if (!meta) return null;
  const Icon = kind === 'system' ? ShieldAlert : ICONS[BAND_META[meta.band].icon];
  return (
    <span
      data-severity={severity}
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 ${large ? 'text-lg' : 'text-xs'} font-bold uppercase tracking-wide ${SEVERITY_TONE[severity]} ${className}`}
    >
      <Icon size={14} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

export function bandOfAlert(alert) {
  return alert?.score != null ? bandFor(alert.score) : null;
}

const CONFIDENCE_HELP = {
  high: 'High: at least 3 supporting offset wells and mean event confidence of 0.8 or more.',
  medium: 'Medium: at least 2 supporting offset wells, or mean event confidence of 0.6 or more.',
  low: 'Low: too few or too uncertain offset events. Low confidence caps an alert at Watch unless a live detector fired.',
};

/** High = solid, Medium = outline, Low = dashed outline + the words "Low confidence"; reason as tooltip. */
export function ConfidenceChip({ level, reason, variant = 'light', className = '' }) {
  if (!level) return null;
  const label = level === 'low' ? 'Low confidence' : `${level.charAt(0).toUpperCase()}${level.slice(1)} confidence`;
  const rig = variant === 'rig';
  const line = rig ? 'border-white text-white' : 'border-gray-700 text-gray-900';
  const tone =
    level === 'high'
      ? rig
        ? 'bg-white text-black border border-white'
        : 'bg-gray-900 text-white border border-gray-900'
      : level === 'medium'
        ? `border bg-transparent ${line}`
        : `border border-dashed bg-transparent ${line}`;
  const tip = [reason, CONFIDENCE_HELP[level]].filter(Boolean).join(' ');
  return (
    <span
      data-confidence={level}
      title={tip}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 ${rig ? 'text-lg' : 'text-xs'} font-semibold ${tone} ${className}`}
    >
      {label}
    </span>
  );
}
