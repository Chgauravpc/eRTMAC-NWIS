import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { EVENT_TYPES } from '../../lib/constants';
import { useWells } from '../../lib/hooks/wells';
import { useFormations } from '../../lib/hooks/review';
import { AskPanel } from './AskPanel';
import { SearchResults } from './SearchResults';

const TABS = [
  { id: 'ask', label: 'Ask' },
  { id: 'search', label: 'Search' },
];
const EMPTY_FILTERS = { formation: '', event_type: '', field: '', md_from: '', md_to: '' };
const FIELD = 'rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';
const label = (s) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Depth fields hold digits only; the panels turn them into numbers. */
const isDepth = (v) => v === '' || (/^\d{0,5}(\.\d?)?$/.test(v));

export function SearchPage() {
  const [params] = useSearchParams();
  const initialQuery = params.get('q') || '';
  // A query from the top bar (?q=...) opens the Search tab; otherwise Ask is the default.
  const [tab, setTab] = useState(params.get('tab') === 'search' || initialQuery ? 'search' : 'ask');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const { data: formations } = useFormations();
  const { data: wells } = useWells();

  const fields = useMemo(() => [...new Set((wells || []).map((w) => w.field).filter(Boolean))].sort(), [wells]);
  const set = (key) => (e) => {
    const value = e.target.value;
    if ((key === 'md_from' || key === 'md_to') && !isDepth(value)) return;
    setFilters((prev) => ({ ...prev, [key]: value }));
  };
  const depthOrderBad = filters.md_from !== '' && filters.md_to !== '' && Number(filters.md_from) > Number(filters.md_to);
  const active = Object.values(filters).some((v) => v !== '');

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-gray-600">Knowledge / Query</div>
        <h1 className="mb-3 text-5xl font-medium tracking-tight text-gray-900">Search &amp; Ask</h1>
        <p className="text-lg text-gray-600">Ask a question of the offset-well reports and get an answer with cited pages, or search the text directly.</p>
      </div>

      <div role="tablist" aria-label="Search mode" className="mb-6 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-5 py-2.5 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              tab === t.id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <fieldset className="mb-8 rounded-xl border border-slate-200 bg-white p-4">
        <legend className="px-2 text-xs font-bold uppercase tracking-wider text-slate-600">Filters (both tabs)</legend>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <label className="text-sm font-medium text-slate-700">
            Formation
            <select className={`${FIELD} mt-1 w-full`} value={filters.formation} onChange={set('formation')}>
              <option value="">Any</option>
              {(formations || []).map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Event type
            <select className={`${FIELD} mt-1 w-full`} value={filters.event_type} onChange={set('event_type')}>
              <option value="">Any</option>
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Field
            <select className={`${FIELD} mt-1 w-full`} value={filters.field} onChange={set('field')}>
              <option value="">Any</option>
              {fields.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Depth from (m)
            <input inputMode="decimal" className={`${FIELD} mt-1 w-full`} value={filters.md_from} onChange={set('md_from')} placeholder="0" />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Depth to (m)
            <input inputMode="decimal" className={`${FIELD} mt-1 w-full`} value={filters.md_to} onChange={set('md_to')} placeholder="any" aria-invalid={depthOrderBad || undefined} />
          </label>
        </div>
        {depthOrderBad && <p role="alert" className="mt-2 text-sm font-medium text-red-700">Depth from must not be greater than depth to.</p>}
        {active && (
          <button type="button" onClick={() => setFilters(EMPTY_FILTERS)} className="mt-3 text-sm font-medium text-indigo-700 underline">
            Clear filters
          </button>
        )}
      </fieldset>

      {/* Both panels stay mounted so a question or result list survives a tab switch. */}
      <div id="panel-ask" role="tabpanel" aria-labelledby="tab-ask" hidden={tab !== 'ask'}>
        <AskPanel filters={filters} />
      </div>
      <div id="panel-search" role="tabpanel" aria-labelledby="tab-search" hidden={tab !== 'search'}>
        <SearchResults filters={filters} initialQuery={initialQuery} />
      </div>
    </div>
  );
}

export default SearchPage;
