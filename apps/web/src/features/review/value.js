// extracted_fields.value is jsonb: {"raw":"15 bbl/hr","value":2.38,"unit":"m3/h"}, a bare scalar, or null.
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Splits any stored value into { raw, value, unit }; every part may be null. */
export function parseFieldValue(v) {
  if (v === null || v === undefined) return { raw: null, value: null, unit: null };
  if (isObj(v)) {
    return {
      raw: v.raw ?? null,
      value: v.value ?? null,
      unit: v.unit ?? null,
    };
  }
  if (Array.isArray(v)) return { raw: null, value: JSON.stringify(v), unit: null };
  return { raw: null, value: v, unit: null };
}

const show = (x) => (typeof x === 'object' ? JSON.stringify(x) : String(x));

/**
 * Text shown to the reviewer: "15 bbl/hr → 2.38 m3/h" (raw then SI), just the value when there is no raw text,
 * just the raw text when the backend could not parse it, or null when nothing was extracted.
 */
export function formatFieldValue(v) {
  const { raw, value, unit } = parseFieldValue(v);
  const si = value === null ? null : `${show(value)}${unit ? ` ${unit}` : ''}`;
  if (raw !== null && si !== null && String(raw).trim() !== show(value)) return `${show(raw)} → ${si}`;
  if (si !== null) return si;
  if (raw !== null) return show(raw);
  return null;
}
