import React from 'react';
import { Link } from 'react-router-dom';
import { fmtDistance } from '../../lib/units';
import { sourceHref } from './sourceLink';

const human = (s) => String(s || '').replace(/_/g, ' ');
const LAYERS = [
  ['l1', 'L1 offset wells'],
  ['l2', 'L2 ML model'],
  ['l3', 'L3 live detectors'],
];

function Section({ title, children }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-800">{title}</h4>
      {children}
    </div>
  );
}

/** Renders the alert `evidence` JSON of contract §11.6: offsets, lessons, SHAP, detector, layers, sources. */
export function EvidencePanel({ alert }) {
  const ev = alert.evidence || {};
  const offsets = ev.offsets || [];
  const lessons = ev.lessons || [];
  const shap = ev.shap || [];
  const sources = ev.sources || [];
  const layers = ev.layers || null;
  const detector = ev.detector || null;
  const hasAny = offsets.length || lessons.length || shap.length || sources.length || layers || detector;

  if (!hasAny) {
    return (
      <section aria-label="Evidence" className="mb-4 rounded border border-dashed border-gray-500 p-3 text-sm italic text-gray-800">
        No evidence was recorded for this alert.
      </section>
    );
  }

  return (
    <section aria-label="Evidence" className="mb-4 rounded-lg border border-gray-400 bg-gray-50 p-4 text-sm">
      <h3 className="mb-3 border-b border-gray-400 pb-1 text-base font-bold">Evidence</h3>
      <div className="grid gap-5 md:grid-cols-2">
        <Section title="Layer contributions">
          <ul className="space-y-1">
            {LAYERS.map(([key, name]) => (
              <li key={key} className="flex justify-between gap-3">
                <span>{name}</span>
                <span className="font-mono tabular-nums">{layers?.[key] != null ? `${(layers[key] * 100).toFixed(0)}%` : 'not available'}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Model reasons (SHAP)">
          {shap.length > 0 ? (
            <ul className="space-y-1">
              {shap.map((s, i) => (
                <li key={`${s.feature}-${i}`} className="flex justify-between gap-3">
                  <span>{human(s.feature)}</span>
                  <span className="font-mono tabular-nums">{Number(s.value).toFixed(2)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="italic">None recorded.</p>
          )}
        </Section>

        {detector && (
          <Section title="Live detector signal">
            <p className="font-semibold">{human(detector.name)}</p>
            <ul>
              {Object.entries(detector.signal || {}).map(([k, v]) => (
                <li key={k} className="flex justify-between gap-3">
                  <span>{human(k)}</span>
                  <span className="font-mono tabular-nums">{typeof v === 'number' ? v : String(v)}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Offset wells">
          {offsets.length > 0 ? (
            <ul className="space-y-2">
              {offsets.map((o) => (
                <li key={o.wellbore_id} className="rounded border border-gray-400 bg-white p-2">
                  <div className="font-semibold">
                    {o.well_name || 'Offset well'} <span className="font-normal">· {o.depth_distance_m != null ? `${fmtDistance(o.depth_distance_m)} away (depth)` : 'distance n/a'}</span>
                  </div>
                  <ul className="mt-1 space-y-1">
                    {(o.events || []).map((e) => (
                      <li key={e.id}>
                        {human(e.event_type)} at {e.md_from_m} m · NPT {e.npt_h != null ? `${e.npt_h} h` : 'n/a'}
                        {e.doc_id && (
                          <>
                            {' · '}
                            <Link className="font-medium text-blue-800 underline" to={sourceHref(e.doc_id, e.page)}>
                              source p.{e.page ?? '?'}
                            </Link>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <p className="italic">No offset events.</p>
          )}
        </Section>

        <Section title="Recommended lessons">
          {lessons.length > 0 ? (
            <ul className="space-y-2">
              {lessons.map((l) => (
                <li key={l.id} className="rounded border border-gray-400 bg-white p-2">
                  <div className="font-semibold">{l.title}</div>
                  <div>{l.mitigation}</div>
                  <div className="mt-1 text-gray-800">Success rate {l.success_rate != null ? `${Math.round(l.success_rate * 100)}%` : 'n/a'}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="italic">No lessons attached.</p>
          )}
        </Section>

        <Section title="Sources">
          {sources.length > 0 ? (
            <ul className="space-y-1">
              {sources.map((s) => (
                <li key={`${s.doc_id}-${s.page}`}>
                  <Link className="font-medium text-blue-800 underline" to={sourceHref(s.doc_id, s.page)}>
                    {s.doc_title || 'Document'}, page {s.page ?? '?'}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="italic">No sources listed.</p>
          )}
        </Section>
      </div>
    </section>
  );
}
