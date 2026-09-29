import React, { useEffect, useRef, useState } from 'react';
import { EVENT_TYPES } from '../../lib/constants';
import { useFormations } from '../../lib/hooks/review';
import { parseFieldValue } from './value';

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white p-2.5 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

const EVENT_LABEL = (t) => t.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Which input a field gets: formation/event_type selects, otherwise typed by the current value / field name. */
export function editorKind(field) {
  const name = field.field;
  const current = parseFieldValue(field.value).value;
  if (name === 'formation') return 'formation';
  if (name === 'event_type') return 'event_type';
  if (typeof current === 'boolean') return 'boolean';
  if (typeof current === 'number' || /(_m|_h|_sg|_in|_deg|_m3|_ppf|_cp|_api|_m_h|severity|confidence)$/.test(name)) return 'number';
  if (/(^|_)date$/.test(name) || (typeof current === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(current))) return 'date';
  return 'text';
}

function initialDraft(field, kind) {
  const { value, raw } = parseFieldValue(field.value);
  const useRaw = kind === 'text' || kind === 'date';
  const v = value ?? (useRaw ? raw ?? '' : '');
  return kind === 'boolean' ? String(!!value) : v === null ? '' : String(v);
}

/** Returns { ok, value } or { ok:false, error } for the draft text. */
export function parseDraft(kind, draft) {
  const t = String(draft).trim();
  if (kind === 'boolean') return { ok: true, value: t === 'true' };
  if (t === '') return { ok: false, error: 'Enter a value, or use Reject to discard this field.' };
  if (kind === 'number') {
    const n = Number(t);
    return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: 'Enter a number.' };
  }
  return { ok: true, value: t };
}

/** Builds the p_value jsonb for review_field: keeps {raw, unit} when the stored value is an object. */
export function buildEditPayload(field, typed) {
  const cur = field.value;
  if (cur !== null && typeof cur === 'object' && !Array.isArray(cur)) return { ...cur, value: typed };
  return typed;
}

export function FieldEditor({ field, onSave, onCancel, busy = false }) {
  const kind = editorKind(field);
  const [draft, setDraft] = useState(() => initialDraft(field, kind));
  const [error, setError] = useState(null);
  const { data: formations, isLoading: formationsLoading, error: formationsError } = useFormations();
  const ref = useRef(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const submit = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const parsed = parseDraft(kind, draft);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    onSave(buildEditPayload(field, parsed.value));
  };

  const common = {
    ref,
    id: `edit-${field.id}`,
    value: draft,
    onChange: (e) => setDraft(e.target.value),
    className: inputClass,
    'aria-invalid': error ? 'true' : undefined,
    'aria-describedby': error ? `edit-err-${field.id}` : undefined,
    disabled: busy,
  };

  let control;
  if (kind === 'formation') {
    const names = (formations || []).map((f) => f.name);
    control = (
      <select {...common}>
        <option value="">{formationsLoading ? 'Loading formations…' : 'Select formation…'}</option>
        {names.map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
        {draft && !names.includes(draft) && <option value={draft}>{draft}</option>}
      </select>
    );
  } else if (kind === 'event_type') {
    control = (
      <select {...common}>
        <option value="">Select event type…</option>
        {EVENT_TYPES.map((t) => (
          <option key={t} value={t}>{EVENT_LABEL(t)}</option>
        ))}
      </select>
    );
  } else if (kind === 'boolean') {
    control = (
      <select {...common}>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  } else {
    control = <input {...common} type={kind === 'number' ? 'number' : kind === 'date' ? 'date' : 'text'} step={kind === 'number' ? 'any' : undefined} />;
  }

  return (
    <form
      onSubmit={submit}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // browsers only submit on Enter from text inputs, so selects are handled here
        if (e.key === 'Enter' && e.target.tagName === 'SELECT') {
          submit(e);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
      className="flex flex-col gap-3 rounded-lg border border-blue-200 bg-gray-50 p-4"
      aria-label={`Edit ${field.field}`}
    >
      <label htmlFor={common.id} className="text-xs font-bold uppercase tracking-wider text-blue-800">
        New value for {field.field}
      </label>
      {control}
      {formationsError && kind === 'formation' && (
        <p className="text-xs text-red-600">Could not load the formation list: {formationsError.message}</p>
      )}
      {error && (
        <p id={`edit-err-${field.id}`} role="alert" className="text-sm font-medium text-red-600">{error}</p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          Cancel (Esc)
        </button>
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 disabled:opacity-60"
        >
          Save (Enter)
        </button>
      </div>
    </form>
  );
}
