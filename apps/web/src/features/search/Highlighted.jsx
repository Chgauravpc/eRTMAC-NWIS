import React from 'react';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Words of the query worth highlighting (3+ characters, same idea as the backend's keyword rule). */
export function queryTerms(query) {
  return [...new Set(String(query || '').split(/[^A-Za-z0-9_.\-/]+/).filter((w) => w.length >= 3))];
}

/** Splits text into [{text, hit}] parts. Plain strings only: nothing here is ever parsed as HTML. */
export function splitHighlight(text, query) {
  const value = String(text ?? '');
  const terms = queryTerms(query);
  if (!value || terms.length === 0) return [{ text: value, hit: false }];
  const re = new RegExp(`(${terms.map(escapeRe).join('|')})`, 'gi');
  return value
    .split(re)
    .map((part, i) => ({ text: part, hit: i % 2 === 1 }))
    .filter((p) => p.text !== '');
}

/** Text with the query words marked. Document text is untrusted (OCR / LLM output), so it is rendered as text. */
export function Highlighted({ text, query }) {
  return (
    <>
      {splitHighlight(text, query).map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded bg-yellow-200 px-0.5 text-slate-900">
            {p.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{p.text}</React.Fragment>
        ),
      )}
    </>
  );
}
