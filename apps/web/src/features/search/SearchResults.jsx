import React, { useEffect, useRef, useState } from 'react';
import { Search, Loader2, FileText, ChevronRight } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { SourceViewer } from './SourceViewer';
import { Highlighted } from './Highlighted';
import { ProvenanceBadge } from '../wells/ProvenanceBadge';

/** Request body for /api/search (contract §9.2): empty filter fields become null, depths become numbers. */
export function buildSearchBody(q, filters = {}, limit = 20) {
  return {
    q,
    filters: {
      formation: filters.formation || null,
      event_type: filters.event_type || null,
      field: filters.field || null,
      md_from: filters.md_from ? Number(filters.md_from) : null,
      md_to: filters.md_to ? Number(filters.md_to) : null,
    },
    limit,
  };
}

export function SearchResults({ filters, initialQuery = '' }) {
  const [query, setQuery] = useState(initialQuery);
  const [searched, setSearched] = useState(''); // the query the shown results belong to (for highlighting)
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [activeSource, setActiveSource] = useState(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const run = async (text) => {
    const q = text.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/search', { method: 'POST', body: JSON.stringify(buildSearchBody(q, filtersRef.current)) });
      setResults(res?.results || []);
      setSearched(q);
    } catch (err) {
      setResults(null);
      setError(err.message || 'The search failed.');
    } finally {
      setLoading(false);
    }
  };

  // A query that arrives from the top-bar search box runs once on open.
  useEffect(() => {
    if (initialQuery.trim()) run(initialQuery);
  }, [initialQuery]);

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(query);
        }}
        className="relative"
        role="search"
      >
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
          <Search aria-hidden="true" className="h-5 w-5 text-slate-500" />
        </div>
        <input
          type="text"
          aria-label="Search reports"
          className="block w-full rounded-xl border border-slate-300 bg-white py-3 pl-11 pr-28 text-slate-900 shadow-sm placeholder:text-slate-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
          placeholder="Search reports, well names, snippets..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="absolute inset-y-1.5 right-1.5 rounded-lg bg-indigo-700 px-4 text-sm font-medium text-white transition-colors hover:bg-indigo-800 disabled:opacity-50"
        >
          {loading ? <Loader2 aria-label="Searching" className="h-4 w-4 animate-spin" /> : 'Search'}
        </button>
      </form>

      {loading && (
        <div role="status" aria-label="Searching" className="animate-pulse space-y-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-xl border border-slate-200 bg-slate-100" />)}
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
          Search failed: {error}
        </div>
      )}

      {!loading && results && results.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-700">
          No results for &ldquo;{searched}&rdquo;. Try fewer words or clear a filter.
        </div>
      )}

      {!loading && results && results.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-slate-700">
            {results.length} result{results.length === 1 ? '' : 's'} for &ldquo;{searched}&rdquo;
          </h2>
          <ul className="flex flex-col gap-3">
            {results.map((r) => (
              <li key={r.chunk_id}>
                <button
                  type="button"
                  onClick={() => setActiveSource(r)}
                  className="group flex w-full items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 text-left transition-all hover:border-indigo-400 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <div className="shrink-0 rounded-lg bg-indigo-50 p-3 text-indigo-700">
                    <FileText aria-hidden="true" className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold text-slate-900">{r.doc_title}</span>
                      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">Page {r.page}</span>
                      {r.formation && (
                        <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">{r.formation}</span>
                      )}
                      <ProvenanceBadge provenance={r.provenance} light />
                    </div>
                    {r.well_name && <div className="mb-2 text-sm font-medium text-slate-700">{r.well_name}</div>}
                    <p className="line-clamp-3 text-sm leading-relaxed text-slate-700">
                      <Highlighted text={r.snippet} query={searched} />
                    </p>
                  </div>
                  <ChevronRight aria-hidden="true" className="mt-2 h-5 w-5 shrink-0 text-slate-500 transition-colors group-hover:text-indigo-600" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {activeSource && <SourceViewer source={activeSource} query={searched} onClose={() => setActiveSource(null)} />}
    </div>
  );
}
