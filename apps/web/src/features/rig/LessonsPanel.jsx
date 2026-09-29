import React from 'react';
import { useLessons } from '../../lib/hooks/risk';

/** Top 3 lessons for the current and the next formation (title, mitigation, success rate, well count). */
export function LessonsPanel({ formation, nextFormation }) {
  const { data: lessons, isLoading, isError } = useLessons([formation, nextFormation], null, 3);

  return (
    <section aria-label="Lessons" className="rounded-lg border border-white/30 p-4">
      <h2 className="mb-3 text-xl font-bold uppercase tracking-wide">Top lessons ahead</h2>
      {isLoading ? (
        <p className="text-lg">Loading lessons…</p>
      ) : isError ? (
        <p role="alert" className="text-lg">Could not load lessons.</p>
      ) : !lessons || lessons.length === 0 ? (
        <p className="text-lg text-gray-300">No lessons recorded for the current or next formation.</p>
      ) : (
        <ul className="grid grid-cols-3 gap-3">
          {lessons.map((l) => (
            <li key={l.id} className="rounded border border-white/30 p-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-xl font-bold leading-tight">{l.title}</h3>
                <span className="shrink-0 rounded border border-white/60 px-2 text-lg">{l.formation}</span>
              </div>
              <p className="mt-2 text-lg">{l.mitigation}</p>
              <p className="mt-2 text-lg text-gray-300">
                Success {l.success_rate != null ? `${Math.round(l.success_rate * 100)}%` : 'n/a'} · {l.well_count} {l.well_count === 1 ? 'well' : 'wells'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
