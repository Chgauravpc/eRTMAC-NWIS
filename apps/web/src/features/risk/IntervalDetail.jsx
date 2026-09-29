import React from 'react';
import { Link } from 'react-router-dom';
import { RISK_LABELS } from '../../lib/constants';
import { bandFor } from '../../lib/risk';
import { fmtDistance } from '../../lib/units';
import { useIntervalEvents, useLessons } from '../../lib/hooks/risk';
import { useWellNames } from '../../lib/hooks/alerts';
import { BandBadge, ConfidenceChip } from './BandBadge';
import { sourceHref } from '../alerts/sourceLink';

const LAYERS = [
  { key: 'l1', name: 'L1 offset wells' },
  { key: 'l2', name: 'L2 ML model' },
  { key: 'l3', name: 'L3 live detectors' },
];

const human = (s) => String(s || '').replace(/_/g, ' ');

function LayerBar({ name, value }) {
  const pct = value == null ? null : Math.round(value * 100);
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-40 shrink-0 text-gray-800">{name}</span>
      {pct == null ? (
        <span className="italic text-gray-700">not available</span>
      ) : (
        <>
          <div role="img" aria-label={`${name}: ${pct}%`} className="h-3 flex-1 rounded bg-gray-200">
            <div className="h-3 rounded bg-gray-800" style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
          </div>
          <span className="w-12 text-right font-mono tabular-nums">{pct}%</span>
        </>
      )}
    </div>
  );
}

/** Offset events behind L1: embedded reason fields win, missing ones are filled from the events lookup. */
export function buildOffsetEvents(score, events, distances, wellNames) {
  const byId = Object.fromEntries((events || []).map((e) => [e.id, e]));
  return (score?.reasons || [])
    .filter((r) => r.kind === 'offset_event')
    .map((r) => {
      const ev = byId[r.event_id] || {};
      const wellboreId = r.wellbore_id ?? ev.wellbore_id;
      return {
        key: r.event_id || `${wellboreId}-${r.event_type}`,
        well: r.well_name ?? wellNames?.[wellboreId] ?? ev.well_name ?? null,
        distance_m: r.depth_distance_m ?? distances?.[wellboreId] ?? ev.depth_distance_m ?? null,
        event_type: r.event_type ?? ev.event_type ?? null,
        npt_h: r.npt_h ?? ev.npt_h ?? null,
        doc_id: r.doc_id ?? ev.doc_id ?? null,
        page: r.page ?? ev.page ?? null,
      };
    });
}

export function IntervalDetail({ score }) {
  const wellNames = useWellNames();
  const { events, distances } = useIntervalEvents(score);
  const lessonsQ = useLessons(score ? [score.formation] : [], score?.risk_type ?? null, 3);

  if (!score) {
    return (
      <div className="rounded-lg border border-dashed border-gray-400 p-8 text-center text-gray-700">
        Select a cell in the strip to see why it scores what it does.
      </div>
    );
  }

  const band = bandFor(score.fused);
  const reasons = score.reasons || [];
  const shap = reasons.filter((r) => r.kind === 'shap');
  const offsetEvents = buildOffsetEvents(score, events, distances, wellNames);
  const lessons = lessonsQ.data || [];

  return (
    <section aria-label="Interval detail" className="rounded-lg border border-gray-300 bg-white p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold">{RISK_LABELS[score.risk_type] || human(score.risk_type)}</h3>
          <p className="text-sm text-gray-800">
            {score.md_from_m}–{score.md_to_m} m{score.formation ? ` · ${score.formation}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BandBadge band={band} score={score.fused} />
          <ConfidenceChip level={score.confidence} reason={score.confidence_reason} />
        </div>
      </div>
      {score.confidence_reason && (
        <p className="mb-4 text-sm text-gray-800">
          <strong>Confidence:</strong> {score.confidence_reason}
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h4 className="mb-2 border-b pb-1 text-sm font-bold">Layer contributions</h4>
          <div className="space-y-2">
            {LAYERS.map((l) => (
              <LayerBar key={l.key} name={l.name} value={score[l.key]} />
            ))}
          </div>
        </div>

        <div>
          <h4 className="mb-2 border-b pb-1 text-sm font-bold">ML model reasons (SHAP)</h4>
          {shap.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {shap.map((r, i) => (
                <li key={`${r.feature}-${i}`} className="flex justify-between gap-3">
                  <span>{human(r.feature)}</span>
                  <span className="font-mono tabular-nums">{Number(r.value).toFixed(2)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm italic text-gray-700">No model reasons for this interval.</p>
          )}
        </div>
      </div>

      <div className="mt-6">
        <h4 className="mb-2 border-b pb-1 text-sm font-bold">Offset events behind L1</h4>
        {offsetEvents.length > 0 ? (
          <ul className="grid gap-2 md:grid-cols-2">
            {offsetEvents.map((e) => (
              <li key={e.key} className="rounded border border-gray-300 p-3 text-sm">
                <div className="font-semibold">{e.well ?? 'Offset well'}</div>
                <div>
                  {human(e.event_type) || 'Event'} · NPT {e.npt_h != null ? `${e.npt_h} h` : 'n/a'} · {e.distance_m != null ? `${fmtDistance(e.distance_m)} away` : 'distance n/a'}
                </div>
                {e.doc_id && (
                  <Link className="mt-1 inline-block font-medium text-blue-800 underline" to={sourceHref(e.doc_id, e.page)}>
                    Source, page {e.page ?? '?'}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm italic text-gray-700">No offset events support this score (offsets did not drill this interval).</p>
        )}
      </div>

      <div className="mt-6">
        <h4 className="mb-2 border-b pb-1 text-sm font-bold">Recommended lessons</h4>
        {lessons.length > 0 ? (
          <ul className="space-y-2">
            {lessons.map((l) => (
              <li key={l.id} className="rounded border border-gray-300 p-3 text-sm">
                <div className="font-semibold">{l.title}</div>
                <div>{l.mitigation}</div>
                <div className="mt-1 text-gray-800">
                  Success {l.success_rate != null ? `${Math.round(l.success_rate * 100)}%` : 'n/a'} · {l.well_count} {l.well_count === 1 ? 'well' : 'wells'}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm italic text-gray-700">No lessons recorded for this formation and risk type.</p>
        )}
      </div>
    </section>
  );
}
