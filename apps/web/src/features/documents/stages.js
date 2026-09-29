// Maps jobs.stage (contract §6: 'classify'|'ocr'|'extract'|'validate'|'index'|'done') to the five PRD stage names.
export const JOB_STAGES = Object.freeze([
  { key: 'classify', label: 'Classify' },
  { key: 'ocr', label: 'Read/OCR' },
  { key: 'extract', label: 'Extract' },
  { key: 'validate', label: 'Validate' },
  { key: 'index', label: 'Index' },
]);

const ALIASES = { read: 'ocr', parse: 'ocr', 'read/ocr': 'ocr', indexing: 'index' };

/** Index (0..4) of the stage currently running, -1 when not started, 5 when all finished. */
export function stageIndex(job) {
  if (!job) return -1;
  if (job.status === 'done' || job.status === 'needs_review' || job.stage === 'done') return JOB_STAGES.length;
  if (job.status === 'queued' && !job.stage) return -1;
  const key = ALIASES[String(job.stage || '').toLowerCase()] || String(job.stage || '').toLowerCase();
  return JOB_STAGES.findIndex((s) => s.key === key);
}

export function stageLabel(job) {
  if (!job || job.status === 'queued') return 'Queued';
  const i = stageIndex(job);
  if (i >= JOB_STAGES.length) return 'Finished';
  return i >= 0 ? JOB_STAGES[i].label : 'Processing';
}

export const JOB_STATUS_LABELS = Object.freeze({
  queued: 'Queued',
  running: 'Running',
  needs_review: 'Needs review',
  done: 'Done',
  failed: 'Failed',
});
