import React from 'react';
import { AlertTriangle, Check, Pencil, X } from 'lucide-react';
import { FieldEditor } from './FieldEditor';
import { reasonTexts } from './reasons';
import { formatFieldValue } from './value';

const ENTITY_LABELS = {
  event: 'Event',
  formation_top: 'Formation top',
  hole_section: 'Hole section',
  cement_job: 'Cement job',
  mud_record: 'Mud record',
  survey_station: 'Survey station',
  well_header: 'Well header',
  time_log: 'Time log',
};

const STATUS_BADGE = {
  approved: { text: 'Approved', cls: 'bg-green-100 text-green-800' },
  edited: { text: 'Edited', cls: 'bg-blue-100 text-blue-800' },
  rejected: { text: 'Rejected', cls: 'bg-red-100 text-red-800' },
};

const btn =
  'flex flex-1 items-center justify-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:opacity-60';

function ConfidenceBar({ value }) {
  if (value === null || value === undefined) return null;
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const tone = value >= 0.8 ? 'bg-green-500' : value >= 0.5 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div
        role="meter"
        aria-label="Confidence"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-1.5 w-16 overflow-hidden rounded-full border border-gray-200 bg-gray-100"
      >
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-xs text-gray-600">{pct}%</span>
    </div>
  );
}

export const FieldCard = React.forwardRef(function FieldCard(
  { field, isSelected, isEditing, busy, isReadOnly, onSelect, onAction, onStartEdit, onCancelEdit },
  ref
) {
  const reasons = reasonTexts(field.reason);
  const display = formatFieldValue(field.value);
  const status = STATUS_BADGE[field.review_status];
  const entity = ENTITY_LABELS[field.entity] || field.entity;
  const label = `${entity} ${field.field}`;

  return (
    <li
      ref={ref}
      tabIndex={isSelected ? 0 : -1}
      aria-current={isSelected ? 'true' : undefined}
      aria-label={`${label}${display ? `: ${display}` : ': no value'}`}
      data-field-id={field.id}
      onClick={onSelect}
      className={`cursor-pointer rounded-xl border-2 bg-white p-5 shadow-sm transition-all focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-400 ${
        isSelected ? 'border-blue-500 ring-4 ring-blue-100' : 'border-gray-200 opacity-80 hover:border-blue-300 hover:opacity-100'
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs font-black uppercase tracking-widest">
          <span className="rounded bg-gray-100 px-2 py-1 text-gray-600">{entity}</span>
          <span className="text-blue-700">{field.field}</span>
          {status && <span className={`rounded px-2 py-1 ${status.cls}`}>{status.text}</span>}
        </div>
        <ConfidenceBar value={field.confidence} />
      </div>

      <div className="mb-3 font-mono text-xl font-bold text-gray-900">
        {display !== null ? display : <span className="text-base font-medium italic text-gray-500">No value extracted</span>}
      </div>

      {reasons.length > 0 && (
        <ul className="mb-3 space-y-1">
          {reasons.map((r) => (
            <li key={r} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs font-bold text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {r}
            </li>
          ))}
        </ul>
      )}

      {isSelected && !isReadOnly && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          {isEditing ? (
            <FieldEditor field={field} busy={busy} onSave={(v) => onAction('edit', v)} onCancel={onCancelEdit} />
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                aria-keyshortcuts="a"
                aria-label={`Approve ${label}`}
                disabled={busy}
                className={`${btn} border-green-200 bg-green-100 text-green-800 hover:bg-green-200 focus-visible:ring-green-600`}
                onClick={(e) => {
                  e.stopPropagation();
                  onAction('approve');
                }}
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" /> Approve <kbd className="font-mono">A</kbd>
              </button>
              <button
                type="button"
                aria-keyshortcuts="e"
                aria-label={`Edit ${label}`}
                disabled={busy}
                className={`${btn} border-blue-200 bg-blue-100 text-blue-800 hover:bg-blue-200 focus-visible:ring-blue-600`}
                onClick={(e) => {
                  e.stopPropagation();
                  onStartEdit();
                }}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit <kbd className="font-mono">E</kbd>
              </button>
              <button
                type="button"
                aria-keyshortcuts="r"
                aria-label={`Reject ${label}`}
                disabled={busy}
                className={`${btn} border-red-200 bg-red-100 text-red-800 hover:bg-red-200 focus-visible:ring-red-600`}
                onClick={(e) => {
                  e.stopPropagation();
                  onAction('reject');
                }}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" /> Reject <kbd className="font-mono">R</kbd>
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
});

/**
 * Fields of the current page. `cardRefs` is a Map (field id -> element) the parent uses to move focus.
 */
export function FieldList({ fields, selectedId, editingId, busy, isReadOnly, cardRefs, onSelect, onAction, onStartEdit, onCancelEdit }) {
  return (
    <ul className="space-y-4" aria-label="Extracted fields on this page">
      {fields.map((f) => (
        <FieldCard
          key={f.id}
          ref={(el) => {
            if (!cardRefs) return;
            if (el) cardRefs.set(f.id, el);
            else cardRefs.delete(f.id);
          }}
          field={f}
          isSelected={f.id === selectedId}
          isEditing={f.id === editingId}
          busy={busy}
          isReadOnly={isReadOnly}
          onSelect={() => onSelect(f.id)}
          onAction={(action, value) => onAction(f, action, value)}
          onStartEdit={() => onStartEdit(f.id)}
          onCancelEdit={onCancelEdit}
        />
      ))}
    </ul>
  );
}
