// Reason codes written by the backend (contract §6 extracted_fields.reason, §10 validation rules, BE-08 well matching)
// mapped to plain language for reviewers.
export const REASON_TEXT = Object.freeze({
  low_ocr_confidence: 'Scan was hard to read',
  low_confidence: 'The extraction model was not sure about this value',
  unknown_formation: 'Formation name not recognised',
  snippet_not_found: "Couldn't find this text on the page",
  unmatched_well: "Couldn't match this report to a known well",
  'failed_rule:depth_gt_td': "Depth is deeper than the well's TD",
  'failed_rule:depth_negative': 'Depth cannot be negative',
  'failed_rule:formation_order': 'Formation is out of the expected order',
  'failed_rule:date_out_of_range': 'Date is before 1950 or in the future',
  'failed_rule:mw_out_of_range': 'Mud weight is outside 0.8 to 2.4 SG',
});

/** Fallback for codes not in the map: "failed_rule:some_rule" -> "Failed check: some rule". */
function humanize(code) {
  const c = code.trim();
  if (c.startsWith('failed_rule:')) return `Failed check: ${c.slice('failed_rule:'.length).replace(/_/g, ' ')}`;
  const s = c.replace(/[_:]+/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** One reason string can hold several codes ("a;b" or "a, b"). Returns plain-language sentences. */
export function reasonTexts(reason) {
  if (!reason) return [];
  return String(reason)
    .split(/[;,|]/)
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => REASON_TEXT[c] || humanize(c));
}
